import type { DatabaseDriver } from '../driver';
import {
  allColumnInfo,
  createCaptureTriggers,
  foreignKeys,
  jsonObjectExpr,
  SYNC_TABLES,
} from './029_create_sync_tables';

/**
 * Migration 031 — fixes a field bug in migration 029's capture triggers: any
 * column declared `BLOB` in the schema (today, only `users.password_hash`)
 * was filtered out of every captured row image entirely (see migration 029's
 * `allColumnInfo` doc comment for the mechanism and why it was wrong). In
 * practice that meant `users` replicated across devices with NO credential
 * material at all — a second device that joined a sync project got the
 * employee record but could never log into it, because nothing it received
 * ever carried a usable `password_hash`. Has a desktop-side twin,
 * `src/main/migrations/031.js` — same reason migrations 028/029/030 do (see
 * `030_create_sync_apply_conflicts.ts`'s doc comment): the existing Electron
 * install path runs schema changes exclusively through the old synchronous
 * `MigrationRunner`, which never calls `bootstrapDatabase`, so a schema
 * change meant to reach it has to be expressed twice.
 *
 * The fix itself — capturing a declared-blob column as a `<col>`/`<col>__hex`
 * typed pair, decoded back into a real blob on apply — lives in migration
 * 029's trigger builder (`jsonObjectExpr`/`createCaptureTriggers`,
 * src/core/db/migrations/029_create_sync_tables.ts) and
 * `SyncEngine.applyRow`, not here: a *fresh* bootstrap already gets the fixed
 * triggers straight from 029, since `CORE_MIGRATIONS` runs in order and 029
 * itself now builds them correctly. This migration exists purely to carry
 * that fix to a database that already ran the OLD (buggy) 029 and therefore
 * has the old, blob-excluding triggers installed. It does two things:
 *
 * 1. **Recreates the capture triggers** for every {@link SYNC_TABLES} table
 *    that has at least one declared-blob column (introspected via `PRAGMA
 *    table_info` — today that's only `users`; nothing else in this schema
 *    declares a BLOB column). The three `trg_sync_capture_<table>_*`
 *    triggers are dropped and rebuilt via {@link createCaptureTriggers} —
 *    the exact same builder 029 itself uses, not a duplicate of the SQL —
 *    so any future BLOB column added to any replicated table is covered by
 *    this same loop without further changes here. Every OTHER replicated
 *    table is left completely untouched: its triggers already came from 029
 *    (fixed or not, the trigger SQL for a table with no blob column is
 *    unaffected by this migration's own trigger-generation change) and
 *    dropping/recreating them would be pure churn.
 *
 * 2. **Re-emits corrective row images for `users`** — the whole reason a
 *    schema-only fix (item 1) isn't sufficient on its own: recreating the
 *    triggers only changes what happens on the NEXT write to `users`; it
 *    does nothing for `users` rows that were already captured (with a
 *    missing credential) under the old, buggy triggers and already pushed to
 *    the server's log. Those bad row images are sitting in every OTHER
 *    device's already-applied `users` table too. Fixing that requires
 *    pushing a corrective `put` for every LOCAL `users` row that actually has
 *    a credential, so the (now-fixed) row image reaches every device that
 *    pulls it, the same way any other application-level `UPDATE` would.
 *
 *    **The `password_hash IS NOT NULL` guard on that INSERT is
 *    load-bearing, not a cosmetic filter**: a device that joined the sync
 *    project via the pre-fix pull path (`SyncEngine.initialPull` / the "join
 *    existing sync" flow) holds a `users` row with NO credential at all —
 *    that is precisely the bug this migration fixes for future writes, but
 *    it means *this specific device's own copy* of that row is the bad one,
 *    not the good one. If this migration re-emitted a corrective row for
 *    every `users` row regardless of `password_hash`, a hash-less device
 *    would push its own hash-less row right back out to the log — and
 *    because the server's log is last-writer-wins by log order, that
 *    corrective-but-still-broken row could land AFTER (and so clobber) the
 *    genuinely-good row a different, credential-holding device already
 *    emitted. Gating on `password_hash IS NOT NULL` means only a device that
 *    actually holds a real credential for a `users` row ever re-emits it —
 *    exactly the set of devices whose re-emission can only ever repair the
 *    row, never regress it.
 */
export const migration031 = {
  name: '031_replicate_blob_columns',
  async up(driver: DatabaseDriver): Promise<void> {
    for (const table of SYNC_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      const columns = await allColumnInfo(driver, table);
      if (!columns.some((c) => c.isBlob)) continue; // no declared-blob column on this table — nothing to fix here

      // eslint-disable-next-line no-await-in-loop
      await driver.exec(
        `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_insert"`,
      );
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(
        `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_update"`,
      );
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(
        `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_delete"`,
      );
      // eslint-disable-next-line no-await-in-loop
      await createCaptureTriggers(driver, table);
    }

    // Corrective row images for `users` only — see this migration's doc
    // comment for why `password_hash IS NOT NULL` is load-bearing here (a
    // hash-less local copy must never re-emit itself and clobber a good row
    // via last-writer-wins log order).
    const usersColumns = await allColumnInfo(driver, 'users');
    const usersFks = await foreignKeys(driver, 'users');
    const usersSelfJson = jsonObjectExpr(
      usersColumns,
      usersFks,
      (col) => `u."${col}"`,
    );

    // idempotencyKey is derived from the row's own uuid, NOT from
    // UUID_V4_SQL_EXPR: that expression is a non-correlated scalar subquery,
    // which SQLite evaluates ONCE per statement rather than once per output
    // row — in a bulk INSERT...SELECT matching more than one user (any
    // business with two or more employee logins) every seeded row would get
    // the SAME key and hit sync_outbox's UNIQUE(idempotencyKey) constraint,
    // failing the whole migration. (Found while building migration 033's
    // analogous settings seeding, where the multi-row case is the norm; a
    // deterministic per-row key is also harmlessly idempotent server-side.)
    await driver.exec(`
      INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
      SELECT u."uuid" || ':corrective-031', 'users', u."uuid", 'put', ${usersSelfJson}, datetime('now')
      FROM "users" u
      WHERE u."password_hash" IS NOT NULL
    `);
  },
};
