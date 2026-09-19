/**
 * Web-build twin of `src/main/utils/publishConfig.ts` — same `PublishConfig`
 * shape (mirrored, not imported, in `src/core/api/AppApi.ts`, which both
 * this file and the desktop one implement against).
 *
 * ## Storage split (as of `migratePublishConnectionToSettings` below)
 *
 * Fourteen of the sixteen `PUBLISH_KEYS` below live in the `settings` table
 * (src/core/services/SettingsService.ts), which migration 033 replicates to
 * every device on a sync project, identically on both platforms:
 *  - the three original business fields — `publicPriceList`,
 *    `requiredAttributeKeys`, `publishWithoutImages` (migration 028) — which
 *    price list is public and what an item must have before it can publish;
 *  - the eleven S3-connection fields — `endpoint`, `region`, `bucket`,
 *    `privateBucket`, `accessKeyId`, `publicBaseUrl`, `privatePrefix`,
 *    `publicPrefix`, `reservedNameChars`, `imagesManifestUrl`, `webhookUrl`.
 *
 * That second group used to live in `web_kv` only, device-local, alongside
 * the two real secrets. REAL INCIDENT this fixed: an owner configured
 * publish (endpoint, buckets, access key ID, URLs, prefixes, webhook URL —
 * none of it secret) on one synced browser device, then opened Settings on a
 * second, already-synced device and found every field blank — nothing they
 * had just typed had gone anywhere the second device could see. Only the two
 * actual secrets ever needed to stay device-local; the other eleven were
 * withheld from sync for no reason connected to their content, only to
 * where the code that read them historically happened to live.
 *
 * `migratePublishConnectionToSettings` (below) copies any of the eleven
 * connection fields already sitting in `web_kv` on an upgrading device into
 * `settings`, once per device, so an existing setup doesn't have to be
 * retyped after upgrading. See that function's doc comment for why it is
 * eager-at-boot rather than lazy-on-read, and for the one field
 * (`reservedNameChars`) that keeps a live `web_kv` mirror rather than being
 * fully vacated like the other ten.
 *
 * Two fields — `secretAccessKeyEnc` and `webhookToken` (the value stored
 * under `PUBLISH_KEYS.webhookToken` is `publish.webhookTokenEnc`) — are the
 * only ones left in `web_kv` for real: they are the actual secrets
 * (`SECRET_SETTING_KEYS`, src/core/services/settingsSecrets.ts), and
 * `SettingsService.set` refuses to write them into a table that replicates
 * off this device. Not encrypted (a browser has no OS-keychain equivalent to
 * call into), but `web_kv` is intentionally outside
 * {@link import('@core/db/import').BUSINESS_TABLES} and migration 029's
 * `SYNC_TABLES` — nothing in it ever syncs or leaves this browser. This is
 * the "on-device storage" `PublishConfig.encryptionAvailable` reports as
 * available for on THIS platform (see that field's doc comment in
 * AppApi.ts) — there is no OS keychain to fail to reach the way desktop's
 * `isEncryptionAvailable()` check can fail, so this is unconditionally
 * `true` here.
 *
 * `SECRET_SETTING_KEYS` still applies here exactly as it does on desktop:
 * the two secret keys are never written through {@link SettingsService} —
 * they go straight to `kv`, same as desktop routes them straight to
 * electron-store and never through `SettingsService` either. Neither
 * platform's publish secret has ever touched, or will ever touch, the
 * `settings` table.
 */
import type { KeyValueStore } from '@core/ports';
import type { SettingsService } from '@core/services/SettingsService';
import type { PublishConfig, PublishConfigInput } from '@core/api/AppApi';

/**
 * Kept string-for-string identical to `src/main/utils/publishConfig.ts`'s
 * `PUBLISH_KEYS` — not imported from there, since that module's top-level
 * `import { safeStorage } from 'electron'` has no browser equivalent and
 * would break this worker's bundle. All fourteen non-secret keys route
 * through `SettingsService` on both platforms (so they MUST stay the same
 * string literals as the desktop side — those are the `settings.key` values
 * that actually sync); the two secret keys are purely local-storage lookup
 * keys, free to differ, kept identical anyway for one less thing to hold in
 * your head moving between the two files.
 */
const PUBLISH_KEYS = {
  endpoint: 'publish.endpoint',
  region: 'publish.region',
  bucket: 'publish.bucket',
  privateBucket: 'publish.privateBucket',
  accessKeyId: 'publish.accessKeyId',
  secretAccessKeyEnc: 'publish.secretAccessKeyEnc',
  publicBaseUrl: 'publish.publicBaseUrl',
  privatePrefix: 'publish.privatePrefix',
  publicPrefix: 'publish.publicPrefix',
  publicPriceList: 'publish.publicPriceList',
  publishWithoutImages: 'publish.publishWithoutImages',
  reservedNameChars: 'publish.reservedNameChars',
  requiredAttributeKeys: 'publish.requiredAttributeKeys',
  imagesManifestUrl: 'publish.imagesManifestUrl',
  webhookUrl: 'publish.webhookUrl',
  webhookToken: 'publish.webhookTokenEnc',
} as const;

