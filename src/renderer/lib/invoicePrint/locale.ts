import { format, isValid } from 'date-fns';

export type InvoicePrintLocale = 'en' | 'ur';

export interface InvoicePrintLabels {
  quotationBanner: string;
  invoiceFallbackTitle: string;
  quotationFallbackTitle: string;
  quotationNumber: string;
  invoiceNumber: string;
  date: string;
  bilty: string;
  cartons: string;
  billTo: string;
  vendor: string;
  walkInCustomer: string;
  serial: string;
  item: string;
  itemDescription: string;
  qty: string;
  price: string;
  discount: string;
  amount: string;
  totalQuantity: string;
  extraDiscount: string;
  total: string;
  returnedBanner: string;
  returnedOn: string;
  currencyWordsPrefix: string;
}

export type InvoicePrintLabelKey = keyof InvoicePrintLabels;

export const INVOICE_PRINT_LABEL_KEYS: InvoicePrintLabelKey[] = [
  'quotationBanner',
  'invoiceFallbackTitle',
  'quotationFallbackTitle',
  'quotationNumber',
  'invoiceNumber',
  'date',
  'bilty',
  'cartons',
  'billTo',
  'vendor',
  'walkInCustomer',
  'serial',
  'item',
  'itemDescription',
  'qty',
  'price',
  'discount',
  'amount',
  'totalQuantity',
  'extraDiscount',
  'total',
  'returnedBanner',
  'returnedOn',
  'currencyWordsPrefix',
];

/** english UI titles for Settings label editor */
export const INVOICE_PRINT_LABEL_TITLES: Record<InvoicePrintLabelKey, string> =
  {
    quotationBanner: 'Quotation banner',
    invoiceFallbackTitle: 'Invoice title (no company name)',
    quotationFallbackTitle: 'Quotation title (no company name)',
    quotationNumber: 'Quotation number label',
    invoiceNumber: 'Invoice number label',
    date: 'Date label',
    bilty: 'Bilty label',
    cartons: 'Cartons label',
    billTo: 'Bill To label',
    vendor: 'Vendor label',
    walkInCustomer: 'Walk-in customer',
    serial: 'Serial column',
    item: 'Item column',
    itemDescription: 'Description column',
    qty: 'Qty column',
    price: 'Price column',
    discount: 'Discount column',
    amount: 'Amount column',
    totalQuantity: 'Total quantity row',
    extraDiscount: 'Extra discount row',
    total: 'Total row',
    returnedBanner: 'Returned banner',
    returnedOn: 'Returned on label',
    currencyWordsPrefix: 'Currency in words',
  };

const ENGLISH_LABELS: InvoicePrintLabels = {
  quotationBanner: 'QUOTATION',
  invoiceFallbackTitle: 'INVOICE',
  quotationFallbackTitle: 'QUOTATION',
  quotationNumber: 'Quotation #:',
  invoiceNumber: 'Invoice No:',
  date: 'Date:',
  bilty: 'Bilty:',
  cartons: 'Cartons:',
  billTo: 'Bill To:',
  vendor: 'Vendor:',
  walkInCustomer: 'WALK IN CUSTOMER',
  serial: '#',
  item: 'Item',
  itemDescription: 'Item Description',
  qty: 'Qty',
  price: 'Price',
  discount: 'Discount',
  amount: 'Amount',
  totalQuantity: 'Total quantity:',
  extraDiscount: 'Extra Discount:',
  total: 'Total:',
  returnedBanner: 'RETURNED',
  returnedOn: 'Returned on',
  currencyWordsPrefix: 'Rs.',
};

/** commercial Urdu defaults — editable in Settings for a native-speaker pass */
const URDU_LABELS: InvoicePrintLabels = {
  quotationBanner: 'کوٹیشن',
  invoiceFallbackTitle: 'بل',
  quotationFallbackTitle: 'کوٹیشن',
  quotationNumber: 'کوٹیشن نمبر:',
  invoiceNumber: 'بل نمبر:',
  date: 'تاریخ:',
  bilty: 'بلٹی:',
  cartons: 'کارٹن:',
  billTo: 'بل بنام:',
  vendor: 'وینڈر:',
  walkInCustomer: 'نقد خریدار',
  serial: '#',
  item: 'حوالہ نمبر',
  itemDescription: 'تفصیل',
  qty: 'مقدار',
  price: 'ریٹ',
  discount: 'رعایت',
  amount: 'رقم',
  totalQuantity: 'کل مقدار:',
  extraDiscount: 'اضافی رعایت:',
  total: 'کل رقم:',
  returnedBanner: 'واپس شدہ',
  returnedOn: 'واپسی کی تاریخ:',
  currencyWordsPrefix: 'روپے',
};

