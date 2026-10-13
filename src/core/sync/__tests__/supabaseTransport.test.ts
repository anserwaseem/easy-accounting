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

const rpcRow = {
  seq: 5,
  table_name: 'account',
  row_uuid: 'u5',
  op: 'put',
  row_json: { name: 'Cash' },
  device_id: 'device-2',
};

describe('SupabaseSyncTransport.pullWithWatermark', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gets the page and the watermark from one sync_pull request', async () => {
    const { calls, impl } = fakeFetch([
      { status: 200, body: { maxSeq: 9, rows: [rpcRow] } },
    ]);

    const result = await makeTransport(impl).pullWithWatermark(4, 200, {
      tables: ['account'],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe('/rest/v1/rpc/sync_pull');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      after_seq: 4,
      max_rows: 200,
      exclude_device: 'device-1',
      only_tables: ['account'],
    });
    expect(result).toEqual({
      maxSeq: 9,
      rows: [
        {
          seq: 5,
          tableName: 'account',
          rowUuid: 'u5',
          op: 'put',
          rowJson: JSON.stringify({ name: 'Cash' }),
          deviceId: 'device-2',
        },
      ],
    });
  });

  it('sends null filters for includeSelf and no table list', async () => {
    const { calls, impl } = fakeFetch([
      { status: 200, body: { maxSeq: 0, rows: [] } },
    ]);

    await makeTransport(impl).pullWithWatermark(0, 200, { includeSelf: true });

    const body = JSON.parse(String(calls[0].init.body));
    expect(body.exclude_device).toBeNull();
    expect(body.only_tables).toBeNull();
  });

  it('falls back to watermark-then-page GETs when sync_pull is missing, and retries it after an hour', async () => {
    const missing = { status: 404, body: { code: 'PGRST202' } };
    const { calls, impl } = fakeFetch([
      missing,
      { status: 200, body: [{ seq: 9 }] },
      { status: 200, body: [rpcRow] },
      { status: 200, body: [{ seq: 9 }] },
      { status: 200, body: [] },
      { status: 200, body: { maxSeq: 9, rows: [] } },
    ]);
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const transport = makeTransport(impl);

    const first = await transport.pullWithWatermark(4, 200);
    expect(first.maxSeq).toBe(9);
    expect(first.rows.map((row) => row.seq)).toEqual([5]);
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/rest/v1/rpc/sync_pull',
      '/rest/v1/sync_log',
      '/rest/v1/sync_log',
    ]);
    // watermark first, then the page
    expect(calls[1].url.searchParams.get('order')).toBe('seq.desc');
    expect(calls[2].url.searchParams.get('seq')).toBe('gt.4');

    now.mockReturnValue(1_000 + 59 * 60 * 1000);
    await transport.pullWithWatermark(9, 200);
    expect(calls).toHaveLength(5);
    expect(calls[3].url.pathname).toBe('/rest/v1/sync_log');

    now.mockReturnValue(1_000 + 60 * 60 * 1000);
    await transport.pullWithWatermark(9, 200);
    expect(calls).toHaveLength(6);
    expect(calls[5].url.pathname).toBe('/rest/v1/rpc/sync_pull');
  });

  it('throws on any other sync_pull failure instead of falling back', async () => {
    const { calls, impl } = fakeFetch([
      { status: 500, body: { code: '57014' } },
    ]);

    await expect(makeTransport(impl).pullWithWatermark(0, 200)).rejects.toThrow(
      /sync_pull RPC failed \(status 500\)/,
    );
    expect(calls).toHaveLength(1);
  });

  it('rejects a malformed sync_pull body', async () => {
    const { impl } = fakeFetch([{ status: 200, body: { rows: [] } }]);

    await expect(makeTransport(impl).pullWithWatermark(0, 200)).rejects.toThrow(
      /unexpected shape/,
    );
  });
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
