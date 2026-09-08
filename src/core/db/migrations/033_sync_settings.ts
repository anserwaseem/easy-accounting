import type { DatabaseDriver } from '../driver';
import { SECRET_SETTING_KEYS } from '../../services/settingsSecrets';
import {
  createCaptureTriggers,
  UUID_V4_SQL_EXPR,
} from './029_create_sync_tables';

/**
 * Migration 033 — makes the `settings` table (migration 028: company
 * profile, invoice print settings, and the publish feature's non-secret
 * business fields — see src/core/services/SettingsService.ts) replicate
 * across devices via the same sync machinery every other business table
 * uses (migration 029 — src/core/db/migrations/029_create_sync_tables.ts).
 * Has a desktop-side twin, `src/main/migrations/033.js` — same reason
 * migrations 028-032 do (see 030's doc comment): the existing Electron
 * install path runs schema changes exclusively through the old synchronous
 * `MigrationRunner`, which never calls `bootstrapDatabase`, so a schema
 * change meant to reach it has to be expressed twice.
 *
 * ## Why `settings` needed a schema change first
 *
 * Migration 029's capture-trigger machinery assumes every replicated table
 * has an `INTEGER` `id` primary key plus a `uuid` column — that is what a
 * capture trigger's `WHERE t."id" = NEW."id"` self-select and the
 * `ON CONFLICT("uuid")` upsert in `SyncEngine.applyRow` both key off. The
 * `settings` table migration 028 created has neither: `key TEXT PRIMARY
 * KEY, value TEXT, updatedAt DATETIME`. This migration rebuilds it to the
 * standard shape — `id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL
 * UNIQUE, value TEXT, updatedAt DATETIME, uuid TEXT` — preserving `key`'s
 * uniqueness (still enforced, just via a `UNIQUE` constraint instead of
 * being the primary key) and every existing row, then installs the same
 * three capture triggers (via {@link createCaptureTriggers}, the exact
 * builder 029/031 already use) any other business table gets.
 *
 * SQLite has no `ALTER TABLE ... DROP CONSTRAINT` / "change the primary
 * key" — the standard rebuild recipe (create the new shape under a
 * temporary name, copy rows across, drop the old table, rename the new one
 * into place) is what below does. This runs unconditionally guarded on
 * "does `settings` already have an `id` column" rather than assuming it
 * never ran before, so calling `up()` more than once (this migration's own
 * idempotency test, and any future re-bootstrap) is a safe no-op past the
 * first run — the normal `CORE_MIGRATIONS` bookkeeping in
 * src/core/db/bootstrap.ts already prevents a second run in production, but
 * this migration does not rely on that alone.
 *
 * ## Per-key last-writer-wins, not per-row
 *
 * Every other replicated table's natural identity is a row's uuid — two
 * devices independently creating "the same" row (say, two accounts named
 * "Cash") are two different rows, on purpose. `settings` is different:
 * there is exactly one row per `key`, and the whole point of syncing it is
 * that when two devices each set `companyProfile.name` before ever syncing
 * with each other, the project should converge on ONE value, not keep two
 * rows both claiming to be "the" company name. That is why `settings.key`
 * carries its own `UNIQUE` constraint independent of `uuid`, and why
 * `SyncEngine.applyRow` needs a small table-specific pre-step for it — see
 * that file's `NATURAL_KEY_TABLES` doc comment for the mechanism. This
 * migration's job is only to make `settings` shaped like a normal
 * replicated table; the per-key convergence behavior lives in
 * `SyncEngine`.
 *
 * ## Corrective outbox seeding
 *
 * A device that already has settings saved (company name typed in before
 * this migration ever ran) needs those values to actually reach the
 * server once it upgrades — the schema rebuild alone only affects what
 * happens on the *next* write. This migration therefore emits one
 * corrective `put` per existing row into `sync_outbox`, exactly the same
 * pattern migration 031 uses for `users`. Two differences from 031's
 * version:
 *
 *  1. **No credential-style gating is needed** — unlike 031's
 *     `password_hash IS NOT NULL` guard (which exists because a
 *     credential-less device must never re-emit its own broken copy over a
 *     good one), every device's copy of a given settings key is equally
 *     "real" data as far as this migration is concerned; last-writer-wins
 *     by log order settles any actual disagreement between devices, as
 *     described above.
 *  2. **Secret keys are excluded.** {@link SECRET_SETTING_KEYS}
 *     (../../services/settingsSecrets.ts) lists keys that must never enter
 *     this table at all — `SettingsService.set()` has always been the only
 *     writer and has rejected them from the moment this migration lands
 *     (see that class's doc comment), so in practice no row under one of
 *     these keys should exist to seed a corrective row for. Excluded here
 *     anyway, defensively, rather than trusting that invariant blindly: if
 *     one somehow already exists (a hand-edited database, a pre-guard
 *     build that briefly wrote one), this migration must not be the thing
 *     that pushes it out to every other device.
 */
