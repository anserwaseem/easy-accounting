import type { DatabaseDriver } from '../db/driver';
import { SYNC_TABLES } from '../db/migrations/034_create_sync_tables';

/** `sync_state` key holding the JSON array of tables still to re-pull */
export const REPULL_TABLES_KEY = 'repull_tables';
/** `sync_state` key holding the re-pull's own cursor, separate from the main `cursor` */
export const REPULL_CURSOR_KEY = 'repull_cursor';

const SYNC_TABLE_SET: ReadonlySet<string> = new Set(SYNC_TABLES);

/**
 * Queues a re-download of every server log row for `tables` on this
 * device. The heal path for "a device skipped rows it should have applied"
 * (the 044 incident) that does NOT reset the main `sync_state.cursor`.
 *
 * Migration 044 reset `cursor` to 0, so every synced device re-downloaded
 * the entire log (~147k rows, ~170 MB of Supabase egress on one day of a
 * 5 GB/month free plan). This instead fetches only rows whose `table_name`
 * is in `tables` (filtered server-side, see `PullOptions.tables`), with its
 * own cursor, so it resumes after a dropped connection and the main pull
 * keeps running normally. `SyncEngine.syncOnce` runs it, then clears both
 * keys.
 *
 * Call it from a migration. It writes only `sync_state` (not replicated, no
 * capture triggers). Returns false without writing on a device that has
 * never synced: its first ordinary pull starts at 0 and gets everything
 * anyway. Calling it while a re-pull is already queued merges the table
 * lists and restarts from 0, because the added tables need the whole log.
 */
export async function scheduleTableRepull(
  db: DatabaseDriver,
  tables: readonly string[],
): Promise<boolean> {
  const unknown = tables.filter((table) => !SYNC_TABLE_SET.has(table));
  if (unknown.length > 0) {
    throw new Error(
      `scheduleTableRepull: not replicated tables: ${unknown.join(', ')}`,
    );
  }
  if (tables.length === 0) return false;

  const cursor = await db.get<{ value: string }>(
    `SELECT value FROM sync_state WHERE key = 'cursor'`,
  );
  if (!cursor || Number(cursor.value) <= 0) return false;

  const merged = [
    ...new Set([...((await loadScheduledRepull(db)) ?? []), ...tables]),
  ].sort();
  await db.run(
    `INSERT INTO sync_state (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    { key: REPULL_TABLES_KEY, value: JSON.stringify(merged) },
  );
  await db.run(
    `INSERT INTO sync_state (key, value) VALUES (@key, '0')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    { key: REPULL_CURSOR_KEY },
  );
  return true;
}

/**
 * the queued table list. null means nothing is queued; an empty array means
 * a value is stored but holds no usable table (unreadable or unknown names),
 * which the caller should clear rather than retry forever.
 */
export async function loadScheduledRepull(
  db: DatabaseDriver,
): Promise<string[] | null> {
  const row = await db.get<{ value: string }>(
    `SELECT value FROM sync_state WHERE key = @key`,
    { key: REPULL_TABLES_KEY },
  );
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (table): table is string =>
        typeof table === 'string' && SYNC_TABLE_SET.has(table),
    );
  } catch {
    return [];
  }
}

export async function clearScheduledRepull(db: DatabaseDriver): Promise<void> {
  await db.run(`DELETE FROM sync_state WHERE key IN (@tables, @cursor)`, {
    tables: REPULL_TABLES_KEY,
    cursor: REPULL_CURSOR_KEY,
  });
}
