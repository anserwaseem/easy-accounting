import type { AttributeDefinition, InventoryItem } from 'types';
import {
  byListPosition,
  compareAttributeValues,
  countActiveFilters,
  countActiveInventoryFilters,
  emptyInventoryFilters,
  matchesInventoryFilters,
  distinctAttributeValues,
  formatAttributeValue,
  isAttributeUnset,
  matchesAttributeFilters,
  type AttributeFilters,
  type InventoryFilters,
} from '../inventoryQuery';

const def = (
  key: string,
  valueType: AttributeDefinition['valueType'],
): AttributeDefinition =>
  ({
    id: 1,
    key,
    label: key,
    unit: null,
    valueType,
    sortOrder: 1,
    isActive: 1,
  }) as AttributeDefinition;

const item = (attributes: Record<string, unknown>): InventoryItem =>
  ({ id: 1, name: 'X', price: 0, quantity: 0, attributes }) as InventoryItem;

const sortValues = (
  values: unknown[],
  valueType: AttributeDefinition['valueType'],
) => [...values].sort((a, b) => compareAttributeValues(a, b, valueType));

describe('isAttributeUnset', () => {
  it.each([null, undefined, ''])('treats %p as unset', (v) => {
    expect(isAttributeUnset(v)).toBe(true);
  });

  it.each([0, false, 'No'])('treats %p as a real value', (v) => {
    // 0 and false are answers, not absences; conflating them would hide items
    expect(isAttributeUnset(v)).toBe(false);
  });
});

describe('formatAttributeValue', () => {
  it('renders booleans as words', () => {
    expect(formatAttributeValue(true)).toBe('Yes');
    expect(formatAttributeValue(false)).toBe('No');
  });

  it('renders unset as an empty string', () => {
    expect(formatAttributeValue(null)).toBe('');
  });
});

describe('compareAttributeValues', () => {
  it('orders numbers numerically, not as text', () => {
    expect(sortValues([12, 9, 16, 10], 'number')).toEqual([9, 10, 12, 16]);
  });

  it('falls back to text when a number attribute holds non-numeric text', () => {
    const sorted = sortValues(['7.5 x 10', '7.5 x 11.5'], 'number');
    expect(sorted).toEqual(['7.5 x 10', '7.5 x 11.5']);
  });

  it('orders booleans No before Yes', () => {
    expect(sortValues([true, false], 'bool')).toEqual([false, true]);
  });

  it('sorts text naturally so 10 follows 9', () => {
    expect(sortValues(['Line 9', 'Line 10'], 'text')).toEqual([
      'Line 9',
      'Line 10',
    ]);
  });

  it('puts unset last regardless of the other value', () => {
    expect(compareAttributeValues(null, 5, 'number')).toBeGreaterThan(0);
    expect(compareAttributeValues(5, null, 'number')).toBeLessThan(0);
    expect(compareAttributeValues(null, null, 'number')).toBe(0);
  });

  it('keeps unset last after the list is reversed', () => {
    // a comparator that merely returned 1 for unset would flip it to the top
    // on descending sort, which is the bug this guards
    const ascending = sortValues([5, null, 9], 'number');
    expect(ascending[ascending.length - 1]).toBeNull();
  });
});

describe('distinctAttributeValues', () => {
  it('lists each present value once, in order, ignoring unset', () => {
    const items = [
      item({ lines: 16 }),
      item({ lines: 9 }),
      item({ lines: 16 }),
      item({ lines: null }),
    ];
    expect(distinctAttributeValues(items, def('lines', 'number'))).toEqual([
      '9',
      '16',
    ]);
  });
});

describe('matchesAttributeFilters', () => {
  const lines16NoBinding: AttributeFilters = {
    lines: { mode: 'value', value: '16' },
    binding: { mode: 'unset' },
  };

  it('answers "16-line items with no binding set"', () => {
    expect(matchesAttributeFilters(item({ lines: 16 }), lines16NoBinding)).toBe(
      true,
    );
    expect(
      matchesAttributeFilters(
        item({ lines: 16, binding: 'Golden Rexine' }),
        lines16NoBinding,
      ),
    ).toBe(false);
    expect(matchesAttributeFilters(item({ lines: 12 }), lines16NoBinding)).toBe(
      false,
    );
  });

  it('matches values by their displayed form, so 16 and "16" agree', () => {
    const filters: AttributeFilters = {
      lines: { mode: 'value', value: '16' },
    };
    expect(matchesAttributeFilters(item({ lines: 16 }), filters)).toBe(true);
    expect(matchesAttributeFilters(item({ lines: '16' }), filters)).toBe(true);
  });

  it('matches a boolean filter against its displayed word', () => {
    const filters: AttributeFilters = { zip: { mode: 'value', value: 'No' } };
    expect(matchesAttributeFilters(item({ zip: false }), filters)).toBe(true);
    expect(matchesAttributeFilters(item({ zip: true }), filters)).toBe(false);
    // unset is not the same as No, so it must not match
    expect(matchesAttributeFilters(item({}), filters)).toBe(false);
  });

  it('ignores filters set to any', () => {
    expect(matchesAttributeFilters(item({}), { lines: { mode: 'any' } })).toBe(
      true,
    );
  });
});

