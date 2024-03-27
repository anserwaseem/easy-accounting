import { store } from '../main';
import { connect } from './Database.service';

export const getAccounts = () => {
  const db = connect();

  const stm = db.prepare(
    'SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt FROM account a JOIN chart c ON c.id = a.chartId WHERE userId = (SELECT id FROM users WHERE username = @username)',
  );

  return stm.all({
    username: store.get('username'),
  }) as Account[];
};

export const insertAccount = (
  account: Pick<Account, 'headName' | 'name' | 'code'>,
): boolean => {
  const db = connect();

  const stm = db.prepare(
    `INSERT INTO account (name, chartId, code)
    VALUES (@name, (SELECT id FROM chart WHERE name = @headName), @code)`,
  );

  return Boolean(stm.run(account).lastInsertRowid);
};
