import type { InventoryItem } from 'types';
import {
  buildBulkEditChangeSummary,
  buildBulkPriceListPatches,
  countDirtyDraftRows,
  getDraftDisplayValue,
  isDraftRowDirty,
  parseFamilyParentInput,
  parseListPositionInput,
  parsePriceInput,
  parseDescriptionInput,
  resolveNextBulkEditTarget,
  priceListCol,
  priceListIdOfCol,
  parseListPriceInput,
  buildInventoryBulkEditCols,
} from '../inventoryBulkEdit';

const row = (
  partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>,
): InventoryItem => ({
  id: partial.id,
  name: partial.name,
  price: partial.price ?? 10,
  quantity: partial.quantity ?? 0,
  description: partial.description,
  descriptionUrdu: partial.descriptionUrdu,
  itemTypeId: partial.itemTypeId ?? null,
  itemTypeName: partial.itemTypeName ?? null,
  listPosition: partial.listPosition ?? null,
  parentId: partial.parentId ?? null,
});

describe('inventoryBulkEdit parsers', () => {
  it('parses price and rejects invalid', () => {
    expect(parsePriceInput('12.5')).toEqual({ ok: true, value: 12.5 });
    expect(parsePriceInput('0')).toEqual({ ok: true, value: 0 });
    expect(parsePriceInput('').ok).toBe(false);
    expect(parsePriceInput('-1').ok).toBe(false);
  });

  it('parses list # empty as null and rejects negatives', () => {
    expect(parseListPositionInput('')).toEqual({ ok: true, value: null });
    expect(parseListPositionInput('  ')).toEqual({ ok: true, value: null });
    expect(parseListPositionInput('3')).toEqual({ ok: true, value: 3 });
    expect(parseListPositionInput('0')).toEqual({ ok: true, value: 0 });
    expect(parseListPositionInput('1.5')).toEqual({
      ok: false,
      error: 'List # must be a non-negative whole number',
    });
    expect(parseListPositionInput('-1')).toEqual({
      ok: false,
      error: 'List # must be a non-negative whole number',
    });
  });

  it('parses family head ids and empty as no family', () => {
    expect(parseFamilyParentInput('')).toEqual({ ok: true, value: null });
    expect(parseFamilyParentInput('12')).toEqual({ ok: true, value: 12 });
    expect(parseFamilyParentInput('0').ok).toBe(false);
    expect(parseFamilyParentInput('x').ok).toBe(false);
  });

  it('parses description empty as null and trims', () => {
    expect(parseDescriptionInput('')).toEqual({ ok: true, value: null });
    expect(parseDescriptionInput('  ')).toEqual({ ok: true, value: null });
    expect(parseDescriptionInput('  hello  ')).toEqual({
      ok: true,
      value: 'hello',
    });
  });
});

