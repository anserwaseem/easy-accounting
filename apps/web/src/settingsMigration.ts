import { api, ready } from './api/client';
import { COMPANY_AND_PRINT_SETTING_KEYS } from '@core/services/businessSettingKeys';

/**
 * Web counterpart of src/main/utils/migrateBusinessSettings.ts — same keys,
 * same idempotent "copy once, leave the old value in place" behavior, moved
 * business settings from their pre-migration-028 home into the `settings`
 * table (src/core/services/SettingsService.ts).
 *
 * On desktop that old home is electron-store; here it is `localStorage`
 * (see electronShim.ts's `store` — the web build's stand-in for
 * electron-store), NOT `web_kv` (the db worker's own internal
 * `KeyValueStore`). `localStorage` lives on the main thread, so this copy
 * runs here via `api.getSetting`/`api.setSetting`.
 *
 * Publish connection fields are copied in the worker
 * (`migratePublishConnectionToSettings`). This file is company + print.
 */

const STORAGE_PREFIX = 'easyAccounting.store.';

function readLegacyValue(key: string): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function migrateBusinessSettingsFromLocalStorage(): Promise<void> {
  await ready;
  await Promise.all(
    COMPANY_AND_PRINT_SETTING_KEYS.map(async (key) => {
      try {
        const existing = await api.getSetting(key);
        if (existing !== undefined) return;
        const legacy = readLegacyValue(key);
        if (legacy === undefined || legacy === null) return;
        await api.setSetting(key, legacy);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`Settings migration: failed to copy '${key}'`, error);
      }
    }),
  );
}
