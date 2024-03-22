import { connect } from './Database.service';

export const getAccounts = (token?: string | null) => {
  const db = connect();

  const stm = db.prepare(
    'SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt FROM account a JOIN chart c ON c.id = a.chartId WHERE userId = (SELECT id FROM users WHERE username = @username)',
  );

  return stm.all({ username: token }) as Account[];
};
