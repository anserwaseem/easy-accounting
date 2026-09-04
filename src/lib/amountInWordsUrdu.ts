/**
 * integer amount-in-words for Pakistani Urdu invoices (ہزار / لاکھ / کروڑ).
 * mirrors English print which feeds Math truncation via number-to-words on the
 * total — fractional paise are ignored the same way.
 */

const ONES = [
  '',
  'ایک',
  'دو',
  'تین',
  'چار',
  'پانچ',
  'چھ',
  'سات',
  'آٹھ',
  'نو',
  'دس',
  'گیارہ',
  'بارہ',
  'تیرہ',
  'چودہ',
  'پندرہ',
  'سولہ',
  'سترہ',
  'اٹھارہ',
  'انیس',
] as const;

const TENS = [
  '',
  '',
  'بیس',
  'تیس',
  'چالیس',
  'پچاس',
  'ساٹھ',
  'ستر',
  'اسی',
  'نوے',
] as const;

/** 20–99 with common spoken forms where they differ from tens+ones */
const TWO_DIGIT_SPECIAL: Record<number, string> = {
  20: 'بیس',
  21: 'اکیس',
  22: 'بائیس',
  23: 'تئیس',
  24: 'چوبیس',
  25: 'پچیس',
  26: 'چھبیس',
  27: 'ستائیس',
  28: 'اٹھائیس',
  29: 'انتیس',
  30: 'تیس',
  31: 'اکتیس',
  32: 'بتیس',
  33: 'تینتیس',
  34: 'چونتیس',
  35: 'پینتیس',
  36: 'چھتیس',
  37: 'سینتیس',
  38: 'اڑتیس',
  39: 'انتالیس',
  40: 'چالیس',
  41: 'اکتالیس',
  42: 'بیالیس',
  43: 'تینتالیس',
  44: 'چوالیس',
  45: 'پینتالیس',
  46: 'چھیالیس',
  47: 'سینتالیس',
  48: 'اڑتالیس',
  49: 'انچاس',
  50: 'پچاس',
  51: 'اکاون',
  52: 'باون',
  53: 'ترپن',
  54: 'چون',
  55: 'پچپن',
  56: 'چھپن',
  57: 'ستاون',
  58: 'اٹھاون',
  59: 'انسٹھ',
  60: 'ساٹھ',
  61: 'اکسٹھ',
  62: 'باسٹھ',
  63: 'ترسٹھ',
  64: 'چونسٹھ',
  65: 'پینسٹھ',
  66: 'چھیاسٹھ',
  67: 'سڑسٹھ',
  68: 'اڑسٹھ',
  69: 'انہتر',
  70: 'ستر',
  71: 'اکہتر',
  72: 'بہتر',
  73: 'تہتر',
  74: 'چوہتر',
  75: 'پچہتر',
  76: 'چھہتر',
  77: 'ستتر',
  78: 'اٹھتر',
  79: 'اناسی',
  80: 'اسی',
  81: 'اکیاسی',
  82: 'بیاسی',
  83: 'تراسی',
  84: 'چوراسی',
  85: 'پچاسی',
  86: 'چھیاسی',
  87: 'ستاسی',
  88: 'اٹھاسی',
  89: 'نواسی',
  90: 'نوے',
  91: 'اکانوے',
  92: 'بانوے',
  93: 'ترانوے',
  94: 'چورانوے',
  95: 'پچانوے',
  96: 'چھیانوے',
  97: 'ستانوے',
  98: 'اتھانوے',
  99: 'ننانوے',
};

const underHundred = (n: number): string => {
  if (n <= 0) return '';
  if (n < 20) return ONES[n];
  if (TWO_DIGIT_SPECIAL[n]) return TWO_DIGIT_SPECIAL[n];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return one === 0 ? TENS[ten] : `${TENS[ten]} ${ONES[one]}`;
};

const underThousand = (n: number): string => {
  if (n <= 0) return '';
  if (n < 100) return underHundred(n);
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const head = `${ONES[hundred]} سو`;
  return rest === 0 ? head : `${head} ${underHundred(rest)}`;
};

const scaleChunk = (n: number, label: string): string => {
  if (n <= 0) return '';
  const words = underThousand(n);
  return words ? `${words} ${label}` : '';
};

export const amountInWordsUrdu = (value: number): string => {
  const n = Math.trunc(Math.abs(Number(value) || 0));
  if (n === 0) return 'صفر';

  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;

  const parts = [
    scaleChunk(crore, 'کروڑ'),
    scaleChunk(lakh, 'لاکھ'),
    scaleChunk(thousand, 'ہزار'),
    underThousand(rest),
  ].filter(Boolean);

  return parts.join(' ');
};
