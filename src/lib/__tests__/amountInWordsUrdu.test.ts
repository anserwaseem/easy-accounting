import { amountInWordsUrdu } from '../amountInWordsUrdu';

describe('amountInWordsUrdu', () => {
  it('handles zero', () => {
    expect(amountInWordsUrdu(0)).toBe('صفر');
  });

  it('handles under twenty', () => {
    expect(amountInWordsUrdu(1)).toBe('ایک');
    expect(amountInWordsUrdu(15)).toBe('پندرہ');
  });

  it('handles tens with spoken forms', () => {
    expect(amountInWordsUrdu(85)).toBe('پچاسی');
  });

  it('handles hundreds', () => {
    expect(amountInWordsUrdu(680)).toBe('چھ سو اسی');
  });

  it('handles the sample quotation total 85680', () => {
    expect(amountInWordsUrdu(85680)).toBe('پچاسی ہزار چھ سو اسی');
  });

  it('truncates fractional amounts like English toWords path', () => {
    expect(amountInWordsUrdu(100.9)).toBe('ایک سو');
  });

  it('handles lakh and crore scales', () => {
    expect(amountInWordsUrdu(100_000)).toBe('ایک لاکھ');
    expect(amountInWordsUrdu(10_000_000)).toBe('ایک کروڑ');
  });
});
