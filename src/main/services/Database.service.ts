import Database from 'better-sqlite3';
import path from 'path';

export type TODO = {
  id?: number;
  title: string;
  date: string;
  status: number;
};

const isDevelopment =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

export function connect() {
  const databasePath = isDevelopment
    ? path.join(__dirname, '../../../', 'release/app', 'database.db')
    : path
        .join(__dirname, '../../database.db')
        .replace('app.asar', 'app.asar.unpacked');

  return Database(path.resolve(databasePath), {
    verbose: console.log,
    fileMustExist: true,
  });
}

/**
 * Wrap a function in a transaction
 * @param func
 * @returns a function that runs the given function in a transaction
 * @example const runSecurely = asTransaction((...args) => { ... });
 * runSecurely(...args);
 */
export const asTransaction = (
  func: (...args: any[]) => void,
): ((...args: any[]) => void) => {
  const db = connect();
  const begin = db.prepare('BEGIN TRANSACTION');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');

  return function (...args) {
    begin.run();
    try {
      func(...args);
      commit.run();
    } catch (error) {
      console.error(error);
      rollback.run();
    } finally {
      if (db.inTransaction) {
        rollback.run();
      }
    }
  };
};

export function insertTODO(todo: TODO) {
  const db = connect();

  const stm = db.prepare(
    'INSERT INTO todos (title, date, status) VALUES (@title, @date, @status)',
  );

  stm.run(todo);
}

export function updateTODO(todo: TODO) {
  const db = connect();
  const { title, status, id } = todo;

  const stm = db.prepare(
    'UPDATE todos SET title = @title, status = @status WHERE id = @id',
  );

  stm.run({ title, status, id });
}

export function deleteTODO(id: number) {
  const db = connect();

  const stm = db.prepare('DELETE FROM todos WHERE id = @id');

  stm.run({ id });
}

export function getAllTODO() {
  const db = connect();

  const stm = db.prepare('SELECT * FROM todos');

  return stm.all() as TODO[];
}

export function getOneTODO(id: number) {
  const db = connect();

  const stm = db.prepare('SELECT * FROM todos where id = @id');

  return stm.get({ id }) as TODO;
}
