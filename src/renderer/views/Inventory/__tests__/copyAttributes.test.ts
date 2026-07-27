import type { AttributeDefinition, InventoryItem } from 'types';
import {
  applyCopyPlan,
  discriminatingKeys,
  groupCandidates,
  headerCheckedValue,
  selectionState,
  summaryOf,
  toggleAll,
  buildCopyPlan,
  countChanges,
  defaultSelection,
  displayValue,
  isSameFamily,
  matchesSearch,
  rankCandidates,
} from '../copyAttributes';

const def = (
  key: string,
  label: string,
  valueType: AttributeDefinition['valueType'] = 'text',
): AttributeDefinition => ({
  id: key.length,
  key,
  label,
  unit: null,
  valueType,
  sortOrder: 1,
  isActive: 1,
  isPublic: 1,
});

const DEFS = [
  def('size_in', 'Paper size'),
  def('lines', 'Lines per page', 'number'),
  def('binding', 'Binding'),
  def('zip', 'Zip cover', 'bool'),
];

const item = (over: Partial<InventoryItem> = {}): InventoryItem =>
  ({
    id: 1,
    name: 'S-23-S',
    price: 1080,
    quantity: 64,
    parentId: 100,
    attributes: {},
    ...over,
  }) as InventoryItem;

// the real case: S-23-D is S-23-S with a different binding
const SOURCE = item({
  id: 2,
  name: 'S-23-D',
  parentId: 100,
  attributes: {
    size_in: '5.75 x 9',
    lines: 16,
    binding: 'Die-cut Pocket Style',
    zip: false,
  },
});

describe('displayValue', () => {
  it('renders numbers as text for the form', () => {
    expect(displayValue(16)).toBe('16');
  });

  it('renders true as the checkbox truthy string and false as empty', () => {
    expect(displayValue(true)).toBe('true');
    expect(displayValue(false)).toBe('');
  });

  it('treats null and undefined as empty', () => {
    expect(displayValue(null)).toBe('');
    expect(displayValue(undefined)).toBe('');
  });
});

describe('buildCopyPlan', () => {
  it('marks empty fields as fill', () => {
    const rows = buildCopyPlan(DEFS, {}, SOURCE);
    expect(rows.map((r) => [r.key, r.action])).toEqual([
      ['size_in', 'fill'],
      ['lines', 'fill'],
      ['binding', 'fill'],
    ]);
  });

  it('marks a differing value as overwrite, not fill', () => {
    const rows = buildCopyPlan(DEFS, { binding: 'Velvet' }, SOURCE);
    expect(rows.find((r) => r.key === 'binding')?.action).toBe('overwrite');
  });

  it('marks an identical value as same', () => {
    const rows = buildCopyPlan(DEFS, { size_in: '5.75 x 9' }, SOURCE);
    expect(rows.find((r) => r.key === 'size_in')?.action).toBe('same');
  });

  it('omits attributes the source cannot supply', () => {
    // zip is false on the source, so there is nothing to copy
    const keys = buildCopyPlan(DEFS, {}, SOURCE).map((r) => r.key);
    expect(keys).not.toContain('zip');
  });

  it('carries both sides so the preview can show them', () => {
    const row = buildCopyPlan(DEFS, { binding: 'Velvet' }, SOURCE).find(
      (r) => r.key === 'binding',
    );
    expect(row?.current).toBe('Velvet');
    expect(row?.incoming).toBe('Die-cut Pocket Style');
  });

  it('uses the definition label, not the storage key', () => {
    const row = buildCopyPlan(DEFS, {}, SOURCE)[0];
    expect(row.label).toBe('Paper size');
  });
});

describe('defaultSelection', () => {
  it('preselects fills', () => {
    const rows = buildCopyPlan(DEFS, {}, SOURCE);
    expect(defaultSelection(rows).size).toBe(3);
  });

  it('never preselects an overwrite', () => {
    // the whole point: S-23-S's velvet binding must survive a careless copy
    const rows = buildCopyPlan(DEFS, { binding: 'Velvet' }, SOURCE);
    expect(defaultSelection(rows).has('binding')).toBe(false);
  });

  it('never preselects a no-op', () => {
    const rows = buildCopyPlan(DEFS, { size_in: '5.75 x 9' }, SOURCE);
    expect(defaultSelection(rows).has('size_in')).toBe(false);
  });
});

