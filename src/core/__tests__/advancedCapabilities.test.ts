import {
  ADVANCED_CAPABILITIES,
  ADVANCED_CAPABILITY_GROUPS,
  ADVANCED_CAPABILITY_LABELS,
  ALL_ADVANCED_CAPABILITIES,
  ALL_ADVANCED_CAPABILITIES_IN_GROUP_ORDER,
  ALL_ADVANCED_CAPABILITIES_SENTINEL,
  DESTRUCTIVE_ADVANCED_CAPABILITIES,
  hasAdvancedCapability,
  parseAdvancedCapabilities,
  serializeAdvancedCapabilities,
} from '../advancedCapabilities';

describe('advancedCapabilities registry', () => {
  it('gives every capability a label', () => {
    for (const capability of ALL_ADVANCED_CAPABILITIES) {
      expect(ADVANCED_CAPABILITY_LABELS[capability]).toBeTruthy();
    }
  });

  it('keeps capability ids unique', () => {
    const ids = ALL_ADVANCED_CAPABILITIES.map((c) => c);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists only real capabilities as destructive', () => {
    const known = new Set<string>(ALL_ADVANCED_CAPABILITIES);
    for (const capability of DESTRUCTIVE_ADVANCED_CAPABILITIES) {
      expect(known.has(capability)).toBe(true);
    }
  });

  it('treats unposting a settlement as destructive', () => {
    // unposting deletes a frozen snapshot and its journal entry, so it
    // must ask for confirmation before it is turned on
    expect(DESTRUCTIVE_ADVANCED_CAPABILITIES).toContain(
      ADVANCED_CAPABILITIES.commissionUnpostSettlement,
    );
  });

  it('does not treat the whole commission module as destructive', () => {
    // the module itself only reads and posts a settlement the owner
    // reviews; unposting the settlement is the destructive part
    expect(DESTRUCTIVE_ADVANCED_CAPABILITIES).not.toContain(
      ADVANCED_CAPABILITIES.commissionModule,
    );
  });

  it('treats restating opening stock as destructive', () => {
    // the "set everything else to 0" option zeroes out stock the owner
    // recorded by hand since the last import, and there is no undo
    expect(DESTRUCTIVE_ADVANCED_CAPABILITIES).toContain(
      ADVANCED_CAPABILITIES.inventorySetOpeningStock,
    );
    expect(DESTRUCTIVE_ADVANCED_CAPABILITIES).toContain(
      ADVANCED_CAPABILITIES.vendorStockSetOpeningStock,
    );
  });
});

describe('advancedCapability groups', () => {
  it('puts every capability in exactly one group', () => {
    // a capability that fell out of every group would vanish from the
    // Settings list with nothing to show it had happened
    const seen = new Map<string, number>();
    for (const group of ADVANCED_CAPABILITY_GROUPS) {
      for (const capability of group.capabilities) {
        seen.set(capability, (seen.get(capability) ?? 0) + 1);
      }
    }

    for (const capability of ALL_ADVANCED_CAPABILITIES) {
      expect(seen.get(capability)).toBe(1);
    }
    expect(seen.size).toBe(ALL_ADVANCED_CAPABILITIES.length);
  });

  it('lists only real capabilities in a group', () => {
    const known = new Set<string>(ALL_ADVANCED_CAPABILITIES);
    for (const group of ADVANCED_CAPABILITY_GROUPS) {
      for (const capability of group.capabilities) {
        expect(known.has(capability)).toBe(true);
      }
    }
  });

  it('gives every group a title and a description', () => {
    for (const group of ADVANCED_CAPABILITY_GROUPS) {
      expect(group.title).toBeTruthy();
      expect(group.description).toBeTruthy();
    }
  });

  it('keeps a group title from colliding with a capability label', () => {
    // the Settings list shows both, and a group titled the same as one of
    // its own controls makes the two impossible to tell apart
    const labels = new Set(Object.values(ADVANCED_CAPABILITY_LABELS));
    for (const group of ADVANCED_CAPABILITY_GROUPS) {
      expect(labels.has(group.title)).toBe(false);
    }
  });

  it('covers the whole registry in group order', () => {
    expect(new Set(ALL_ADVANCED_CAPABILITIES_IN_GROUP_ORDER)).toEqual(
      new Set(ALL_ADVANCED_CAPABILITIES),
    );
    expect(ALL_ADVANCED_CAPABILITIES_IN_GROUP_ORDER.length).toBe(
      ALL_ADVANCED_CAPABILITIES.length,
    );
  });
});

