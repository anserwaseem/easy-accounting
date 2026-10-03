import { validatePublishConfig, getPublishConfig } from '../publishConfig';
import { store } from '../../store';

const mockGetAll = jest.fn();
jest.mock('../../coreRuntime', () => ({
  getSettingsService: () => ({
    getAll: mockGetAll,
  }),
}));

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
jest.mock('../../store', () => ({
  store: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
}));

const ready = {
  endpoint: 'https://example.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'catalog',
  privateBucket: '',
  accessKeyId: 'AKIA',
  publicBaseUrl: 'https://cdn.example.com',
  privatePrefix: 'catalog/private',
  publicPrefix: 'catalog/public',
  publicPriceList: 'Retail',
  publishWithoutImages: false,
  requireTitle: true,
  requiredAttributeKeys: '',
  reservedNameChars: '',
  imagesManifestUrl: '',
  webhookUrl: '',
  hasSecretAccessKey: true,
  hasWebhookToken: false,
  encryptionAvailable: true,
};

describe('validatePublishConfig', () => {
  it('reports nothing missing for a complete config', () => {
    expect(validatePublishConfig(ready)).toEqual([]);
  });

  it('requires endpoint, bucket, access key and secret', () => {
    const missing = validatePublishConfig({
      ...ready,
      endpoint: '',
      bucket: '',
      accessKeyId: '',
      hasSecretAccessKey: false,
    });
    expect(missing).toEqual([
      'endpoint',
      'bucket',
      'access key ID',
      'secret access key',
    ]);
  });

  it('requires a public price list (safe by default)', () => {
    expect(validatePublishConfig({ ...ready, publicPriceList: '' })).toEqual([
      'a public price list',
    ]);
  });
});

describe('getPublishConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads non-secret fields from SettingsService when present', async () => {
    mockGetAll.mockResolvedValueOnce({
      'publish.endpoint': 'https://synced-r2.com',
      'publish.bucket': 'synced-bucket',
      'publish.accessKeyId': 'SYNCED_KEY',
      'publish.publicPriceList': 'Wholesale',
    });
    (store.get as jest.Mock).mockReturnValue(undefined);

    const config = await getPublishConfig();
    expect(config.endpoint).toBe('https://synced-r2.com');
    expect(config.bucket).toBe('synced-bucket');
    expect(config.accessKeyId).toBe('SYNCED_KEY');
    expect(config.publicPriceList).toBe('Wholesale');
  });

  it('falls back to store when SettingsService is empty', async () => {
    mockGetAll.mockResolvedValueOnce({});
    (store.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'publish.endpoint') return 'https://legacy-r2.com';
      if (key === 'publish.bucket') return 'legacy-bucket';
      return undefined;
    });

    const config = await getPublishConfig();
    expect(config.endpoint).toBe('https://legacy-r2.com');
    expect(config.bucket).toBe('legacy-bucket');
  });
});
