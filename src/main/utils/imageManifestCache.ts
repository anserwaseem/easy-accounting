/**
 * When a remembered images manifest may be reused.
 *
 * Extracted from the service so the rule is testable without a database or a
 * network: caching is the kind of thing that fails silently and late, by
 * serving an answer that was true an hour ago.
 */
interface ImageManifestCacheEntry<T> {
  url: string;
  result: T;
}

/**
 * True when the cached entry answers this request.
 *
 * Keyed by URL because changing the manifest location in Settings must not be
 * answered from the old one; `force` exists for the paths where the user is
 * explicitly asking for current state (previewing, publishing) rather than
 * incidentally reading it.
 */
export function canUseCachedManifest<T>(
  cache: ImageManifestCacheEntry<T> | null,
  url: string | undefined,
  force: boolean,
): boolean {
  if (force || !url || cache === null) return false;
  return cache.url === url;
}

/**
 * Whether a result is worth remembering.
 *
 * Failures are not: caching "the manifest is unreachable" would keep every item
 * reporting a missing image long after the network recovered, and the user has
 * no way to tell the app to try again.
 */
export function isCacheableManifestResult(result: { error?: string }): boolean {
  return !result.error;
}
