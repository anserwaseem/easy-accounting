import { parseJsonRecord, parseListPrices } from '../inventoryJson';

describe('parseJsonRecord', () => {
  it('parses an object', () => {
    expect(parseJsonRecord('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
  });
  it('returns {} for null, empty, malformed, array or scalar json', () => {
    expect(parseJsonRecord(null)).toEqual({});
    expect(parseJsonRecord('')).toEqual({});
    expect(parseJsonRecord('{oops')).toEqual({});
    expect(parseJsonRecord('[1,2]')).toEqual({});
    expect(parseJsonRecord('42')).toEqual({});
  });
  it('preserves unicode attribute values', () => {
    expect(parseJsonRecord('{"paper_urdu":"آرٹ پیپر"}')).toEqual({
      paper_urdu: 'آرٹ پیپر',
    });
  });
});

describe('parseListPrices', () => {
  it('coerces string keys from json_group_object into numbers', () => {
    expect(parseListPrices('{"1":1080,"2":700}')).toEqual({ 1: 1080, 2: 700 });
  });
  it('returns {} when the item has no list prices', () => {
    expect(parseListPrices(null)).toEqual({});
  });
  it('drops entries that are not numeric', () => {
    expect(parseListPrices('{"1":1080,"x":"abc"}')).toEqual({ 1: 1080 });
  });
});
