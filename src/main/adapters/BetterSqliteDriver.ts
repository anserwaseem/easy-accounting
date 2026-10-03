import type BetterSqlite3 from 'better-sqlite3';
import { AsyncLocalStorage } from 'async_hooks';
import type {
  DatabaseDriver,
  RunResult,
  SqlParams,
} from '../../core/db/driver';
import { shouldCompactUnusedPages } from '../../core/db/driver';
import { inTransaction, type TxState } from '../../core/db/txZone';

/**
 * AsyncLocalStorage follows native `await`. A `Promise#then` patch does not
 * (ES2022 / V8). The store is the transaction token; any other IPC or timer
 * sees `undefined` and waits on `txQueue` instead of joining the BEGIN.
 */
const txAls = new AsyncLocalStorage<symbol>();

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

  /** Serializes every statement so a concurrent caller cannot join an open transaction. */
  private txQueue: Promise<unknown> = Promise.resolve();

  private readonly txState: TxState = { depth: 0 };

  /** token of the open transaction; matches `txAls` only on the owning turn */
  private token: symbol | undefined;

  private mutationListener: (() => void) | undefined;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  setMutationListener(listener: (() => void) | undefined): void {
    this.mutationListener = listener;
  }

  private notifyMutation(): void {
    const listener = this.mutationListener;
    if (!listener) return;
    // a timer scheduled from the listener must not inherit the transaction
    // token, or the deferred sync would run inside the open BEGIN.
    txAls.exit(() => {
      listener();
    });
  }

  private ownsTx(): boolean {
    return this.txState.depth > 0 && txAls.getStore() === this.token;
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

  /**
   * owner of the open transaction runs inline (queueing would deadlock:
   * the transaction job is waiting on `fn`, and `fn` is waiting on this
   * call). every other caller waits until that job finishes, so it cannot
   * read or write inside the open BEGIN.
   */
  private enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.ownsTx()) {
      try {
        return Promise.resolve(fn());
      } catch (error) {
        return Promise.reject(error);
      }
    }
    const next = this.txQueue.then(fn, fn);
    this.txQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async run(sql: string, params?: SqlParams): Promise<RunResult> {
    return this.enqueue(() => {
      const stm = this.prepare(sql);
      const result = stm.run(...BetterSqliteDriver.bind(stm, params));
      this.notifyMutation();
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    });
  }

  async get<T = unknown>(
    sql: string,
    params?: SqlParams,
  ): Promise<T | undefined> {
    return this.enqueue(() => {
      const stm = this.prepare(sql);
      return stm.get(...BetterSqliteDriver.bind(stm, params)) as T | undefined;
    });
  }

  async all<T = unknown>(sql: string, params?: SqlParams): Promise<T[]> {
    return this.enqueue(() => {
      const stm = this.prepare(sql);
      return stm.all(...BetterSqliteDriver.bind(stm, params)) as T[];
    });
  }

  async exec(sql: string): Promise<void> {
    return this.enqueue(() => {
      this.db.exec(sql);
      this.notifyMutation();
    });
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const exec = (sql: string) => {
      this.db.exec(sql);
    };
    if (this.ownsTx()) return inTransaction(this.txState, exec, fn);
    const token = Symbol('core-tx');
    return this.enqueue(() =>
      txAls.run(token, async () => {
        this.token = token;
        try {
          return await inTransaction(this.txState, exec, fn);
        } finally {
          this.token = undefined;
        }
      }),
    );
  }

  async compactIfNeeded(): Promise<boolean> {
    // vacuum cannot run inside a transaction. the owner skips; everyone
    // else waits until the transaction releases the connection.
    if (this.ownsTx()) return false;
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
