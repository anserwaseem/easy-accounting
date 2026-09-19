import fs from 'fs';
import path from 'path';
import {
  DESKTOP_MIGRATION_NAMES,
  knownMigrationNames,
} from '../knownMigrations';
import { CORE_MIGRATIONS } from '../migrations';

const MIGRATIONS_DIR = path.join(__dirname, '../../../main/migrations');

describe('knownMigrationNames', () => {
  it('lists every src/main/migrations/*.js recorded name', () => {
    const fromFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+\.js$/.test(f))
      .sort()
      // eslint-disable-next-line global-require, import/no-dynamic-require
      .map((f) => require(path.join(MIGRATIONS_DIR, f)).name as string);

    expect([...DESKTOP_MIGRATION_NAMES].sort()).toEqual([...fromFiles].sort());
  });

  it('includes every CORE_MIGRATIONS name so a web export of this build imports', () => {
    const known = knownMigrationNames();
    const missing = CORE_MIGRATIONS.map((m) => m.name).filter(
      (name) => !known.has(name),
    );
    expect(missing).toEqual([]);
  });
});
