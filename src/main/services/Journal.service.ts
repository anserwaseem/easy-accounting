import { compact, get, omit, toNumber } from 'lodash';
import { connect } from './Database.service';
import { cast } from '../utils/sqlite';
import { store } from '../main';

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

    const stmJournalEntry = db.prepare(
      ` INSERT INTO journal_entry (journalId, debitAmount, accountId, creditAmount)
        VALUES (@journalId, @debitAmount, @accountId, @creditAmount)`,
    );

    const stmGetBalance = db.prepare(
      ` SELECT balance
        FROM ledger
        WHERE accountId = @accountId
        ORDER BY createdAt DESC
        LIMIT 1`,
    );

    const stmLedger = db.prepare(
      ` INSERT INTO ledger (date, accountId, debit, credit, balance, balanceType, particulars)
        VALUES (@date, @accountId, @debit, @credit, @balance, @balanceType, @particulars)`,
    );

    db.transaction((journal: Journal) => {
      const { date, narration, isPosted } = journal;
      const journalId = stmJournal.run({
        date,
        narration,
        isPosted: cast(isPosted),
      }).lastInsertRowid;

      for (const entry of journal.journalEntries) {
        const { debitAmount, accountId, creditAmount } = entry;
        stmJournalEntry.run({
          journalId,
          debitAmount,
          accountId,
          creditAmount,
        });

        const { balance } = stmGetBalance.get({ accountId }) as Pick<
          Ledger,
          'balance'
        >;

        const newBalance =
          balance + toNumber(debitAmount) - toNumber(creditAmount);
        const newBalanceType = newBalance >= 0 ? 'Dr' : 'Cr';

        stmLedger.run({
          date,
          accountId,
          debit: debitAmount,
          credit: creditAmount,
          balance: newBalance,
          balanceType: newBalanceType,
          particulars: `Journal #${journalId}`,
        });
      }
    })(journal);

    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};

export const getJournals = (): Journal[] => {
  const db = connect();

  const stm = db.prepare(
    ` SELECT j.id, j.date, j.narration, j.isPosted, j.createdAt, j.updatedAt, je.debitAmount
      FROM journal j
      JOIN journal_entry je
      ON j.id = je.journalId
      JOIN account a
      ON a.id = je.accountId
      JOIN chart c
      ON c.id = a.chartId
      WHERE userId = (
        SELECT id
        FROM users
        WHERE username = @username
      )`,
  );

  const res = stm.all({
    username: store.get('username'),
  }) as (Journal & { debitAmount: number })[];

  const journals = compact(
    res.reduce((acc, journal) => {
      if (!acc[journal.id]) {
        acc[journal.id] = {
          ...omit(journal, 'debitAmount'),
          journalEntries: [],
        };
      }

      acc[journal.id].journalEntries.push({
        debitAmount: journal.debitAmount,
      } as JournalEntry);

      return acc;
    }, [] as Journal[]),
  );

  return journals;
};