export const getDefaultInvoicePrintLabels = (
  locale: InvoicePrintLocale,
): InvoicePrintLabels =>
  locale === 'ur' ? { ...URDU_LABELS } : { ...ENGLISH_LABELS };

export const getInvoicePrintLabels = (
  locale: InvoicePrintLocale,
  overrides?: Partial<InvoicePrintLabels> | null,
): InvoicePrintLabels => {
  const base = getDefaultInvoicePrintLabels(locale);
  if (locale !== 'ur' || !overrides) return base;

  const merged = { ...base };
  INVOICE_PRINT_LABEL_KEYS.forEach((key) => {
    const override = overrides[key];
    if (typeof override === 'string' && override.trim().length > 0) {
      merged[key] = override.trim();
    }
  });
  return merged;
};

const URDU_MONTHS = [
  'جنوری',
  'فروری',
  'مارچ',
  'اپریل',
  'مئی',
  'جون',
  'جولائی',
  'اگست',
  'ستمبر',
  'اکتوبر',
  'نومبر',
  'دسمبر',
] as const;

export interface InvoicePrintDateParts {
  day: number;
  month: string;
  year: number;
  /** english `PP` string when locale is en */
  formatted: string;
}

/** structured parts so Urdu UI can LTR-isolate day/year and avoid bidi reorder */
export const getInvoicePrintDateParts = (
  value: string | Date,
  locale: InvoicePrintLocale,
): InvoicePrintDateParts | null => {
  const date = value instanceof Date ? value : new Date(value);
  if (!isValid(date)) {
    return null;
  }

  if (locale !== 'ur') {
    return {
      day: date.getDate(),
      month: format(date, 'MMM'),
      year: date.getFullYear(),
      formatted: format(date, 'PP'),
    };
  }

  return {
    day: date.getDate(),
    month: URDU_MONTHS[date.getMonth()],
    year: date.getFullYear(),
    formatted: `${date.getDate()} ${
      URDU_MONTHS[date.getMonth()]
    } ${date.getFullYear()}`,
  };
};

/** Gregorian day + Urdu month name + year, Western digits */
export const formatInvoicePrintDate = (
  value: string | Date,
  locale: InvoicePrintLocale,
): string => {
  const parts = getInvoicePrintDateParts(value, locale);
  if (!parts) {
    return String(value);
  }
  if (locale !== 'ur') {
    return parts.formatted;
  }
  return `${parts.day} ${parts.month} ${parts.year}`;
};

/** prefer localized string when locale is Urdu and Urdu value is non-empty */
export const pickPrintLocalizedText = (
  english: string | null | undefined,
  urdu: string | null | undefined,
  locale: InvoicePrintLocale,
): string => {
  if (locale === 'ur') {
    const ur = String(urdu ?? '').trim();
    if (ur.length > 0) return ur;
  }
  return String(english ?? '').trim();
};

export const formatInvoicePrintCurrency = (
  amount: number,
  locale: InvoicePrintLocale,
): string => {
  const formatted = new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  if (locale === 'ur') {
    return `${formatted} روپے`;
  }
  return `PKR ${formatted}`;
};

/** wait for document fonts (esp. Nastaliq) before printToPDF / window.print */
export const waitForInvoicePrintFonts = async (
  locale: InvoicePrintLocale,
  urduFontFamily = 'Jameel Noori Nastaleeq',
): Promise<void> => {
  if (typeof document === 'undefined' || !document.fonts) {
    return;
  }
  try {
    await document.fonts.ready;
    if (locale === 'ur') {
      await document.fonts.load(`16px '${urduFontFamily}'`);
    }
  } catch {
    // print still proceeds; glyphs may fall back
  }
};