describe('inventoryBulkEdit draft dirty + patches', () => {
  const a = row({ id: 1, name: 'A', price: 10, listPosition: 1 });
  const b = row({ id: 2, name: 'B', price: 20, listPosition: 2 });

  it('detects dirty only when value differs', () => {
    expect(isDraftRowDirty(a, { price: '10' })).toBe(false);
    expect(isDraftRowDirty(a, { price: '11' })).toBe(true);
    expect(isDraftRowDirty(a, { listPosition: '1' })).toBe(false);
    expect(isDraftRowDirty(a, { listPosition: '' })).toBe(true);
  });

  it('builds dirty-only patches and hydrates display from draft', () => {
    const originals = new Map([
      [a.id, a],
      [b.id, b],
    ]);
    const draft = new Map([
      [a.id, { price: '15' }],
      [b.id, { price: '20', listPosition: '2' }],
    ]);

    expect(countDirtyDraftRows(originals, draft)).toBe(1);
    expect(getDraftDisplayValue(a, 'price', draft.get(a.id))).toBe('15');

    const built = buildBulkPriceListPatches(originals, draft);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.patches).toEqual([{ id: 1, price: 15, listPosition: 1 }]);
  });

  it('returns error when dirty cell invalid', () => {
    const originals = new Map([[a.id, a]]);
    const draft = new Map([[a.id, { price: 'nope' }]]);
    const built = buildBulkPriceListPatches(originals, draft);
    expect(built.ok).toBe(false);
  });

  it('builds family-only patches and labels summary with head names', () => {
    const head = row({ id: 10, name: 'Family A' });
    const variant = row({ id: 11, name: 'Variant', parentId: null });
    const originals = new Map([
      [head.id, head],
      [variant.id, variant],
    ]);
    const built = buildBulkPriceListPatches(
      originals,
      new Map([[variant.id, { parentId: '10' }]]),
    );
    expect(built).toEqual({
      ok: true,
      patches: [
        {
          id: 11,
          price: 10,
          listPosition: null,
          parentId: 10,
        },
      ],
    });
    if (!built.ok) return;
    const summary = buildBulkEditChangeSummary(originals, built.patches);
    expect(summary.hasFamilyChanges).toBe(true);
    expect(summary.rows[0]).toMatchObject({
      familyFrom: 'None',
      familyTo: 'Family A',
    });
  });

  it('builds description-only patches and summary labels', () => {
    const item = row({
      id: 1,
      name: 'A',
      description: 'old',
      descriptionUrdu: 'قدیم',
    });
    const originals = new Map([[item.id, item]]);
    const built = buildBulkPriceListPatches(
      originals,
      new Map([[item.id, { description: 'new', descriptionUrdu: '  ' }]]),
    );
    expect(built).toEqual({
      ok: true,
      patches: [
        {
          id: 1,
          price: 10,
          listPosition: null,
          description: 'new',
          descriptionUrdu: null,
        },
      ],
    });
    if (!built.ok) return;
    const summary = buildBulkEditChangeSummary(originals, built.patches);
    expect(summary.hasDescriptionChanges).toBe(true);
    expect(summary.hasDescriptionUrduChanges).toBe(true);
    expect(summary.rows[0]).toMatchObject({
      descriptionFrom: 'old',
      descriptionTo: 'new',
      descriptionUrduFrom: 'قدیم',
      descriptionUrduTo: '—',
    });
  });

  it('does not mark description dirty when trim equals stored', () => {
    const item = row({ id: 1, name: 'A', description: 'same' });
    expect(isDraftRowDirty(item, { description: '  same  ' })).toBe(false);
    expect(isDraftRowDirty(item, { description: 'other' })).toBe(true);
  });

  it('rejects negative list # in patches', () => {
    const originals = new Map([[a.id, a]]);
    const draft = new Map([[a.id, { listPosition: '-3' }]]);
    const built = buildBulkPriceListPatches(originals, draft);
    expect(built).toEqual({
      ok: false,
      error: expect.stringMatching(/non-negative/),
    });
  });

  it('builds one summary row per item with only changed fields', () => {
    const originals = new Map([
      [a.id, a],
      [b.id, b],
    ]);
    const summary = buildBulkEditChangeSummary(originals, [
      { id: 1, price: 15, listPosition: 1 },
      { id: 2, price: 20, listPosition: null },
    ]);
    expect(summary.itemCount).toBe(2);
    expect(summary.hasPriceChanges).toBe(true);
    expect(summary.hasListChanges).toBe(true);
    expect(summary.rows).toEqual([
      { id: 1, name: 'A', priceFrom: 10, priceTo: 15 },
      { id: 2, name: 'B', listFrom: 2, listTo: null },
    ]);
    expect(summary.truncatedCount).toBe(0);
  });

  it('truncates long change summaries by item row', () => {
    const originals = new Map<number, InventoryItem>();
    const patches: Array<{
      id: number;
      price: number;
      listPosition: number | null;
    }> = [];
    for (let i = 1; i <= 30; i++) {
      originals.set(
        i,
        row({ id: i, name: `Item ${i}`, price: 1, listPosition: i }),
      );
      patches.push({ id: i, price: 2, listPosition: i });
    }
    const summary = buildBulkEditChangeSummary(originals, patches, 5);
    expect(summary.rows).toHaveLength(5);
    expect(summary.truncatedCount).toBe(25);
    expect(summary.itemCount).toBe(30);
  });
});

