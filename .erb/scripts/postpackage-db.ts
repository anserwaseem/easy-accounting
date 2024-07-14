import fs from 'fs';
import path from 'path';

const rootDir = path.join(__dirname, '../..');
const releaseDir = path.join(rootDir, 'release/app');
const targetDbPath = path.join(releaseDir, 'database.db');
const backupDbPath = path.join(releaseDir, 'database_backup.db');

// Delete the new database.db if it exists
if (fs.existsSync(targetDbPath)) {
  fs.unlinkSync(targetDbPath);
}

// Rename the old database back if it exists
if (fs.existsSync(backupDbPath)) {
  fs.renameSync(backupDbPath, targetDbPath);
}
