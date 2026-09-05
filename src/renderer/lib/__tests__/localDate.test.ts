import {
  toLocalNoonIsoString,
  toLocalNoonIsoStringFromStored,
} from '../localDate';

describe('toLocalNoonIsoStringFromStored', () => {
  it('treats YYYY-MM-DD as a local calendar day', () => {
    const iso = toLocalNoonIsoStringFromStored('2026-01-15');
    const date = new Date(iso);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(12);
  });

  it('normalizes an ISO instant to local noon on that local day', () => {
    const source = toLocalNoonIsoString(new Date(2026, 8, 4));
    const iso = toLocalNoonIsoStringFromStored(source);
    const date = new Date(iso);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(8);
    expect(date.getDate()).toBe(4);
    expect(date.getHours()).toBe(12);
  });
});
