import {
  buildFullCatalog,
  buildPublicCatalog,
  isPublishable,
  missingRequiredAttributes,
  parseAttributeKeyList,
  publicAttributesOf,
  publicPriceOf,
  publishBlockers,
  toProductsCsv,
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
    expect(isPublishable(row(), OPTS)).toBe(true);
  });
  it('false without attributes', () => {
    expect(isPublishable(row({ attributes: {} }), OPTS)).toBe(false);
  });
  it('false without an image', () => {
    expect(isPublishable(row({ hasImage: false }), OPTS)).toBe(false);
  });
  it('false without a public price', () => {
    expect(isPublishable(row({ prices: { Wholesale: 700 } }), OPTS)).toBe(
      false,
    );
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
    expect(
      isPublishable(attrRow({ notes: 'x' }), {
        publicPriceList: 'Retail',
        publicAttributeKeys: ['size'],
      }),
    ).toBe(false);
  });

  it('is publishable once a public attribute is present', () => {
    expect(
      isPublishable(attrRow({ size: '5 x 7' }), {
        publicPriceList: 'Retail',
        publicAttributeKeys: ['size'],
      }),
    ).toBe(true);
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
    expect(
      isPublishable(held, {
        publicPriceList: 'Retail',
        publicAttributeKeys: ['size_in'],
      }),
    ).toBe(false);
    expect(
      isPublishable(
        { ...held, excludeFromCatalog: false },
        { publicPriceList: 'Retail', publicAttributeKeys: ['size_in'] },
      ),
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
    expect(
      isPublishable(noImage, {
        publicPriceList: 'Retail',
        publicAttributeKeys: ['size_in'],
      }),
    ).toBe(false);
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

describe('requireImage (standing the catalogue up before photography)', () => {
  const noPhoto = (): CatalogSourceRow => ({
    sku: 'S-23-G',
    name: 'S-23-G',
    parentSku: null,
    basePrice: 900,
    quantity: 5,
    attributes: { lines: 16 },
    prices: { Retail: 1080 },
    hasImage: false,
    excludeFromCatalog: false,
  });

  it('withholds an unphotographed item by default', () => {
    expect(
      isPublishable(noPhoto(), {
        publicPriceList: 'Retail',
        publicAttributeKeys: ['lines'],
      }),
    ).toBe(false);
  });

  it('publishes it when the image requirement is relaxed', () => {
    expect(
      isPublishable(noPhoto(), {
        publicPriceList: 'Retail',
        publicAttributeKeys: ['lines'],
        requireImage: false,
      }),
    ).toBe(true);
  });

  it('still withholds one held back by hand', () => {
    // relaxing the image gate must not override an explicit exclusion
    const r = { ...noPhoto(), excludeFromCatalog: true };
    expect(
      isPublishable(r, {
        publicPriceList: 'Retail',
        publicAttributeKeys: ['lines'],
        requireImage: false,
      }),
    ).toBe(false);
  });

  it('still withholds one with no public price', () => {
    const r = { ...noPhoto(), prices: {} };
    expect(
      isPublishable(r, {
        publicPriceList: 'Retail',
        publicAttributeKeys: ['lines'],
        requireImage: false,
      }),
    ).toBe(false);
  });

  it('still withholds one with no public attributes', () => {
    expect(
      isPublishable(noPhoto(), {
        publicPriceList: 'Retail',
        publicAttributeKeys: [],
        requireImage: false,
      }),
    ).toBe(false);
  });

  it('keeps hasImage truthful so photography debt stays visible', () => {
    // the whole point of a flag over placeholder images
    const pub = buildPublicCatalog([noPhoto()], {
      publicPriceList: 'Retail',
      publicAttributeKeys: ['lines'],
      requireImage: false,
    });
    expect(pub.items[0].publishable).toBe(true);
    expect(pub.items[0].hasImage).toBe(false);
  });

  it('defaults to requiring an image when the option is omitted', () => {
    const pub = buildPublicCatalog([noPhoto()], {
      publicPriceList: 'Retail',
      publicAttributeKeys: ['lines'],
    });
    expect(pub.items[0].publishable).toBe(false);
  });
});

describe('requiredAttributeKeys (a structural attribute is not optional)', () => {
  const typed = (over: Partial<CatalogSourceRow> = {}): CatalogSourceRow => ({
    sku: 'S-23-G',
    name: 'S-23-G',
    parentSku: null,
    basePrice: 900,
    quantity: 5,
    attributes: { lines: 16, product_type: 'Quran' },
    prices: { Retail: 1080 },
    hasImage: true,
    excludeFromCatalog: false,
    ...over,
  });

  it('publishes when every required key is present', () => {
    expect(
      isPublishable(typed(), {
        publicPriceList: 'Retail',
        publicAttributeKeys: ['lines'],
        requireImage: true,
        requiredAttributeKeys: ['product_type'],
      }),
    ).toBe(true);
  });

  it('withholds an item missing a required key', () => {
    // the whole point: without it the item is filed under a default and looks
    // correct while being wrong
    const item = typed({ attributes: { lines: 16 } });
    expect(
      isPublishable(item, {
        publicPriceList: 'Retail',
        publicAttributeKeys: ['lines'],
        requireImage: true,
        requiredAttributeKeys: ['product_type'],
      }),
    ).toBe(false);
  });

  it('treats an empty value as missing', () => {
    const item = typed({ attributes: { lines: 16, product_type: '' } });
    expect(
      isPublishable(item, {
        publicPriceList: 'Retail',
        publicAttributeKeys: ['lines'],
        requireImage: true,
        requiredAttributeKeys: ['product_type'],
      }),
    ).toBe(false);
  });

  it('requires nothing when the list is empty', () => {
    const item = typed({ attributes: { lines: 16 } });
    expect(
      isPublishable(item, {
        publicPriceList: 'Retail',
        publicAttributeKeys: ['lines'],
        requireImage: true,
        requiredAttributeKeys: [],
      }),
    ).toBe(true);
  });

  it('names each missing key so the fix is obvious', () => {
    const item = typed({ attributes: { lines: 16 } });
    expect(
      missingRequiredAttributes(item, ['product_type', 'weight_kg']),
    ).toEqual(['product_type', 'weight_kg']);
  });

  it('reports nothing missing for a complete row', () => {
    expect(missingRequiredAttributes(typed(), ['product_type'])).toEqual([]);
  });
});

describe('parseAttributeKeyList', () => {
  it('splits on commas', () => {
    expect(parseAttributeKeyList('product_type, weight_kg')).toEqual([
      'product_type',
      'weight_kg',
    ]);
  });

  it('splits on whitespace too, so either style works', () => {
    expect(parseAttributeKeyList('product_type weight_kg')).toEqual([
      'product_type',
      'weight_kg',
    ]);
  });

  it('drops blanks from trailing separators', () => {
    expect(parseAttributeKeyList('product_type,,  ,')).toEqual([
      'product_type',
    ]);
  });

  it('an empty setting requires nothing', () => {
    expect(parseAttributeKeyList('')).toEqual([]);
  });
});

describe('publishBlockers is the single definition', () => {
  const OPTIONS = {
    publicPriceList: 'Retail',
    publicAttributeKeys: ['lines'],
    requiredAttributeKeys: ['product_type'],
  };
  const base = (over: Partial<CatalogSourceRow> = {}): CatalogSourceRow => ({
    sku: 'S-23-G',
    name: 'S-23-G',
    parentSku: null,
    basePrice: 900,
    quantity: 5,
    attributes: { lines: 16, product_type: 'Quran' },
    prices: { Retail: 1080 },
    hasImage: true,
    excludeFromCatalog: false,
    ...over,
  });

  it('a ready item has no blockers', () => {
    expect(publishBlockers(base(), OPTIONS)).toEqual([]);
  });

  it('the verdict always agrees with the reasons', () => {
    // the property that was violated when the rule existed twice
    const rows = [
      base(),
      base({ hasImage: false }),
      base({ prices: {} }),
      base({ attributes: {} }),
      base({ attributes: { lines: 16 } }),
      base({ prices: {}, hasImage: false }),
    ];
    for (const r of rows) {
      expect(isPublishable(r, OPTIONS)).toBe(
        publishBlockers(r, OPTIONS).length === 0,
      );
    }
  });

  it('reports every reason at once, not just the first', () => {
    const broken = base({ hasImage: false, prices: {}, attributes: {} });
    expect(publishBlockers(broken, OPTIONS).sort()).toEqual(
      [
        'missing product_type',
        'no image',
        'no public attributes',
        'no public price',
      ].sort(),
    );
  });

  it('holding an item back is not a blocker', () => {
    // "held back" is a decision, not a deficiency — the item may be perfect
    const held = base({ excludeFromCatalog: true });
    expect(publishBlockers(held, OPTIONS)).toEqual([]);
    expect(isPublishable(held, OPTIONS)).toBe(false);
  });

  it('drops the image blocker when the requirement is relaxed', () => {
    expect(
      publishBlockers(base({ hasImage: false }), {
        ...OPTIONS,
        requireImage: false,
      }),
    ).toEqual([]);
  });
});
