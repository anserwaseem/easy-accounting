import { isNetworkFetchError } from '../networkError';
import { fetchWithRetry } from '../fetchWithRetry';

describe('isNetworkFetchError', () => {
  it('recognizes Safari, Chromium, and Firefox fetch failures', () => {
    expect(isNetworkFetchError(new TypeError('Load failed'))).toBe(true);
    expect(isNetworkFetchError(new TypeError('Failed to fetch'))).toBe(true);
    expect(
      isNetworkFetchError(
        new TypeError('NetworkError when attempting to fetch resource.'),
      ),
    ).toBe(true);
  });

  it('does not treat application errors as dropped packets', () => {
    expect(isNetworkFetchError(new Error('UNIQUE constraint failed'))).toBe(
      false,
    );
    expect(isNetworkFetchError('not a network error')).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  it('retries Safari Load failed and returns the first success', async () => {
    const ok = { status: 200, ok: true } as Response;
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(ok);

    const delays: number[] = [];
    const got = await fetchWithRetry(
      fetchImpl as typeof fetch,
      'https://example.test',
      {},
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(got).toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([400]);
  });

  it('times out a hung fetch and retries', async () => {
    const ok = { status: 200, ok: true } as Response;
    const fetchImpl = jest
      .fn()
      .mockImplementationOnce(
        (_input: unknown, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const { signal } = init;
            if (!signal) return;
            signal.addEventListener('abort', () => {
              reject(
                Object.assign(new Error('The user aborted a request.'), {
                  name: 'AbortError',
                }),
              );
            });
          }),
      )
      .mockResolvedValueOnce(ok);

    const got = await fetchWithRetry(
      fetchImpl as typeof fetch,
      'https://example.test',
      {},
      {
        timeoutMs: 20,
        sleep: async () => {},
      },
    );

    expect(got).toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-network throw', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('UNIQUE constraint failed'));

    await expect(
      fetchWithRetry(
        fetchImpl as typeof fetch,
        'https://example.test',
        {},
        {
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow('UNIQUE constraint failed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
