import {
  buildFullCatalog,
  buildPublicCatalog,
  toProductsCsv,
  isPublishable,
  publicPricesOf,
  type CatalogSourceRow,
} from '../catalog';

const row = (over: Partial<CatalogSourceRow> = {}): CatalogSourceRow => ({
  sku: 'S-23-G',
  name: 'S-23-G',
  parentSku: 'S-23',
  basePrice: 900, // private/trade price
  quantity: 12,
  attributes: { size_in: '5.75 x 9', binding: 'Golden Rexine' },
  prices: { Retail: 1080 },
  hasImage: true,
  ...over,
});

const OPTS = { publicPriceLists: ['Retail'] };

describe('publicPricesOf', () => {
  it('keeps only public lists with a positive price', () => {
    const r = row({ prices: { Retail: 1080, Wholesale: 700, Zero: 0 } });
    expect(publicPricesOf(r, ['Retail', 'Zero'])).toEqual({ Retail: 1080 });
  });
});

describe('isPublishable', () => {
  it('true when attributes + public price + image all present', () => {
    expect(isPublishable(row(), OPTS.publicPriceLists)).toBe(true);
  });
  it('false without attributes', () => {
    expect(isPublishable(row({ attributes: {} }), OPTS.publicPriceLists)).toBe(
      false,
    );
  });
  it('false without an image', () => {
    expect(isPublishable(row({ hasImage: false }), OPTS.publicPriceLists)).toBe(
      false,
    );
  });
  it('false without a public price', () => {
    expect(
      isPublishable(row({ prices: { Wholesale: 700 } }), OPTS.publicPriceLists),
    ).toBe(false);
  });
});

describe('buildFullCatalog', () => {
  it('includes base price, all price lists, and publishable flag', () => {
    const cat = buildFullCatalog(
      [row({ prices: { Retail: 1080, Wholesale: 700 } })],
      OPTS,
      'T',
    );
    expect(cat.count).toBe(1);
    expect(cat.priceLists).toEqual(['Retail', 'Wholesale']);
    expect(cat.publicPriceLists).toEqual(['Retail']);
    expect(cat.items[0].basePrice).toBe(900);
    expect(cat.items[0].prices).toEqual({ Retail: 1080, Wholesale: 700 });
    expect(cat.items[0].publishable).toBe(true);
  });
});

describe('buildPublicCatalog', () => {
  it('excludes items with no public price', () => {
    const rows = [
      row(),
      row({ sku: 'X', name: 'X', prices: { Wholesale: 700 } }),
    ];
    const pub = buildPublicCatalog(rows, OPTS, 'T');
    expect(pub.count).toBe(1);
    expect(pub.items[0].sku).toBe('S-23-G');
  });

  it('public items carry only public prices and NO base price field', () => {
    const pub = buildPublicCatalog(
      [row({ prices: { Retail: 1080, Wholesale: 700 } })],
      OPTS,
    );
    const item = pub.items[0] as unknown as Record<string, unknown>;
    expect(item.prices).toEqual({ Retail: 1080 });
    expect('basePrice' in item).toBe(false);
    expect(item).not.toHaveProperty('basePrice');
  });
});

describe('TIER SEPARATION (red line)', () => {
  // Distinct, searchable private values that must never surface publicly.
  const rows: CatalogSourceRow[] = [
    row({
      sku: 'A',
      name: 'A',
      basePrice: 111111,
      prices: { Retail: 1080, Wholesale: 222222 },
    }),
    row({
      sku: 'B',
      name: 'B',
      basePrice: 333333,
      prices: { Retail: 990, Wholesale: 444444 },
    }),
  ];

  it('no base price or non-public price value appears in public JSON', () => {
    const json = JSON.stringify(buildPublicCatalog(rows, OPTS, 'T'));
    for (const secret of [
      '111111',
      '222222',
      '333333',
      '444444',
      'Wholesale',
      'basePrice',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('no base price or non-public price value appears in products.csv', () => {
    const csv = toProductsCsv(buildPublicCatalog(rows, OPTS, 'T'));
    for (const secret of [
      '111111',
      '222222',
      '333333',
      '444444',
      'Wholesale',
      'basePrice',
    ]) {
      expect(csv).not.toContain(secret);
    }
    // sanity: the public price DID make it in
    expect(csv).toContain('1080');
  });

  it('full catalog, by contrast, DOES contain the private values', () => {
    const json = JSON.stringify(buildFullCatalog(rows, OPTS, 'T'));
    expect(json).toContain('111111');
    expect(json).toContain('222222');
  });
});

describe('toProductsCsv', () => {
  it('has stable columns and escapes commas/quotes/unicode', () => {
    const rows = [
      row({
        sku: 'A',
        name: 'Quran, 16 line',
        attributes: { note: 'has "zip"', urdu: 'کاغذ' },
      }),
    ];
    const csv = toProductsCsv(buildPublicCatalog(rows, OPTS, 'T'));
    const [header, dataLine] = csv.trim().split('\n');
    expect(header).toBe(
      'sku,name,parentSku,quantity,attr.note,attr.urdu,price.Retail,hasImage,publishable',
    );
    expect(dataLine).toContain('"Quran, 16 line"'); // comma-quoted
    expect(dataLine).toContain('"has ""zip"""'); // quote-escaped
    expect(dataLine).toContain('کاغذ'); // unicode preserved
  });
});
