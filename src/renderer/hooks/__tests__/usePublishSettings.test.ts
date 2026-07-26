import { missingPublishConfig } from '../usePublishSettings';

const ready = {
  endpoint: 'https://example.storage.com',
  bucket: 'catalog',
  accessKeyId: 'AKIA',
  hasSecretAccessKey: true,
  publicPriceLists: ['Retail'],
};

describe('missingPublishConfig', () => {
  it('returns nothing missing when all required fields are present', () => {
    expect(missingPublishConfig(ready)).toEqual([]);
  });

  it('lists each missing required field', () => {
    expect(
      missingPublishConfig({
        endpoint: '',
        bucket: '',
        accessKeyId: '',
        hasSecretAccessKey: false,
        publicPriceLists: [],
      }),
    ).toEqual([
      'storage endpoint',
      'bucket',
      'access key ID',
      'secret access key',
      'at least one public price list',
    ]);
  });

  it('treats whitespace-only values as missing', () => {
    expect(missingPublishConfig({ ...ready, bucket: '   ' })).toEqual([
      'bucket',
    ]);
  });

  it('requires an explicit public price list (safe by default)', () => {
    expect(missingPublishConfig({ ...ready, publicPriceLists: [] })).toEqual([
      'at least one public price list',
    ]);
  });
});
