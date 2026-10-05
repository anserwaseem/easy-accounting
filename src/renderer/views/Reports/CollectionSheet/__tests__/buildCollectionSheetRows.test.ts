import {
  buildCollectionSheetRows,
  collectionSheetTotals,
  collectionSheetTourTotals,
  formatTourAmount,
  isUnpaidTourCell,
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
  });
});
