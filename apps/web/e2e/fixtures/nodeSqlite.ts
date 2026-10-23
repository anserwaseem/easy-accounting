/**
 * A tiny better-sqlite3-shaped wrapper over Node's built-in `node:sqlite`.
 *
 * Why not just use better-sqlite3? The e2e suite runs in plain Node, and the
 * only better-sqlite3 in this repo lives in release/app/node_modules — the
 * packaged Electron build's own copy, compiled for Electron 25's ABI
 * (NODE_MODULE_VERSION 116). Plain Node (24 = 137, 20 = 115) can never load
 * it: "compiled against a different Node.js version". Node's built-in
 * `node:sqlite` is the same SQLite engine with no ABI coupling at all, so
 * the e2e fixtures can build and inspect real SQLite files on any modern
 * Node without dragging the packaged app's native module along.
 *
 * The surface is deliberately narrow — only what the frozen migrations
 * (src/main/migrations/001.js..028.js) and the fixtures themselves use:
 * `prepare(...).run/all/get`, `exec`, `transaction(fn)()` and `close`.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
  /** better-sqlite3's `db.transaction(fn)` — calling the result runs `fn` in a transaction. */
  transaction<TArgs extends unknown[]>(
    fn: (...args: TArgs) => unknown,
  ): (...args: TArgs) => unknown;
}

/** the slice of node:sqlite's DatabaseSync/StatementSync this wrapper uses */
interface NodeSqliteStatement {
  run(...params: unknown[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface NodeSqliteDatabase {
  prepare(sql: string): NodeSqliteStatement;
  exec(sql: string): void;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (
    path: string,
    options?: {
      readOnly?: boolean;
      enableForeignKeyConstraints?: boolean;
    },
  ) => NodeSqliteDatabase;
}

function loadNodeSqlite(): NodeSqliteModule {
  try {
    return require('node:sqlite') as NodeSqliteModule;
  } catch (error) {
    throw new Error(
      'node:sqlite is unavailable in this Node runtime. The web e2e fixtures ' +
        'need Node >= 22.5 (24 recommended) — check `node --version`.',
      { cause: error },
    );
  }
}

/**
 * Wraps a node:sqlite database so it looks like better-sqlite3 to the
 * migrations: `run()` results come back with plain numbers, and
 * `transaction(fn)` is a callable that wraps `fn` in BEGIN/COMMIT (nested
 * calls use SAVEPOINTs, like better-sqlite3 does).
 */
function wrap(db: NodeSqliteDatabase): SqliteDatabase {
  let depth = 0;

  const transaction = <TArgs extends unknown[]>(
    fn: (...args: TArgs) => unknown,
  ) => {
    return (...args: TArgs): unknown => {
      const nested = depth > 0;
      const savepoint = `e2e_sp_${depth}`;
      db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
      depth += 1;
      try {
        const result = fn(...args);
        depth -= 1;
        db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (error) {
        depth -= 1;
        db.exec(
          nested
            ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`
            : 'ROLLBACK',
        );
        throw error;
      }
    };
  };

  return {
    prepare(sql: string): SqliteStatement {
      const statement = db.prepare(sql);
      return {
        run(...params: unknown[]): SqliteRunResult {
          const result = statement.run(...params);
          return {
            changes: Number(result.changes),
            lastInsertRowid: Number(result.lastInsertRowid),
          };
        },
        get: (...params: unknown[]) => statement.get(...params),
        all: (...params: unknown[]) => statement.all(...params),
      };
    },
    exec: (sql: string) => db.exec(sql),
    close: () => db.close(),
    transaction,
  };
}

/**
 * Opens a SQLite file (or `:memory:`) through Node's built-in `node:sqlite`.
 * `readOnly` mirrors better-sqlite3's `{ readonly: true }` option, used by
 * the export spec to inspect a downloaded database without touching it.
 */
export function openNodeSqlite(
  filePath: string,
  options: { readOnly?: boolean } = {},
): SqliteDatabase {
  const { DatabaseSync } = loadNodeSqlite();
  const db = new DatabaseSync(filePath, {
    readOnly: options.readOnly ?? false,
    // better-sqlite3 leaves foreign keys OFF by default; node:sqlite turns
    // them ON. The frozen migrations toggle the pragma themselves, but the
    // fixture's seeding statements should behave the way they do on the
    // desktop app, where FKs are off outside a migration.
    enableForeignKeyConstraints: false,
  });
  return wrap(db);
}
