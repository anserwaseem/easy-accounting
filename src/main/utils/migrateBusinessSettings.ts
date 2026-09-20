/**
 * One-time copy of business settings out of electron-store into the
 * `settings` table so Join / "Add a device" can pull them. Idempotent:
 * a key already in sqlite is left alone (the table is the source of
 * truth after this runs). Secrets never enter this table.
 */
import { store } from '../store';
import type { SettingsService } from '../../core/services/SettingsService';
import { COMPANY_AND_PRINT_SETTING_KEYS } from '../../core/services/businessSettingKeys';
import { isSecretSettingKey } from '../../core/services/settingsSecrets';
import { PUBLISH_KEYS } from './publishConfig';

const PUBLISH_NON_SECRET_KEYS: readonly string[] = [
  PUBLISH_KEYS.endpoint,
  PUBLISH_KEYS.region,
  PUBLISH_KEYS.bucket,
  PUBLISH_KEYS.privateBucket,
  PUBLISH_KEYS.accessKeyId,
  PUBLISH_KEYS.publicBaseUrl,
  PUBLISH_KEYS.privatePrefix,
  PUBLISH_KEYS.publicPrefix,
  PUBLISH_KEYS.publicPriceList,
  PUBLISH_KEYS.publishWithoutImages,
  PUBLISH_KEYS.requireTitle,
  PUBLISH_KEYS.reservedNameChars,
  PUBLISH_KEYS.requiredAttributeKeys,
  PUBLISH_KEYS.imagesManifestUrl,
  PUBLISH_KEYS.webhookUrl,
];

const BOOLEAN_STORE_KEYS = new Set<string>([
  PUBLISH_KEYS.publishWithoutImages,
  PUBLISH_KEYS.requireTitle,
  'print.showPartyBalances',
  'print.showAgent',
  'print.showBillBalance',
]);

function coerceLegacy(key: string, raw: unknown): unknown {
  if (!BOOLEAN_STORE_KEYS.has(key)) return raw;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return raw;
}

async function copyIfMissing(
  settings: SettingsService,
  key: string,
): Promise<void> {
  if (isSecretSettingKey(key)) return;
  const existing = await settings.get(key);
  if (existing !== undefined) return;
  const legacy = store.get(key);
  if (legacy === undefined || legacy === null) return;
  await settings.set(key, coerceLegacy(key, legacy));
}

export async function migrateBusinessSettingsFromStore(
  settings: SettingsService,
): Promise<void> {
  const keys = [...COMPANY_AND_PRINT_SETTING_KEYS, ...PUBLISH_NON_SECRET_KEYS];
  await Promise.all(keys.map((key) => copyIfMissing(settings, key)));
}
