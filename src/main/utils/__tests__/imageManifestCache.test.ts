import {
  canUseCachedManifest,
  isCacheableManifestResult,
} from '../imageManifestCache';

const cached = {
  url: 'https://cdn.example.com/images.json',
  result: { ok: 1 },
};

describe('canUseCachedManifest', () => {
  it('reuses the entry for the same URL', () => {
    expect(canUseCachedManifest(cached, cached.url, false)).toBe(true);
  });

  it('refuses a different URL', () => {
    // changing the manifest location in Settings must not be answered from the
    // old one, which would silently describe a different bucket
    expect(
      canUseCachedManifest(cached, 'https://other/images.json', false),
    ).toBe(false);
  });

  it('refuses when forced', () => {
    // previewing and publishing are the user asking for current state
    expect(canUseCachedManifest(cached, cached.url, true)).toBe(false);
  });

  it('refuses when nothing is cached yet', () => {
    expect(canUseCachedManifest(null, cached.url, false)).toBe(false);
  });

  it('refuses when no URL is configured', () => {
    expect(canUseCachedManifest(cached, undefined, false)).toBe(false);
  });
});

describe('isCacheableManifestResult', () => {
  it('remembers a good read', () => {
    expect(isCacheableManifestResult({})).toBe(true);
  });

  it('never remembers a failure', () => {
    // caching "unreachable" would keep every item reporting a missing image
    // long after the network recovered, with no way to ask it to retry
    expect(isCacheableManifestResult({ error: 'HTTP 503' })).toBe(false);
  });

  it('never remembers an empty manifest', () => {
    expect(
      isCacheableManifestResult({
        error: 'The images manifest lists no images.',
      }),
    ).toBe(false);
  });
});