export const migration033 = {
  name: '033_sync_settings',
  async up(driver: DatabaseDriver): Promise<void> {
    const columns = await driver.all<{ name: string }>(
      `PRAGMA table_info("settings")`,
    );
    const hasId = columns.some((c) => c.name === 'id');

    if (!hasId) {
      await driver.exec(`
        CREATE TABLE settings_sync_rebuild (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          value TEXT,
          updatedAt DATETIME,
          uuid TEXT
        )
      `);
      await driver.exec(`
        INSERT INTO settings_sync_rebuild (key, value, updatedAt)
        SELECT key, value, updatedAt FROM settings
      `);
      await driver.exec(`DROP TABLE settings`);
      await driver.exec(`ALTER TABLE settings_sync_rebuild RENAME TO settings`);
    }

    // Backfill uuid for any row that doesn't have one yet — every row just
    // copied across by the rebuild above, on a first run; a defensive no-op
    // on a re-run (createCaptureTriggers' own insert trigger only assigns a
    // uuid going forward, not to rows that already existed before it was
    // installed).
    const pending = await driver.all<{ id: number }>(
      `SELECT id FROM settings WHERE uuid IS NULL`,
    );
    for (const row of pending) {
      // eslint-disable-next-line no-await-in-loop
      await driver.run(
        `UPDATE settings SET uuid = ${UUID_V4_SQL_EXPR} WHERE id = @id`,
        { id: row.id },
      );
    }

    await driver.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_settings_uuid" ON "settings"("uuid")`,
    );

    // Drop before recreating, unconditionally — not just defensive
    // "belt-and-braces" cleanup. `SYNC_TABLES` (migration 029) is derived
    // from `BUSINESS_TABLES` at CALL time, not frozen at migration-029's
    // original authoring time, so on a brand-new install (every
    // CORE_MIGRATIONS entry running back-to-back in one bootstrap sweep —
    // see src/core/db/bootstrap.ts) migration 029 itself already loops over
    // `SYNC_TABLES` and, now that `settings` is a member, tries to install
    // capture triggers for it — while `settings` still has migration 028's
    // OLD shape (no `id`/`uuid` yet, since this migration hasn't run). That
    // succeeds (`CREATE TRIGGER` never validates column references at
    // creation time) and produces a trigger built from migration 029's
    // narrower, pre-rebuild column snapshot. Calling `createCaptureTriggers`
    // below with a bare `CREATE TRIGGER IF NOT EXISTS` would then silently
    // keep THAT stale trigger instead of replacing it — on an UPGRADING
    // device (where migration 029 already ran, historically, before
    // `settings` was ever a sync table, and is therefore skipped this run)
    // there is nothing to drop, so this is a harmless no-op there. Same
    // defensive pattern migration 031 uses for the same class of problem
    // (see that migration's doc comment).
    await driver.exec(
      `DROP TRIGGER IF EXISTS "trg_sync_capture_settings_insert"`,
    );
    await driver.exec(
      `DROP TRIGGER IF EXISTS "trg_sync_capture_settings_update"`,
    );
    await driver.exec(
      `DROP TRIGGER IF EXISTS "trg_sync_capture_settings_delete"`,
    );
    await createCaptureTriggers(driver, 'settings');

    // Corrective row images for every existing setting except secrets — see
    // this migration's doc comment ("Corrective outbox seeding").
    //
    // One `INSERT ... SELECT ${UUID_V4_SQL_EXPR}, ... FROM settings` doing
    // all rows at once — the pattern migration 031 uses for its own
    // corrective `users` re-emission — looks tempting here but is wrong for
    // more than one matching row: `UUID_V4_SQL_EXPR` is a non-correlated
    // scalar subquery (it references none of the outer query's columns),
    // and SQLite's query planner evaluates a non-correlated subquery ONCE
    // per statement, not once per output row — confirmed empirically
    // against the better-sqlite3 build this app ships
    // (`SELECT (SELECT lower(hex(randomblob(4)))) FROM t` returns the SAME
    // value for every row of a 3-row `t`). A single bulk INSERT here would
    // therefore try to give every seeded row the SAME `idempotencyKey`,
    // which `sync_outbox.idempotencyKey`'s own `UNIQUE` constraint rejects
    // outright once more than one non-secret setting exists (migration
    // 031's own version of this pattern only ever matches at most one
    // `users` row in practice — `password_hash IS NOT NULL` — so it has
    // never hit this). Looping in JS and issuing one INSERT per row instead
    // sidesteps it entirely: each `driver.run` call is its own statement
    // execution, so `UUID_V4_SQL_EXPR` is (re-)evaluated fresh every time.
    const excluded = SECRET_SETTING_KEYS.map((k) => `'${k}'`).join(', ');
    const toSeed = await driver.all<{
      key: string;
      value: string | null;
      updatedAt: string | null;
      uuid: string;
    }>(
      `SELECT key, value, updatedAt, uuid FROM settings WHERE key NOT IN (${excluded})`,
    );
    for (const setting of toSeed) {
      // eslint-disable-next-line no-await-in-loop
      await driver.run(
        `INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
         VALUES (${UUID_V4_SQL_EXPR}, 'settings', @rowUuid, 'put', @rowJson, datetime('now'))`,
        {
          rowUuid: setting.uuid,
          rowJson: JSON.stringify({
            key: setting.key,
            value: setting.value,
            updatedAt: setting.updatedAt,
            uuid: setting.uuid,
          }),
        },
      );
    }
  },
};