describe('parseAdvancedCapabilities', () => {
  it('treats a missing value as nothing enabled', () => {
    expect(parseAdvancedCapabilities(undefined).size).toBe(0);
    expect(parseAdvancedCapabilities(null).size).toBe(0);
  });

  it('reads a JSON array of ids', () => {
    const parsed = parseAdvancedCapabilities(
      JSON.stringify([
        ADVANCED_CAPABILITIES.journalReverse,
        ADVANCED_CAPABILITIES.accountDelete,
      ]),
    );
    expect(parsed.has(ADVANCED_CAPABILITIES.journalReverse)).toBe(true);
    expect(parsed.has(ADVANCED_CAPABILITIES.accountDelete)).toBe(true);
    expect(parsed.has(ADVANCED_CAPABILITIES.inventoryDelete)).toBe(false);
  });

  it('reads a bare unquoted id', () => {
    const parsed = parseAdvancedCapabilities(
      ADVANCED_CAPABILITIES.journalReverse,
    );
    expect(parsed.has(ADVANCED_CAPABILITIES.journalReverse)).toBe(true);
    expect(parsed.size).toBe(1);
  });

  it('expands the "all" sentinel', () => {
    const parsed = parseAdvancedCapabilities(
      JSON.stringify([ALL_ADVANCED_CAPABILITIES_SENTINEL]),
    );
    expect(parsed.size).toBe(ALL_ADVANCED_CAPABILITIES.length);
  });

  it('drops unknown ids', () => {
    const parsed = parseAdvancedCapabilities(
      JSON.stringify(['journal.retired', 'not-a-capability']),
    );
    expect(parsed.size).toBe(0);
  });

  it('ignores a value that is not an array', () => {
    expect(parseAdvancedCapabilities(42).size).toBe(0);
    expect(parseAdvancedCapabilities({ a: 1 }).size).toBe(0);
  });

  it('ignores non-string entries', () => {
    const parsed = parseAdvancedCapabilities(
      JSON.stringify([1, null, ADVANCED_CAPABILITIES.accountDelete]),
    );
    expect(parsed.size).toBe(1);
    expect(parsed.has(ADVANCED_CAPABILITIES.accountDelete)).toBe(true);
  });
});

describe('serializeAdvancedCapabilities', () => {
  it('sorts the result into group order', () => {
    const serialized = serializeAdvancedCapabilities([
      ADVANCED_CAPABILITIES.inventoryDelete,
      ADVANCED_CAPABILITIES.journalReverse,
    ]);
    expect(serialized).toEqual([
      ADVANCED_CAPABILITIES.journalReverse,
      ADVANCED_CAPABILITIES.inventoryDelete,
    ]);
  });

  it('drops unknown ids', () => {
    const serialized = serializeAdvancedCapabilities([
      'journal.retired' as never,
      ADVANCED_CAPABILITIES.accountDelete,
    ]);
    expect(serialized).toEqual([ADVANCED_CAPABILITIES.accountDelete]);
  });

  it('collapses the "all" sentinel to the full list', () => {
    const serialized = serializeAdvancedCapabilities([
      ALL_ADVANCED_CAPABILITIES_SENTINEL as never,
    ]);
    expect(serialized).toEqual([...ALL_ADVANCED_CAPABILITIES]);
  });

  it('round-trips through parse', () => {
    const ids = [
      ADVANCED_CAPABILITIES.journalReverse,
      ADVANCED_CAPABILITIES.dataImport,
    ];
    const parsed = parseAdvancedCapabilities(
      JSON.stringify(serializeAdvancedCapabilities(ids)),
    );
    expect(parsed).toEqual(new Set(ids));
  });
});

describe('hasAdvancedCapability', () => {
  it('reports membership', () => {
    const enabled = new Set([ADVANCED_CAPABILITIES.journalReverse]);
    expect(
      hasAdvancedCapability(enabled, ADVANCED_CAPABILITIES.journalReverse),
    ).toBe(true);
    expect(
      hasAdvancedCapability(enabled, ADVANCED_CAPABILITIES.accountDelete),
    ).toBe(false);
  });
});
