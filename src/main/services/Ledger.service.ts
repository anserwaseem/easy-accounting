import { connect } from './Database.service';

export const getLedger = (accountId: number) => {
  const db = connect();

  const stm = db.prepare(
    ` SELECT id, date, accountId, particulars, debit, credit, balance, balanceType, createdAt, updatedAt
      FROM ledger
      WHERE accountId = @accountId
      ORDER BY createdAt DESC`,
  );

  return stm.all({ accountId }) as Ledger[];
};
