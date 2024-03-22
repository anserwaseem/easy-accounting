import { connect } from './Database.service';

export const getAccounts = (token?: string | null) => {
  const db = connect();

  const stm = db.prepare(
    'SELECT * FROM account where chartId IN (SELECT id FROM chart WHERE userId = (SELECT id FROM users WHERE username = @username))',
  );

  return stm.all({ username: token }) as Account[];
};
