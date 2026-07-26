import {
  buildPublishTargets,
  joinKey,
  unsafeTargetReason,
} from '../publishTargets';

const config = {
  privatePrefix: 'catalog/private',
  publicPrefix: 'catalog/public',
};

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
});

describe('unsafeTargetReason', () => {
  it('accepts a well-separated layout', () => {
    expect(unsafeTargetReason(config)).toBeNull();
  });

  it('rejects identical prefixes', () => {
    expect(
      unsafeTargetReason({ privatePrefix: 'x', publicPrefix: 'x' }),
    ).toMatch(/same/i);
  });

  it('rejects a private prefix nested inside the public one', () => {
    expect(
      unsafeTargetReason({
        privatePrefix: 'catalog/public/private',
        publicPrefix: 'catalog/public',
      }),
    ).toMatch(/inside/i);
  });

  it('rejects a bucket-root public prefix', () => {
    expect(
      unsafeTargetReason({ privatePrefix: 'private', publicPrefix: '' }),
    ).toMatch(/root/i);
  });
});
