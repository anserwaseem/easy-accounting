import {
  classifyCollectionSource,
  collectionRoleFor,
} from '../receiptAccounts';

const AGENT = 23;
const base = {
  chartId: 15,
  headType: 'Asset',
  headParentId: null,
  collectionRole: null,
  entries: 8,
  maxShopsPerEntry: 138,
};

describe('classifyCollectionSource', () => {
  it('counts a cash or clearing account by default without a flag', () => {
    expect(classifyCollectionSource(base, AGENT)).toEqual({
      counts: true,
      defaultCounts: true,
      reason: 'Cash, bank or clearing account',
      flag: null,
    });
  });

  it("flags another agent's account as a likely payment", () => {
    const verdict = classifyCollectionSource(
      { ...base, chartId: 26, headParentId: 15, entries: 2 },
      AGENT,
    );
    expect(verdict.counts).toBe(false);
    expect(verdict.reason).toBe("Another agent's account");
    expect(verdict.flag).toMatch(/payment/);
  });

  it('labels moves between the same agent shops without a flag', () => {
    const verdict = classifyCollectionSource(
      { ...base, chartId: AGENT, headParentId: 15 },
      AGENT,
    );
    expect(verdict).toMatchObject({
      counts: false,
      reason: "Moved between this agent's shop accounts",
      flag: null,
    });
  });

  it('flags a counted account whose single entry settled many shops', () => {
    const verdict = classifyCollectionSource(
      { ...base, entries: 1, maxShopsPerEntry: 128 },
      AGENT,
    );
    expect(verdict.counts).toBe(true);
    expect(verdict.flag).toMatch(/128 shops/);
  });

  it('respects overrides and stops flagging once decided', () => {
    expect(
      classifyCollectionSource(
        { ...base, chartId: 26, headParentId: 15, collectionRole: 'receipt' },
        AGENT,
      ),
    ).toMatchObject({ counts: true, defaultCounts: false, flag: null });
    expect(
      classifyCollectionSource(
        {
          ...base,
          entries: 1,
          maxShopsPerEntry: 128,
          collectionRole: 'exclude',
        },
        AGENT,
      ),
    ).toMatchObject({ counts: false, reason: 'Set not to count', flag: null });
    expect(
      classifyCollectionSource({ ...base, headType: 'Expense' }, AGENT).reason,
    ).toBe('Expense account, not money received');
  });
});

describe('collectionRoleFor', () => {
  it('stores nothing when the wish matches the default', () => {
    expect(collectionRoleFor(true, true)).toBeNull();
    expect(collectionRoleFor(false, false)).toBeNull();
    expect(collectionRoleFor(true, false)).toBe('receipt');
    expect(collectionRoleFor(false, true)).toBe('exclude');
  });
});
