import type {
  Database as Sqlite3Database,
  Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';

/**
 * Opens a byte array (an uploaded `.db` file's contents) as a second,
 * independent, in-memory sqlite-wasm database — the sqlite-wasm-specific
 * half of the "bring your database" importer (see src/core/db/import.ts for
 * the platform-free half that actually copies rows once this handle
 * exists).
 *
 * @sqlite.org/sqlite-wasm (this app pins 3.53.0-build1 — see
 * apps/web/package.json) exposes no convenience "open these bytes as a
 * database" call on `sqlite3.oo1.DB`'s constructor — that constructor only
 * opens a *named* file against a VFS (`:memory:`, an OPFS path, ...), never
 * an in-memory byte buffer directly. The documented way to get bytes into a
 * live connection is the lower-level C API surface `sqlite3.capi` mirrors
 * one-for-one:
 *
 *   1. `sqlite3.wasm.allocFromTypedArray(bytes)` copies the bytes into
 *      wasm linear memory and returns a pointer to them.
 *   2. `new sqlite3.oo1.DB(':memory:', 'c')` opens a normal empty
 *      in-memory database and gives us a `db.pointer` (the underlying
 *      `sqlite3*`) to attach the bytes to.
 *   3. `sqlite3.capi.sqlite3_deserialize(db.pointer, 'main', ptr,
 *      bytes.length, bytes.length, flags)` replaces that empty database's
 *      "main" schema with the deserialized content in one call — this is
 *      the wasm binding of https://sqlite.org/c3ref/deserialize.html.
 *
 * Flags: `SQLITE_DESERIALIZE_FREEONCLOSE` tells sqlite3 to free the wasm
 * allocation from step 1 itself when the `DB` is closed, so the caller
 * doesn't have to track and separately free that pointer.
 * `SQLITE_DESERIALIZE_RESIZEABLE` lets sqlite3 reallocate the buffer if a
 * write ever needs to grow it — not something an import's read-only source
 * needs, but harmless to allow and avoids a surprise failure if that ever
 * changes.
 *
 * Returned as a plain `Sqlite3Database` (the same type
 * `apps/web/src/worker/SqliteWasmDriver.ts` already wraps) — callers wrap it
 * in a `SqliteWasmDriver` themselves so it satisfies the platform-free
 * `DatabaseDriver` port, exactly like the destination database.
 */
export function openDeserializedDatabase(
  sqlite3: Sqlite3Static,
  bytes: Uint8Array,
): Sqlite3Database {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const ptr = sqlite3.wasm.allocFromTypedArray(bytes);
  const flags =
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
    sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
  const rc = sqlite3.capi.sqlite3_deserialize(
    db.pointer!,
    'main',
    ptr,
    bytes.length,
    bytes.length,
    flags,
  );
  if (rc !== sqlite3.capi.SQLITE_OK) {
    db.close();
    throw new Error(
      `Could not open the uploaded file as a SQLite database (sqlite3_deserialize rc=${rc}). ` +
        `It may be corrupt or not a SQLite file.`,
    );
  }
  return db;
}
