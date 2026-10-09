import {
  formatJournalDiscountLabel,
  journalDiscountLabel,
  profilePercentFromJournalLabel,
} from '../journalDiscountLabel';

describe('journalDiscountLabel', () => {
  it('stores the shared profile percent when no line is typed', () => {
    expect(
      journalDiscountLabel([
        { discount: 20, isNetRate: false },
        { discount: 20, isNetRate: false },
      ]),
    ).toBe(20);
  });

  it('marks a typed line beside one profile percent', () => {
    expect(
      journalDiscountLabel([
        { discount: 20, isNetRate: false },
        { discount: 0, isNetRate: true },
      ]),
    ).toBe('N·20');
  });

  it('marks an all-typed bill as N', () => {
    expect(
      journalDiscountLabel([
        { discount: 0, isNetRate: true },
        { discount: 0, isNetRate: true },
      ]),
    ).toBe('N');
  });

  it('leaves the box empty when untyped lines do not share a percent', () => {
    expect(
      journalDiscountLabel([
        { discount: 10, isNetRate: false },
        { discount: 20, isNetRate: false },
        { discount: 0, isNetRate: true },
      ]),
    ).toBeUndefined();
  });
});

describe('formatJournalDiscountLabel', () => {
  it('prints a number with a percent sign and leaves N labels alone', () => {
    expect(formatJournalDiscountLabel(20)).toBe('20%');
    expect(formatJournalDiscountLabel('N·20')).toBe('N · 20%');
    expect(formatJournalDiscountLabel('N')).toBe('N');
    expect(formatJournalDiscountLabel(null)).toBe('-');
  });
});

describe('profilePercentFromJournalLabel', () => {
  it('reads the profile percent out of N$20 and ignores a bare N', () => {
    expect(profilePercentFromJournalLabel('N·20')).toBe(20);
    expect(profilePercentFromJournalLabel(20)).toBe(20);
    expect(profilePercentFromJournalLabel('N')).toBeNull();
  });
});
