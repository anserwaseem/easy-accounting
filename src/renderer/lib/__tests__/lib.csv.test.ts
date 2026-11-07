import { parseCsvToAoa , convertFileToJson } from '@/renderer/lib/lib';

describe('parseCsvToAoa', () => {
  it('parses basic csv', () => {
    const out = parseCsvToAoa('a,b\n1,2\n');
    expect(out).toEqual([
      ['a', 'b'],
      [1, 2],
    ]);
  });

  it('preserves leading zeros in quoted strings', () => {
    const out = parseCsvToAoa('"00123",123\n');
    expect(out).toEqual([['00123', 123]]);
  });

  it('skips blank lines and all-empty rows', () => {
    const out = parseCsvToAoa('a,b\n\n,\n3,4\n');
    expect(out).toEqual([
      ['a', 'b'],
      [3, 4],
    ]);
  });

  it('handles standalone CR line endings', () => {
    const out = parseCsvToAoa('a,b\r1,2\r');
    expect(out).toEqual([
      ['a', 'b'],
      [1, 2],
    ]);
  });

  it('handles CRLF', () => {
    const out = parseCsvToAoa('a,b\r\n1,2\r\n');
    expect(out).toEqual([
      ['a', 'b'],
      [1, 2],
    ]);
  });

  it('handles trailing comma', () => {
    const out = parseCsvToAoa('a,\n');
    expect(out).toEqual([['a', '']]);
  });

  it('trims unquoted values', () => {
    const out = parseCsvToAoa('  spaced ,2\n');
    expect(out).toEqual([['spaced', 2]]);
  });

  it('preserves quoted whitespace', () => {
    const out = parseCsvToAoa('" spaced ",2\n');
    expect(out).toEqual([[' spaced ', 2]]);
  });
});


describe('convertFileToJson (csv)', () => {
  it('reads CSV through File path', async () => {
    const file = new File(['a,b\n"00123",2\n'], 't.csv', {
      type: 'text/csv',
    });
    const out = await convertFileToJson(file);
    expect(out).toEqual([
      ['a', 'b'],
      ['00123', 2],
    ]);
  });
});
