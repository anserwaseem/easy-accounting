import { api, ready } from './api/client';

/**
 * Web counterpart of src/main/utils/migrateBusinessSettings.ts — same keys,
 * same idempotent "copy once, leave the old value in place" behavior, moved
 * business settings from their pre-migration-028 home into the `settings`
 * table (src/core/services/SettingsService.ts).
 *
 * On desktop that old home is electron-store; here it is `localStorage`
 * (see electronShim.ts's `store` — the web build's stand-in for
 * electron-store), NOT `web_kv` (the db worker's own internal
 * `KeyValueStore`, used only for InventoryService's synchronous
 * `reservedNameChars` read — see db.worker.ts's `WebKv` doc comment).
 * `localStorage` lives on the main thread, so — despite this migration's
 * server-side twin running "in the worker boot" — this one has to run here,
 * on the main thread, calling into the worker only through the same
 * `settings:get`/`settings:set` RPC methods the renderer's hooks use
 * (`api.getSetting`/`api.setSetting`), since a dedicated Worker has no
 * `localStorage` to read in the first place.
 *
 * Called once from main.tsx, awaited before the real renderer mounts, so
 * every business-setting hook's very first read already sees the migrated
 * value rather than racing this copy.
 */
const STORAGE_PREFIX = 'easyAccounting.store.';

const BUSINESS_SETTING_KEYS = [
  'companyProfile.name',
  'companyProfile.address',
  'companyProfile.phone',
  'companyProfile.email',
  'print.totalQuantityLabel',
  'publish.publicPriceList',
  'publish.requiredAttributeKeys',
  'publish.publishWithoutImages',
] as const;

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
    BUSINESS_SETTING_KEYS.map(async (key) => {
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