describe('countActiveFilters', () => {
  it('counts only the constraining ones', () => {
    expect(
      countActiveFilters({
        a: { mode: 'any' },
        b: { mode: 'unset' },
        c: { mode: 'value', value: '16' },
      }),
    ).toBe(2);
  });
});

describe('byListPosition', () => {
  const at = (id: number, listPosition: number | null) =>
    ({ id, name: `I${id}`, listPosition }) as unknown as InventoryItem;

  it('orders by list position with unnumbered items last', () => {
    const sorted = byListPosition([at(1, null), at(2, 778), at(3, 777)]);
    expect(sorted.map((i) => i.id)).toEqual([3, 2, 1]);
  });

  it('breaks ties by id so the order never wobbles between renders', () => {
    const sorted = byListPosition([at(9, 5), at(4, 5)]);
    expect(sorted.map((i) => i.id)).toEqual([4, 9]);
  });

  it('does not mutate the array it is given', () => {
    const input = [at(1, 2), at(2, 1)];
    byListPosition(input);
    expect(input.map((i) => i.id)).toEqual([1, 2]);
  });
});

describe('matchesInventoryFilters', () => {
  const withTitle = (title: string | null) =>
    ({ id: 1, name: 'X', title, attributes: {} }) as unknown as InventoryItem;
  const noState = () => undefined;

  it('passes everything through when nothing is set', () => {
    expect(
      matchesInventoryFilters(withTitle(null), emptyInventoryFilters, noState),
    ).toBe(true);
  });

  it('separates a set display title from one falling back to the item name', () => {
    const set: InventoryFilters = {
      ...emptyInventoryFilters,
      displayTitle: 'set',
    };
    const unset: InventoryFilters = {
      ...emptyInventoryFilters,
      displayTitle: 'unset',
    };
    expect(matchesInventoryFilters(withTitle('A name'), set, noState)).toBe(
      true,
    );
    expect(matchesInventoryFilters(withTitle(null), set, noState)).toBe(false);
    expect(matchesInventoryFilters(withTitle(''), unset, noState)).toBe(true);
    expect(matchesInventoryFilters(withTitle('A name'), unset, noState)).toBe(
      false,
    );
  });

  it('filters by publish state', () => {
    const filters: InventoryFilters = {
      ...emptyInventoryFilters,
      publish: 'not ready',
    };
    expect(
      matchesInventoryFilters(withTitle(null), filters, () => 'not ready'),
    ).toBe(true);
    expect(
      matchesInventoryFilters(withTitle(null), filters, () => 'ready'),
    ).toBe(false);
  });

  it('treats "not a candidate" as having no state at all', () => {
    const filters: InventoryFilters = {
      ...emptyInventoryFilters,
      publish: 'not a candidate',
    };
    expect(matchesInventoryFilters(withTitle(null), filters, noState)).toBe(
      true,
    );
    expect(
      matchesInventoryFilters(withTitle(null), filters, () => 'ready'),
    ).toBe(false);
  });

  it('combines attribute, title and publish choices with AND', () => {
    const item16 = {
      id: 1,
      name: 'X',
      title: null,
      attributes: { lines: 16 },
    } as unknown as InventoryItem;
    const filters: InventoryFilters = {
      attributes: { lines: { mode: 'value', value: '16' } },
      displayTitle: 'unset',
      publish: 'ready',
    };
    expect(matchesInventoryFilters(item16, filters, () => 'ready')).toBe(true);
    // one mismatch is enough to exclude
    expect(matchesInventoryFilters(item16, filters, () => 'not ready')).toBe(
      false,
    );
  });
});

describe('countActiveInventoryFilters', () => {
  it('counts attribute, publish and title choices together', () => {
    expect(countActiveInventoryFilters(emptyInventoryFilters)).toBe(0);
    expect(
      countActiveInventoryFilters({
        attributes: { a: { mode: 'unset' }, b: { mode: 'any' } },
        publish: 'ready',
        displayTitle: 'set',
      }),
    ).toBe(3);
  });
});
