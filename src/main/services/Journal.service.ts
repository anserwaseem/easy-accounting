import { compact, get, head, isEqual, omit, toNumber, toString } from 'lodash';
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
      const { date, narration, isPosted, journalEntries } = journal;
      const journalId = stmJournal.run({
        date,
        narration,
        isPosted: cast(isPosted),
      }).lastInsertRowid;

      // Find the dividend entry (the entry whose amount is to be divided)
      const creditEntries = journalEntries.filter(
        (entry) => entry.creditAmount > 0,
      );
      const debitEntries = journalEntries.filter(
        (entry) => entry.debitAmount > 0,
      );
      const dividendEntry =
        creditEntries.length > debitEntries.length
          ? head(debitEntries)
          : head(creditEntries);

      for (const entry of journalEntries) {
        const { debitAmount, accountId, creditAmount } = entry;
        stmJournalEntry.run({
          journalId,
          debitAmount,
          accountId,
          creditAmount,
        });

        // continue if the current entry is the dividend entry
        if (isEqual(entry, dividendEntry)) {
          continue;
        }

        updateLedger(accountId, debitAmount, creditAmount);
        updateLedger(dividendEntry!.accountId, creditAmount, debitAmount);
      }

      function updateLedger(
        $accountId: number,
        $debitAmount: number,
        $creditAmount: number,
      ) {
        const { balance } = (stmGetBalance.get({
          accountId: $accountId,
        }) ?? { balance: 0 }) as Pick<Ledger, 'balance'>;

        const newBalance =
          balance + toNumber($debitAmount) - toNumber($creditAmount);
        const newBalanceType = newBalance >= 0 ? 'Dr' : 'Cr';

        stmLedger.run({
          date,
          accountId: $accountId,
          debit: $debitAmount,
          credit: $creditAmount,
          balance: Math.abs(newBalance),
          balanceType: newBalanceType,
          particulars: `Journal #${journalId}`,
        });
      }
    })(journal);

    return true;
  } catch (error) {
    console.error(error);
    throw error;
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

export const getJorunal = (journalId: number): Journal => {
  const db = connect();

  const stm = db.prepare(
    ` SELECT j.id, j.date, j.narration, j.isPosted, j.createdAt, j.updatedAt, je.debitAmount, je.creditAmount, je.accountId, a.name as accountName
      FROM journal j
      JOIN journal_entry je
      ON j.id = je.journalId
      JOIN account a
      ON a.id = je.accountId
      JOIN chart c
      ON c.id = a.chartId
      WHERE j.id = @journalId
      AND userId = (
        SELECT id
        FROM users
        WHERE username = @username
      )`,
  );

  const res = stm.all({
    journalId,
    username: store.get('username'),
  }) as (Journal & {
    debitAmount: number;
    creditAmount: number;
    accountName: string;
    accountId: number;
  })[];

  const journal = res.reduce((acc, entry) => {
    if (!acc.id) {
      acc = omit(
        entry,
        'debitAmount',
        'creditAmount',
        'accountName',
        'accountId',
      );
      acc.journalEntries = [];
    }

    acc.journalEntries.push({
      debitAmount: entry.debitAmount,
      creditAmount: entry.creditAmount,
      accountName: entry.accountName,
      accountId: entry.accountId,
    } as JournalEntry & { accountName: string });

    return acc;
  }, {} as Journal);

  return journal;
};
