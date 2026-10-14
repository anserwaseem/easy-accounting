import {
  buildCollectionSheetRows,
  collectionSheetTotals,
  collectionSheetTourTotals,
  collectionSheetUntouredTotal,
  formatTourAmount,
  isUnpaidTourCell,
  isUntouredCell,
  tourColumnHeader,
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

  it('keeps a bill whose amount equals the collection, and rounds the bill total', () => {
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
    expect(rows.map((r) => r.billNumber)).toEqual(['9881', '10268']);
    expect(rows.map((r) => r.balance)).toEqual([100, 81]);
    expect(rows.map((r) => r.collected)).toEqual([100, null]);
    expect(rows.map((r) => r.code)).toEqual(['CHITRAL-NOOR', 'CHITRAL-NOOR']);
    expect(rows.map((r) => r.shopDisplay)).toEqual(['نور بک ڈپو', '//']);
    expect(rows.map((r) => r.addressDisplay)).toEqual(['چترال', '//']);
    expect(rows.map((r) => r.codeDisplay)).toEqual(['CHITRAL-NOOR', '//']);
    expect(rows.map((r) => r.billIndex)).toEqual([1, 2]);
    expect(rows.map((r) => r.billCount)).toEqual([2, 2]);
    expect(rows.map((r) => r.totalBilled)).toEqual([180.9, null]);
    expect(collectionSheetTotals(rows)).toEqual({
      balance: 181,
      collected: 100,
    });
  });

  it('falls back to English when Urdu is empty, and sums signed balances', () => {
    const accounts: CollectionSheetSource[] = [
      { id: 1, name: 'A', code: 'A', address: 'Z' },
      { id: 2, name: 'B', code: 'B', address: 'Y', nameUrdu: 'بی' },
    ];
    const rows = buildCollectionSheetRows(
      accounts,
      itemTypes,
      {
        1: owed(100, 40),
        2: { balance: 25, balanceType: 'Cr', collected: 0 },
      },
      {
        1: [{ invoiceNumber: 1, date: '2026-01-02', amount: 10 }],
        2: [{ invoiceNumber: 2, date: '2026-01-03', amount: 20 }],
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

    it('puts the family "not in a tour" sum on the first row only', () => {
      const rows = buildCollectionSheetRows(
        accounts,
        itemTypes,
        money,
        bills,
        'en',
        tourIds,
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
    ).toBe('Aug 2026 · 27/07–30/08');
    expect(
      tourColumnHeader({
        id: 2,
        name: 'Oct 2026',
        startDate: '2026-10-01',
        endDate: null,
      }),
    ).toBe('Oct 2026 · 01/10–…');
    expect(
      tourColumnHeader({
        id: 3,
        name: 'Jan 2026',
        startDate: '2026-01-01',
        endDate: '2026-01-25',
        clipped: true,
      }),
    ).toBe('Jan 2026 · 01/01–25/01 (part)');
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
        'bills-desc',
      );
      // Beta (510), Gamma (200), Alpha (100)
      expect(rows.map((r) => r.code)).toEqual(['B-BETA', 'C-GAMMA', 'A-ALPHA']);
    });
  });
});
