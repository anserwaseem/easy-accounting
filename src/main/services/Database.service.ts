import Database from 'better-sqlite3';
import path from 'path';

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
 * Wraps a function in a transaction
 * @param callback
 * @returns a function that runs the given callback in a transaction
 * @example const runSecurely = asTransaction((...args) => { ... });
 * runSecurely(...args);
 */
export const asTransaction = (
  callback: (...args: any[]) => void,
): ((...args: any[]) => void) => {
  const db = connect();
  const begin = db.prepare('BEGIN TRANSACTION');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');

  return function (...args) {
    begin.run();
    try {
      callback(...args);
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
