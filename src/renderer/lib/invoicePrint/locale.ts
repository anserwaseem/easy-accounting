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

const URDU_LABELS: InvoicePrintLabels = {
  quotationBanner: 'کوٹیشن',
  invoiceFallbackTitle: 'انوائس',
  quotationFallbackTitle: 'کوٹیشن',
  quotationNumber: 'کوٹیشن نمبر:',
  invoiceNumber: 'انوائس نمبر:',
  date: 'تاریخ:',
  bilty: 'بلٹی:',
  cartons: 'کارٹن:',
  billTo: 'بل بنام:',
  vendor: 'سپلائر:',
  walkInCustomer: 'نقد خریدار',
  serial: '#',
  item: 'آئٹم',
  itemDescription: 'تفصیل',
  qty: 'مقدار',
  price: 'قیمت',
  discount: 'رعایت',
  amount: 'رقم',
  totalQuantity: 'کل مقدار:',
  extraDiscount: 'اضافی رعایت:',
  total: 'کل:',
  returnedBanner: 'واپس',
  returnedOn: 'واپسی کی تاریخ',
  currencyWordsPrefix: 'روپے',
};

export const getInvoicePrintLabels = (
  locale: InvoicePrintLocale,
): InvoicePrintLabels => (locale === 'ur' ? URDU_LABELS : ENGLISH_LABELS);

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

/** Gregorian day + Urdu month name + year, Western digits */
export const formatInvoicePrintDate = (
  value: string | Date,
  locale: InvoicePrintLocale,
): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (!isValid(date)) {
    return String(value);
  }

  if (locale !== 'ur') {
    return format(date, 'PP');
  }

  const day = date.getDate();
  const month = URDU_MONTHS[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
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
