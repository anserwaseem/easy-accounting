/**
 * Unit tests for {@link seedOutboxFromLocalData} (../seedOutbox.ts) in
 * isolation from `SyncEngine` — no transport, no second device, just one
 * bootstrapped database and direct assertions against what the helper
 * queues into `sync_outbox`. `SyncEngine.test.ts`'s scenarios (p)/(q)/(r)
 * cover the end-to-end recovery this helper enables; these tests cover the
 * helper's own contract.
 */
import Database from 'better-sqlite3';
import { bootstrapDatabase } from '../../db/bootstrap';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import type { DatabaseDriver } from '../../db/driver';
import { seedOutboxFromLocalData } from '../seedOutbox';

async function freshDriver(): Promise<DatabaseDriver> {
  const db = new Database(':memory:');
  const driver = new BetterSqliteDriver(db);
  await bootstrapDatabase(driver);
  return driver;
}

async function outboxCount(driver: DatabaseDriver): Promise<number> {
  const row = await driver.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM sync_outbox`,
  );
  return row!.c;
}

describe('seedOutboxFromLocalData', () => {
  it('a brand-new, empty device (no business rows at all) seeds nothing', async () => {
    const driver = await freshDriver();
    const result = await seedOutboxFromLocalData(driver);
    expect(result.seeded).toBe(0);
    expect(await outboxCount(driver)).toBe(0);
  });

  it('captures every current row exactly once, with the deterministic reseed: key, and a second call is a local no-op', async () => {
    const driver = await freshDriver();
    await driver.run(
      `INSERT INTO chart (name, type) VALUES ('Current Asset', 'Asset')`,
    );
    const chart = await driver.get<{ id: number; uuid: string }>(
      `SELECT id, uuid FROM chart WHERE name = 'Current Asset'`,
    );
    // migration 029's own insert-capture trigger assigned a uuid and
    // already queued its own (unrelated) sync_outbox row for this insert —
    // clear it so the assertions below are only about what THIS helper
    // itself queues, in isolation.
    expect(chart!.uuid).toBeTruthy();
    await driver.run(`DELETE FROM sync_outbox`);
    expect(await outboxCount(driver)).toBe(0);

    const first = await seedOutboxFromLocalData(driver);
    expect(first.seeded).toBe(1);
    expect(await outboxCount(driver)).toBe(1);

    const row = await driver.get<{
      idempotencyKey: string;
      tableName: string;
      rowUuid: string;
      op: string;
    }>(`SELECT idempotencyKey, tableName, rowUuid, op FROM sync_outbox`);
    expect(row!.tableName).toBe('chart');
    expect(row!.rowUuid).toBe(chart!.uuid);
    expect(row!.op).toBe('put');
    expect(row!.idempotencyKey).toBe(`reseed:chart:${chart!.uuid}`);

    // Second call: the row it would produce already exists (same
    // deterministic key), so the NOT EXISTS guard makes this a true no-op —
    // no duplicate entry, `seeded` reports 0.
    const second = await seedOutboxFromLocalData(driver);
    expect(second.seeded).toBe(0);
    expect(await outboxCount(driver)).toBe(1);
  });

  it('skips a row whose uuid is NULL rather than queuing a null-keyed entry', async () => {
    const driver = await freshDriver();

    // Simulate a row that predates uuid assignment by suppressing the
    // insert-capture trigger (which is what assigns the uuid) via the same
    // 'applying' guard SyncEngine's own apply path uses — see migration
    // 029's "Echo suppression" doc comment.
    await driver.run(
      `INSERT INTO sync_state (key, value) VALUES ('applying', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    await driver.run(
      `INSERT INTO chart (name, type) VALUES ('No Uuid', 'Asset')`,
    );
    await driver.run(`DELETE FROM sync_state WHERE key = 'applying'`);

    const chart = await driver.get<{ uuid: string | null }>(
      `SELECT uuid FROM chart WHERE name = 'No Uuid'`,
    );
    expect(chart!.uuid).toBeNull();
    // The suppressed trigger also never captured its own row.
    expect(await outboxCount(driver)).toBe(0);

    const result = await seedOutboxFromLocalData(driver);
    expect(result.seeded).toBe(0);
    expect(await outboxCount(driver)).toBe(0);
  });

  it('never seeds ledger — excluded from SYNC_TABLES as derived state, not a replicated fact table', async () => {
    const driver = await freshDriver();
    await driver.run(
      `INSERT INTO ledger (date, particulars, balance, balanceType) VALUES (datetime('now'), 'test', 0, 'Dr')`,
    );
    const ledgerRow = await driver.get<{ uuid: string | null }>(
      `SELECT uuid FROM ledger`,
    );
    // ledger keeps its own migration-024 uuid-assignment trigger (untouched
    // by migration 029 — see that migration's doc comment), so it has a
    // uuid despite never being replicated.
    expect(ledgerRow!.uuid).toBeTruthy();

    const result = await seedOutboxFromLocalData(driver);
    expect(result.seeded).toBe(0);
    expect(await outboxCount(driver)).toBe(0);
  });

  it('seeds multiple rows of the same table with distinct per-row idempotency keys (the non-correlated-subquery trap this must avoid)', async () => {
    const driver = await freshDriver();
    await driver.run(
      `INSERT INTO chart (name, type) VALUES ('Current Asset', 'Asset')`,
    );
    await driver.run(
      `INSERT INTO chart (name, type) VALUES ('Revenue', 'Revenue')`,
    );
    await driver.run(
      `INSERT INTO chart (name, type) VALUES ('Expense', 'Expense')`,
    );
    await driver.run(`DELETE FROM sync_outbox`); // isolate from the inserts' own capture-trigger rows

    const result = await seedOutboxFromLocalData(driver);
    expect(result.seeded).toBe(3);

    const keys = await driver.all<{ idempotencyKey: string }>(
      `SELECT idempotencyKey FROM sync_outbox WHERE tableName = 'chart'`,
    );
    // A bulk INSERT...SELECT using a non-correlated scalar subquery for the
    // key (e.g. migration 029's UUID_V4_SQL_EXPR) would give every row of
    // this SELECT the SAME value — this asserts that did NOT happen here,
    // and that sync_outbox's own UNIQUE(idempotencyKey) constraint (which
    // would have rejected the whole INSERT outright) never had a chance to
    // fire.
    expect(new Set(keys.map((k) => k.idempotencyKey)).size).toBe(3);
  });
});
