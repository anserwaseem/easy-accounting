import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export function isDevelopment() {
  return (
    process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'
  );
}

export function connect() {
  const userDataPath = app.getPath('userData');
  const databaseFileName = 'database.db';
  let databasePath;

  if (isDevelopment()) {
    // In development mode, work with the database in the release/app directory
    databasePath = path.join(
      __dirname,
      '../../../',
      'release/app',
      databaseFileName,
    );
  } else {
    // In production mode, use the user data directory
    databasePath = path.join(userDataPath, databaseFileName);

    // If the database doesn't exist in the user data directory,
    // copy it from the app's resources (this db will be a fresh db we make in prepackage-db.ts script)
    if (!fs.existsSync(databasePath)) {
      const sourceDbPath = path.join(process.resourcesPath, databaseFileName);
      fs.copyFileSync(sourceDbPath, databasePath);
    }
  }

  return new Database(databasePath, {
    verbose: console.log,
  });
}
