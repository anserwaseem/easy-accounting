import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../db/bootstrap';
import { LedgerService } from '../LedgerService';
import { JournalService } from '../JournalService';
import { CommissionService } from '../CommissionService';

jest.mock('electron-log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  verbose: jest.fn(),
  debug: jest.fn(),
  silly: jest.fn(),
  transports: {
    file: { level: 'debug', getFile: jest.fn() },
    console: { level: 'debug' },
  },
}));

const session = { getUsername: () => 'test-user' };

function createCore(db: Database.Database) {
  const driver = new BetterSqliteDriver(db);
  const ledger = new LedgerService({ db: driver, session });
  const journal = new JournalService({
    db: driver,
    session,
    ledgerService: ledger,
  });
  const commission = new CommissionService({
    db: driver,
    journalService: journal,
  });
  return { driver, journal, commission };
}

describe('CommissionService', () => {
  it('saves and reads back agent commission config', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);
    const { commission } = createCore(db);

    const chart = db
      .prepare(
        `INSERT INTO chart (name, type, parentId) VALUES ('Shahbaz Parties', 'Asset', 2)`,
      )
      .run();
    const chartId = Number(chart.lastInsertRowid);

    // Initial read returns empty defaults
    const initial = await commission.getCommissionConfig(chartId);
    expect(initial.chartId).toBe(chartId);
    expect(initial.rates).toEqual([]);
    expect(initial.overrides).toEqual([]);

    // Save rates & overrides
    await commission.saveCommissionConfig({
      chartId,
      payableAccountId: 101,
      expenseAccountId: 201,
      rates: [
        { itemTypeId: 1, percent: 5.0, netRatePercent: 2.5 },
        { itemTypeId: 2, percent: 4.0, netRatePercent: 2.0 },
      ],
      overrides: [{ inventoryId: 301, rupeesPerUnit: 15.0 }],
    });

    const saved = await commission.getCommissionConfig(chartId);
    expect(saved.payableAccountId).toBe(101);
    expect(saved.expenseAccountId).toBe(201);
    expect(saved.rates).toHaveLength(2);
    expect(saved.rates[0]).toEqual({
      itemTypeId: 1,
      percent: 5.0,
      netRatePercent: 2.5,
    });
    expect(saved.overrides).toEqual([
      { inventoryId: 301, rupeesPerUnit: 15.0 },
    ]);

    db.close();
  });

  it('calculates commissions accurately for normal %, net-rate %, and SKU rupee overrides with correct exclusions', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);
    const { commission } = createCore(db);

    // 1. Setup Chart heads (2 agents)
    const agent1 = db
      .prepare(
        `INSERT INTO chart (name, type, parentId) VALUES ('Shahbaz Parties', 'Asset', 2)`,
      )
      .run();
    const agent1Id = Number(agent1.lastInsertRowid);

    const agent2 = db
      .prepare(
        `INSERT INTO chart (name, type, parentId) VALUES ('Ijaz Parties', 'Asset', 2)`,
      )
      .run();
    const agent2Id = Number(agent2.lastInsertRowid);

    // 2. Setup Accounts
    const custShahbaz = db
      .prepare(
        `INSERT INTO account (chartId, name, code) VALUES (?, 'Customer A', 101)`,
      )
      .run(agent1Id);
    const custShahbazId = Number(custShahbaz.lastInsertRowid);

    const custIjaz = db
      .prepare(
        `INSERT INTO account (chartId, name, code) VALUES (?, 'Customer B', 102)`,
      )
      .run(agent2Id);
    const custIjazId = Number(custIjaz.lastInsertRowid);

    // 3. Setup Item Types
    const typeF = db
      .prepare(`INSERT INTO item_types (name) VALUES ('F')`)
      .run();
    const typeFId = Number(typeF.lastInsertRowid);

    const typeT = db
      .prepare(`INSERT INTO item_types (name) VALUES ('T')`)
      .run();
    const typeTId = Number(typeT.lastInsertRowid);

    const typeUnset = db
      .prepare(`INSERT INTO item_types (name) VALUES ('Unconfigured')`)
      .run();
    const typeUnsetId = Number(typeUnset.lastInsertRowid);

    // 4. Setup Inventory Items
    const itemF = db
      .prepare(
        `INSERT INTO inventory (name, price, itemTypeId) VALUES ('Book F', 100, ?)`,
      )
      .run(typeFId);
    const itemFId = Number(itemF.lastInsertRowid);

    const itemT1 = db
      .prepare(
        `INSERT INTO inventory (name, price, itemTypeId) VALUES ('Book T1', 200, ?)`,
      )
      .run(typeTId);
    const itemT1Id = Number(itemT1.lastInsertRowid);

    const itemTOverride = db
      .prepare(
        `INSERT INTO inventory (name, price, itemTypeId) VALUES ('Book T Override', 500, ?)`,
      )
      .run(typeTId);
    const itemTOverrideId = Number(itemTOverride.lastInsertRowid);

    const itemUnset = db
      .prepare(
        `INSERT INTO inventory (name, price, itemTypeId) VALUES ('Book Unset', 50, ?)`,
      )
      .run(typeUnsetId);
    const itemUnsetId = Number(itemUnset.lastInsertRowid);

    // 5. Configure Agent 1 Commission Rates:
    // Type F: 5% normal, 2% net
    // Type T: 10% normal, 4% net
    // SKU Override for Book T Override: Rs. 25.00/unit
    await commission.saveCommissionConfig({
      chartId: agent1Id,
      rates: [
        { itemTypeId: typeFId, percent: 5.0, netRatePercent: 2.0 },
        { itemTypeId: typeTId, percent: 10.0, netRatePercent: 4.0 },
      ],
      overrides: [{ inventoryId: itemTOverrideId, rupeesPerUnit: 25.0 }],
    });

    // 6. Seed Invoices for Agent 1 (Shahbaz):
    // Invoice 1: Normal sales on 2026-09-10
    const inv1 = db
      .prepare(
        `INSERT INTO invoices (invoiceNumber, invoiceType, date, totalAmount, accountId)
         VALUES (1, 'Sale', '2026-09-10', 1000, ?)`,
      )
      .run(custShahbazId);
    const inv1Id = Number(inv1.lastInsertRowid);

    // Line 1a: Book F, qty 10, price 100, discount 10% -> charged = 10 * 100 * 0.9 = 900.
    // Rate: 5% normal -> commission = 900 * 0.05 = 45.
    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, netPrice)
       VALUES (?, ?, 10, 100, 10, NULL)`,
    ).run(inv1Id, itemFId);

    // Line 1b: Book Unset, qty 2, price 50, discount 0% -> charged = 100.
    // Rate: missing -> commission = 0.
    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, netPrice)
       VALUES (?, ?, 2, 50, 0, NULL)`,
    ).run(inv1Id, itemUnsetId);

    // Invoice 2: Net-rate sales on 2026-09-15
    const inv2 = db
      .prepare(
        `INSERT INTO invoices (invoiceNumber, invoiceType, date, totalAmount, accountId)
         VALUES (2, 'Sale', '2026-09-15', 3000, ?)`,
      )
      .run(custShahbazId);
    const inv2Id = Number(inv2.lastInsertRowid);

    // Line 2a: Book T1 (no override), qty 5, netPrice 150 -> charged = 5 * 150 = 750.
    // Rate: netRatePercent = 4% -> commission = 750 * 0.04 = 30.
    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, netPrice)
       VALUES (?, ?, 5, 200, 0, 150)`,
    ).run(inv2Id, itemT1Id);

    // Line 2b: Book T Override (has Rs. 25/unit override), qty 4, netPrice 400 -> charged = 4 * 400 = 1600.
    // Rate: Rs. 25/unit -> commission = 4 * 25 = 100.
    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, netPrice)
       VALUES (?, ?, 4, 500, 0, 400)`,
    ).run(inv2Id, itemTOverrideId);

    // 7. Seed Invoices that MUST be EXCLUDED:
    // Excluded: Quotation
    const invQuotation = db
      .prepare(
        `INSERT INTO invoices (invoiceNumber, invoiceType, date, totalAmount, accountId, isQuotation)
         VALUES (3, 'Sale', '2026-09-12', 500, ?, 1)`,
      )
      .run(custShahbazId);
    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount)
       VALUES (?, ?, 5, 100, 0)`,
    ).run(Number(invQuotation.lastInsertRowid), itemFId);

    // Excluded: Returned sale
    const invReturned = db
      .prepare(
        `INSERT INTO invoices (invoiceNumber, invoiceType, date, totalAmount, accountId, isReturned)
         VALUES (4, 'Sale', '2026-09-12', 500, ?, 1)`,
      )
      .run(custShahbazId);
    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount)
       VALUES (?, ?, 5, 100, 0)`,
    ).run(Number(invReturned.lastInsertRowid), itemFId);

    // Excluded: Purchase invoice
    const invPurchase = db
      .prepare(
        `INSERT INTO invoices (invoiceNumber, invoiceType, date, totalAmount, accountId)
         VALUES (101, 'Purchase', '2026-09-12', 500, ?)`,
      )
      .run(custShahbazId);
    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount)
       VALUES (?, ?, 5, 100, 0)`,
    ).run(Number(invPurchase.lastInsertRowid), itemFId);

    // Excluded: Other agent (Ijaz)
    const invIjaz = db
      .prepare(
        `INSERT INTO invoices (invoiceNumber, invoiceType, date, totalAmount, accountId)
         VALUES (5, 'Sale', '2026-09-12', 1000, ?)`,
      )
      .run(custIjazId);
    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount)
       VALUES (?, ?, 10, 100, 0)`,
    ).run(Number(invIjaz.lastInsertRowid), itemFId);

    // Excluded: Outside date range (August)
    const invPast = db
      .prepare(
        `INSERT INTO invoices (invoiceNumber, invoiceType, date, totalAmount, accountId)
         VALUES (6, 'Sale', '2026-08-25', 1000, ?)`,
      )
      .run(custShahbazId);
    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount)
       VALUES (?, ?, 10, 100, 0)`,
    ).run(Number(invPast.lastInsertRowid), itemFId);

    // 8. Generate Report
    const report = await commission.getCommissionReport(
      agent1Id,
      '2026-09-01',
      '2026-09-30',
    );

    expect(report.agentId).toBe(agent1Id);
    expect(report.agentName).toBe('Shahbaz Parties');
    expect(report.totalQty).toBe(10 + 2 + 5 + 4); // 21 units
    expect(report.totalCharged).toBe(900 + 100 + 750 + 1600); // 3350
    // Total commission: 45 (Book F) + 0 (Book Unset) + 30 (Book T1) + 100 (Book T Override) = 175
    expect(report.grossCommission).toBe(175);

    expect(report.missingRateItemTypes).toContain('Unconfigured');

    // Buckets verification
    expect(report.buckets).toHaveLength(4);
    const normalFBucket = report.buckets.find(
      (b) => b.ruleType === 'normal_pct',
    );
    expect(normalFBucket?.totalCommission).toBe(45);

    const netTBucket = report.buckets.find((b) => b.ruleType === 'net_pct');
    expect(netTBucket?.totalCommission).toBe(30);

    const overrideBucket = report.buckets.find(
      (b) => b.ruleType === 'sku_override',
    );
    expect(overrideBucket?.totalCommission).toBe(100);

    const missingBucket = report.buckets.find((b) => b.ruleType === 'missing');
    expect(missingBucket?.totalCommission).toBe(0);

    db.close();
  });

  it('posts settlement journal, saves frozen snapshot, and unposts cleanly', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);
    const { commission } = createCore(db);

    const agent = db
      .prepare(
        `INSERT INTO chart (name, type, parentId) VALUES ('Shahbaz Parties', 'Asset', 2)`,
      )
      .run();
    const agentId = Number(agent.lastInsertRowid);

    const liabilityChart = db
      .prepare(
        `INSERT INTO chart (name, type, parentId) VALUES ('Current Liability', 'Liability', NULL)`,
      )
      .run();
    const liabilityChartId = Number(liabilityChart.lastInsertRowid);

    const expenseChart = db
      .prepare(
        `INSERT INTO chart (name, type, parentId) VALUES ('Operating Expense', 'Expense', NULL)`,
      )
      .run();
    const expenseChartId = Number(expenseChart.lastInsertRowid);

    const payableAcc = db
      .prepare(
        `INSERT INTO account (chartId, name, code) VALUES (?, 'Comm. Payable:Shahbaz', 889)`,
      )
      .run(liabilityChartId);
    const payableAccId = Number(payableAcc.lastInsertRowid);

    const expenseAcc = db
      .prepare(
        `INSERT INTO account (chartId, name, code) VALUES (?, 'Commission Expense', 900)`,
      )
      .run(expenseChartId);
    const expenseAccId = Number(expenseAcc.lastInsertRowid);

    const cust = db
      .prepare(
        `INSERT INTO account (chartId, name, code) VALUES (?, 'Customer A', 101)`,
      )
      .run(agentId);
    const custId = Number(cust.lastInsertRowid);

    const typeF = db
      .prepare(`INSERT INTO item_types (name) VALUES ('F')`)
      .run();
    const typeFId = Number(typeF.lastInsertRowid);

    const itemF = db
      .prepare(
        `INSERT INTO inventory (name, price, itemTypeId) VALUES ('Book F', 100, ?)`,
      )
      .run(typeFId);
    const itemFId = Number(itemF.lastInsertRowid);

    await commission.saveCommissionConfig({
      chartId: agentId,
      payableAccountId: payableAccId,
      expenseAccountId: expenseAccId,
      rates: [{ itemTypeId: typeFId, percent: 10.0, netRatePercent: 5.0 }],
      overrides: [],
    });

    const inv = db
      .prepare(
        `INSERT INTO invoices (invoiceNumber, invoiceType, date, totalAmount, accountId)
         VALUES (1, 'Sale', '2026-09-10', 1000, ?)`,
      )
      .run(custId);
    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount)
       VALUES (?, ?, 10, 100, 0)`,
    ).run(Number(inv.lastInsertRowid), itemFId);

    // Post settlement with adjustments
    const settlement = await commission.postCommissionSettlement({
      chartId: agentId,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      postingDate: '2026-09-30',
      payableAccountId: payableAccId,
      expenseAccountId: expenseAccId,
      adjustments: [
        { id: '1', description: 'Consignment Return', amount: -20 },
        { id: '2', description: 'Traveling Allowance', amount: 15 },
      ],
    });

    // Gross: 100 (1000 * 10%). Adjustments: -20 + 15 = -5. Net: 95.
    expect(settlement.grossCommission).toBe(100);
    expect(settlement.netCommission).toBe(95);
    expect(settlement.journalId).toBeDefined();

    // Verify journal was posted
    const journalRow = db
      .prepare(`SELECT * FROM journal WHERE id = ?`)
      .get(settlement.journalId) as { narration: string; isPosted: number };
    expect(journalRow).toBeDefined();
    expect(journalRow.isPosted).toBe(1);
    expect(journalRow.narration).toContain('Consignment Return: Rs. -20');
    expect(journalRow.narration).toContain('Net Payable: Rs. 95');

    // Verify journal entries
    const entries = db
      .prepare(`SELECT * FROM journal_entry WHERE journalId = ?`)
      .all(settlement.journalId) as {
      accountId: number;
      debitAmount: number;
      creditAmount: number;
    }[];
    expect(entries).toHaveLength(2);
    const expenseEntry = entries.find((e) => e.accountId === expenseAccId);
    const payableEntry = entries.find((e) => e.accountId === payableAccId);
    expect(expenseEntry?.debitAmount).toBe(95);
    expect(payableEntry?.creditAmount).toBe(95);

    // Verify report reflects the settlement
    const reportWithSettlement = await commission.getCommissionReport(
      agentId,
      '2026-09-01',
      '2026-09-30',
    );
    expect(reportWithSettlement.settlement).toBeDefined();
    expect(reportWithSettlement.settlement?.id).toBe(settlement.id);
    expect(reportWithSettlement.settlement?.adjustments).toHaveLength(2);

    // Unpost settlement
    const unposted = await commission.unpostCommissionSettlement(settlement.id);
    expect(unposted).toBe(true);

    // Verify journal was removed
    const journalAfterUnpost = db
      .prepare(`SELECT * FROM journal WHERE id = ?`)
      .get(settlement.journalId);
    expect(journalAfterUnpost).toBeUndefined();

    // Verify report no longer shows settlement
    const reportAfterUnpost = await commission.getCommissionReport(
      agentId,
      '2026-09-01',
      '2026-09-30',
    );
    expect(reportAfterUnpost.settlement).toBeNull();

    db.close();
  });

  it('handles legacy or varied property names (normalCommissionPct, netRateCommissionPct) without toFixed error', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);
    const { commission } = createCore(db);

    const agentChart = db
      .prepare(
        `INSERT INTO chart (name, type, parentId) VALUES ('Test Agent', 'Asset', 2)`,
      )
      .run();
    const agentId = Number(agentChart.lastInsertRowid);

    // Insert ratesJson with normalCommissionPct / netRateCommissionPct directly into DB
    db.prepare(
      `INSERT INTO agent_commissions (chartId, ratesJson, overridesJson)
       VALUES (?, ?, ?)`,
    ).run(
      agentId,
      JSON.stringify([
        { itemTypeId: 10, normalCommissionPct: 6.5, netRateCommissionPct: 3.2 },
      ]),
      JSON.stringify([]),
    );

    const config = await commission.getCommissionConfig(agentId);
    expect(config.rates).toHaveLength(1);
    expect(config.rates[0].percent).toBe(6.5);
    expect(config.rates[0].netRatePercent).toBe(3.2);

    // Create item type and invoice to verify getCommissionReport doesn't throw toFixed error
    db.prepare(
      `INSERT INTO item_types (id, name) VALUES (10, 'TestType')`,
    ).run();
    const customer = db
      .prepare(
        `INSERT INTO account (chartId, name, code) VALUES (?, 'Cust A', 999)`,
      )
      .run(agentId);
    const item = db
      .prepare(
        `INSERT INTO inventory (name, price, itemTypeId) VALUES ('TestBook', 100, 10)`,
      )
      .run();

    const inv = db
      .prepare(
        `INSERT INTO invoices (invoiceNumber, invoiceType, date, totalAmount, accountId)
         VALUES (501, 'Sale', '2026-09-15', 500, ?)`,
      )
      .run(customer.lastInsertRowid);

    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, netPrice)
       VALUES (?, ?, 5, 100, 0, NULL)`,
    ).run(inv.lastInsertRowid, item.lastInsertRowid);

    // Call getCommissionReport - must succeed cleanly with calculated buckets
    const report = await commission.getCommissionReport(
      agentId,
      '2026-09-01',
      '2026-09-30',
    );
    expect(report.grossCommission).toBe(32.5); // 5 * 100 * 6.5% = 32.5
    expect(report.buckets).toHaveLength(1);
    expect(report.buckets[0].title).toBe('TestType (Sale 6.50%)');

    db.close();
  });
});
