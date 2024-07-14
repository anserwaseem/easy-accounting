import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const rootDir = path.join(__dirname, '../..');
const releaseDir = path.join(rootDir, 'release/app');
const schemaPath = path.join(rootDir, 'src/sql/schema.sql');
const targetDbPath = path.join(releaseDir, 'database.db');

// Rename existing database.db if it exists
if (fs.existsSync(targetDbPath)) {
  const backupDbPath = path.join(releaseDir, 'database_backup.db');
  fs.renameSync(targetDbPath, backupDbPath);
}

// Construct the absolute path to better-sqlite3
const betterSqlite3Path = path.join(
  releaseDir,
  'node_modules',
  'better-sqlite3',
);

if (!fs.existsSync(betterSqlite3Path)) {
  console.error(
    'better-sqlite3 module not found in release/app. Please ensure it is installed.',
  );
  process.exit(1);
}

execSync('npm rebuild better-sqlite3 --update-binary', {
  cwd: betterSqlite3Path,
  stdio: 'inherit',
});

// Dynamically require better-sqlite3 using its absolute path
const Database = require(betterSqlite3Path);

// Initialize the new database schema
const db = new Database(targetDbPath, {
  verbose: console.log,
});
const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schemaSql);
console.log('New database schema initialized.');

// Close the database connection
db.close();
