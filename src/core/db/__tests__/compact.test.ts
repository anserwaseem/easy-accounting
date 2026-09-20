import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { COMPACT_MIN_WASTED_BYTES, shouldCompactUnusedPages } from '../driver';

describe('shouldCompactUnusedPages', () => {
  it('skips empty and tiny freelists', () => {
    expect(shouldCompactUnusedPages(4096, 0)).toBe(false);
    expect(shouldCompactUnusedPages(4096, 1)).toBe(false);
    expect(shouldCompactUnusedPages(0, 999999)).toBe(false);
  });

  it('trips at 8MB unused', () => {
    const pages = COMPACT_MIN_WASTED_BYTES / 4096;
    expect(shouldCompactUnusedPages(4096, pages - 1)).toBe(false);
    expect(shouldCompactUnusedPages(4096, pages)).toBe(true);
  });
});

describe('BetterSqliteDriver.compactIfNeeded', () => {
  let dbPath: string;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-compact-'));
    dbPath = path.join(dir, 't.db');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('no-ops when unused pages are small', async () => {
    const db = new Database(dbPath);
    const driver = new BetterSqliteDriver(db);
    expect(await driver.compactIfNeeded()).toBe(false);
    db.close();
  });

  it('vacuums after a large delete and does not fire mutation listener', async () => {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, blob TEXT)');
    const blob = 'x'.repeat(4000);
    const insert = db.prepare('INSERT INTO t (blob) VALUES (?)');
    db.transaction(() => {
      for (let i = 0; i < 2500; i += 1) insert.run(blob);
    })();
    db.exec('DELETE FROM t');
    const wasted =
      Number(db.pragma('page_size', { simple: true })) *
      Number(db.pragma('freelist_count', { simple: true }));
    expect(wasted).toBeGreaterThanOrEqual(COMPACT_MIN_WASTED_BYTES);
    const before = fs.statSync(dbPath).size;

    const driver = new BetterSqliteDriver(db);
    const listener = jest.fn();
    driver.setMutationListener(listener);
    expect(await driver.compactIfNeeded()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(Number(db.pragma('freelist_count', { simple: true }))).toBe(0);
    db.close();
    expect(fs.statSync(dbPath).size).toBeLessThan(before);
  });
});
