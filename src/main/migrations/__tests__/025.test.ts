/**
 * Migration 025 — stored customer grouping.
 *
 * A customer is split into one account per item-type tier (base code plus
 * typed variants like RWP-KITAB / RWP-KITAB-T). 025 promotes that naming
 * convention into a stored fact: a `customer_groups` table plus
 * `account.customerGroupId`, conservatively auto-seeded from account CODES
 * only. Shop names repeat across cities in real data, so the seeding must
 * never merge on name — that ambiguity is exactly what the table removes.
 *
 * This file covers the seeding transform; the general runner behaviour
 * (fresh install, upgrade path, idempotent re-run of the whole chain) lives
 * in migrations.test.ts.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

jest.mock('electron', () => ({
  app: { isPackaged: false, getPath: jest.fn(() => '/tmp') },
}));

jest.mock('electron-log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  verbose: jest.fn(),
  debug: jest.fn(),
  silly: jest.fn(),
  transports: {
    file: { level: 'debug', getFile: jest.fn(() => ({ path: '/tmp/log' })) },
    console: { level: 'debug' },
  },
}));

const MIGRATIONS_DIR = path.join(__dirname, '..');

const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, '../../../sql/schema.sql'),
  'utf-8',
);

interface MigrationFile {
  name: string;
  up: (db: Database.Database) => true | Error;
}

const loadMigration = (file: string): MigrationFile =>
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(path.join(MIGRATIONS_DIR, file));

const migration025 = loadMigration('025.js');

/**
 * A database exactly as it stands the moment 025 runs: packaged schema plus
 * every earlier migration. The schema baseline already carries the
 * customer_groups table (empty) but not account.customerGroupId, which is
 * migration-added — the same split as every other migration-added column.
 */
const dbBefore025 = (): Database.Database => {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+\.js$/.test(f))
    .sort()
    .filter((f) => f < '025')
    .forEach((f) => expect(loadMigration(f).up(db)).toBe(true));
  return db;
};

/** id → [name, code] fixtures mirroring real patterns (synthetic values). */
const ACCOUNTS: Record<number, [string, string | null]> = {
  // one customer: base + two typed variants, mixed case and stray spaces
  1: ['Book Corner', 'RWP-BOOK'],
  2: ['Book Corner-T', 'rwp-book-t'],
  3: ['Book Corner TT', '  RWP-BOOK-TT  '],
  // same shop name in two other cities — must NEVER merge with each other
  // or with the RWP group; each city groups only through its own code
  4: ['Book Corner', 'ABD-BOOK'],
  5: ['Book Corner-T', 'ABD-BOOK-T'],
  6: ['Book Corner', 'QUE-BOOK'],
  // lone code: no second member, stays ungrouped
  7: ['Solo Shop', 'LHR-SOLO'],
  // typed code whose base code exists nowhere: '-ZZ' is not an item type,
  // so the code is its own base and both stay lone/ungrouped
  8: ['Zed Traders', 'KHI-ZED'],
  9: ['Zed Traders Extra', 'KHI-ZED-ZZ'],
  // no code at all: never grouped, whatever the name says
  10: ['Book Corner', null],
  11: ['Book Corner-T', ''],
  // all members typed (no base account): name falls back to shortest member
  12: ['Long Name Store-T', 'MUL-LONG-T'],
  13: ['Long Name-TT', 'MUL-LONG-TT'],
};

const seed = (db: Database.Database): void => {
  db.exec(`
    INSERT INTO users (id, username, password_hash) VALUES (1, 'owner', 'x');
    INSERT INTO chart (id, name, userId, type) VALUES (1, 'Assets', 1, 'Asset');
    INSERT INTO item_types (name) VALUES ('F'), ('T'), ('TT');
  `);
  const insert = db.prepare(
    `INSERT INTO account (id, chartId, name, code) VALUES (?, 1, ?, ?)`,
  );
  Object.entries(ACCOUNTS).forEach(([id, [name, code]]) =>
    insert.run(Number(id), name, code),
  );
};

interface AccountRow {
  id: number;
  name: string;
  code: string | null;
  customerGroupId: number | null;
}

const accountRows = (db: Database.Database): AccountRow[] =>
  db
    .prepare('SELECT id, name, code, customerGroupId FROM account ORDER BY id')
    .all() as AccountRow[];

const groupRows = (db: Database.Database) =>
  db
    .prepare('SELECT id, name FROM customer_groups ORDER BY id')
    .all() as Array<{ id: number; name: string }>;

const groupIdOf = (db: Database.Database, accountId: number): number | null =>
  accountRows(db).find((r) => r.id === accountId)?.customerGroupId ?? null;

