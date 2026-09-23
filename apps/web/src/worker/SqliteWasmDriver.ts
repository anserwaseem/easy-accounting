import type {
  Database as Sqlite3Database,
  PreparedStatement,
  Sqlite3Static,
  SqlValue,
} from '@sqlite.org/sqlite-wasm';
import type { DatabaseDriver, RunResult, SqlParams } from '@core/db/driver';
import { shouldCompactUnusedPages } from '@core/db/driver';
import { inTransaction, type TxState } from '@core/db/txZone';
import { cast } from '@core/utils/sqlite';

/**
 * `getParamName` exists at runtime (dist/index.mjs) and is documented in
 * dist/README.md, but is missing from the published .d.mts (an upstream
 * typings gap, distinct from the documented `getParamIndex`). Augment
 * locally rather than reaching for `any` at every call site.
 */
type StmtWithParamName = PreparedStatement & {
  getParamName(ndx: number): string | null;
};

/**
 * DatabaseDriver over @sqlite.org/sqlite-wasm's OO1 API (src/core/db/driver.ts
 * semantics), the web counterpart of
 * src/main/adapters/BetterSqliteDriver.ts.
 *
 * The subtle part: core services spread whole domain objects into named
 * ('@name') bind bags, including keys the SQL statement never references
 * (see src/core/db/driver.ts's SqlParams doc comment). better-sqlite3
 * tolerates that silently. sqlite-wasm's `Stmt.bind(object)` does not — it
 * calls `sqlite3_bind_parameter_index()` for *every* object key and throws
 * "Invalid bind() parameter name" the moment one doesn't match a parameter
 * in the statement. It also expects the key to include the sigil exactly as
 * written in the SQL ('@name', not 'name'), which core's spread objects
 * never do.
 *
 * So named binding here does not call `stmt.bind(object)` at all. Instead it
 * walks the statement's own declared parameters (`getParamName(1..count)`),
 * strips the leading sigil, and looks that bare name up in the params
 * object — binding by positional index only for names that are actually
 * present in the params object AND declared by the statement. Params object
 * keys the statement doesn't declare are silently ignored (matching
 * better-sqlite3); statement parameters missing from the params object are
 * left unbound, which SQLite treats as NULL (same as an explicit `null`).
 */
export class SqliteWasmDriver implements DatabaseDriver {
  private readonly sqlite3: Sqlite3Static;

  private readonly db: Sqlite3Database;

  private readonly statements = new Map<string, PreparedStatement>();

  /** Serializes every statement so a concurrent RPC/sync cannot join an open transaction. */
  private txQueue: Promise<unknown> = Promise.resolve();

  private readonly txState: TxState = { depth: 0 };

  private mutationListener: (() => void) | undefined;

  constructor(sqlite3: Sqlite3Static, db: Sqlite3Database) {
    this.sqlite3 = sqlite3;
    this.db = db;
  }

  setMutationListener(listener: (() => void) | undefined): void {
    this.mutationListener = listener;
  }

  private notifyMutation(): void {
    this.mutationListener?.();
  }

  private prepare(sql: string): PreparedStatement {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  /**
   * Coerces a bind value into `SqlValue`, sqlite-wasm's positional
   * `Stmt.bind(idx, value)` type. Booleans are mapped to 0/1 rather than
   * passed through: SQLite has no boolean storage class (core's own
   * `cast()`/`uncastBoolean()` helpers already treat 0/1 as the wire
   * representation — see src/core/utils/sqlite.ts), and sqlite-wasm's
   * two-argument `bind()` overload isn't typed to accept `boolean` even
   * though its single-argument/object form is.
   */
  private static toBindable(value: unknown): SqlValue {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      value instanceof Uint8Array
    ) {
      return value;
    }
    // Same local naive DATETIME core's `cast(Date)` writes. UTC ISO (`Z`)
    // mixed with `datetime(CURRENT_TIMESTAMP, 'localtime')` makes every
    // synced invoice look edited (`updatedAt > createdAt`).
    if (value instanceof Date) return cast(value);
    throw new Error(
      `SqliteWasmDriver: unsupported bind value of type ${typeof value}`,
    );
  }

