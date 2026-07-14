import type { InventoryItem } from 'types';
import {
  buildBulkPriceListPatches,
  countDirtyDraftRows,
  getDraftDisplayValue,
  isDraftRowDirty,
  parseListPositionInput,
  parsePriceInput,
  resolveNextBulkEditTarget,
} from '../inventoryBulkEdit';

const row = (
  partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>,
): InventoryItem => ({
  id: partial.id,
  name: partial.name,
  price: partial.price ?? 10,
  quantity: partial.quantity ?? 0,
  description: partial.description,
  itemTypeId: partial.itemTypeId ?? null,
  itemTypeName: partial.itemTypeName ?? null,
  listPosition: partial.listPosition ?? null,
});

describe('inventoryBulkEdit parsers', () => {
  it('parses price and rejects invalid', () => {
    expect(parsePriceInput('12.5')).toEqual({ ok: true, value: 12.5 });
    expect(parsePriceInput('0')).toEqual({ ok: true, value: 0 });
    expect(parsePriceInput('').ok).toBe(false);
    expect(parsePriceInput('-1').ok).toBe(false);
  });

  it('parses list # empty as null', () => {
    expect(parseListPositionInput('')).toEqual({ ok: true, value: null });
    expect(parseListPositionInput('  ')).toEqual({ ok: true, value: null });
    expect(parseListPositionInput('3')).toEqual({ ok: true, value: 3 });
    expect(parseListPositionInput('1.5').ok).toBe(false);
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
});
