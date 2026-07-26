import { validatePublishConfig } from '../publishConfig';

jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: jest.fn(() => true),
    encryptString: jest.fn((s: string) => Buffer.from(s)),
    decryptString: jest.fn((b: Buffer) => b.toString()),
  },
}));
jest.mock('electron-log', () => ({ error: jest.fn(), warn: jest.fn() }));
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