  private static bindNamed(
    stmt: PreparedStatement,
    params: Record<string, unknown>,
  ): void {
    const { parameterCount } = stmt;
    for (let i = 1; i <= parameterCount; i += 1) {
      const rawName = (stmt as StmtWithParamName).getParamName(i);
      if (!rawName) continue; // anonymous '?' mixed into an otherwise-named statement
      // rawName is e.g. '@username' — strip the sigil to get the bare key
      // core's services use when they build the params object.
      const bareName = rawName.slice(1);
      if (Object.prototype.hasOwnProperty.call(params, bareName)) {
        stmt.bind(i, SqliteWasmDriver.toBindable(params[bareName]));
      }
    }
  }

  private static bindParams(stmt: PreparedStatement, params?: SqlParams): void {
    if (params === undefined) return;
    if (Array.isArray(params)) {
      params.forEach((value, index) => {
        stmt.bind(index + 1, SqliteWasmDriver.toBindable(value));
      });
      return;
    }
    SqliteWasmDriver.bindNamed(stmt, params);
  }

  /** Downcast a rowid to `number` when it's safely representable, else keep the bigint. */
  private static normalizeRowid(rowid: bigint): number | bigint {
    return rowid >= BigInt(Number.MIN_SAFE_INTEGER) &&
      rowid <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(rowid)
      : rowid;
  }

  /**
   * while a transaction is open, nested calls from that same turn run
   * inline. other turns must not reach here: db.worker.ts runs RPCs and
   * background sync one at a time. `txDepth > 0` alone is not safe if a
   * second RPC can enter, and a `Promise#then` patch does not track
   * ES2022 `await`.
   */
  private enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.txState.depth > 0) {
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
    return this.enqueue(async () => {
      const stmt = this.prepare(sql);
      try {
        stmt.clearBindings();
        SqliteWasmDriver.bindParams(stmt, params);
        stmt.step();
        const changes = this.db.changes() as number;
        const lastInsertRowid = SqliteWasmDriver.normalizeRowid(
          this.sqlite3.capi.sqlite3_last_insert_rowid(this.db.pointer!),
        );
        this.notifyMutation();
        return { changes, lastInsertRowid };
      } finally {
        stmt.reset();
      }
    });
  }

  async get<T = unknown>(
    sql: string,
    params?: SqlParams,
  ): Promise<T | undefined> {
    return this.enqueue(async () => {
      const stmt = this.prepare(sql);
      try {
        stmt.clearBindings();
        SqliteWasmDriver.bindParams(stmt, params);
        const hasRow = stmt.step();
        if (!hasRow) return undefined;
        return stmt.get({}) as T;
      } finally {
        stmt.reset();
      }
    });
  }

  async all<T = unknown>(sql: string, params?: SqlParams): Promise<T[]> {
    return this.enqueue(async () => {
      const stmt = this.prepare(sql);
      const rows: T[] = [];
      try {
        stmt.clearBindings();
        SqliteWasmDriver.bindParams(stmt, params);
        while (stmt.step()) {
          rows.push(stmt.get({}) as T);
        }
        return rows;
      } finally {
        stmt.reset();
      }
    });
  }

  async exec(sql: string): Promise<void> {
    return this.enqueue(async () => {
      this.db.exec(sql);
      this.notifyMutation();
    });
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const exec = (sql: string) => {
      this.db.exec(sql);
    };
    if (this.txState.depth > 0) return inTransaction(this.txState, exec, fn);
    return this.enqueue(() => inTransaction(this.txState, exec, fn));
  }

  private readPragmaNumber(name: string): number {
    const stmt = this.db.prepare(`PRAGMA ${name}`);
    try {
      stmt.step();
      const row = stmt.get({}) as Record<string, unknown>;
      return Number(Object.values(row)[0] ?? 0);
    } finally {
      stmt.finalize();
    }
  }

  private finalizeCachedStatements(): void {
    for (const stmt of this.statements.values()) {
      try {
        stmt.finalize();
      } catch {
        // already finalized
      }
    }
    this.statements.clear();
  }

  async compactIfNeeded(): Promise<boolean> {
    if (this.txState.depth > 0) return false;
    return this.enqueue(async () => {
      const pageSize = this.readPragmaNumber('page_size');
      const freelistCount = this.readPragmaNumber('freelist_count');
      if (!shouldCompactUnusedPages(pageSize, freelistCount)) return false;
      this.finalizeCachedStatements();
      this.db.exec('VACUUM');
      return true;
    });
  }
}
