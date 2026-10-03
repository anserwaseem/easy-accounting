/**
 * Browser `fetch` network failures are not HTTP errors — they throw
 * `TypeError` with an opaque message. Safari iOS reports `"Load failed"`;
 * Chromium `"Failed to fetch"`; Firefox `"NetworkError when attempting to
 * fetch resource."`. Join/rebuild of a large project is many sequential
 * pulls; one dropped request used to abort the whole join and skip
 * persisting credentials (so Settings looked disconnected even though rows
 * had already landed).
 */
export function isNetworkFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === 'AbortError') return true;
  return /load failed|failed to fetch|networkerror|network request failed|failed to load|the internet connection appears to be offline|aborted/i.test(
    message,
  );
}
