/**
 * Publish configuration — supplied by the client (per installation), never
 * baked into the build.
 *
 * Non-secret fields live in electron-store as plain JSON. The single secret
 * (the storage secret access key) is encrypted with Electron's safeStorage,
 * which is backed by the OS keychain (Keychain / DPAPI / libsecret), and is
 * never returned to the renderer — the renderer only learns whether a secret
 * is set.
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
  reservedNameChars: 'publish.reservedNameChars',
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

export function getPublishConfig(): PublishConfig {
  return {
    endpoint: str(PUBLISH_KEYS.endpoint),
    region: str(PUBLISH_KEYS.region, DEFAULTS.region),
    bucket: str(PUBLISH_KEYS.bucket),
    privateBucket: str(PUBLISH_KEYS.privateBucket),
    accessKeyId: str(PUBLISH_KEYS.accessKeyId),
    publicBaseUrl: str(PUBLISH_KEYS.publicBaseUrl),
    privatePrefix: str(PUBLISH_KEYS.privatePrefix, DEFAULTS.privatePrefix),
    publicPrefix: str(PUBLISH_KEYS.publicPrefix, DEFAULTS.publicPrefix),
    publicPriceList: str(PUBLISH_KEYS.publicPriceList),
    reservedNameChars: str(PUBLISH_KEYS.reservedNameChars),
    imagesManifestUrl: str(PUBLISH_KEYS.imagesManifestUrl),
    webhookUrl: str(PUBLISH_KEYS.webhookUrl),
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

export function savePublishConfig(input: PublishConfigInput): PublishConfig {
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
  setIfDefined(PUBLISH_KEYS.imagesManifestUrl, input.imagesManifestUrl?.trim());
  setIfDefined(PUBLISH_KEYS.webhookUrl, input.webhookUrl?.trim());
  setIfDefined(PUBLISH_KEYS.publicPriceList, input.publicPriceList?.trim());
  setIfDefined(PUBLISH_KEYS.reservedNameChars, input.reservedNameChars?.trim());

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
