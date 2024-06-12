import { connect } from './Database.service';
import type { Ledger } from 'types';

export const getLedger = (accountId: number) => {
  const db = connect();

  const stm = db.prepare(
    ` SELECT l.id, l.date, l.accountId, l.particulars, l.debit, l.credit, l.balance, l.balanceType, l.linkedAccountId, a.name AS linkedAccountName, l.createdAt, l.updatedAt
      FROM ledger l
      LEFT JOIN account a
      ON l.linkedAccountId = a.id
      WHERE l.accountId = @accountId
      ORDER BY l.createdAt DESC`,
  );

  return stm.all({ accountId }) as Ledger[];
};
