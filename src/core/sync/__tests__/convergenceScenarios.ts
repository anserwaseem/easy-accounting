/**
 * Shared source of truth for `SyncEngine`'s cross-device convergence
 * scenarios (a), (b), (e) — extracted out of `SyncEngine.test.ts` so the
 * exact same scenario bodies can run against two different servers:
 * `MockSyncServer` (./mockServer.ts, the in-process reference — see
 * `SyncEngine.test.ts`) and the real Supabase backend
 * (./supabaseTransport.integration.test.ts, `SupabaseSyncTransport`,
 * `supabase/setup.sql` at the repo root). Neither caller weakens or skips
 * any assertion these scenarios make; only the transport underneath
 * changes.
 *
 * Scenarios (c), (d), (f) stay local to `SyncEngine.test.ts` — they assert
 * things specific to `MockSyncServer`'s test-only introspection
 * (`server.logLength`) that a real server can't offer without an extra
 * round-trip, and aren't part of what the integration test needs to prove
 * (idempotency and echo-suppression are exercised directly against
 * `SupabaseSyncTransport` in the integration test's own "round-trip"
 * section instead).
 *
 * ## Shared-server isolation (real backend)
 *
 * `MockSyncServer` starts empty for every test (`beforeEach` in
 * `SyncEngine.test.ts` makes a fresh instance), so a device's local
 * `sync_state.cursor` starting at 0 naturally only ever sees this test's
 * own rows. The real Supabase test project is shared and disposable — it
 * accumulates rows across every run of the integration test (and every
 * other run before it) with no cleanup between them. To keep these
 * scenarios re-runnable against that project without manual cleanup, every
 * scenario here:
 *   - asks the {@link ScenarioTransportFactory} for `currentSeq()` (the
 *     log's current max `seq`) *before* creating either device, and seeds
 *     both devices' local cursor to that value (see {@link makeDevice}'s
 *     `startCursor` param) — so each run's first `pull` only ever sees rows
 *     this run itself pushes, never a prior run's leftovers;
 *   - never asserts an exact row *count* against the server log or a bare
 *     table (which would include prior runs' rows on a shared server) —
 *     only uuid-keyed convergence between the two devices in this run
 *     (`assertTableConverged`/`assertAllFactsConverged`) and balances,
 *     both of which are unaffected by unrelated historical rows because
 *     they're keyed by this run's own randomly-generated uuids;
 *   - relies on every idempotency key being a fresh random uuid, assigned
 *     by migration 029's capture triggers per row per run (see that
 *     migration's doc comment) — never reused across runs, so dedup can
 *     never accidentally swallow this run's own rows.
 */
import Database from 'better-sqlite3';
import type {
  Invoice,
  InvoiceItem,
  InvoiceType,
  Journal,
  JournalEntry,
} from 'types';
import { bootstrapDatabase } from '../../db/bootstrap';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import type { DatabaseDriver } from '../../db/driver';
import type { SessionContext } from '../../ports';
import { AccountService } from '../../services/AccountService';
import { ChartService } from '../../services/ChartService';
import { LedgerService } from '../../services/LedgerService';
import { JournalService } from '../../services/JournalService';
import { InvoiceService } from '../../services/InvoiceService';
import { PricingService } from '../../services/PricingService';
import { SyncEngine } from '../SyncEngine';
import type { SyncTransport } from '../transport';

/* eslint jest/expect-expect: ["warn", { "assertFunctionNames": ["expect", "assertTableConverged", "assertAllFactsConverged", "assertBalancesConverged"] }] */

