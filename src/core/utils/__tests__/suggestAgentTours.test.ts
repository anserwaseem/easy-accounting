import {
  clipTourToRange,
  suggestAgentTours,
  toursOverlap,
} from '../suggestAgentTours';

describe('clipTourToRange', () => {
  const today = '2026-10-05';

  it('cuts a tour that starts before the range', () => {
    expect(
      clipTourToRange(
        { startDate: '2025-12-22', endDate: '2026-01-25' },
        '2026-01-01',
        '2026-09-30',
        today,
      ),
    ).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-01-25',
      clipped: true,
    });
  });

  it('leaves a tour inside the range alone', () => {
    expect(
      clipTourToRange(
        { startDate: '2026-02-01', endDate: '2026-02-20' },
        '2026-01-01',
        '2026-09-30',
        today,
      ).clipped,
    ).toBe(false);
  });

  it('ends a running tour at the range end only when the range ends before today', () => {
    const running = { startDate: '2026-08-31', endDate: null };
    expect(clipTourToRange(running, '2026-01-01', '2026-09-30', today)).toEqual(
      { startDate: '2026-08-31', endDate: '2026-09-30', clipped: true },
    );
    expect(clipTourToRange(running, '2026-01-01', '2026-10-05', today)).toEqual(
      { startDate: '2026-08-31', endDate: null, clipped: false },
    );
  });
});

describe('toursOverlap', () => {
  it('treats ranges as inclusive and a null end as open', () => {
    const jan = { startDate: '2026-01-01', endDate: '2026-01-31' };
    expect(
      toursOverlap(jan, { startDate: '2026-01-31', endDate: '2026-02-05' }),
    ).toBe(true);
    expect(
      toursOverlap(jan, { startDate: '2026-02-01', endDate: '2026-02-05' }),
    ).toBe(false);
    expect(toursOverlap({ startDate: '2025-12-01', endDate: null }, jan)).toBe(
      true,
    );
  });
});

describe('suggestAgentTours', () => {
  const day = (d: string, journalId: number, creditLines = 9) => ({
    day: d,
    journalId,
    creditLines,
  });

  it('chains windows from the previous settlement and numbers repeat months', () => {
    const suggested = suggestAgentTours(
      7,
      [day('2025-10-26', 2), day('2025-10-19', 1), day('2025-11-16', 3)],
      [],
    );
    expect(
      suggested.map((s) => [s.name, s.startDate, s.endDate, s.journalId]),
    ).toEqual([
      ['Oct 2025', '2025-10-01', '2025-10-19', 1],
      ['Oct 2025 (2)', '2025-10-20', '2025-10-26', 2],
      ['Nov 2025', '2025-10-27', '2025-11-16', 3],
    ]);
    expect(suggested.every((s) => s.chartId === 7)).toBe(true);
  });

  it('drops windows that touch a saved tour but keeps chaining after them', () => {
    const suggested = suggestAgentTours(
      7,
      [day('2026-01-25', 1), day('2026-02-22', 2)],
      [{ startDate: '2026-01-10', endDate: '2026-01-25' }],
    );
    expect(suggested.map((s) => [s.startDate, s.endDate])).toEqual([
      ['2026-01-26', '2026-02-22'],
    ]);
  });

  it('returns nothing without bulk days', () => {
    expect(suggestAgentTours(7, [], [])).toEqual([]);
  });
});
