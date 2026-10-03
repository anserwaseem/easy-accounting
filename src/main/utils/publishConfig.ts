/**
 * Publish configuration — supplied by the client (per installation), never
 * baked into the build.
 *
 * Non-secret fields live in electron-store as plain JSON *and* are
 * mirrored into the `settings` table (migration 038) so Join / Add-a-device
 * can pull them. The secret access key and webhook token stay in
 * electron-store encrypted with Electron's safeStorage (OS keychain) and
 * never enter `settings`.
 *
 * Generic by design: any S3-compatible endpoint, any bucket, any webhook.
 */
import { safeStorage } from 'electron';
import log from 'electron-log';
import { store } from '../store';

export const PUBLISH_KEYS = {
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
  requireTitle: 'publish.requireTitle',
  reservedNameChars: 'publish.reservedNameChars',
  requiredAttributeKeys: 'publish.requiredAttributeKeys',
  imagesManifestUrl: 'publish.imagesManifestUrl',
  webhookUrl: 'publish.webhookUrl',
  webhookToken: 'publish.webhookTokenEnc',
  lastResult: 'publish.lastResult',
} as const;

/** What the renderer may see — no secrets. */
export interface PublishConfig {
  endpoint: string;
  region: string;
  bucket: string;
  /**
   * Optional separate bucket for the full (all-tiers) catalog. Set this when
   * the main bucket is publicly readable, since public access on most object
   * stores is bucket-wide and cannot be limited to a prefix. Empty = use `bucket`.
   */
  privateBucket: string;
  accessKeyId: string;
  publicBaseUrl: string;
  privatePrefix: string;
  publicPrefix: string;
  /** The single price list published as the public price. Empty = not chosen. */
  publicPriceList: string;
  /**
   * Characters an item name may not contain, because the downstream publishing
   * pipeline reserves them (e.g. as escapes when turning a SKU into a file path).
   * Empty = no restriction. Enforced on item create/rename.
   */
  reservedNameChars: string;
  /** Attribute keys an item must carry before it can publish (comma separated). */
  requiredAttributeKeys: string;
  /** Publish items with no photograph yet — testing only, never for a live shop. */
  publishWithoutImages: boolean;
  /**
   * Require a display title before an item can publish. Missing key = on, so an
   * existing install that freezes URLs from titles does not silently keep
   * publishing hawala numbers. Set false to let a consumer compose a name.
   */
  requireTitle: boolean;
  imagesManifestUrl: string;
  webhookUrl: string;
  /** True when a secret access key is stored (the value itself never leaves main). */
  hasSecretAccessKey: boolean;
  /** True when a webhook token is stored. */
  hasWebhookToken: boolean;
  /** True when the OS keychain is usable; false means secrets can't be stored. */
  encryptionAvailable: boolean;
}

/** Values the renderer may write. Secrets are write-only (undefined = unchanged). */
export interface PublishConfigInput
  extends Partial<
    Omit<
      PublishConfig,
      'hasSecretAccessKey' | 'hasWebhookToken' | 'encryptionAvailable'
    >
  > {
  /** Plain secret; '' clears it, undefined leaves it unchanged. */
  secretAccessKey?: string;
  webhookToken?: string;
}

const DEFAULTS = {
  region: 'auto',
  privatePrefix: 'catalog/private',
  publicPrefix: 'catalog/public',
} as const;

const str = (key: string, fallback = ''): string => {
  const v = store.get(key);
  return typeof v === 'string' ? v : fallback;
};

const isEncryptionAvailable = (): boolean => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

function encrypt(plain: string): string {
  return safeStorage.encryptString(plain).toString('base64');
}

function decrypt(b64: string): string {
  return safeStorage.decryptString(Buffer.from(b64, 'base64'));
}

export async function getPublishConfig(): Promise<PublishConfig> {
  let dbValues: Record<string, unknown> = {};
  try {
    const { getSettingsService } = await import('../coreRuntime');
    const settings = getSettingsService();
    dbValues = await settings.getAll();
  } catch {
    // runtime not initialized or in isolated test; fallback to store
  }

  const val = (key: string, fallback = ''): string => {
    const v = dbValues[key];
    if (typeof v === 'string') return v;
    return str(key, fallback);
  };

  const boolVal = (key: string, fallback: boolean): boolean => {
    const v = dbValues[key];
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    const storeVal = store.get(key);
    if (typeof storeVal === 'boolean') return storeVal;
    if (storeVal === 'true' || storeVal === '1') return true;
    if (storeVal === 'false' || storeVal === '0') return false;
    return fallback;
  };

  return {
    endpoint: val(PUBLISH_KEYS.endpoint),
    region: val(PUBLISH_KEYS.region, DEFAULTS.region),
    bucket: val(PUBLISH_KEYS.bucket),
    privateBucket: val(PUBLISH_KEYS.privateBucket),
    accessKeyId: val(PUBLISH_KEYS.accessKeyId),
    publicBaseUrl: val(PUBLISH_KEYS.publicBaseUrl),
    privatePrefix: val(PUBLISH_KEYS.privatePrefix, DEFAULTS.privatePrefix),
    publicPrefix: val(PUBLISH_KEYS.publicPrefix, DEFAULTS.publicPrefix),
    publicPriceList: val(PUBLISH_KEYS.publicPriceList),
    publishWithoutImages: boolVal(PUBLISH_KEYS.publishWithoutImages, false),
    requireTitle: boolVal(PUBLISH_KEYS.requireTitle, true),
    reservedNameChars: val(PUBLISH_KEYS.reservedNameChars),
    requiredAttributeKeys: val(PUBLISH_KEYS.requiredAttributeKeys),
    imagesManifestUrl: val(PUBLISH_KEYS.imagesManifestUrl),
    webhookUrl: val(PUBLISH_KEYS.webhookUrl),
    hasSecretAccessKey: !!str(PUBLISH_KEYS.secretAccessKeyEnc),
    hasWebhookToken: !!str(PUBLISH_KEYS.webhookToken),
    encryptionAvailable: isEncryptionAvailable(),
  };
}

