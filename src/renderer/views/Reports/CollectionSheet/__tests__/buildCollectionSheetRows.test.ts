import {
  buildCollectionSheetRows,
  collectionSheetTotals,
  collectionSheetTourTotals,
  collectionSheetUntouredTotal,
  computeDueBills,
  formatTourAmount,
  isUnpaidTourCell,
  isUntouredCell,
  tourColumnHeader,
  tourColumnRange,
  type CollectionSheetSource,
} from '../buildCollectionSheetRows';

const row = (
  partial: CollectionSheetSource & { address?: string },
): CollectionSheetSource => partial;

const owed = (balance: number, collected = 0) => ({
  balance,
  balanceType: 'Dr',
  collected,
});

describe('buildCollectionSheetRows', () => {
  const itemTypes = ['F', 'T', 'TT'];

  it('skips a shop that has a ledger balance but no bill in the range', () => {
    const accounts: CollectionSheetSource[] = [
      row({
        id: 4,
        name: 'MAKTABA USMANIA',
        code: 'KAR-USMANIA-T',
        address: 'Karachi',
      }),
      row({
        id: 2,
        name: 'MAKTABA USMANIA',
        code: 'Bon-Usmania-T',
        address: 'Swari',
      }),
      row({
        id: 3,
        name: 'MAKTABA USMANIA',
        code: 'KAR-USMANIA',
        address: 'Karachi',
      }),
      row({
        id: 5,
        name: 'MAKTABA USMANIA',
        code: 'KAR-USMANIA-TT',
        address: 'Karachi',
      }),
      row({
        id: 1,
        name: 'MAKTABA USMANIA',
        code: 'Bon-Usmania',
        address: 'Swari',
      }),
    ];

    const rows = buildCollectionSheetRows(
      accounts,
      itemTypes,
      {
        1: owed(1, 4),
        2: owed(10),
        3: owed(1),
        4: owed(20),
        5: owed(5),
      },
      {},
      'en',
    );
    expect(rows).toEqual([]);
  });

  it('omits paid bills and keeps only active due bills settled FIFO', () => {
    const accounts: CollectionSheetSource[] = [
      row({
        id: 2,
        name: 'NOOR BOOK DEPO-T',
        code: 'CHITRAL-NOOR',
        nameUrdu: 'نور بک ڈپو ٹی',
        addressUrdu: 'چترال',
      }),
      row({
        id: 1,
        name: 'NOOR BOOK DEPO',
        code: 'CHITRAL-NOOR',
        nameUrdu: 'نور بک ڈپو',
        address: 'CHITRALN',
        addressUrdu: 'چترال',
      }),
      row({
        id: 3,
        name: 'PAID SHOP',
        code: 'PAID',
        address: 'Somewhere',
      }),
    ];

    const rows = buildCollectionSheetRows(
      accounts,
      itemTypes,
      {
        1: owed(80, 100),
        2: owed(0, 0),
        3: owed(0, 9),
      },
      {
        1: [
          { invoiceNumber: 10268, date: '2026-09-18', amount: 80.5 },
          { invoiceNumber: 9881, date: '2026-02-03', amount: 60 },
        ],
        2: [{ invoiceNumber: 9881, date: '2026-02-03', amount: 40.4 }],
      },
      'ur',
    );
    // Bill 9881 was fully paid by the 100 collection; only active bill 10268 is due for 80
    expect(rows.map((r) => r.billNumber)).toEqual(['10268']);
    expect(rows.map((r) => r.balance)).toEqual([80]);
    expect(rows.map((r) => r.collected)).toEqual([100]);
    expect(rows.map((r) => r.code)).toEqual(['CHITRAL-NOOR']);
    expect(rows.map((r) => r.shopDisplay)).toEqual(['نور بک ڈپو']);
    expect(rows.map((r) => r.addressDisplay)).toEqual(['چترال']);
    expect(rows.map((r) => r.codeDisplay)).toEqual(['CHITRAL-NOOR']);
    expect(rows.map((r) => r.billIndex)).toEqual([1]);
    expect(rows.map((r) => r.billCount)).toEqual([1]);
    expect(rows.map((r) => r.totalBilled)).toEqual([80]);
    expect(collectionSheetTotals(rows)).toEqual({
      balance: 80,
      collected: 100,
    });
  });

  it('splits debt across multiple bills and formats indexes and totals', () => {
    const accounts: CollectionSheetSource[] = [
      row({
        id: 1,
        name: 'MULTI SHOP',
        code: 'MULTI',
        address: 'City',
      }),
    ];

    const rows = buildCollectionSheetRows(
      accounts,
      itemTypes,
      {
        1: owed(150, 50),
      },
      {
        1: [
          { invoiceNumber: 101, date: '2026-01-01', amount: 100 },
          { invoiceNumber: 102, date: '2026-02-01', amount: 100 },
        ],
      },
      'en',
    );
    // Bill 102 is fully due (100), Bill 101 is partially due (50)
    expect(rows.map((r) => r.billNumber)).toEqual(['101', '102']);
    expect(rows.map((r) => r.balance)).toEqual([50, 100]);
    expect(rows.map((r) => r.collected)).toEqual([50, null]);
    expect(rows.map((r) => r.billIndex)).toEqual([1, 2]);
    expect(rows.map((r) => r.billCount)).toEqual([2, 2]);
    expect(rows.map((r) => r.totalBilled)).toEqual([150, null]);
    expect(rows.map((r) => r.shopDisplay)).toEqual(['MULTI SHOP', '//']);
    expect(rows.map((r) => r.codeDisplay)).toEqual(['MULTI', '//']);
    expect(collectionSheetTotals(rows)).toEqual({
      balance: 150,
      collected: 50,
    });
  });

  it('falls back to English when Urdu is empty, and excludes credit balance shops', () => {
    const accounts: CollectionSheetSource[] = [
      { id: 1, name: 'A', code: 'A', address: 'Z' },
      { id: 2, name: 'B', code: 'B', address: 'Y', nameUrdu: 'بی' },
      { id: 3, name: 'C', code: 'C', address: 'W' },
    ];
    const rows = buildCollectionSheetRows(
      accounts,
      itemTypes,
      {
        1: owed(10, 40),
        2: owed(20, 0),
        3: { balance: 25, balanceType: 'Cr', collected: 0 },
      },
      {
        1: [{ invoiceNumber: 1, date: '2026-01-02', amount: 10 }],
        2: [{ invoiceNumber: 2, date: '2026-01-03', amount: 20 }],
        3: [{ invoiceNumber: 3, date: '2026-01-04', amount: 30 }],
      },
      'ur',
    );
    expect(rows.map((r) => r.shop)).toEqual(['A', 'بی']);
    expect(collectionSheetTotals(rows)).toEqual({
      balance: 30,
      collected: 40,
    });
  });

  it('shows 0 when the shop collected nothing', () => {
    const rows = buildCollectionSheetRows(
      [{ id: 1, name: 'A', code: 'A', address: 'Z' }],
      itemTypes,
      { 1: owed(50, 0) },
      { 1: [{ invoiceNumber: 7, date: '2026-03-01', amount: 50 }] },
      'en',
    );
    expect(rows.map((r) => r.collected)).toEqual([0]);
  });

  describe('tour columns', () => {
    const accounts: CollectionSheetSource[] = [
      { id: 1, name: 'NOOR', code: 'NOOR', address: 'X' },
      { id: 2, name: 'NOOR-T', code: 'NOOR-T', address: 'X' },
      { id: 3, name: 'IDLE', code: 'IDLE', address: 'Y' },
    ];
    const money = { 1: owed(100), 2: owed(50), 3: owed(30) };
    const bills = {
      1: [
        { invoiceNumber: 1, date: '2026-01-02', amount: 60 },
        { invoiceNumber: 2, date: '2026-02-02', amount: 40 },
      ],
      2: [{ invoiceNumber: 2, date: '2026-02-02', amount: 50 }],
      3: [{ invoiceNumber: 3, date: '2026-01-05', amount: 30 }],
    };
    const tourIds = [10, 11];

    it('folds tiers per tour on the first row, 0 when unpaid, null after', () => {
      const rows = buildCollectionSheetRows(
        accounts,
        itemTypes,
        money,
        bills,
        'en',
        tourIds,
        { 1: { 10: 40 }, 2: { 10: 5, 11: 20 } },
      );
      expect(rows.map((r) => [r.code, r.billNumber, r.tourPaid])).toEqual([
        ['IDLE', '3', { 10: 0, 11: 0 }],
        ['NOOR', '1', { 10: 45, 11: 20 }],
        ['NOOR', '2', { 10: null, 11: null }],
      ]);
      expect(collectionSheetTourTotals(rows, tourIds)).toEqual({
        10: 45,
        11: 20,
      });
    });

    it('folds tiers per tour for the balance at tour end, first row only', () => {
      const rows = buildCollectionSheetRows(
        accounts,
        itemTypes,
        money,
        bills,
        'en',
        tourIds,
        {},
        {
          1: {
            10: { balance: 100, balanceType: 'Dr' },
            11: { balance: 80, balanceType: 'Dr' },
          },
          2: {
            10: { balance: 20, balanceType: 'Cr' },
            11: { balance: 10, balanceType: 'Dr' },
          },
        },
      );
      expect(rows.map((r) => [r.code, r.tourBalance])).toEqual([
        ['IDLE', { 10: 0, 11: 0 }],
        // tier 2's Cr balance offsets tier 1: 100 - 20, then 80 + 10
        ['NOOR', { 10: 80, 11: 90 }],
        ['NOOR', { 10: null, 11: null }],
      ]);
    });

    it('puts the family "not in a tour" sum on the first row only', () => {
      const rows = buildCollectionSheetRows(
        accounts,
        itemTypes,
        money,
        bills,
        'en',
        tourIds,
        {},
        {},
        { 1: 7, 2: 3 },
      );
      expect(rows.map((r) => [r.code, r.untoured])).toEqual([
        ['IDLE', 0],
        ['NOOR', 10],
        ['NOOR', null],
      ]);
      expect(collectionSheetUntouredTotal(rows)).toBe(10);
      expect(isUntouredCell(10)).toBe(true);
      expect(isUntouredCell(0)).toBe(false);
    });

    it('leaves rows without tour cells when no tour is in range', () => {
      const rows = buildCollectionSheetRows(
        accounts,
        itemTypes,
        money,
        bills,
        'en',
      );
      expect(rows.every((r) => Object.keys(r.tourPaid).length === 0)).toBe(
        true,
      );
      expect(rows.every((r) => r.untoured === null)).toBe(true);
    });
  });

  it('formats tour cells and headers', () => {
    expect(isUnpaidTourCell(0)).toBe(true);
    expect(isUnpaidTourCell(null)).toBe(false);
    expect(isUnpaidTourCell(12)).toBe(false);
    expect(formatTourAmount(0)).toBe('');
    expect(formatTourAmount(null)).toBe('');
    expect(formatTourAmount(1500)).toBe('1,500');
    expect(
      tourColumnHeader({
        id: 1,
        name: 'Aug 2026',
        startDate: '2026-07-27',
        endDate: '2026-08-30',
      }),
    ).toBe('Aug 2026 · 27 Jul–30 Aug');
    expect(
      tourColumnHeader({
        id: 2,
        name: 'Oct 2026',
        startDate: '2026-10-01',
        endDate: null,
      }),
    ).toBe('Oct 2026 · 01 Oct–…');
    expect(
      tourColumnHeader({
        id: 3,
        name: 'Jan 2026',
        startDate: '2026-01-01',
        endDate: '2026-01-25',
        clipped: true,
      }),
    ).toBe('Jan 2026 · 01 Jan–25 Jan (part)');
    // the sheet header stacks this range under the tour name, so it must stay short
    expect(
      tourColumnRange({
        id: 1,
        name: 'Aug 2026',
        startDate: '2026-07-27',
        endDate: '2026-08-30',
      }),
    ).toBe('27 Jul–30 Aug');
    expect(
      tourColumnRange({
        id: 2,
        name: 'Oct 2026',
        startDate: '2026-10-01',
        endDate: null,
      }),
    ).toBe('01 Oct–…');
  });

  describe('sorting options', () => {
    const accounts: CollectionSheetSource[] = [
      { id: 1, name: 'Shop Alpha', code: 'A-ALPHA', address: 'X' },
      { id: 2, name: 'Shop Beta', code: 'B-BETA', address: 'Y' },
      { id: 3, name: 'Shop Gamma', code: 'C-GAMMA', address: 'Z' },
    ];
    // Alpha: billed 100, collected 20 -> outstanding 80. Tour 10: paid 20, Tour 11: 0 (1 unpaid tour)
    // Beta: billed 510, collected 500 -> outstanding 10. Tour 10: 250, Tour 11: 250 (0 unpaid tours)
    // Gamma: billed 200, collected 0 -> outstanding 200. Tour 10: 0, Tour 11: 0 (2 unpaid tours)
    const money = {
      1: owed(80, 20),
      2: owed(10, 500),
      3: owed(200, 0),
    };
    const bills = {
      1: [{ invoiceNumber: 101, date: '2026-01-01', amount: 100 }],
      2: [{ invoiceNumber: 102, date: '2026-01-02', amount: 510 }],
      3: [{ invoiceNumber: 103, date: '2026-01-03', amount: 200 }],
    };
    const tourIds = [10, 11];
    const tourCollections = {
      1: { 10: 20, 11: 0 },
      2: { 10: 250, 11: 250 },
      3: { 10: 0, 11: 0 },
    };

    it('sorts by route/code by default', () => {
      const rows = buildCollectionSheetRows(
        accounts,
        itemTypes,
        money,
        bills,
        'en',
        tourIds,
        tourCollections,
      );
      expect(rows.map((r) => r.code)).toEqual(['A-ALPHA', 'B-BETA', 'C-GAMMA']);
    });

    it('sorts by highest outstanding descending', () => {
      const rows = buildCollectionSheetRows(
        accounts,
        itemTypes,
        money,
        bills,
        'en',
        tourIds,
        tourCollections,
        {},
        {},
        'outstanding-desc',
      );
      // Gamma (200), Alpha (80), Beta (10)
      expect(rows.map((r) => r.code)).toEqual(['C-GAMMA', 'A-ALPHA', 'B-BETA']);
    });

    it('sorts by most unpaid tours descending', () => {
      const rows = buildCollectionSheetRows(
        accounts,
        itemTypes,
        money,
        bills,
        'en',
        tourIds,
        tourCollections,
        {},
        {},
        'unpaid-tours-desc',
      );
      // Gamma (2 unpaid), Alpha (1 unpaid), Beta (0 unpaid)
      expect(rows.map((r) => r.code)).toEqual(['C-GAMMA', 'A-ALPHA', 'B-BETA']);
    });

    it('sorts by highest billed descending', () => {
      const rows = buildCollectionSheetRows(
        accounts,
        itemTypes,
        money,
        bills,
        'en',
        tourIds,
        tourCollections,
        {},
        {},
        'bills-desc',
      );
      // Gamma (200 due), Alpha (80 due), Beta (10 due)
      expect(rows.map((r) => r.code)).toEqual(['C-GAMMA', 'A-ALPHA', 'B-BETA']);
    });
  });

  describe('computeDueBills', () => {
    const candidateBills = [
      { invoiceNumber: 10180, date: '2026-07-04', amount: 326646 },
      { invoiceNumber: 10200, date: '2026-07-23', amount: 326646 },
      { invoiceNumber: 10240, date: '2026-08-27', amount: 219078 },
      { invoiceNumber: 10045, date: '2026-05-15', amount: 200000 },
      { invoiceNumber: 10014, date: '2026-04-10', amount: 300000 },
    ];

    it('settles FIFO backward from latest bills and omits fully paid older bills', () => {
      const due = computeDueBills(candidateBills, 862724, 'en');
      expect(due).toEqual([
        { invoiceNumber: 10180, date: '2026-07-04', amount: 317000 },
        { invoiceNumber: 10200, date: '2026-07-23', amount: 326646 },
        { invoiceNumber: 10240, date: '2026-08-27', amount: 219078 },
      ]);
      expect(due.reduce((sum, b) => sum + b.amount, 0)).toBe(862724);
    });

    it('appends Opening Bal when debt exceeds all candidate bills', () => {
      const due = computeDueBills(
        [{ invoiceNumber: 100, date: '2026-01-01', amount: 30000 }],
        50000,
        'en',
      );
      expect(due).toEqual([
        { invoiceNumber: 'Opening Bal', date: '', amount: 20000 },
        { invoiceNumber: 100, date: '2026-01-01', amount: 30000 },
      ]);
    });

    it('uses Urdu label for opening balance when language is ur', () => {
      const due = computeDueBills(
        [{ invoiceNumber: 100, date: '2026-01-01', amount: 30000 }],
        50000,
        'ur',
      );
      expect(due).toEqual([
        { invoiceNumber: 'سابقہ بقایا', date: '', amount: 20000 },
        { invoiceNumber: 100, date: '2026-01-01', amount: 30000 },
      ]);
    });

    it('returns empty array when balance is zero or negative', () => {
      expect(computeDueBills(candidateBills, 0, 'en')).toEqual([]);
      expect(computeDueBills(candidateBills, -500, 'en')).toEqual([]);
    });

    it('returns empty array when candidateBills is empty', () => {
      expect(computeDueBills([], 50000, 'en')).toEqual([]);
    });
  });
});