/**
 * The eleven non-secret, non-business `PUBLISH_KEYS` — this file's top doc
 * comment's second group — that `migratePublishConnectionToSettings` below
 * copies out of `web_kv` and that `getWebPublishConfig`/`saveWebPublishConfig`
 * read/write through {@link SettingsService} today. Named explicitly (not
 * derived by filtering `PUBLISH_KEYS`) so it's obvious at a glance which
 * keys these are: `PUBLISH_KEYS` also holds the 3 business keys (already
 * migrated separately, by migration 028) and the 2 secret keys, neither of
 * which belongs in this list. Kept string-for-string identical to desktop's
 * `CONNECTION_SETTING_KEYS` (src/main/utils/publishConfig.ts).
 */
const CONNECTION_SETTING_KEYS: readonly string[] = [
  PUBLISH_KEYS.endpoint,
  PUBLISH_KEYS.region,
  PUBLISH_KEYS.bucket,
  PUBLISH_KEYS.privateBucket,
  PUBLISH_KEYS.accessKeyId,
  PUBLISH_KEYS.publicBaseUrl,
  PUBLISH_KEYS.privatePrefix,
  PUBLISH_KEYS.publicPrefix,
  PUBLISH_KEYS.reservedNameChars,
  PUBLISH_KEYS.imagesManifestUrl,
  PUBLISH_KEYS.webhookUrl,
];

/**
 * Guards the one-time copy phase of {@link migratePublishConnectionToSettings}
 * below. Lives in `web_kv` (never `settings` — this bookkeeping value is
 * meaningless to any other device and must never sync) under its own key,
 * outside `PUBLISH_KEYS`, since it isn't a publish config field at all.
 */
const CONNECTION_MIGRATION_FLAG_KEY = 'publish.connectionMigratedToSettings';

const DEFAULTS = {
  region: 'auto',
  privatePrefix: 'catalog/private',
  publicPrefix: 'catalog/public',
} as const;

const str = (kv: KeyValueStore, key: string, fallback = ''): string => {
  const v = kv.get(key);
  return typeof v === 'string' ? v : fallback;
};

export async function getWebPublishConfig(
  kv: KeyValueStore,
  settings: SettingsService,
): Promise<PublishConfig> {
  const [
    endpoint,
    region,
    bucket,
    privateBucket,
    accessKeyId,
    publicBaseUrl,
    privatePrefix,
    publicPrefix,
    reservedNameChars,
    imagesManifestUrl,
    webhookUrl,
    publicPriceList,
    requiredAttributeKeys,
    publishWithoutImages,
  ] = await Promise.all([
    settings.get<string>(PUBLISH_KEYS.endpoint),
    settings.get<string>(PUBLISH_KEYS.region),
    settings.get<string>(PUBLISH_KEYS.bucket),
    settings.get<string>(PUBLISH_KEYS.privateBucket),
    settings.get<string>(PUBLISH_KEYS.accessKeyId),
    settings.get<string>(PUBLISH_KEYS.publicBaseUrl),
    settings.get<string>(PUBLISH_KEYS.privatePrefix),
    settings.get<string>(PUBLISH_KEYS.publicPrefix),
    settings.get<string>(PUBLISH_KEYS.reservedNameChars),
    settings.get<string>(PUBLISH_KEYS.imagesManifestUrl),
    settings.get<string>(PUBLISH_KEYS.webhookUrl),
    settings.get<string>(PUBLISH_KEYS.publicPriceList),
    settings.get<string>(PUBLISH_KEYS.requiredAttributeKeys),
    settings.get<boolean>(PUBLISH_KEYS.publishWithoutImages),
  ]);
  return {
    endpoint: endpoint ?? '',
    region: region ?? DEFAULTS.region,
    bucket: bucket ?? '',
    privateBucket: privateBucket ?? '',
    accessKeyId: accessKeyId ?? '',
    publicBaseUrl: publicBaseUrl ?? '',
    privatePrefix: privatePrefix ?? DEFAULTS.privatePrefix,
    publicPrefix: publicPrefix ?? DEFAULTS.publicPrefix,
    publicPriceList: publicPriceList ?? '',
    publishWithoutImages: publishWithoutImages ?? false,
    reservedNameChars: reservedNameChars ?? '',
    requiredAttributeKeys: requiredAttributeKeys ?? '',
    imagesManifestUrl: imagesManifestUrl ?? '',
    webhookUrl: webhookUrl ?? '',
    hasSecretAccessKey: !!str(kv, PUBLISH_KEYS.secretAccessKeyEnc),
    hasWebhookToken: !!str(kv, PUBLISH_KEYS.webhookToken),
    // No OS keychain to fail to reach on this platform — on-device storage
    // (web_kv) is always available. See this file's doc comment.
    encryptionAvailable: true,
  };
}

