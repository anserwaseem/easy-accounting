/**
 * Cloud-backup Supabase configuration — supplied per installation, never
 * baked into the build.
 *
 * The project URL is stored in electron-store as plain JSON. The anon key
 * is encrypted with Electron's safeStorage (OS keychain) and is never
 * returned to the renderer — the renderer only learns whether a key is set.
 *
 * These values must not go in the synced `settings` table: the anon key is
 * a credential, and the URL identifies this machine's backup destination.
 * Local folders and pre-BYOK cloud buckets still embed hostname + username.
 */
import { safeStorage } from 'electron';
import log from 'electron-log';
import { store } from '../store';

export const BACKUP_KEYS = {
  supabaseUrl: 'backup.supabaseUrl',
  anonKeyEnc: 'backup.supabaseAnonKeyEnc',
  envMigrated: 'backup.envMigrated',
} as const;

/** What the renderer may see — no secrets. */
export interface BackupConfig {
  supabaseUrl: string;
  /** True when an anon key is stored (the value itself never leaves main). */
  hasAnonKey: boolean;
  /** True when the OS keychain is usable; false means the key cannot be stored. */
  encryptionAvailable: boolean;
}

/** Values the renderer may write. The secret is write-only (undefined = unchanged). */
export interface BackupConfigInput {
  supabaseUrl?: string;
  /** Plain anon key; '' clears it, undefined leaves it unchanged. */
  anonKey?: string;
}

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

/**
 * One-time copy of process.env into electron-store so existing `.env` /
 * unpackaged installs keep cloud backup after webpack stopped baking the
 * keys into the bundle. Skipped once `backup.envMigrated` is set, including
 * when env was empty — otherwise a later `.env` appearance would overwrite
 * a user who already cleared Settings. If encryption is unavailable the
 * key is left unmigrated so a later launch can copy it.
 */
function migrateFromEnvIfNeeded(): void {
  if (store.get(BACKUP_KEYS.envMigrated) === true) return;

  const alreadyConfigured =
    store.has(BACKUP_KEYS.supabaseUrl) || store.has(BACKUP_KEYS.anonKeyEnc);
  if (alreadyConfigured) {
    store.set(BACKUP_KEYS.envMigrated, true);
    return;
  }

  const url = (process.env.SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY ?? '').trim();
  if (anonKey && !isEncryptionAvailable()) {
    if (url) store.set(BACKUP_KEYS.supabaseUrl, url);
    log.warn(
      'Backup: env anon key not migrated — secure storage unavailable. Will retry next launch.',
    );
    return;
  }
  if (url) store.set(BACKUP_KEYS.supabaseUrl, url);
  if (anonKey) store.set(BACKUP_KEYS.anonKeyEnc, encrypt(anonKey));
  store.set(BACKUP_KEYS.envMigrated, true);
}

export function getBackupConfig(): BackupConfig {
  migrateFromEnvIfNeeded();
  return {
    supabaseUrl: str(BACKUP_KEYS.supabaseUrl),
    hasAnonKey: !!str(BACKUP_KEYS.anonKeyEnc),
    encryptionAvailable: isEncryptionAvailable(),
  };
}

/** Decrypted credentials. Main-process only — never send these to the renderer. */
export function getBackupCredentials(): {
  url: string;
  anonKey: string;
} | null {
  migrateFromEnvIfNeeded();
  const url = str(BACKUP_KEYS.supabaseUrl).trim();
  const enc = str(BACKUP_KEYS.anonKeyEnc);
  if (!url || !enc) return null;
  try {
    const anonKey = decrypt(enc);
    if (!anonKey) return null;
    return { url, anonKey };
  } catch (error) {
    log.error('Backup: failed to decrypt supabase anon key', error);
    return null;
  }
}

export function saveBackupConfig(input: BackupConfigInput): BackupConfig {
  if (input.supabaseUrl !== undefined) {
    store.set(BACKUP_KEYS.supabaseUrl, input.supabaseUrl.trim());
  }

  if (input.anonKey !== undefined) {
    if (input.anonKey === '') {
      store.delete(BACKUP_KEYS.anonKeyEnc);
    } else {
      if (!isEncryptionAvailable()) {
        throw new Error(
          'Secure storage is unavailable on this system, so the anon key was not saved.',
        );
      }
      store.set(BACKUP_KEYS.anonKeyEnc, encrypt(input.anonKey));
    }
  }

  store.set(BACKUP_KEYS.envMigrated, true);
  return getBackupConfig();
}
