import { get } from 'lodash';
import { connect } from './Database.service';
import { asTransaction } from './Database.service';
import { cast } from '../utils/sqlite';

export const getNextJournalId = () => {
  const db = connect();
  const stm = db.prepare(`SELECT MAX(id) as id FROM journal`);
  const res = stm.get();

  return get(res, 'id', 0) + 1;
};

export const insertJournal = (journal: Journal) => {
  try {
    const db = connect();

    const stmJournal = db.prepare(
      ` INSERT INTO journal (date, narration, isPosted)
      VALUES (@date, @narration, @isPosted)`,
    );

    const stm = asTransaction((journal: Journal) => {
      const { date, narration, isPosted } = journal;

      const journalId = stmJournal.run({
        date,
        narration,
        isPosted: cast(isPosted),
      }).lastInsertRowid;

      for (const entry of journal.journalEntries) {
        const { debitAmount, accountId, creditAmount } = entry;

        const stmJournalEntry = db.prepare(
          ` INSERT INTO journalEntry (journalId, debitAmount, accountId, creditAmount)
          VALUES (@journalId, @debitAmount, @accountId, @creditAmount)`,
        );

        const jer = stmJournalEntry.run({
          journalId,
          debitAmount,
          accountId,
          creditAmount,
        });
      }
    });

    stm(journal);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};
