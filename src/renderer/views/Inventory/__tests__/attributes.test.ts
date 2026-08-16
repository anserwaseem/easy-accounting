import { coerceAttributeValue } from '../EditItemAttributes';
import { keyFromLabel } from '../ManageAttributes';

describe('keyFromLabel', () => {
  it('derives a snake_case key', () => {
    expect(keyFromLabel('Paper size')).toBe('paper_size');
    expect(keyFromLabel('Lines per page')).toBe('lines_per_page');
  });
  it('strips punctuation and collapses separators', () => {
    expect(keyFromLabel('  Weight (kg)!! ')).toBe('weight_kg');
    expect(keyFromLabel('A---B')).toBe('a_b');
  });
  it('returns empty for a label with nothing usable', () => {
    expect(keyFromLabel('   ')).toBe('');
    expect(keyFromLabel('!!!')).toBe('');
  });
  it('caps length so it fits the key column', () => {
    expect(keyFromLabel('x'.repeat(200)).length).toBe(64);
  });
});

describe('coerceAttributeValue', () => {
  it('keeps text as trimmed text', () => {
    expect(coerceAttributeValue('  Art Paper ', 'text')).toBe('Art Paper');
  });
  it('converts numeric input to a number', () => {
    expect(coerceAttributeValue('568', 'number')).toBe(568);
    expect(coerceAttributeValue('5.75', 'number')).toBe(5.75);
  });
  it('leaves unparseable numbers as text rather than losing the value', () => {
    expect(coerceAttributeValue('5.75 x 9', 'number')).toBe('5.75 x 9');
  });
  it('treats any non-empty bool input as true', () => {
    expect(coerceAttributeValue('true', 'bool')).toBe(true);
  });
  it('returns empty string for blanks so the key is dropped on save', () => {
    expect(coerceAttributeValue('', 'text')).toBe('');
    expect(coerceAttributeValue('   ', 'number')).toBe('');
    expect(coerceAttributeValue('', 'bool')).toBe('');
  });
  it('preserves unicode values', () => {
    expect(coerceAttributeValue('آرٹ پیپر', 'text')).toBe('آرٹ پیپر');
  });
});
