/**
 * The async database boundary for core services.
 *
 * Everything is async even though better-sqlite3 is synchronous, because the
 * web platform (SQLite-wasm over OPFS) can only be async — the interface has
 * to match the most constrained implementation.
 */

/**
 * Named (`@name`) or positional (`?`) bind parameters.
 *
 * Deliberately loose: existing services spread whole domain objects into
 * named-parameter bags (extra keys unused by the statement included), and the
 * engine itself is the runtime validator — exactly as with better-sqlite3
 * today. Tightening this type would force churn in every ported service for
 * no behavioral gain.
 */
export type SqlParams = Record<string, unknown> | unknown[];

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface DatabaseDriver {
  /** Execute a statement that returns no rows (INSERT/UPDATE/DELETE/DDL). */
  run(sql: string, params?: SqlParams): Promise<RunResult>;

  /** Fetch the first row, or undefined. */
  get<T = unknown>(sql: string, params?: SqlParams): Promise<T | undefined>;

  /** Fetch all rows. */
  all<T = unknown>(sql: string, params?: SqlParams): Promise<T[]>;

  /** Run a multi-statement SQL script (no parameters, no results). */
  exec(sql: string): Promise<void>;

  /**
   * Run `fn` inside a single transaction. Rolls back if `fn` throws,
   * commits otherwise. Transactions are serialized by the driver — callers
   * never observe an interleaved transaction.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
