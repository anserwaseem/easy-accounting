import {
  buildSeedPlan,
  roundToNearest,
  sampleSeedChanges,
  validateSeedOptions,
  type SeedInputRow,
  type SeedOptions,
} from '../priceSeeding';

const OPTS: SeedOptions = {
  source: 'base',
  multiplier: 1.2,
  roundTo: 10,
  overwriteExisting: false,
};

const rows: SeedInputRow[] = [
  { inventoryId: 1, name: 'A', basePrice: 900, currentPrice: null },
  { inventoryId: 2, name: 'B', basePrice: 780, currentPrice: null },
];

describe('roundToNearest', () => {
  it('rounds to the nearest multiple', () => {
    expect(roundToNearest(1134, 10)).toBe(1130);
    expect(roundToNearest(819, 10)).toBe(820);
    expect(roundToNearest(1119.6, 10)).toBe(1120);
  });
  it('rounds halves up', () => {
    expect(roundToNearest(1135, 10)).toBe(1140);
    expect(roundToNearest(2.5, 1)).toBe(3);
  });
  it('supports rounding to 1 and 5', () => {
    expect(roundToNearest(1134.4, 1)).toBe(1134);
    expect(roundToNearest(1134, 5)).toBe(1135);
  });
  it('falls back to whole numbers for a bad step', () => {
    expect(roundToNearest(1134.4, 0)).toBe(1134);
  });
});

describe('validateSeedOptions', () => {
  it('accepts sensible values', () => {
    expect(validateSeedOptions({ multiplier: 1.2, roundTo: 10 })).toEqual({
      ok: true,
      errors: [],
    });
  });
  it('rejects a non-positive multiplier', () => {
    expect(validateSeedOptions({ multiplier: 0, roundTo: 10 }).ok).toBe(false);
  });
  it('rejects fractional or non-positive rounding', () => {
    expect(validateSeedOptions({ multiplier: 1, roundTo: 2.5 }).ok).toBe(false);
    expect(validateSeedOptions({ multiplier: 1, roundTo: 0 }).ok).toBe(false);
  });
});

describe('buildSeedPlan — bootstrapping from the base price', () => {
  it('computes multiplied, rounded prices', () => {
    const plan = buildSeedPlan(rows, OPTS);
    expect(plan.changes).toEqual([
      { inventoryId: 1, name: 'A', from: null, to: 1080 },
      { inventoryId: 2, name: 'B', from: null, to: 940 },
    ]);
  });

  it('skips items whose base price is zero (cannot derive a price)', () => {
    const plan = buildSeedPlan(
      [{ inventoryId: 3, name: 'C', basePrice: 0, currentPrice: null }],
      OPTS,
    );
    expect(plan.changes).toEqual([]);
    expect(plan.skippedNoSource).toBe(1);
  });

  it('leaves existing prices alone unless overwrite is on', () => {
    const withExisting: SeedInputRow[] = [
      { inventoryId: 1, name: 'A', basePrice: 900, currentPrice: 1000 },
    ];
    expect(buildSeedPlan(withExisting, OPTS).skippedExisting).toBe(1);
    expect(
      buildSeedPlan(withExisting, { ...OPTS, overwriteExisting: true }).changes,
    ).toEqual([{ inventoryId: 1, name: 'A', from: 1000, to: 1080 }]);
  });

  it('is safe to re-run: a second pass changes nothing', () => {
    const first = buildSeedPlan(rows, OPTS);
    const seeded: SeedInputRow[] = rows.map((r, i) => ({
      ...r,
      currentPrice: first.changes[i].to,
    }));
    const second = buildSeedPlan(seeded, OPTS);
    expect(second.changes).toEqual([]);
    expect(second.skippedExisting).toBe(2);
  });
});

describe('buildSeedPlan — revising an existing list', () => {
  const seeded: SeedInputRow[] = [
    { inventoryId: 1, name: 'A', basePrice: 900, currentPrice: 1080 },
    { inventoryId: 2, name: 'B', basePrice: 780, currentPrice: 780 },
  ];
  const revise: SeedOptions = {
    source: 'list',
    multiplier: 1.05,
    roundTo: 10,
    overwriteExisting: true,
  };

  it('applies the factor to the current list price, not the base price', () => {
    expect(buildSeedPlan(seeded, revise).changes).toEqual([
      { inventoryId: 1, name: 'A', from: 1080, to: 1130 },
      { inventoryId: 2, name: 'B', from: 780, to: 820 },
    ]);
  });

  it('skips rows with no price on the list yet', () => {
    const plan = buildSeedPlan(
      [{ inventoryId: 9, name: 'Z', basePrice: 500, currentPrice: null }],
      revise,
    );
    expect(plan.changes).toEqual([]);
    expect(plan.skippedNoSource).toBe(1);
  });

  it('counts rows whose rounded price does not move as unchanged', () => {
    const plan = buildSeedPlan(
      [{ inventoryId: 1, name: 'A', basePrice: 100, currentPrice: 1000 }],
      {
        source: 'list',
        multiplier: 1.001,
        roundTo: 10,
        overwriteExisting: true,
      },
    );
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });
});

describe('sampleSeedChanges', () => {
  it('returns a few representative pairs for the preview', () => {
    const many: SeedInputRow[] = Array.from({ length: 10 }, (_, i) => ({
      inventoryId: i + 1,
      name: `I${i}`,
      basePrice: 100 * (i + 1),
      currentPrice: null,
    }));
    expect(sampleSeedChanges(buildSeedPlan(many, OPTS))).toHaveLength(3);
  });
});