export async function saveWebPublishConfig(
  kv: KeyValueStore,
  settings: SettingsService,
  input: PublishConfigInput,
): Promise<PublishConfig> {
  // All fourteen non-secret fields — the eleven connection fields and the
  // three original business fields — go through SettingsService now; see
  // this file's top doc comment for the storage split and the field
  // incident that forced the eleven connection fields to join the three
  // business fields here instead of staying in web_kv.
  const setSettingIfDefined = async (key: string, value: unknown) => {
    if (value !== undefined) await settings.set(key, value);
  };
  await Promise.all([
    setSettingIfDefined(PUBLISH_KEYS.endpoint, input.endpoint?.trim()),
    setSettingIfDefined(PUBLISH_KEYS.region, input.region?.trim()),
    setSettingIfDefined(PUBLISH_KEYS.bucket, input.bucket?.trim()),
    setSettingIfDefined(
      PUBLISH_KEYS.privateBucket,
      input.privateBucket?.trim(),
    ),
    setSettingIfDefined(PUBLISH_KEYS.accessKeyId, input.accessKeyId?.trim()),
    setSettingIfDefined(
      PUBLISH_KEYS.publicBaseUrl,
      input.publicBaseUrl?.trim().replace(/\/+$/, ''),
    ),
    setSettingIfDefined(
      PUBLISH_KEYS.privatePrefix,
      input.privatePrefix?.trim(),
    ),
    setSettingIfDefined(PUBLISH_KEYS.publicPrefix, input.publicPrefix?.trim()),
    setSettingIfDefined(
      PUBLISH_KEYS.reservedNameChars,
      input.reservedNameChars?.trim(),
    ),
    setSettingIfDefined(
      PUBLISH_KEYS.imagesManifestUrl,
      input.imagesManifestUrl?.trim(),
    ),
    setSettingIfDefined(PUBLISH_KEYS.webhookUrl, input.webhookUrl?.trim()),
    setSettingIfDefined(
      PUBLISH_KEYS.publicPriceList,
      input.publicPriceList?.trim(),
    ),
    setSettingIfDefined(
      PUBLISH_KEYS.requiredAttributeKeys,
      input.requiredAttributeKeys?.trim(),
    ),
    setSettingIfDefined(
      PUBLISH_KEYS.publishWithoutImages,
      input.publishWithoutImages,
    ),
  ]);

  // `reservedNameChars` alone also gets a `web_kv` mirror, written here
  // alongside its now-canonical `settings` copy above:
  // src/core/services/InventoryService.ts's `assertNameAllowed` needs a
  // *synchronous* read of it, inline mid-query, through the `KeyValueStore`
  // port, and `settings` is only reachable async. Skipping this mirror would
  // silently turn name-reservation enforcement off (`kv.get` returning
  // `undefined` reads as "no restriction") the moment a value only ever
  // reached this device via `settings`. See `migratePublishConnectionToSettings`
  // below for how this mirror is kept in step with `settings` on devices
  // that receive a change from elsewhere (e.g. a sync pull) rather than
  // typing it in locally.
  if (input.reservedNameChars !== undefined) {
    kv.set(PUBLISH_KEYS.reservedNameChars, input.reservedNameChars.trim());
  }

  // Secrets: web_kv, plaintext (no OS keychain to encrypt against on this
  // platform — see this file's doc comment), NEVER through
  // SettingsService/the settings table.
  const saveSecret = (key: string, value?: string) => {
    if (value === undefined) return; // unchanged
    if (value === '') {
      kv.delete(key);
      return;
    }
    kv.set(key, value);
  };
  saveSecret(PUBLISH_KEYS.secretAccessKeyEnc, input.secretAccessKey);
  saveSecret(PUBLISH_KEYS.webhookToken, input.webhookToken);

  return getWebPublishConfig(kv, settings);
}

/**
 * Secrets as stored in `web_kv`. Main-thread never sees these — only the
 * worker's publish run (./publishService.ts) reads them, matching desktop's
 * `getPublishSecrets` (src/main/utils/publishConfig.ts) which never sends
 * them to the renderer. Not encrypted (no OS keychain on this platform).
 */
export function getWebPublishSecrets(kv: KeyValueStore): {
  secretAccessKey: string;
  webhookToken: string;
} {
  return {
    secretAccessKey: str(kv, PUBLISH_KEYS.secretAccessKeyEnc),
    webhookToken: str(kv, PUBLISH_KEYS.webhookToken),
  };
}