describe('applyCopyPlan', () => {
  it('fills only the selected rows', () => {
    const rows = buildCopyPlan(DEFS, {}, SOURCE);
    const next = applyCopyPlan({}, rows, new Set(['size_in']));
    expect(next).toEqual({ size_in: '5.75 x 9' });
  });

  it('leaves unselected overwrites untouched', () => {
    const current = { binding: 'Velvet' };
    const rows = buildCopyPlan(DEFS, current, SOURCE);
    const next = applyCopyPlan(current, rows, defaultSelection(rows));
    expect(next.binding).toBe('Velvet');
    expect(next.size_in).toBe('5.75 x 9');
  });

  it('does not mutate the values it was given', () => {
    const current = { binding: 'Velvet' };
    const rows = buildCopyPlan(DEFS, current, SOURCE);
    applyCopyPlan(current, rows, new Set(['binding']));
    expect(current).toEqual({ binding: 'Velvet' });
  });

  it('replaces when an overwrite is explicitly chosen', () => {
    const current = { binding: 'Velvet' };
    const rows = buildCopyPlan(DEFS, current, SOURCE);
    expect(applyCopyPlan(current, rows, new Set(['binding'])).binding).toBe(
      'Die-cut Pocket Style',
    );
  });
});

describe('countChanges', () => {
  it('ignores rows that would change nothing', () => {
    const rows = buildCopyPlan(DEFS, { size_in: '5.75 x 9' }, SOURCE);
    const all = new Set(rows.map((r) => r.key));
    expect(countChanges(rows, all)).toBe(2); // lines + binding, not size_in
  });

  it('is zero when nothing is selected', () => {
    expect(countChanges(buildCopyPlan(DEFS, {}, SOURCE), new Set())).toBe(0);
  });
});

describe('rankCandidates', () => {
  const target = item({ id: 1, parentId: 100 });

  it('excludes the item being edited', () => {
    const ranked = rankCandidates([target, SOURCE], target);
    expect(ranked.map((c) => c.id)).toEqual([2]);
  });

  it('excludes items with nothing to copy', () => {
    const bare = item({ id: 3, name: 'S-99', attributes: {} });
    expect(rankCandidates([bare, SOURCE], target).map((c) => c.id)).toEqual([
      2,
    ]);
  });

  it('puts family members first', () => {
    const outsider = item({
      id: 4,
      name: 'A-1',
      parentId: 999,
      attributes: { size_in: '3 x 5', lines: 11, binding: 'X' },
    });
    const ranked = rankCandidates([outsider, SOURCE], target);
    expect(ranked.map((c) => c.name)).toEqual(['S-23-D', 'A-1']);
  });

  it('prefers the fuller source within a family', () => {
    const sparse = item({
      id: 5,
      name: 'S-23-X',
      parentId: 100,
      attributes: { size_in: '5.75 x 9' },
    });
    const ranked = rankCandidates([sparse, SOURCE], target);
    expect(ranked.map((c) => c.name)).toEqual(['S-23-D', 'S-23-X']);
  });
});

describe('isSameFamily', () => {
  it('matches children of the same head', () => {
    expect(isSameFamily(SOURCE, item({ id: 1, parentId: 100 }))).toBe(true);
  });

  it('treats a head item as its own family', () => {
    const head = item({ id: 100, parentId: null });
    expect(isSameFamily(SOURCE, head)).toBe(true);
  });

  it('separates unrelated items', () => {
    expect(isSameFamily(SOURCE, item({ id: 9, parentId: 999 }))).toBe(false);
  });
});

describe('matchesSearch', () => {
  it('matches case-insensitively', () => {
    expect(matchesSearch(SOURCE, 's-23')).toBe(true);
  });

  it('matches everything when the box is empty', () => {
    expect(matchesSearch(SOURCE, '   ')).toBe(true);
  });

  it('rejects a non-match', () => {
    expect(matchesSearch(SOURCE, 'A-1')).toBe(false);
  });
});

// a family: same size/lines/paper, different bindings — the real shape
const FAMILY = [
  SOURCE,
  item({
    id: 6,
    name: 'S-23-G',
    parentId: 100,
    attributes: {
      size_in: '5.75 x 9',
      lines: 16,
      binding: 'Golden Rexine + Gilt Edge',
    },
  }),
  item({
    id: 7,
    name: 'S-23-Z',
    parentId: 100,
    attributes: {
      size_in: '5.75 x 9',
      lines: 16,
      binding: 'Golden Embossed + Zip',
    },
  }),
];

