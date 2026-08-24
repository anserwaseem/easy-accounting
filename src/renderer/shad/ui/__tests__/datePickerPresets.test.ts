import {
  MAX_LAST_N_YEARS,
  getLastNYearsPresetValue,
  parseLastNYearsPresetValue,
} from '@/renderer/shad/ui/datePicker';

describe('last N years presets', () => {
  it('builds a preset value from a year count', () => {
    expect(getLastNYearsPresetValue(2)).toBe('last-2-years');
    expect(getLastNYearsPresetValue(7)).toBe('last-7-years');
  });

  it('reads the year count back out', () => {
    expect(parseLastNYearsPresetValue('last-2-years')).toBe(2);
    expect(parseLastNYearsPresetValue('last-25-years')).toBe(25);
    expect(
      parseLastNYearsPresetValue(getLastNYearsPresetValue(MAX_LAST_N_YEARS)),
    ).toBe(MAX_LAST_N_YEARS);
  });

  it('rejects values that are not a last-N-years preset', () => {
    expect(parseLastNYearsPresetValue(undefined)).toBeNull();
    expect(parseLastNYearsPresetValue('')).toBeNull();
    expect(parseLastNYearsPresetValue('last-year')).toBeNull();
    expect(parseLastNYearsPresetValue('current-year')).toBeNull();
    expect(parseLastNYearsPresetValue('-365')).toBeNull();
  });

  it('rejects out-of-range year counts', () => {
    expect(parseLastNYearsPresetValue('last-0-years')).toBeNull();
    expect(
      parseLastNYearsPresetValue(
        getLastNYearsPresetValue(MAX_LAST_N_YEARS + 1),
      ),
    ).toBeNull();
  });
});
