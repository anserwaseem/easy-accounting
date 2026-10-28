import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { migration053 } from '../053_heal_journal_timestamps';

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

describe('migration 053 — heal journal timestamps', () => {
  it('heals null createdAt/updatedAt on journal and account, re-emits to outbox, and fixes capture trigger', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    // Insert an invoice with timestamps
    db.prepare(
      `
      INSERT INTO invoices (id, invoiceNumber, accountId, invoiceType, date, totalAmount, createdAt, updatedAt)
      VALUES (999, 100, 1, 'Sale', '2026-10-27', 500, '2026-10-27 12:00:00', '2026-10-27 12:00:00')
    `,
    ).run();

    // Insert test rows
    db.prepare(
      `
      INSERT INTO journal (id, date, narration, isPosted, invoiceId, uuid)
      VALUES (888, '2026-10-27', 'Linked Journal', 1, 999, 'j-uuid-888')
    `,
    ).run();
    db.prepare(
      `
      INSERT INTO journal (id, date, narration, isPosted, invoiceId, uuid)
      VALUES (889, '2026-10-28', 'Standalone Journal', 1, NULL, 'j-uuid-889')
    `,
    ).run();
    db.prepare(
      `
      INSERT INTO account (id, chartId, name, code, date, uuid)
      VALUES (777, 1, 'Test Null Account', 'TNA', '2026-10-20', 'a-uuid-777')
    `,
    ).run();

    // Set applying to suppress update triggers while simulating pre-existing corrupt rows
    db.prepare(
      `INSERT INTO sync_state (key, value) VALUES ('applying', '1')`,
    ).run();
    db.prepare(
      `UPDATE journal SET createdAt = NULL, updatedAt = NULL WHERE id = 888`,
    ).run();
    db.prepare(
      `UPDATE journal SET createdAt = NULL, updatedAt = NULL WHERE id = 889`,
    ).run();
    db.prepare(
      `UPDATE account SET createdAt = NULL, updatedAt = NULL WHERE id = 777`,
    ).run();
    db.prepare(`DELETE FROM sync_state WHERE key = 'applying'`).run();

    // Clear outbox before running migration
    db.prepare(`DELETE FROM sync_outbox`).run();

    await migration053.up(driver);

    // Verify linked journal took invoice timestamps
    const linkedJournal = db
      .prepare(`SELECT createdAt, updatedAt FROM journal WHERE id = 888`)
      .get() as { createdAt: string; updatedAt: string };
    expect(linkedJournal.createdAt).toBe('2026-10-27 12:00:00');
    expect(linkedJournal.updatedAt).toBe('2026-10-27 12:00:00');

    // Verify standalone journal took date timestamp
    const standaloneJournal = db
      .prepare(`SELECT createdAt, updatedAt FROM journal WHERE id = 889`)
      .get() as { createdAt: string; updatedAt: string };
    expect(standaloneJournal.createdAt).toBe('2026-10-28 00:00:00');
    expect(standaloneJournal.updatedAt).toBe('2026-10-28 00:00:00');

    // Verify account timestamps healed
    const accountRow = db
      .prepare(`SELECT createdAt, updatedAt FROM account WHERE id = 777`)
      .get() as { createdAt: string; updatedAt: string };
    expect(accountRow.createdAt).toBe('2026-10-20 00:00:00');
    expect(accountRow.updatedAt).toBe('2026-10-20 00:00:00');

    // Verify outbox entries were re-emitted with non-null timestamps
    const outboxJournals = db
      .prepare(
        `SELECT rowUuid, rowJson FROM sync_outbox WHERE tableName = 'journal'`,
      )
      .all() as { rowUuid: string; rowJson: string }[];
    expect(outboxJournals.length).toBeGreaterThanOrEqual(2);
    for (const entry of outboxJournals) {
      const parsed = JSON.parse(entry.rowJson);
      expect(parsed.createdAt).not.toBeNull();
      expect(parsed.updatedAt).not.toBeNull();
    }

    // Verify newly inserted journal captures non-null timestamps directly
    db.prepare(`DELETE FROM sync_outbox`).run();
    const newJournalResult = db
      .prepare(
        `INSERT INTO journal (date, narration, isPosted) VALUES ('2026-10-28', 'Fresh Journal', 1)`,
      )
      .run();
    const newJournalId = Number(newJournalResult.lastInsertRowid);

    const freshJournalRow = db
      .prepare(`SELECT createdAt, updatedAt FROM journal WHERE id = ?`)
      .get(newJournalId) as { createdAt: string; updatedAt: string };
    expect(freshJournalRow.createdAt).toBeTruthy();
    expect(freshJournalRow.updatedAt).toBeTruthy();

    const freshOutbox = db
      .prepare(
        `SELECT rowJson FROM sync_outbox WHERE tableName = 'journal' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { rowJson: string };
    const freshOutboxJson = JSON.parse(freshOutbox.rowJson);
    expect(freshOutboxJson.createdAt).toBeTruthy();
    expect(freshOutboxJson.updatedAt).toBeTruthy();

    db.close();
  });
});
