import {
  buildPublishTargets,
  contentFingerprint,
  joinKey,
  unsafeTargetReason,
} from '../publishTargets';

const config = {
  bucket: 'public-bucket',
  privatePrefix: 'catalog/private',
  publicPrefix: 'catalog/public',
};

const splitConfig = { ...config, privateBucket: 'private-bucket' };

describe('joinKey', () => {
  it('joins prefix and file name', () => {
    expect(joinKey('a/b', 'f.json')).toBe('a/b/f.json');
  });
  it('tolerates stray slashes', () => {
    expect(joinKey('/a/b/', 'f.json')).toBe('a/b/f.json');
  });
  it('supports an empty prefix', () => {
    expect(joinKey('', 'f.json')).toBe('f.json');
  });
});

describe('buildPublishTargets', () => {
  it('puts the full catalog under the private prefix only', () => {
    const full = buildPublishTargets(config).find((t) => t.kind === 'full');
    expect(full?.key).toBe('catalog/private/catalog-full.json');
    expect(full?.isPublic).toBe(false);
  });

  it('puts the public catalog and csv under the public prefix', () => {
    const targets = buildPublishTargets(config);
    expect(targets.find((t) => t.kind === 'public')?.key).toBe(
      'catalog/public/catalog-public.json',
    );
    expect(targets.find((t) => t.kind === 'csv')?.key).toBe(
      'catalog/public/products.csv',
    );
  });

  it('never places the full catalog under the public prefix', () => {
    const fullKeys = buildPublishTargets(config)
      .filter((t) => t.kind === 'full')
      .map((t) => t.key.startsWith(config.publicPrefix));
    expect(fullKeys).toEqual([false]);
  });

  it('sets sensible content types', () => {
    const byKind = Object.fromEntries(
      buildPublishTargets(config).map((t) => [t.kind, t.contentType]),
    );
    expect(byKind).toEqual({
      full: 'application/json',
      public: 'application/json',
      csv: 'text/csv',
    });
  });

  it('falls back to the main bucket when no private bucket is set', () => {
    const buckets = Object.fromEntries(
      buildPublishTargets(config).map((t) => [t.kind, t.bucket]),
    );
    expect(buckets).toEqual({
      full: 'public-bucket',
      public: 'public-bucket',
      csv: 'public-bucket',
    });
  });

  it('routes ONLY the full catalog to the private bucket when set', () => {
    const buckets = Object.fromEntries(
      buildPublishTargets(splitConfig).map((t) => [t.kind, t.bucket]),
    );
    expect(buckets).toEqual({
      full: 'private-bucket',
      public: 'public-bucket',
      csv: 'public-bucket',
    });
  });

  it('never routes a public file to the private bucket', () => {
    const publicBuckets = buildPublishTargets(splitConfig)
      .filter((t) => t.isPublic)
      .map((t) => t.bucket);
    expect(publicBuckets).toEqual(['public-bucket', 'public-bucket']);
  });

  it('ignores a blank private bucket', () => {
    const full = buildPublishTargets({ ...config, privateBucket: '   ' }).find(
      (t) => t.kind === 'full',
    );
    expect(full?.bucket).toBe('public-bucket');
  });
});

describe('unsafeTargetReason', () => {
  it('accepts a well-separated prefix layout', () => {
    expect(unsafeTargetReason(config)).toBeNull();
  });

  it('rejects identical prefixes in a shared bucket', () => {
    expect(
      unsafeTargetReason({ ...config, privatePrefix: 'x', publicPrefix: 'x' }),
    ).toMatch(/same/i);
  });

  it('rejects a private prefix nested inside the public one', () => {
    expect(
      unsafeTargetReason({
        ...config,
        privatePrefix: 'catalog/public/private',
        publicPrefix: 'catalog/public',
      }),
    ).toMatch(/inside/i);
  });

  it('rejects a bucket-root public prefix in a shared bucket', () => {
    expect(
      unsafeTargetReason({
        ...config,
        privatePrefix: 'private',
        publicPrefix: '',
      }),
    ).toMatch(/root/i);
  });

  it('accepts any prefix layout once a separate private bucket is used', () => {
    // the full catalog lives in a bucket that is never published, so prefix
    // collisions cannot expose it
    expect(
      unsafeTargetReason({
        ...splitConfig,
        privatePrefix: 'x',
        publicPrefix: 'x',
      }),
    ).toBeNull();
    expect(unsafeTargetReason({ ...splitConfig, publicPrefix: '' })).toBeNull();
  });

  it('still validates prefixes when the private bucket equals the main bucket', () => {
    expect(
      unsafeTargetReason({
        ...config,
        privateBucket: 'public-bucket',
        privatePrefix: 'x',
        publicPrefix: 'x',
      }),
    ).toMatch(/same/i);
  });
});

describe('contentFingerprint', () => {
  const payload = {
    full: '{"generatedAt":"2026-01-01T00:00:00Z","items":[1]}',
    public: '{"generatedAt":"2026-01-01T00:00:00Z","items":[1]}',
    csv: 'sku,price\nA,10\n',
  };

  it('is stable for identical content', () => {
    expect(contentFingerprint(payload)).toBe(contentFingerprint(payload));
  });

  it('ignores the timestamp so an unchanged catalog matches', () => {
    const later = {
      ...payload,
      full: payload.full.replace(
        '2026-01-01T00:00:00Z',
        '2026-09-09T09:09:09Z',
      ),
      public: payload.public.replace(
        '2026-01-01T00:00:00Z',
        '2026-09-09T09:09:09Z',
      ),
    };
    expect(contentFingerprint(later)).toBe(contentFingerprint(payload));
  });

  it('changes when catalog data changes', () => {
    expect(
      contentFingerprint({ ...payload, csv: 'sku,price\nA,11\n' }),
    ).not.toBe(contentFingerprint(payload));
    expect(
      contentFingerprint({ ...payload, public: '{"items":[2]}' }),
    ).not.toBe(contentFingerprint(payload));
  });
});
