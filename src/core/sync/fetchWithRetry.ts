import { isNetworkFetchError } from './networkError';

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 400;
/** Safari iOS can leave a `fetch` pending forever after a tab freeze. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Retries a `fetch` that threw a network error (see {@link isNetworkFetchError}).
 * HTTP responses (including 4xx/5xx) are returned as-is — those are not
 * dropped packets. Used by {@link import('./SupabaseSyncTransport').SupabaseSyncTransport}
 * so a single Safari "Load failed" during a multi-page join pull does not
 * abort the whole download.
 *
 * Each attempt is bounded by `timeoutMs` (default 30s). A hung request is
 * aborted and retried like a dropped packet — without this, Safari can
 * leave `SyncManager.inFlight` set forever and the UI stuck on
 * "syncing…".
 */
export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  opts?: {
    attempts?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<Response> {
  const attempts = opts?.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = opts?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep =
    opts?.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));

  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fetchWithTimeout(fetchImpl, input, init, timeoutMs);
    } catch (error) {
      lastError = error;
      const retry = i < attempts - 1 && isNetworkFetchError(error);
      if (!retry) throw error;
      // eslint-disable-next-line no-await-in-loop
      await sleep(baseDelayMs * 2 ** i);
    }
  }
  throw lastError;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const existing = init.signal;
  if (existing) {
    if (existing.aborted) controller.abort();
    else {
      existing.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }
  }
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw new TypeError('Load failed');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name } = error as { name?: unknown };
  const message = error instanceof Error ? error.message : String(error);
  return name === 'AbortError' || /aborted|abort/i.test(message);
}