/** Secrets, decrypted. Main-process only — never send these to the renderer. */
export function getPublishSecrets(): {
  secretAccessKey: string;
  webhookToken: string;
} {
  const read = (key: string): string => {
    const enc = str(key);
    if (!enc) return '';
    try {
      return decrypt(enc);
    } catch (error) {
      log.error(`Publish: failed to decrypt ${key}`, error);
      return '';
    }
  };
  return {
    secretAccessKey: read(PUBLISH_KEYS.secretAccessKeyEnc),
    webhookToken: read(PUBLISH_KEYS.webhookToken),
  };
}

export async function savePublishConfig(
  input: PublishConfigInput,
): Promise<PublishConfig> {
  const setIfDefined = (key: string, value: unknown) => {
    if (value !== undefined) store.set(key, value);
  };

  setIfDefined(PUBLISH_KEYS.endpoint, input.endpoint?.trim());
  setIfDefined(PUBLISH_KEYS.region, input.region?.trim());
  setIfDefined(PUBLISH_KEYS.bucket, input.bucket?.trim());
  setIfDefined(PUBLISH_KEYS.privateBucket, input.privateBucket?.trim());
  setIfDefined(PUBLISH_KEYS.accessKeyId, input.accessKeyId?.trim());
  setIfDefined(
    PUBLISH_KEYS.publicBaseUrl,
    input.publicBaseUrl?.trim().replace(/\/+$/, ''),
  );
  setIfDefined(PUBLISH_KEYS.privatePrefix, input.privatePrefix?.trim());
  setIfDefined(PUBLISH_KEYS.publicPrefix, input.publicPrefix?.trim());
  setIfDefined(
    PUBLISH_KEYS.publishWithoutImages,
    input.publishWithoutImages === undefined
      ? undefined
      : String(input.publishWithoutImages),
  );
  setIfDefined(
    PUBLISH_KEYS.requireTitle,
    input.requireTitle === undefined ? undefined : String(input.requireTitle),
  );
  setIfDefined(PUBLISH_KEYS.imagesManifestUrl, input.imagesManifestUrl?.trim());
  setIfDefined(PUBLISH_KEYS.webhookUrl, input.webhookUrl?.trim());
  setIfDefined(PUBLISH_KEYS.publicPriceList, input.publicPriceList?.trim());
  setIfDefined(PUBLISH_KEYS.reservedNameChars, input.reservedNameChars?.trim());
  setIfDefined(
    PUBLISH_KEYS.requiredAttributeKeys,
    input.requiredAttributeKeys?.trim(),
  );

  const saveSecret = (key: string, value?: string) => {
    if (value === undefined) return; // unchanged
    if (value === '') {
      store.delete(key);
      return;
    }
    if (!isEncryptionAvailable()) {
      throw new Error(
        'Secure storage is unavailable on this system, so the secret was not saved.',
      );
    }
    store.set(key, encrypt(value));
  };

  saveSecret(PUBLISH_KEYS.secretAccessKeyEnc, input.secretAccessKey);
  saveSecret(PUBLISH_KEYS.webhookToken, input.webhookToken);

  // non-secrets also go in `settings` so Join / Add-a-device can pull them.
  // secrets stay in electron-store + safeStorage only.
  const { getSettingsService } = await import('../coreRuntime');
  const settings = getSettingsService();
  const mirror = async (key: string, value: unknown) => {
    if (value !== undefined) await settings.set(key, value);
  };
  await Promise.all([
    mirror(PUBLISH_KEYS.endpoint, input.endpoint?.trim()),
    mirror(PUBLISH_KEYS.region, input.region?.trim()),
    mirror(PUBLISH_KEYS.bucket, input.bucket?.trim()),
    mirror(PUBLISH_KEYS.privateBucket, input.privateBucket?.trim()),
    mirror(PUBLISH_KEYS.accessKeyId, input.accessKeyId?.trim()),
    mirror(
      PUBLISH_KEYS.publicBaseUrl,
      input.publicBaseUrl?.trim().replace(/\/+$/, ''),
    ),
    mirror(PUBLISH_KEYS.privatePrefix, input.privatePrefix?.trim()),
    mirror(PUBLISH_KEYS.publicPrefix, input.publicPrefix?.trim()),
    mirror(PUBLISH_KEYS.imagesManifestUrl, input.imagesManifestUrl?.trim()),
    mirror(PUBLISH_KEYS.webhookUrl, input.webhookUrl?.trim()),
    mirror(PUBLISH_KEYS.publicPriceList, input.publicPriceList?.trim()),
    mirror(PUBLISH_KEYS.reservedNameChars, input.reservedNameChars?.trim()),
    mirror(
      PUBLISH_KEYS.requiredAttributeKeys,
      input.requiredAttributeKeys?.trim(),
    ),
    mirror(PUBLISH_KEYS.publishWithoutImages, input.publishWithoutImages),
    mirror(PUBLISH_KEYS.requireTitle, input.requireTitle),
  ]);

  return getPublishConfig();
}

/** Missing pieces that would block a publish (empty array = ready). */
export function validatePublishConfig(config: PublishConfig): string[] {
  const missing: string[] = [];
  if (!config.endpoint) missing.push('endpoint');
  if (!config.bucket) missing.push('bucket');
  if (!config.accessKeyId) missing.push('access key ID');
  if (!config.hasSecretAccessKey) missing.push('secret access key');
  if (!config.publicPriceList) missing.push('a public price list');
  return missing;
}
