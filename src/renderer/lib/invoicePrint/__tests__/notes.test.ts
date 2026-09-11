import {
  EXAMPLE_INVOICE_PRINT_NOTE_EN,
  EXAMPLE_INVOICE_PRINT_NOTE_UR,
} from '../notes';

describe('example invoice print notes', () => {
  it('keeps the commercial Urdu adda / WhatsApp wording as a settings hint', () => {
    expect(EXAMPLE_INVOICE_PRINT_NOTE_UR).toBe(
      '15 دن کے اندر اڈے سے اپنا مال وصول کر لیں ورنہ کمپنی ذمہ دار نہیں ہوگی۔ مال کی کمی بیشی کی صورت میں ویڈیو بنا کے واٹس ایپ پر بھیجیں۔',
    );
  });

  it('keeps the English translation as a settings hint', () => {
    expect(EXAMPLE_INVOICE_PRINT_NOTE_EN).toBe(
      'Collect your goods from the adda within 15 days otherwise the company will not be responsible. In case of shortage or excess of goods, take a video and send it on WhatsApp.',
    );
  });
});
