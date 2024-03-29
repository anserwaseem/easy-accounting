import { connect } from './Database.service';

export const getLedger = (accountId: number) => {
  const db = connect();

  const stm = db.prepare(
    ` SELECT l.id, l.accountId, l.amount, l.description, l.createdAt, l.updatedAt
      FROM ledger l
      WHERE l.accountId = @accountId
      ORDER BY l.createdAt DESC`,
  );

  return stm.all({ accountId }) as Ledger[];
};