export const defaultAccountFields = {
  code: null,
  address: null,
  phone1: null,
  phone2: null,
  goodsName: null,
  isActive: true,
  discountProfileId: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

export interface Device {
  db: Database.Database;
  driver: DatabaseDriver;
  session: SessionContext;
  accounts: AccountService;
  chart: ChartService;
  ledger: LedgerService;
  journal: JournalService;
  pricing: PricingService;
  invoices: InvoiceService;
  engine: SyncEngine;
  userId: number;
}

/**
 * What a convergence scenario needs from "a server" — deliberately smaller
 * than {@link SyncTransport} itself. `createDeviceTransport` mirrors
 * `MockSyncServer.createDeviceTransport` (./mockServer.ts): a fresh
 * transport per simulated device, all sharing one backing log/seq counter.
 * `currentSeq` supports the shared-server isolation strategy described in
 * this file's doc comment — for `MockSyncServer` it's always 0 (a fresh
 * instance per test); for a real server it's whatever seq already exists.
 */
export interface ScenarioTransportFactory {
  createDeviceTransport(deviceId: string): SyncTransport;
  currentSeq(): Promise<number>;
}

/**
 * Called once at the top of every scenario, so each caller controls
 * exactly how fresh/shared the backing server is per test: `SyncEngine.test.ts`
 * hands back a brand-new `MockSyncServer` every time; the integration test
 * hands back one factory bound to the same live Supabase project, probed
 * fresh each call for `currentSeq()`.
 */
export type MakeFactory = () =>
  | ScenarioTransportFactory
  | Promise<ScenarioTransportFactory>;

/**
 * Builds one simulated device: a fresh in-memory DB bootstrapped exactly
 * the way production does (schema snapshot + every CORE_MIGRATIONS entry,
 * including migration 029), one seeded local user (`username`, which must
 * be distinct per device in these tests), and every core service wired
 * against it plus a `SyncEngine` bound to `transport`.
 *
 * `startCursor` pre-seeds this device's `sync_state.cursor` (see
 * `SyncEngine`'s `getCursor`/`setCursor`) so its very first `pull` only
 * fetches rows with `seq > startCursor` — see this file's doc comment on
 * why that matters against a shared, disposable real server. Defaults to 0
 * (equivalent to not seeding it at all), which is exactly right for
 * `MockSyncServer`, whose log is always empty at the start of a test.
 */
export async function makeDevice(
  username: string,
  transport: SyncTransport,
  startCursor = 0,
): Promise<Device> {
  const db = new Database(':memory:');
  const driver = new BetterSqliteDriver(db);
  await bootstrapDatabase(driver);

  if (startCursor > 0) {
    await driver.run(
      `INSERT INTO sync_state (key, value) VALUES ('cursor', @value)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      { value: String(startCursor) },
    );
  }

  db.prepare(
    `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
  ).run(username, Buffer.from('x'));
  const userId = (
    db.prepare(`SELECT id FROM users WHERE username = ?`).get(username) as {
      id: number;
    }
  ).id;

  const session: SessionContext = { getUsername: () => username };
  const accounts = new AccountService({ db: driver, session });
  const chart = new ChartService({ db: driver, session });
  const ledger = new LedgerService({ db: driver, session });
  const journal = new JournalService({
    db: driver,
    session,
    ledgerService: ledger,
  });
  const pricing = new PricingService({ db: driver, session });
  const invoices = new InvoiceService({
    db: driver,
    session,
    journalService: journal,
    accountService: accounts,
    pricingService: pricing,
  });
  const engine = new SyncEngine({ db: driver, transport });

  return {
    db,
    driver,
    session,
    accounts,
    chart,
    ledger,
    journal,
    pricing,
    invoices,
    engine,
    userId,
  };
}

export async function seedChart(device: Device): Promise<void> {
  await device.chart.insertCharts(device.session.getUsername()!, [
    { name: 'Current Asset', type: 'Asset' },
    { name: 'Current Liability', type: 'Liability' },
    { name: 'Revenue', type: 'Revenue' },
    { name: 'Expense', type: 'Expense' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any);
}

export async function accountIdByName(
  device: Device,
  name: string,
): Promise<number> {
  const row = await device.driver.get<{ id: number }>(
    `SELECT id FROM account WHERE name = @name`,
    { name },
  );
  return row!.id;
}

export async function insertAccount(
  device: Device,
  name: string,
  headName: string,
): Promise<number> {
  await device.accounts.insertAccount({
    name,
    headName,
    ...defaultAccountFields,
  });
  return accountIdByName(device, name);
}

export const aJournal = (overrides: Partial<Journal> = {}): Journal =>
  ({
    id: 0,
    date: '2025-02-01',
    narration: 'test journal',
    isPosted: true,
    journalEntries: [] as JournalEntry[],
    ...overrides,
  }) as Journal;

/** Every replicated fact table these scenarios check for cross-device convergence. */
export const FACT_TABLES = [
  'users',
  'chart',
  'account',
  'journal',
  'journal_entry',
  'invoices',
  'invoice_items',
];

/**
 * One table's rows, keyed by `uuid`, with every FK column replaced by the
 * *referenced row's uuid* (dropping the raw local id, which is
 * device-specific and not portable) and `createdAt`/`updatedAt` stripped
 * (per `SyncEngine`'s doc comment on why those two columns are not expected
 * to survive a sync round-trip byte-for-byte). This makes the result
 * directly comparable across two independent databases: same uuid keys,
 * same projected values, regardless of which device's AUTOINCREMENT
 * happened to assign which local id to what.
 */
export async function factSnapshot(
  driver: DatabaseDriver,
  table: string,
): Promise<Map<string, Record<string, unknown>>> {
  const columnInfo = await driver.all<{ name: string; type: string }>(
    `PRAGMA table_info("${table}")`,
  );
  const fks = await driver.all<{ from: string; table: string }>(
    `PRAGMA foreign_key_list("${table}")`,
  );
  const fkFrom = new Set(fks.map((fk) => fk.from));

  // Declared-BLOB columns (e.g. users.password_hash) ARE captured and
  // applied now (migration 029's `<col>`/`<col>__hex` typed pair, fixed by
  // migration 031 — see those migrations' doc comments), but this generic
  // snapshot helper still excludes them from the projection it builds: it
  // has no way to know whether a given row's value was hex-decoded on
  // apply, so a raw `t."col"` select here could legitimately differ in
  // representation (Buffer vs string) from the other device's without that
  // meaning divergence. Tests that need to assert a declared-blob column
  // converged (e.g. SyncEngine.test.ts's password_hash round-trip
  // assertions) query it directly instead.
  const selectCols = columnInfo
    .filter(
      (c) =>
        c.name !== 'id' &&
        c.name !== 'createdAt' &&
        c.name !== 'updatedAt' &&
        !fkFrom.has(c.name) &&
        !/BLOB/i.test(c.type ?? ''),
    )
    .map((c) => `t."${c.name}" AS "${c.name}"`);
  const fkJoins = fks
    .map(
      (fk, i) =>
        `LEFT JOIN "${fk.table}" fk${i} ON fk${i}."id" = t."${fk.from}"`,
    )
    .join(' ');
  const fkSelects = fks.map((fk, i) => `fk${i}."uuid" AS "${fk.from}__uuid"`);

  const sql = `SELECT ${[...selectCols, ...fkSelects].join(
    ', ',
  )} FROM "${table}" t ${fkJoins}`;
  const rows = await driver.all<Record<string, unknown>>(sql);

  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) map.set(String(row.uuid), row);
  return map;
}

/** Asserts `table` converged identically (by uuid, FK-columns-as-uuids) between two devices. */
export async function assertTableConverged(
  a: Device,
  b: Device,
  table: string,
): Promise<void> {
  const snapA = await factSnapshot(a.driver, table);
  const snapB = await factSnapshot(b.driver, table);
  expect(new Set(snapA.keys())).toEqual(new Set(snapB.keys()));
  for (const [uuid, rowA] of snapA) {
    expect(snapB.get(uuid)).toEqual(rowA);
  }
}

export async function assertAllFactsConverged(
  a: Device,
  b: Device,
): Promise<void> {
  for (const table of FACT_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    await assertTableConverged(a, b, table);
  }
}

/** Balances for every account on `device`, keyed by the account's uuid (portable across devices). */
export async function balancesByAccountUuid(
  device: Device,
): Promise<Map<string, { balance: number; balanceType: string }>> {
  const accountRows = await device.driver.all<{ id: number; uuid: string }>(
    `SELECT id, uuid FROM account`,
  );
  const result = new Map<string, { balance: number; balanceType: string }>();
  for (const row of accountRows) {
    // eslint-disable-next-line no-await-in-loop
    const balance = await device.ledger.getBalance(row.id);
    result.set(row.uuid, {
      balance: balance?.balance ?? 0,
      balanceType: balance?.balanceType ?? 'Dr',
    });
  }
  return result;
}

export async function assertBalancesConverged(
  a: Device,
  b: Device,
): Promise<void> {
  const balancesA = await balancesByAccountUuid(a);
  const balancesB = await balancesByAccountUuid(b);
  expect(balancesB).toEqual(balancesA);
}

export async function outboxCount(device: Device): Promise<number> {
  const row = await device.driver.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM sync_outbox`,
  );
  return row!.c;
}

// ---------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------

/** (a) A creates accounts + a journal offline; after both sync, B matches A by uuid and by ledger balance. */
export function scenarioA(makeFactory: MakeFactory): void {
  it('(a) A creates accounts + a journal offline; after both sync, B matches A by uuid and by ledger balance', async () => {
    const factory = await makeFactory();
    const startCursor = await factory.currentSeq();
    const a = await makeDevice(
      'deviceA',
      factory.createDeviceTransport('A'),
      startCursor,
    );
    const b = await makeDevice(
      'deviceB',
      factory.createDeviceTransport('B'),
      startCursor,
    );

    await seedChart(a);
    const cash = await insertAccount(a, 'Cash', 'Current Asset');
    const sale = await insertAccount(a, 'Sale', 'Revenue');
    await a.journal.insertJournal(
      aJournal({
        journalEntries: [
          { accountId: cash, debitAmount: 1000, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 1000 },
        ] as JournalEntry[],
      }),
    );

    await a.engine.syncOnce();
    await b.engine.syncOnce();

    await assertTableConverged(a, b, 'chart');
    await assertTableConverged(a, b, 'account');
    await assertTableConverged(a, b, 'journal');
    await assertTableConverged(a, b, 'journal_entry');
    await assertBalancesConverged(a, b);

    a.db.close();
    b.db.close();
  });
}

/** (b) both devices write different journals offline against shared accounts; full round-trip converges to identical facts + trial balance. */
export function scenarioB(makeFactory: MakeFactory): void {
  it('(b) both devices write different journals offline against shared accounts; full round-trip converges to identical facts + trial balance', async () => {
    const factory = await makeFactory();
    const startCursor = await factory.currentSeq();
    const a = await makeDevice(
      'deviceA',
      factory.createDeviceTransport('A'),
      startCursor,
    );
    const b = await makeDevice(
      'deviceB',
      factory.createDeviceTransport('B'),
      startCursor,
    );

    // Shared setup, authored on A, synced to B before either writes a journal.
    await seedChart(a);
    const cashA = await insertAccount(a, 'Cash', 'Current Asset');
    const saleA = await insertAccount(a, 'Sale', 'Revenue');
    await insertAccount(a, 'Bank', 'Current Asset');
    await a.engine.syncOnce();
    await b.engine.syncOnce();

    const saleB = await accountIdByName(b, 'Sale');
    const bankB = await accountIdByName(b, 'Bank');

    // Each device writes its own journal, offline, against the shared accounts.
    await a.journal.insertJournal(
      aJournal({
        date: '2025-03-01',
        narration: 'A journal',
        journalEntries: [
          { accountId: cashA, debitAmount: 500, creditAmount: 0 },
          { accountId: saleA, debitAmount: 0, creditAmount: 500 },
        ] as JournalEntry[],
      }),
    );
    await b.journal.insertJournal(
      aJournal({
        date: '2025-03-02',
        narration: 'B journal',
        journalEntries: [
          { accountId: bankB, debitAmount: 300, creditAmount: 0 },
          { accountId: saleB, debitAmount: 0, creditAmount: 300 },
        ] as JournalEntry[],
      }),
    );

    // A push+pull, B push+pull, A pull again (per the task's exact scenario).
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    await a.engine.syncOnce();

    await assertAllFactsConverged(a, b);
    await assertBalancesConverged(a, b);

    // Trial balance: total debits == total credits, independently, on both devices.
    const totalsA = await a.driver.get<{ d: number; c: number }>(
      `SELECT SUM(debit) AS d, SUM(credit) AS c FROM ledger_view`,
    );
    const totalsB = await b.driver.get<{ d: number; c: number }>(
      `SELECT SUM(debit) AS d, SUM(credit) AS c FROM ledger_view`,
    );
    expect(totalsA!.d).toBeCloseTo(totalsA!.c, 6);
    expect(totalsB!.d).toBeCloseTo(totalsB!.c, 6);
    expect(totalsB!.d).toBeCloseTo(totalsA!.d, 6);

    a.db.close();
    b.db.close();
  });
}

/** (e) FK integrity: an invoice + invoice_items + journal created on A appear correctly linked on B. */
export function scenarioE(makeFactory: MakeFactory): void {
  it('(e) FK integrity: an invoice + invoice_items + journal created on A appear correctly linked on B', async () => {
    const factory = await makeFactory();
    const startCursor = await factory.currentSeq();
    const a = await makeDevice(
      'deviceA',
      factory.createDeviceTransport('A'),
      startCursor,
    );
    const b = await makeDevice(
      'deviceB',
      factory.createDeviceTransport('B'),
      startCursor,
    );

    await seedChart(a);
    // InvoiceService.getTransactionAccounts requires both a 'Sale' and a
    // 'Purchase' named account to exist regardless of this invoice's own
    // type (see InvoiceService.ts).
    await insertAccount(a, 'Sale', 'Revenue');
    await insertAccount(a, 'Purchase', 'Expense');
    const partyId = await insertAccount(a, 'Customer', 'Current Asset');
    await a.pricing.insertItemType('General');
    const itemTypeRow = await a.driver.get<{ id: number }>(
      `SELECT id FROM item_types WHERE name = 'General'`,
    );
    await a.pricing.setPrimaryItemType(itemTypeRow!.id);
    await a.driver.run(
      `INSERT INTO inventory (name, description, price, quantity, itemTypeId) VALUES (@name, NULL, @price, @quantity, @itemTypeId)`,
      { name: 'Widget', price: 50, quantity: 100, itemTypeId: itemTypeRow!.id },
    );
    const inventoryRow = await a.driver.get<{ id: number }>(
      `SELECT id FROM inventory WHERE name = 'Widget'`,
    );

    const items: InvoiceItem[] = [
      {
        id: 1,
        inventoryId: inventoryRow!.id,
        quantity: 3,
        discount: 0,
        price: 50,
        discountedPrice: 150,
      },
    ];
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-03-01T12:00:00.000Z').toISOString(),
      invoiceNumber: 9001,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 150,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
      invoiceItems: items,
    };

    const { invoiceId } = await a.invoices.insertInvoice(
      'Sale' as InvoiceType,
      invoice,
    );
    expect(invoiceId).toBeGreaterThan(0);

    await a.engine.syncOnce();
    await b.engine.syncOnce();

    await assertTableConverged(a, b, 'invoices');
    await assertTableConverged(a, b, 'invoice_items');
    await assertTableConverged(a, b, 'journal');
    await assertTableConverged(a, b, 'journal_entry');

    // Explicitly confirm the child rows reference B-LOCAL parent ids, not A's.
    const invoiceOnB = await b.driver.get<{
      id: number;
      uuid: string;
      accountId: number;
    }>(`SELECT id, uuid, accountId FROM invoices WHERE invoiceNumber = 9001`);
    const itemOnB = await b.driver.get<{
      invoiceId: number;
      inventoryId: number;
    }>(
      `SELECT invoiceId, inventoryId FROM invoice_items WHERE invoiceId = @invoiceId`,
      { invoiceId: invoiceOnB!.id },
    );
    expect(itemOnB!.invoiceId).toBe(invoiceOnB!.id);
    const partyOnB = await accountIdByName(b, 'Customer');
    expect(invoiceOnB!.accountId).toBe(partyOnB);
    const inventoryOnB = await b.driver.get<{ id: number }>(
      `SELECT id FROM inventory WHERE name = 'Widget'`,
    );
    expect(itemOnB!.inventoryId).toBe(inventoryOnB!.id);

    a.db.close();
    b.db.close();
  });
}