describe('resolveNextBulkEditTarget', () => {
  const rows = [
    row({ id: 1, name: 'A' }),
    row({ id: 2, name: 'B' }),
    row({ id: 3, name: 'C' }),
  ];

  it('moves down same column and left/right between list # and price', () => {
    expect(
      resolveNextBulkEditTarget(rows, 1, 'price', 'ArrowDown', false),
    ).toEqual({ inventoryId: 2, col: 'price', rowIndex: 1 });

    expect(
      resolveNextBulkEditTarget(rows, 2, 'price', 'ArrowLeft', false),
    ).toEqual({ inventoryId: 2, col: 'listPosition', rowIndex: 1 });

    expect(
      resolveNextBulkEditTarget(rows, 2, 'listPosition', 'ArrowRight', false),
    ).toEqual({ inventoryId: 2, col: 'price', rowIndex: 1 });
  });

  it('tabs across columns then to next row', () => {
    expect(
      resolveNextBulkEditTarget(rows, 1, 'listPosition', 'Tab', false),
    ).toEqual({ inventoryId: 1, col: 'price', rowIndex: 0 });

    expect(resolveNextBulkEditTarget(rows, 1, 'price', 'Tab', false)).toEqual({
      inventoryId: 2,
      col: 'listPosition',
      rowIndex: 1,
    });
  });

  it('returns null at grid Tab / Shift+Tab edges', () => {
    expect(
      resolveNextBulkEditTarget(rows, 3, 'price', 'Tab', false),
    ).toBeNull();
    expect(
      resolveNextBulkEditTarget(rows, 1, 'listPosition', 'Tab', true),
    ).toBeNull();
  });

  it('tabs through visible description columns when provided', () => {
    const cols = buildInventoryBulkEditCols({
      showListPosition: true,
      showDescription: true,
      showDescriptionUrdu: true,
      priceListIds: [],
    });
    expect(cols).toEqual([
      'listPosition',
      'description',
      'descriptionUrdu',
      'price',
    ]);
    expect(
      resolveNextBulkEditTarget(rows, 1, 'listPosition', 'Tab', false, cols),
    ).toEqual({ inventoryId: 1, col: 'description', rowIndex: 0 });
    expect(
      resolveNextBulkEditTarget(rows, 1, 'description', 'Tab', false, cols),
    ).toEqual({ inventoryId: 1, col: 'descriptionUrdu', rowIndex: 0 });
  });
});

describe('price list columns', () => {
  const priceRow = (over: Partial<InventoryItem> = {}): InventoryItem =>
    ({
      id: 1,
      name: 'S-23-G',
      price: 900,
      quantity: 5,
      listPosition: 3,
      listPrices: { 1: 1080 },
      ...over,
    }) as InventoryItem;

  it('builds and parses the column id', () => {
    expect(priceListCol(7)).toBe('list:7');
    expect(priceListIdOfCol('list:7')).toBe(7);
    expect(priceListIdOfCol('price')).toBeNull();
    expect(priceListIdOfCol('listPosition')).toBeNull();
  });

  it('shows the stored list price, or blank when unpriced', () => {
    expect(getDraftDisplayValue(priceRow(), 'list:1', undefined)).toBe('1080');
    expect(getDraftDisplayValue(priceRow(), 'list:2', undefined)).toBe('');
  });

  it('prefers the typed draft value over the stored one', () => {
    expect(
      getDraftDisplayValue(priceRow(), 'list:1', { listPrices: { 1: '1120' } }),
    ).toBe('1120');
  });

  it('treats an empty list price as clearing it', () => {
    expect(parseListPriceInput('')).toEqual({ ok: true, value: null });
    expect(parseListPriceInput('1120')).toEqual({ ok: true, value: 1120 });
    expect(parseListPriceInput('-5').ok).toBe(false);
    expect(parseListPriceInput('abc').ok).toBe(false);
  });

  it('marks a row dirty only when a list price actually changes', () => {
    expect(isDraftRowDirty(priceRow(), { listPrices: { 1: '1080' } })).toBe(
      false,
    );
    expect(isDraftRowDirty(priceRow(), { listPrices: { 1: '1120' } })).toBe(
      true,
    );
    expect(isDraftRowDirty(priceRow(), { listPrices: { 1: '' } })).toBe(true);
    expect(isDraftRowDirty(priceRow(), { listPrices: { 2: '500' } })).toBe(
      true,
    );
  });

  it('emits only changed list prices in the patch', () => {
    const originals = new Map([[1, priceRow()]]);
    const drafts = new Map([[1, { listPrices: { 1: '1120', 2: '640' } }]]);
    const built = buildBulkPriceListPatches(originals, drafts);
    if (!built.ok) throw new Error(built.error);
    expect(built.patches[0].listPrices).toEqual([
      { priceListId: 1, price: 1120 },
      { priceListId: 2, price: 640 },
    ]);
    // base price and list # are carried through unchanged
    expect(built.patches[0].price).toBe(900);
    expect(built.patches[0].listPosition).toBe(3);
  });

  it('emits a null price to clear an item from a list', () => {
    const built = buildBulkPriceListPatches(
      new Map([[1, priceRow()]]),
      new Map([[1, { listPrices: { 1: '' } }]]),
    );
    if (!built.ok) throw new Error(built.error);
    expect(built.patches[0].listPrices).toEqual([
      { priceListId: 1, price: null },
    ]);
  });

  it('reports an invalid list price with the item name', () => {
    const built = buildBulkPriceListPatches(
      new Map([[1, priceRow()]]),
      new Map([[1, { listPrices: { 1: 'abc' } }]]),
    );
    expect(built.ok).toBe(false);
    expect(built.ok ? '' : built.error).toContain('S-23-G');
  });
});
