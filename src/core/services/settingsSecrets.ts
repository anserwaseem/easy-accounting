/**
 * The `settings` table (migration 028, rebuilt for sync by migration 033 —
 * src/core/db/migrations/033_sync_settings.ts) replicates to every device on
 * a sync project (see that migration's doc comment). That is exactly why a
 * secret must never be written into it: anything stored there is pushed to
 * `sync_outbox` by the capture trigger migration 033 installs, sent to
 * whatever server the project is configured against, and pulled down by
 * every other device — durably, in plaintext, outside this app's control
 * once it leaves the device. A setting is fine to lose control of that way
 * (company name, invoice paper size); a secret is not.
 *
 * This is the single, platform-free list of setting keys that must never
 * reach the `settings` table — {@link SettingsService.set} enforces it (see
 * that class's doc comment), and migration 033's corrective outbox seeding
 * filters it out defensively (belt-and-braces: nothing should ever have
 * written a secret under these keys in the first place, since
 * `SettingsService.set` has always been the only writer and rejects them,
 * but the migration excludes them anyway rather than trusting that
 * invariant blindly).
 *
 * Today this is the publish feature's two secrets — the object-storage
 * secret access key and the outbound webhook token
 * (src/main/utils/publishConfig.ts's `PUBLISH_KEYS.secretAccessKeyEnc` /
 * `.webhookToken`, whose *values* are these exact literal strings; kept as
 * literals here rather than importing that module, which pulls in
 * Electron's `safeStorage` and cannot be imported from platform-free
 * `src/core` code). Where each secret actually lives instead, per platform:
 *
 *  - **Desktop**: `electron-store`, encrypted at rest with Electron's
 *    `safeStorage` (OS keychain — Keychain / DPAPI / libsecret). Never
 *    touches `SettingsService` at all — see publishConfig.ts's
 *    `saveSecret`.
 *  - **Web**: `web_kv` (apps/web/src/worker/db.worker.ts's `WebKv`), the
 *    same device-local table that holds this browser's sync connection
 *    config. Not encrypted (the browser has no OS-keychain equivalent to
 *    call into), but never synced and never leaves this browser — `web_kv`
 *    is intentionally outside {@link import('../db/import').BUSINESS_TABLES}
 *    and migration 029's `SYNC_TABLES`.
 *
 * Kept here (not in `src/main/utils/publishConfig.ts`) precisely so both
 * platforms' secret storage AND the shared `settings`-table guard can import
 * one list without either pulling in the other's platform-specific code.
 * The desktop migration twin (`src/main/migrations/033.js`) cannot import
 * this module either (a plain synchronous `require()` cannot load a .ts
 * module without a build step — same reason 029.js/031.js/032.js duplicate
 * their core twins' logic instead of importing it) and so duplicates these
 * two literals by hand; keep both lists in sync.
 */
export const SECRET_SETTING_KEYS: readonly string[] = [
  'publish.secretAccessKeyEnc',
  'publish.webhookTokenEnc',
];

export function isSecretSettingKey(key: string): boolean {
  return SECRET_SETTING_KEYS.includes(key);
}
