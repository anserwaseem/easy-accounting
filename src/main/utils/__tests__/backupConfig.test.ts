import {
  BACKUP_KEYS,
  getBackupConfig,
  getBackupCredentials,
  saveBackupConfig,
} from '../backupConfig';
import { store } from '../../store';

jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: jest.fn(() => true),
    encryptString: jest.fn((s: string) => Buffer.from(s)),
    decryptString: jest.fn((b: Buffer) => b.toString()),
  },
}));
jest.mock('electron-log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}));

const memory = new Map<string, unknown>();

jest.mock('../../store', () => ({
  store: {
    get: jest.fn((key: string) => memory.get(key)),
    set: jest.fn((key: string, value: unknown) => {
      memory.set(key, value);
    }),
    delete: jest.fn((key: string) => {
      memory.delete(key);
    }),
    has: jest.fn((key: string) => memory.has(key)),
  },
}));

describe('backupConfig', () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_ANON_KEY;

  beforeEach(() => {
    memory.clear();
    jest.clearAllMocks();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = originalKey;
  });

  it('returns empty config when nothing is stored or in env', () => {
    expect(getBackupConfig()).toEqual({
      supabaseUrl: '',
      hasAnonKey: false,
      encryptionAvailable: true,
    });
    expect(getBackupCredentials()).toBeNull();
    expect(store.set).toHaveBeenCalledWith(BACKUP_KEYS.envMigrated, true);
  });

  it('migrates process.env into the store once', () => {
    process.env.SUPABASE_URL = 'https://env.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'env-anon';

    expect(getBackupCredentials()).toEqual({
      url: 'https://env.supabase.co',
      anonKey: 'env-anon',
    });
    expect(getBackupConfig()).toEqual({
      supabaseUrl: 'https://env.supabase.co',
      hasAnonKey: true,
      encryptionAvailable: true,
    });

    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    expect(getBackupCredentials()).toEqual({
      url: 'https://env.supabase.co',
      anonKey: 'env-anon',
    });
  });

  it('does not re-read env after a user clears settings', () => {
    process.env.SUPABASE_URL = 'https://env.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'env-anon';
    getBackupCredentials();

    saveBackupConfig({ supabaseUrl: '', anonKey: '' });

    expect(getBackupCredentials()).toBeNull();
    expect(getBackupConfig().hasAnonKey).toBe(false);
  });

  it('saves url and write-only anon key', () => {
    const saved = saveBackupConfig({
      supabaseUrl: ' https://mine.supabase.co ',
      anonKey: 'secret-anon',
    });
    expect(saved).toEqual({
      supabaseUrl: 'https://mine.supabase.co',
      hasAnonKey: true,
      encryptionAvailable: true,
    });
    expect(getBackupCredentials()).toEqual({
      url: 'https://mine.supabase.co',
      anonKey: 'secret-anon',
    });
  });

  it('leaves the anon key unchanged when save omits it', () => {
    saveBackupConfig({
      supabaseUrl: 'https://mine.supabase.co',
      anonKey: 'secret-anon',
    });
    saveBackupConfig({ supabaseUrl: 'https://other.supabase.co' });
    expect(getBackupCredentials()).toEqual({
      url: 'https://other.supabase.co',
      anonKey: 'secret-anon',
    });
  });
});
