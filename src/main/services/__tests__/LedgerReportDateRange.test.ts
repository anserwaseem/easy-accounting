import Database from 'better-sqlite3';

const localDateExpr = (col: string) => `
  (
    CASE
      WHEN length(${col}) = 10 THEN ${col}
      ELSE date(datetime(${col}, 'localtime'))
    END
  )
`;

describe('ledger report date range (local-date semantics)', () => {
  it('opening balance before startDate excludes ISO-Z rows that are next local day', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE ledger (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        accountId INTEGER NOT NULL,
        balance INTEGER NOT NULL,
        balanceType TEXT NOT NULL
      );
    `);

    const insert = db.prepare(
      `INSERT INTO ledger (id, date, accountId, balance, balanceType)
       VALUES (@id, @date, @accountId, @balance, @balanceType)`,
    );

    // feb 20 local date-only row (end-of-day local balance)
    insert.run({
      id: 1,
      date: '2026-02-20',
      accountId: 926,
      balance: 19026810,
      balanceType: 'Cr',
    });

    // this is feb 21 local (PKT +05), but stored as feb 20T19:00Z
    insert.run({
      id: 2,
      date: '2026-02-20T19:00:00.000Z',
      accountId: 926,
      balance: 19644310,
      balanceType: 'Cr',
    });

    const stmt = db.prepare(
      `SELECT balance
       FROM ledger
       WHERE accountId = @accountId
         AND ${localDateExpr('date')} < @startDate
       ORDER BY ${localDateExpr(
         'date',
       )} DESC, datetime(date, 'localtime') DESC, id DESC
       LIMIT 1`,
    );

    const row = stmt.get({ accountId: 926, startDate: '2026-02-21' }) as
      | { balance: number }
      | undefined;

    expect(row?.balance).toBe(19026810);
  });

  it('range query includes ISO-Z rows that fall within local date range', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE ledger (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        accountId INTEGER NOT NULL,
        balance INTEGER NOT NULL,
        balanceType TEXT NOT NULL
      );
    `);

    const insert = db.prepare(
      `INSERT INTO ledger (id, date, accountId, balance, balanceType)
       VALUES (@id, @date, @accountId, @balance, @balanceType)`,
    );

    insert.run({
      id: 1,
      date: '2026-02-20',
      accountId: 926,
      balance: 19026810,
      balanceType: 'Cr',
    });
    insert.run({
      id: 2,
      date: '2026-02-20T19:00:00.000Z',
      accountId: 926,
      balance: 19644310,
      balanceType: 'Cr',
    });

    const stmt = db.prepare(
      `SELECT id
       FROM ledger
       WHERE accountId = @accountId
         AND ${localDateExpr('date')} >= @startDate
         AND ${localDateExpr('date')} <= @endDate
       ORDER BY datetime(date, 'localtime') ASC, id ASC`,
    );

    const rows = stmt.all({
      accountId: 926,
      startDate: '2026-02-21',
      endDate: '2026-02-28',
    }) as Array<{ id: number }>;

    expect(rows.map((r) => r.id)).toEqual([2]);
  });
});
