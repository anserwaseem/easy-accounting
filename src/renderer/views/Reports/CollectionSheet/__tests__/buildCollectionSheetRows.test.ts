import {
  buildCollectionSheetRows,
  collectionSheetTotals,
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

  it('sorts by account code, so a base stays ahead of its suffixed tiers', () => {
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
        1: owed(1),
        2: owed(1),
        3: owed(1),
        4: owed(1),
        5: owed(1),
      },
      {},
      'en',
    );
    expect(rows.map((r) => r.code)).toEqual([
      'Bon-Usmania',
      'Bon-Usmania-T',
      'KAR-USMANIA',
      'KAR-USMANIA-T',
      'KAR-USMANIA-TT',
    ]);
    expect(rows.map((r) => r.isTier)).toEqual([false, true, false, true, true]);
    expect(rows.map((r) => r.addressDisplay)).toEqual([
      'Swari',
      '//',
      'Karachi',
      '//',
      '//',
    ]);
    expect(rows.map((r) => r.serial)).toEqual([1, 2, 3, 4, 5]);
  });

  it('uses Urdu labels, flips Cr to negative, and drops a zero balance', () => {
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
        1: owed(10, 3),
        2: { balance: 4, balanceType: 'Cr', collected: 0 },
        3: owed(0, 9),
      },
      {
        1: [
          { invoiceNumber: 12, date: '2026-09-04' },
          { invoiceNumber: 15, date: '2026-09-18' },
        ],
      },
      'ur',
    );
    expect(rows.map((r) => r.shop)).toEqual(['نور بک ڈپو', 'نور بک ڈپو ٹی']);
    expect(rows.map((r) => r.balance)).toEqual([10, -4]);
    expect(rows[0].bills).toBe('12 (04/09/26), 15 (18/09/26)');
    expect(rows[1].addressDisplay).toBe('//');
    expect(rows.map((r) => r.code)).not.toContain('PAID');
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
      {},
      'ur',
    );
    expect(rows.map((r) => r.shop)).toEqual(['A', 'بی']);
    expect(collectionSheetTotals(rows)).toEqual({
      balance: 75,
      collected: 40,
    });
  });
});
