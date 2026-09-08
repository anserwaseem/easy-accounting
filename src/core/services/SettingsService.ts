import type { DatabaseDriver } from '../db/driver';
import { logErrors } from '../errorLogger';
import { isSecretSettingKey } from './settingsSecrets';

const SQL = {
  get: `SELECT value FROM settings WHERE key = @key`,
  set: `
      INSERT INTO settings (key, value, updatedAt) VALUES (@key, @value, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
    `,
  delete: `DELETE FROM settings WHERE key = @key`,
  getAll: `SELECT key, value FROM settings`,
};

/**
 * Platform-free reader/writer for the `settings` table (migration 028 —
 * see src/core/db/migrations/index.ts). Business settings live here now
 * instead of device-local storage (electron-store on desktop,
 * localStorage/web_kv on web), so they ride multi-device sync later and
 * ship in backups/exports today.
 *
 * Values are JSON-encoded in the `value` column, so any JSON-serializable
 * value round-trips (string, number, boolean, object, array) — the same
 * convention apps/web/src/worker/db.worker.ts's `web_kv` table already
 * uses for the same reason.
 *
 * Deliberately NOT the same thing as the `KeyValueStore` port
 * (src/core/ports.ts): that port is synchronous by contract (electron-store
 * and the web's in-memory-cached `web_kv` can both satisfy it, and
 * InventoryService relies on reading it inline, mid-query) and is used for
 * device/session-local values plus the one still-electron-store-backed
 * publish field (`publish.reservedNameChars`) that has not moved here — see
 * src/main/utils/publishConfig.ts's doc comment. `SettingsService` is async,
 * DB-backed, and is what the renderer's `settings:get/set/delete/getAll`
 * AppApi calls (src/core/api/AppApi.ts) are served by on both platforms.
 *
 * As of migration 033 (src/core/db/migrations/033_sync_settings.ts), the
 * `settings` table replicates across every device on a sync project — every
 * successful `set()` is captured into `sync_outbox` and pushed to whatever
 * server this device is connected to, exactly like any other business
 * table's row. That makes `set()` the one and only gate that can stop a
 * secret from leaving this device: {@link SECRET_SETTING_KEYS}
 * (./settingsSecrets.ts) lists every key this table must never hold, and
 * `set()` throws rather than write one. Nothing today calls `set()` with one
 * of those keys — the publish feature's secrets are written straight to
 * platform-local storage instead (desktop: electron-store, encrypted via
 * `safeStorage`; web: `web_kv`) and never reach this class at all — so this
 * is a hard backstop against a future regression re-routing a secret through
 * here, not a guard against anything that happens in practice today. There
 * is no separate desktop twin of this class: unlike the migrations
 * (028/029/030/031/032/033), `SettingsService` has always been the single
 * platform-free implementation both `src/main/coreRuntime.ts` (desktop) and
 * `apps/web/src/worker/db.worker.ts` (web) construct directly against their
 * own `DatabaseDriver` — this one guard covers both platforms already.
 */
@logErrors
export class SettingsService {
  private db: DatabaseDriver;

  constructor(deps: { db: DatabaseDriver }) {
    this.db = deps.db;
  }

  /** Parsed value for `key`, or `undefined` if unset or unparsable. */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = await this.db.get<{ value: string | null }>(SQL.get, { key });
    if (row === undefined || row.value === null || row.value === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(row.value) as T;
    } catch {
      // Tolerate a hand-written/legacy non-JSON value rather than throwing.
      return row.value as unknown as T;
    }
  }

  /**
   * Upserts `key` to `value` (JSON-encoded), stamping `updatedAt`. Throws
   * without writing anything if `key` is one of {@link SECRET_SETTING_KEYS}
   * — see this class's doc comment for why: the `settings` table syncs, so
   * nothing in it can be a secret.
   */
  async set(key: string, value: unknown): Promise<void> {
    if (isSecretSettingKey(key)) {
      throw new Error(
        `SettingsService.set: "${key}" is a secret setting key and may ` +
          `never be written to the "settings" table — it replicates across ` +
          `devices (migration 033). Store secrets in platform-local storage ` +
          `instead (desktop: electron-store via safeStorage; web: web_kv).`,
      );
    }
    await this.db.run(SQL.set, {
      key,
      value: JSON.stringify(value),
      updatedAt: new Date().toISOString(),
    });
  }

  async delete(key: string): Promise<void> {
    await this.db.run(SQL.delete, { key });
  }

  /** Every stored setting, parsed, keyed by name. */
  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.db.all<{ key: string; value: string | null }>(
      SQL.getAll,
    );
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      if (row.value === null || row.value === undefined) continue;
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = row.value;
      }
    }
    return result;
  }
}
