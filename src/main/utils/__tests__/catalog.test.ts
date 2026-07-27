import {
  buildFullCatalog,
  buildPublicCatalog,
  toProductsCsv,
  isPublishable,
  publicAttributesOf,
  publicPriceOf,
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
  excludeFromCatalog: false,
  ...over,
});

// the fixture's attribute keys are all marked public, so these tests exercise
// price/image behaviour rather than the whitelist (covered separately below)
const OPTS = {
  publicPriceList: 'Retail',
  publicAttributeKeys: ['size_in', 'binding', 'note', 'urdu'],
};

describe('publicPriceOf', () => {
  it('returns the price from the configured list', () => {
    const r = row({ prices: { Retail: 1080, Wholesale: 700 } });
    expect(publicPriceOf(r, 'Retail')).toBe(1080);
  });
  it('ignores a non-positive price', () => {
    expect(publicPriceOf(row({ prices: { Retail: 0 } }), 'Retail')).toBeNull();
  });
  it('returns null when the list is absent or unset', () => {
    expect(publicPriceOf(row(), 'Wholesale')).toBeNull();
    expect(publicPriceOf(row(), '')).toBeNull();
  });
});

describe('isPublishable', () => {
  it('true when attributes + public price + image all present', () => {
    expect(
      isPublishable(row(), OPTS.publicPriceList, OPTS.publicAttributeKeys),
    ).toBe(true);
  });
  it('false without attributes', () => {
    expect(
      isPublishable(
        row({ attributes: {} }),
        OPTS.publicPriceList,
        OPTS.publicAttributeKeys,
      ),
    ).toBe(false);
  });
  it('false without an image', () => {
    expect(
      isPublishable(
        row({ hasImage: false }),
        OPTS.publicPriceList,
        OPTS.publicAttributeKeys,
      ),
    ).toBe(false);
  });
  it('false without a public price', () => {
    expect(
      isPublishable(
        row({ prices: { Wholesale: 700 } }),
        OPTS.publicPriceList,
        OPTS.publicAttributeKeys,
      ),
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
    expect(cat.publicPriceList).toBe('Retail');
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

  it('public items expose one price and NO base price field', () => {
    const pub = buildPublicCatalog(
      [row({ prices: { Retail: 1080, Wholesale: 700 } })],
      OPTS,
    );
    const item = pub.items[0] as unknown as Record<string, unknown>;
    expect(item.price).toBe(1080);
    expect('basePrice' in item).toBe(false);
    expect('prices' in item).toBe(false);
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
      'sku,name,parentSku,quantity,attr.note,attr.urdu,price,hasImage,publishable',
    );
    expect(dataLine).toContain('"Quran, 16 line"'); // comma-quoted
    expect(dataLine).toContain('"has ""zip"""'); // quote-escaped
    expect(dataLine).toContain('کاغذ'); // unicode preserved
  });
});

describe('public attribute whitelist', () => {
  const attrRow = (attrs: Record<string, unknown>): CatalogSourceRow => ({
    sku: 'A-1',
    name: 'A-1',
    parentSku: null,
    basePrice: 100,
    quantity: 5,
    attributes: attrs,
    prices: { Retail: 200 },
    hasImage: true,
    excludeFromCatalog: false,
  });

  const internal = {
    size: '5 x 7',
    notes: 'sold 337 in 24 months',
    data_flags: 'CHECK',
  };

  it('keeps only the keys marked public', () => {
    expect(publicAttributesOf(attrRow(internal), ['size'])).toEqual({
      size: '5 x 7',
    });
  });

  it('publishes nothing when no keys are marked public', () => {
    // failing closed matters: an unconfigured install must not leak
    expect(publicAttributesOf(attrRow(internal))).toEqual({});
  });

  it('ignores public keys the item does not carry', () => {
    expect(
      publicAttributesOf(attrRow({ size: '5 x 7' }), ['size', 'binding']),
    ).toEqual({ size: '5 x 7' });
  });

  it('strips internal keys from the built public catalog', () => {
    const built = buildPublicCatalog([attrRow(internal)], {
      publicPriceList: 'Retail',
      publicAttributeKeys: ['size'],
    });
    expect(built.items[0].attributes).toEqual({ size: '5 x 7' });
    const serialised = JSON.stringify(built);
    expect(serialised).not.toContain('sold 337');
    expect(serialised).not.toContain('data_flags');
  });

  it('leaves the full catalog complete — it is private and feeds Urdu output', () => {
    const built = buildFullCatalog([attrRow(internal)], {
      publicPriceList: 'Retail',
      publicAttributeKeys: ['size'],
    });
    expect(built.items[0].attributes).toEqual(internal);
  });

  it('is not publishable when every attribute is internal', () => {
    expect(isPublishable(attrRow({ notes: 'x' }), 'Retail', ['size'])).toBe(
      false,
    );
  });

  it('is publishable once a public attribute is present', () => {
    expect(isPublishable(attrRow({ size: '5 x 7' }), 'Retail', ['size'])).toBe(
      true,
    );
  });

  it('keeps internal values out of the products CSV', () => {
    const built = buildPublicCatalog([attrRow(internal)], {
      publicPriceList: 'Retail',
      publicAttributeKeys: ['size'],
    });
    const csv = toProductsCsv(built);
    expect(csv).toContain('5 x 7');
    expect(csv).not.toContain('sold 337');
  });
});

describe('excludeFromCatalog', () => {
  it('holds back an item that meets every other condition', () => {
    // the only case where the derived answer is wrong: everything is ready,
    // the business simply does not want it on sale
    const held = row({ excludeFromCatalog: true });
    expect(isPublishable(held, 'Retail', ['size_in'])).toBe(false);
    expect(
      isPublishable({ ...held, excludeFromCatalog: false }, 'Retail', [
        'size_in',
      ]),
    ).toBe(true);
  });

  it('keeps the item in the public catalog, marked unpublishable', () => {
    // it still has a public price, so a storefront that lists prices can show
    // it; what changes is that nothing treats it as ready to sell
    const built = buildPublicCatalog([row({ excludeFromCatalog: true })], {
      publicPriceList: 'Retail',
      publicAttributeKeys: ['size_in'],
    });
    expect(built.items).toHaveLength(1);
    expect(built.items[0].publishable).toBe(false);
  });

  it('is recorded in the full catalog for the business to see', () => {
    const built = buildFullCatalog([row({ excludeFromCatalog: true })], {
      publicPriceList: 'Retail',
      publicAttributeKeys: ['size_in'],
    });
    expect(built.items[0].excludeFromCatalog).toBe(true);
    expect(built.items[0].publishable).toBe(false);
  });

  it('does not resurrect an item that fails another condition', () => {
    const noImage = row({ excludeFromCatalog: false, hasImage: false });
    expect(isPublishable(noImage, 'Retail', ['size_in'])).toBe(false);
  });
});

describe('per-item publish state (the decision the badge shows)', () => {
  const blockersFor = (over: Partial<CatalogSourceRow>) => {
    const r = row(over);
    if (r.excludeFromCatalog) return ['held back'];
    const out: string[] = [];
    if (!r.hasImage) out.push('no image');
    if (publicPriceOf(r, 'Retail') === null) out.push('no public price');
    if (Object.keys(publicAttributesOf(r, ['size_in'])).length === 0) {
      out.push('no public attributes');
    }
    return out;
  };

  it('a ready item has no blockers', () => {
    expect(blockersFor({})).toEqual([]);
  });

  it('names every missing thing, not just the first', () => {
    expect(
      blockersFor({ hasImage: false, prices: {}, attributes: {} }),
    ).toEqual(['no image', 'no public price', 'no public attributes']);
  });

  it('held back outranks the other reasons', () => {
    // the item is complete; the business simply said no
    expect(blockersFor({ excludeFromCatalog: true })).toEqual(['held back']);
  });

  it('an item described only by internal keys counts as undescribed', () => {
    expect(blockersFor({ attributes: { notes: 'internal' } })).toEqual([
      'no public attributes',
    ]);
  });
});
