import type { Account, InsertAccount, UpdateAccount } from 'types';
import { store } from '../store';
import { connect } from './Database.service';
import { cast } from '../utils/sqlite';

export const getAccounts = (): Account[] => {
  const db = connect();

  const stm = db.prepare(
    ` SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt
      FROM account a
      JOIN chart c
      ON c.id = a.chartId
      WHERE userId = (
        SELECT id
        FROM users
        WHERE username = @username
      )`,
  );

  return stm.all({
    username: store.get('username'),
  }) as Account[];
};

export const insertAccount = (account: InsertAccount): boolean => {
  const db = connect();

  const username = store.get('username');

  const stm = db.prepare(
    ` INSERT INTO account (name, chartId, code)
      VALUES (@name, (
        SELECT id
        FROM chart
        WHERE name = @headName AND userId = (
          SELECT id
          FROM users
          WHERE username = '${username}'
        )
      ), @code)`,
  );

  return Number.isSafeInteger(stm.run(account).lastInsertRowid);
};

export const updateAccount = (account: UpdateAccount): boolean => {
  const db = connect();

  const stm = db.prepare(
    ` UPDATE account
      SET name = @name, code = @code, chartId = (
        SELECT id
        FROM chart
        WHERE name = @headName
      )
      WHERE id = @id`,
  );

  return Boolean(stm.run({ ...account, id: cast(account.id) }).changes);
};
