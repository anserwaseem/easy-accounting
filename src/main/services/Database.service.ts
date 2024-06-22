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
    // eslint-disable-next-line no-console
    verbose: console.log,
    fileMustExist: true,
  });
}
