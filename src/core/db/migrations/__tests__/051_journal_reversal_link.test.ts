import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { migration051 } from '../051_journal_reversal_link';

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

describe('migration 051 — journal reversal link', () => {
  it('links a reversal only when the numbered journal lines are the swap', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    const insertJournal = db.prepare(
      `INSERT INTO journal (date, narration, isPosted) VALUES ('2025-01-01', ?, 1)`,
    );
    const insertLine = db.prepare(
      `INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount)
       VALUES (?, ?, ?, ?)`,
    );

    const originalId = Number(insertJournal.run('Sale').lastInsertRowid);
    insertLine.run(originalId, 1, 10, 0);
    insertLine.run(originalId, 2, 0, 10);

    const wrongId = Number(
      insertJournal.run(`Reversal of Journal #${originalId}: Noise`)
        .lastInsertRowid,
    );
    insertLine.run(wrongId, 1, 5, 0);
    insertLine.run(wrongId, 2, 0, 5);

    const rightId = Number(
      insertJournal.run(`Reversal of Journal #${originalId}: Kept`)
        .lastInsertRowid,
    );
    insertLine.run(rightId, 1, 0, 10);
    insertLine.run(rightId, 2, 10, 0);

    const originalUuid = (
      db.prepare(`SELECT uuid FROM journal WHERE id = ?`).get(originalId) as {
        uuid: string;
      }
    ).uuid;

    db.prepare(`DELETE FROM sync_outbox`).run();
    await migration051.up(driver);

    const right = db
      .prepare(
        `SELECT narration, reversesJournalUuid FROM journal WHERE id = ?`,
      )
      .get(rightId) as { narration: string; reversesJournalUuid: string };
    const wrong = db
      .prepare(
        `SELECT narration, reversesJournalUuid FROM journal WHERE id = ?`,
      )
      .get(wrongId) as {
      narration: string;
      reversesJournalUuid: string | null;
    };

    expect(right.narration).toBe('Kept');
    expect(right.reversesJournalUuid).toBe(originalUuid);
    expect(wrong.narration).toBe(`Reversal of Journal #${originalId}: Noise`);
    expect(wrong.reversesJournalUuid).toBeNull();

    const queued = db
      .prepare(
        `SELECT rowUuid, rowJson FROM sync_outbox WHERE tableName = 'journal'`,
      )
      .all() as { rowUuid: string; rowJson: string }[];
    expect(queued).toHaveLength(1);
    expect(queued[0].rowUuid).toBe(
      (
        db.prepare(`SELECT uuid FROM journal WHERE id = ?`).get(rightId) as {
          uuid: string;
        }
      ).uuid,
    );
    expect(JSON.parse(queued[0].rowJson).reversesJournalUuid).toBe(
      originalUuid,
    );

    const trigger = db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE name = 'trg_sync_capture_journal_insert'`,
      )
      .get() as { sql: string };
    expect(trigger.sql).toContain('reversesJournalUuid');

    db.close();
  });
});
