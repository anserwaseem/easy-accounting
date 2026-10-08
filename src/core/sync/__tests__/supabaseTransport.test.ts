/**
 * @jest-environment node
 */
import { SupabaseSyncTransport } from '../SupabaseSyncTransport';

/** records every request and answers each with the next queued response */
const fakeFetch = (responses: { status: number; body: unknown }[]) => {
  const calls: { url: URL; init: RequestInit }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    const next = responses.shift() ?? { status: 200, body: [] };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { calls, impl };
};

const makeTransport = (fetchImpl: typeof fetch) =>
  new SupabaseSyncTransport({
    url: 'https://example.supabase.co/',
    anonKey: 'anon',
    deviceId: 'device-1',
    fetchImpl,
  });

describe('SupabaseSyncTransport.pull', () => {
  it('filters out own rows and, when given, everything outside `tables`', async () => {
    const { calls, impl } = fakeFetch([{ status: 200, body: [] }]);

    await makeTransport(impl).pull(41, 200, {
      tables: ['account', 'invoice_items'],
    });

    const { searchParams } = calls[0].url;
    expect(calls[0].url.pathname).toBe('/rest/v1/sync_log');
    expect(searchParams.get('seq')).toBe('gt.41');
    expect(searchParams.get('device_id')).toBe('neq.device-1');
    expect(searchParams.get('table_name')).toBe('in.(account,invoice_items)');
  });

  it('sends no table filter by default', async () => {
    const { calls, impl } = fakeFetch([{ status: 200, body: [] }]);

    await makeTransport(impl).pull(0, 200);

    expect(calls[0].url.searchParams.has('table_name')).toBe(false);
  });
});