/**
 * One-time, per-device migration of the eleven `CONNECTION_SETTING_KEYS`
 * from `web_kv` (their pre-this-change home) into the `settings` table, for
 * any browser upgrading from a build that only ever wrote them to `web_kv`.
 * Desktop counterpart: src/main/utils/publishConfig.ts's
 * `migratePublishConnectionToSettings` — same shape, same reasoning,
 * different device-local store underneath (`web_kv` here, electron-store
 * there).
 *
 * ## Why eager-at-boot, not lazy-on-read
 *
 * The tempting alternative is simpler: have `getWebPublishConfig` write-
 * through to `settings` the first time it notices a key only exists in
 * `web_kv`. That is exactly the wrong shape once a table is
 * per-key-LWW-synced (see `SyncEngine`'s `NATURAL_KEY_TABLES` handling of
 * `settings`, keyed by `key`): a lazy write-through on GET would stamp a
 * stale local value with a *fresh* `updatedAt`, and under last-writer-wins
 * that fresh stamp can beat a genuinely newer value already sitting on the
 * server from another device — this device would win a race it has no
 * business winning, because "read config" is not "the user just edited
 * config". An eager, once-per-device copy run at boot (before this device
 * has any chance to read/display/act on a stale value, and definitely before
 * any real edit) bounds that risk to a single moment very early in this
 * device's history, rather than leaving it live on every future read. After
 * migration, any later genuine edit — on this device or another — still
 * wins by `updatedAt` exactly as normal; this function does not change that.
 *
 * ## The `reservedNameChars` exception
 *
 * Every other connection key is deleted from `web_kv` once copied
 * (`settings` becomes its only home, same as the three business fields).
 * `reservedNameChars` is not: `saveWebPublishConfig` above dual-writes it
 * into `web_kv` on every save (see that write's own doc comment) because
 * `InventoryService.assertNameAllowed` needs a *synchronous* read of it,
 * inline mid-query, and `settings` is only reachable async. Deleting the
 * `web_kv` copy here would silently turn name-reservation enforcement off
 * (`kv.get` returning `undefined` reads as "no restriction") the instant
 * this migration ran, for every device that had ever set one.
 *
 * That mirror can still go stale relative to `settings` — a value that
 * arrives here via a sync pull (`SyncManager`'s background loop, or
 * `sync:join`/`sync:rebuild`) lands straight in `settings` with no callback
 * to this file, since `web_kv` is deliberately outside every sync-table list
 * (see this file's top doc comment). So, unconditionally on every call (not
 * gated by the flag below — this part is not "once", it is "every boot"),
 * this function refreshes the `web_kv` mirror from whatever `settings`
 * currently holds. That bounds `reservedNameChars` staleness to "at most as
 * old as this device's last page load" — not perfect (a sync pull that lands
 * mid-session still needs a reload to reach `InventoryService`'s check), but
 * strictly better than "never", and consistent with how `WebKv`'s own cache
 * (this file's `kv` parameter) is documented as being loaded once at boot
 * and not otherwise kept fresh against concurrent writers.
 *
 * Call site: apps/web/src/worker/db.worker.ts's `main()`, after
 * `bootstrapDatabase` (the `settings` table and its capture triggers must
 * exist for the copies below to be captured into `sync_outbox` and
 * propagate) and after `webKv`/`settingsService` are constructed — see that
 * call site's own comment for why it deliberately does NOT run under
 * `withCaptureSuppressed`.
 */
export async function migratePublishConnectionToSettings(
  kv: KeyValueStore,
  settings: SettingsService,
): Promise<void> {
  if (kv.get(CONNECTION_MIGRATION_FLAG_KEY) !== '1') {
    await Promise.all(
      CONNECTION_SETTING_KEYS.map(async (key) => {
        try {
          const local = kv.get(key);
          if (typeof local !== 'string' || local === '') return;
          const existing = await settings.get(key);
          if (existing !== undefined) return; // settings already has a value — never overwrite
          await settings.set(key, local);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(
            `Publish connection migration: failed to copy '${key}'`,
            error,
          );
        }
      }),
    );
    for (const key of CONNECTION_SETTING_KEYS) {
      // reservedNameChars is the one key that keeps a live web_kv mirror
      // forever — see this function's doc comment.
      if (key === PUBLISH_KEYS.reservedNameChars) continue;
      kv.delete(key);
    }
    kv.set(CONNECTION_MIGRATION_FLAG_KEY, '1');
  }

  try {
    const syncedReserved = await settings.get<string>(
      PUBLISH_KEYS.reservedNameChars,
    );
    if (typeof syncedReserved === 'string') {
      kv.set(PUBLISH_KEYS.reservedNameChars, syncedReserved);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      'Publish connection migration: failed to refresh reservedNameChars mirror',
      error,
    );
  }
}
