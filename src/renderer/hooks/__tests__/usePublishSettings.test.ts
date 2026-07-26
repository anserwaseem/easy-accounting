import { missingPublishConfig } from '../usePublishSettings';

const ready = {
  endpoint: 'https://example.storage.com',
  bucket: 'catalog',
  accessKeyId: 'AKIA',
  hasSecretAccessKey: true,
  publicPriceList: 'Retail',
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
        publicPriceList: '',
      }),
    ).toEqual([
      'storage endpoint',
      'bucket',
      'access key ID',
      'secret access key',
      'a public price list',
    ]);
  });

  it('treats whitespace-only values as missing', () => {
    expect(missingPublishConfig({ ...ready, bucket: '   ' })).toEqual([
      'bucket',
    ]);
  });

  it('requires an explicit public price list (safe by default)', () => {
    expect(missingPublishConfig({ ...ready, publicPriceList: '' })).toEqual([
      'a public price list',
    ]);
  });
});
