import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';

/**
 * An open transaction used to treat every concurrent driver call as nested
 * (`txDepth > 0` → run inline). A second caller must wait, and must not
 * lose its write if the open transaction rolls back.
 */
describe('BetterSqliteDriver transaction isolation', () => {
  it('keeps an outsider out of an open transaction', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tx = driver.transaction(async () => {
      await driver.run(`INSERT INTO t (v) VALUES ('inside')`);
      await gate;
      const row = await driver.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM t',
      );
      expect(row?.c).toBe(1);
      throw new Error('abort');
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    const outside = driver.run(`INSERT INTO t (v) VALUES ('outside')`);
    release();

    await expect(tx).rejects.toThrow('abort');
    await outside;

    const rows = db.prepare('SELECT v FROM t ORDER BY id').all() as {
      v: string;
    }[];
    expect(rows).toEqual([{ v: 'outside' }]);
    db.close();
  });

  it('nested transaction sees the outer insert and rolls back alone', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');

    await driver.transaction(async () => {
      await driver.run(`INSERT INTO t (v) VALUES ('outer')`);
      await expect(
        driver.transaction(async () => {
          await driver.run(`INSERT INTO t (v) VALUES ('inner')`);
          const mid = await driver.get<{ c: number }>(
            'SELECT COUNT(*) AS c FROM t',
          );
          expect(mid?.c).toBe(2);
          throw new Error('drop inner');
        }),
      ).rejects.toThrow('drop inner');
      const after = await driver.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM t',
      );
      expect(after?.c).toBe(1);
    });

    const rows = db.prepare('SELECT v FROM t').all() as { v: string }[];
    expect(rows).toEqual([{ v: 'outer' }]);
    db.close();
  });
});
