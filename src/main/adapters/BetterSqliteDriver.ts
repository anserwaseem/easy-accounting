import type BetterSqlite3 from 'better-sqlite3';
import type {
  DatabaseDriver,
  RunResult,
  SqlParams,
} from '../../core/db/driver';
import { shouldCompactUnusedPages } from '../../core/db/driver';

/**
 * DatabaseDriver over a better-sqlite3 connection (Electron main / Node).
 *
 * better-sqlite3 is synchronous, so every method resolves immediately; the
 * async surface exists to match the web driver (SQLite-wasm), which cannot
 * be sync. Prepared statements are cached per SQL string, preserving the
 * performance profile of the previous hand-prepared statements.
 */
export class BetterSqliteDriver implements DatabaseDriver {
  private readonly db: BetterSqlite3.Database;

  private readonly statements = new Map<string, BetterSqlite3.Statement>();

  /** Serializes transactions so async callers can never interleave them. */
  private txQueue: Promise<unknown> = Promise.resolve();

  /** Savepoint depth for transactions opened inside transactions. */
  private txDepth = 0;

  private mutationListener: (() => void) | undefined;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  setMutationListener(listener: (() => void) | undefined): void {
    this.mutationListener = listener;
  }

  private notifyMutation(): void {
    this.mutationListener?.();
  }

  private prepare(sql: string): BetterSqlite3.Statement {
    let stm = this.statements.get(sql);
    if (!stm) {
      stm = this.db.prepare(sql);
      this.statements.set(sql, stm);
    }
    return stm;
  }

  private static bind(stm: BetterSqlite3.Statement, params?: SqlParams) {
    if (params === undefined) return [] as unknown[];
    return Array.isArray(params) ? params : [params];
  }

  async run(sql: string, params?: SqlParams): Promise<RunResult> {
    const stm = this.prepare(sql);
    const result = stm.run(...BetterSqliteDriver.bind(stm, params));
    this.notifyMutation();
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  async get<T = unknown>(
    sql: string,
    params?: SqlParams,
  ): Promise<T | undefined> {
    const stm = this.prepare(sql);
    return stm.get(...BetterSqliteDriver.bind(stm, params)) as T | undefined;
  }

  async all<T = unknown>(sql: string, params?: SqlParams): Promise<T[]> {
    const stm = this.prepare(sql);
    return stm.all(...BetterSqliteDriver.bind(stm, params)) as T[];
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
    this.notifyMutation();
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const runInTx = async (): Promise<T> => {
      const isNested = this.txDepth > 0;
      const savepoint = `core_tx_${this.txDepth}`;
      this.db.exec(isNested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
      this.txDepth += 1;
      try {
        const result = await fn();
        this.txDepth -= 1;
        this.db.exec(isNested ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (error) {
        this.txDepth -= 1;
        this.db.exec(isNested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
        if (isNested) this.db.exec(`RELEASE ${savepoint}`);
        throw error;
      }
    };

    // Outermost transactions queue behind each other; nested ones (called
    // from inside fn) must run inline or they would deadlock on the queue.
    if (this.txDepth > 0) {
      return runInTx();
    }
    const next = this.txQueue.then(runInTx, runInTx);
    // Keep the chain alive regardless of this transaction's outcome.
    this.txQueue = next.catch(() => undefined);
    return next;
  }

  async compactIfNeeded(): Promise<boolean> {
    if (this.txDepth > 0) return false;
    const run = async (): Promise<boolean> => {
      const pageSize = Number(this.db.pragma('page_size', { simple: true }));
      const freelistCount = Number(
        this.db.pragma('freelist_count', { simple: true }),
      );
      if (!shouldCompactUnusedPages(pageSize, freelistCount)) return false;
      // drop cached stmts so VACUUM is not racing in-flight SQL. do not
      // notifyMutation — this is housekeeping, not a business write.
      this.statements.clear();
      this.db.exec('VACUUM');
      return true;
    };
    const next = this.txQueue.then(run, run);
    this.txQueue = next.catch(() => undefined);
    return next;
  }
}