describe('025_add_customer_groups', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = dbBefore025();
    seed(db);
  });

  afterEach(() => db.close());

  it('groups on exact base-code equality with item-type suffixes stripped case-insensitively', () => {
    expect(migration025.up(db)).toBe(true);

    // RWP trio share base code 'rwp-book' despite case and whitespace noise
    const rwpGroup = groupIdOf(db, 1);
    expect(rwpGroup).not.toBeNull();
    expect(groupIdOf(db, 2)).toBe(rwpGroup);
    expect(groupIdOf(db, 3)).toBe(rwpGroup);

    // group is named after the base (unsuffixed-code) account
    expect(groupRows(db).find((g) => g.id === rwpGroup)?.name).toBe(
      'Book Corner',
    );
  });

  it('never merges same-name accounts across different base codes', () => {
    expect(migration025.up(db)).toBe(true);

    const rwpGroup = groupIdOf(db, 1);
    const abdGroup = groupIdOf(db, 4);
    expect(abdGroup).not.toBeNull();
    expect(groupIdOf(db, 5)).toBe(abdGroup);

    // three cities carry the same shop name; ABD formed its own group, QUE
    // and the codeless rows stayed out of everything
    expect(abdGroup).not.toBe(rwpGroup);
    expect(groupIdOf(db, 6)).toBeNull();
    expect(groupIdOf(db, 10)).toBeNull();
    expect(groupIdOf(db, 11)).toBeNull();
  });

  it('requires 2+ members and a suffix that is a real item type', () => {
    expect(migration025.up(db)).toBe(true);

    // lone base code: no group
    expect(groupIdOf(db, 7)).toBeNull();
    // '-ZZ' is not in item_types, so KHI-ZED-ZZ is its own base code and
    // neither KHI row groups
    expect(groupIdOf(db, 8)).toBeNull();
    expect(groupIdOf(db, 9)).toBeNull();
  });

  it('falls back to the shortest member name when no base account exists', () => {
    expect(migration025.up(db)).toBe(true);

    const mulGroup = groupIdOf(db, 12);
    expect(mulGroup).not.toBeNull();
    expect(groupIdOf(db, 13)).toBe(mulGroup);
    expect(groupRows(db).find((g) => g.id === mulGroup)?.name).toBe(
      'Long Name-TT',
    );
  });

  it('creates exactly the provable groups and nothing else', () => {
    expect(migration025.up(db)).toBe(true);

    // RWP-BOOK, ABD-BOOK, MUL-LONG — and no name-derived extras
    expect(groupRows(db)).toHaveLength(3);
    const grouped = accountRows(db).filter((r) => r.customerGroupId !== null);
    expect(grouped.map((r) => r.id).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 12, 13,
    ]);
  });

  it('is idempotent: a second run adds no groups and reassigns nothing', () => {
    expect(migration025.up(db)).toBe(true);
    const firstGroups = groupRows(db);
    const firstAccounts = accountRows(db);

    expect(migration025.up(db)).toBe(true);

    expect(groupRows(db)).toEqual(firstGroups);
    expect(accountRows(db)).toEqual(firstAccounts);
  });

  it('leaves manually curated grouping untouched on a re-run', () => {
    expect(migration025.up(db)).toBe(true);

    // a person moves account 6 into the ABD group and deletes MUL's group
    const abdGroup = groupIdOf(db, 4);
    db.prepare('UPDATE account SET customerGroupId = ? WHERE id = 6').run(
      abdGroup,
    );
    db.prepare(
      'UPDATE account SET customerGroupId = NULL WHERE id IN (12, 13)',
    ).run();
    const curated = accountRows(db);

    expect(migration025.up(db)).toBe(true);

    expect(accountRows(db)).toEqual(curated);
  });

  it('enforces the foreign key when the pragma is on', () => {
    expect(migration025.up(db)).toBe(true);
    db.pragma('foreign_keys = ON');

    // dangling group id is rejected
    expect(() =>
      db
        .prepare(
          `INSERT INTO account (chartId, name, code, customerGroupId)
             VALUES (1, 'Dangling', 'X-1', 999999)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);

    // a group with members cannot be deleted out from under them
    const rwpGroup = groupIdOf(db, 1);
    expect(() =>
      db.prepare('DELETE FROM customer_groups WHERE id = ?').run(rwpGroup),
    ).toThrow(/FOREIGN KEY/i);

    // and the whole schema stays FK-consistent after seeding
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('loses no accounts and rewrites nothing but customerGroupId', () => {
    // customerGroupId does not exist yet, so snapshot the pre-025 columns
    const before = db
      .prepare('SELECT id, name, code FROM account ORDER BY id')
      .all();

    expect(migration025.up(db)).toBe(true);

    const after = accountRows(db).map(({ id, name, code }) => ({
      id,
      name,
      code,
    }));
    expect(after).toEqual(before);
  });
});
