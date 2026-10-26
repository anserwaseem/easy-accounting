import type { DatabaseDriver } from '../driver';
import {
  allColumnInfo,
  createCaptureTriggers,
  foreignKeys,
  jsonObjectExpr,
} from './034_create_sync_tables';

/**
 * A reversal used to name the original journal by this device's integer id
 * inside `narration`. That id is different on every device, so the duplicate
 * check and the sentence both point at the wrong row after sync.
 *
 * `reversesJournalUuid` is the original journal's uuid. Existing reversals
 * are linked only when the numbered journal's lines are the exact swap of
 * the reversal's lines. A peer whose local id happens to be the same number
 * fails that check and does not publish a wrong link.
 */

const REVERSAL_NARRATION = /^Reversal of Journal #(\d+)(?:: (.*))?$/;

interface JournalLine {
  accountId: number;
  debitAmount: number;
  creditAmount: number;
}

const lineKey = (accountId: number, debit: number, credit: number): string =>
  `${accountId}|${Number(debit)}|${Number(credit)}`;

const sameSwappedLines = (
  reversal: JournalLine[],
  original: JournalLine[],
): boolean => {
  if (reversal.length === 0 || reversal.length !== original.length)
    return false;
  const got = reversal
    .map((line) => lineKey(line.accountId, line.debitAmount, line.creditAmount))
    .sort();
  const swapped = original
    .map((line) => lineKey(line.accountId, line.creditAmount, line.debitAmount))
    .sort();
  return got.every((key, index) => key === swapped[index]);
};

async function linesFor(
  driver: DatabaseDriver,
  journalId: number,
): Promise<JournalLine[]> {
  return driver.all<JournalLine>(
    `SELECT accountId, debitAmount, creditAmount
     FROM journal_entry WHERE journalId = @journalId`,
    { journalId },
  );
}

async function rebuildJournalCapture(driver: DatabaseDriver): Promise<void> {
  await driver.exec(`DROP TRIGGER IF EXISTS "trg_sync_capture_journal_insert"`);
  await driver.exec(`DROP TRIGGER IF EXISTS "trg_sync_capture_journal_update"`);
  await driver.exec(`DROP TRIGGER IF EXISTS "trg_sync_capture_journal_delete"`);
  await createCaptureTriggers(driver, 'journal');
}

export const migration051 = {
  name: '051_journal_reversal_link',
  async up(driver: DatabaseDriver): Promise<void> {
    const columns = await driver.all<{ name: string }>(
      `PRAGMA table_info("journal")`,
    );
    if (!columns.some((column) => column.name === 'reversesJournalUuid')) {
      await driver.exec(
        `ALTER TABLE "journal" ADD COLUMN "reversesJournalUuid" TEXT`,
      );
    }
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS "idx_journal_reverses_uuid"
       ON "journal" ("reversesJournalUuid")
       WHERE "reversesJournalUuid" IS NOT NULL`,
    );

    // hold the capture triggers off so the backfill update is not pushed
    // with the old column list
    await driver.run(
      `INSERT INTO sync_state (key, value) VALUES ('applying', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    try {
      const candidates = await driver.all<{
        id: number;
        narration: string;
      }>(
        `SELECT id, narration FROM journal
         WHERE narration LIKE 'Reversal of Journal #%'
           AND reversesJournalUuid IS NULL`,
      );
      for (const candidate of candidates) {
        const match = REVERSAL_NARRATION.exec(candidate.narration);
        if (!match) continue;
        const originalId = Number(match[1]);
        // eslint-disable-next-line no-await-in-loop
        const original = await driver.get<{ uuid: string; narration: string }>(
          `SELECT uuid, narration FROM journal WHERE id = @id`,
          { id: originalId },
        );
        if (!original?.uuid) continue;
        // eslint-disable-next-line no-await-in-loop
        const reversalLines = await linesFor(driver, candidate.id);
        // eslint-disable-next-line no-await-in-loop
        const originalLines = await linesFor(driver, originalId);
        if (!sameSwappedLines(reversalLines, originalLines)) continue;
        const suffix = match[2]?.trim();
        const narration = suffix || original.narration?.trim() || 'Reversal';
        // eslint-disable-next-line no-await-in-loop
        await driver.run(
          `UPDATE journal
           SET reversesJournalUuid = @uuid, narration = @narration
           WHERE id = @id`,
          { uuid: original.uuid, narration, id: candidate.id },
        );
      }
    } finally {
      await driver.run(`DELETE FROM sync_state WHERE key = 'applying'`);
    }

    await rebuildJournalCapture(driver);

    const info = await allColumnInfo(driver, 'journal');
    const fks = await foreignKeys(driver, 'journal');
    const rowJson = jsonObjectExpr(info, fks, (col) => `t."${col}"`);
    await driver.exec(`
      INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
      SELECT t."uuid" || ':reversal-link-051', 'journal', t."uuid", 'put', ${rowJson}, datetime('now')
      FROM "journal" t
      WHERE t."reversesJournalUuid" IS NOT NULL
        AND t."uuid" IS NOT NULL
    `);
  },
};