describe('discriminatingKeys', () => {
  it('picks the attribute that varies, not the first one defined', () => {
    // size and lines are identical across the family; binding is the choice
    expect(discriminatingKeys(FAMILY, DEFS)).toEqual(['binding']);
  });

  it('ignores attributes with a single value', () => {
    expect(discriminatingKeys(FAMILY, DEFS)).not.toContain('size_in');
    expect(discriminatingKeys(FAMILY, DEFS)).not.toContain('lines');
  });

  it('ranks by how much an attribute varies', () => {
    const mixed = [
      ...FAMILY,
      item({
        id: 8,
        name: 'A-1',
        attributes: { size_in: '3 x 5', lines: 11, binding: 'X' },
      }),
    ];
    // binding takes 4 values, size and lines 2 each
    expect(discriminatingKeys(mixed, DEFS)[0]).toBe('binding');
  });

  it('skips booleans, which read poorly in a summary line', () => {
    expect(discriminatingKeys(FAMILY, DEFS)).not.toContain('zip');
  });

  it('returns nothing when every candidate is identical', () => {
    expect(discriminatingKeys([SOURCE, SOURCE], DEFS)).toEqual([]);
  });

  it('caps how many it returns', () => {
    const mixed = [
      ...FAMILY,
      item({
        id: 9,
        name: 'B-1',
        attributes: { size_in: '3 x 5', lines: 11, binding: 'Y' },
      }),
    ];
    expect(discriminatingKeys(mixed, DEFS, 2)).toHaveLength(2);
  });
});

describe('summaryOf', () => {
  it('describes a row by the discriminating values', () => {
    const keys = discriminatingKeys(FAMILY, DEFS);
    expect(summaryOf(SOURCE, keys)).toBe('Die-cut Pocket Style');
  });

  it('gives family members distinguishable summaries', () => {
    // the bug this replaced: every row read "5.75 x 9 · 16 · Art Paper"
    const keys = discriminatingKeys(FAMILY, DEFS);
    const summaries = FAMILY.map((c) => summaryOf(c, keys));
    expect(new Set(summaries).size).toBe(FAMILY.length);
  });

  it('is empty when the item has none of the keys', () => {
    expect(summaryOf(item({ attributes: {} }), ['binding'])).toBe('');
  });

  it('joins several values readably', () => {
    expect(summaryOf(SOURCE, ['size_in', 'binding'])).toBe(
      '5.75 x 9 · Die-cut Pocket Style',
    );
  });
});

describe('groupCandidates', () => {
  const target = item({ id: 1, parentId: 100 });

  it('splits family from the rest, keeping rank order', () => {
    const outsider = item({
      id: 4,
      name: 'A-1',
      parentId: 999,
      attributes: { lines: 11 },
    });
    const groups = groupCandidates([SOURCE, outsider], target);
    expect(groups.family.map((c) => c.name)).toEqual(['S-23-D']);
    expect(groups.others.map((c) => c.name)).toEqual(['A-1']);
  });

  it('handles an empty list', () => {
    expect(groupCandidates([], target)).toEqual({ family: [], others: [] });
  });
});

describe('select all', () => {
  const rows = () => buildCopyPlan(DEFS, { size_in: '5.75 x 9' }, SOURCE);

  it('reports none when nothing is ticked', () => {
    expect(selectionState(rows(), new Set())).toBe('none');
    expect(headerCheckedValue(rows(), new Set())).toBe(false);
  });

  it('reports some for a partial selection', () => {
    const partial = new Set(['lines']);
    expect(selectionState(rows(), partial)).toBe('some');
    expect(headerCheckedValue(rows(), partial)).toBe('indeterminate');
  });

  it('reports all when every changeable row is ticked', () => {
    const all = new Set(['lines', 'binding']);
    expect(selectionState(rows(), all)).toBe('all');
    expect(headerCheckedValue(rows(), all)).toBe(true);
  });

  it('select-all ignores the no-op rows', () => {
    // size_in is already identical; ticking it would claim a change there is none
    expect([...toggleAll(rows(), new Set())].sort()).toEqual([
      'binding',
      'lines',
    ]);
  });

  it('toggles back to empty from all', () => {
    expect(toggleAll(rows(), new Set(['lines', 'binding'])).size).toBe(0);
  });
});
