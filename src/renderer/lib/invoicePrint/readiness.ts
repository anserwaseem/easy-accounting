import type { InvoicePrintLocale } from './locale';

export interface InvoicePrintReadinessGap {
  key: string;
  label: string;
}

export interface InvoicePrintReadinessInput {
  locale: InvoicePrintLocale;
  companyName: string;
  companyNameUrdu: string;
  companyAddress: string;
  companyAddressUrdu: string;
  /** English party name after bill-to resolution; empty / — = walk-in */
  partyNameEnglish: string;
  partyNameUrdu: string;
  partyAddressEnglish: string;
  partyAddressUrdu: string;
  /** when bilty goods English is present, Urdu goods should be too */
  goodsNameEnglish: string;
  goodsNameUrdu: string;
  showGoodsField: boolean;
}

const isBlank = (value: string | null | undefined): boolean =>
  String(value ?? '').trim().length === 0;

const hasEnglish = (value: string | null | undefined): boolean =>
  !isBlank(value) && String(value).trim() !== '—';

/** gaps where Urdu print will silently fall back to English */
export const getInvoicePrintReadinessGaps = (
  input: InvoicePrintReadinessInput,
): InvoicePrintReadinessGap[] => {
  if (input.locale !== 'ur') return [];

  const gaps: InvoicePrintReadinessGap[] = [];

  if (hasEnglish(input.companyName) && isBlank(input.companyNameUrdu)) {
    gaps.push({ key: 'companyName', label: 'Company name (Urdu)' });
  }
  if (hasEnglish(input.companyAddress) && isBlank(input.companyAddressUrdu)) {
    gaps.push({ key: 'companyAddress', label: 'Company address (Urdu)' });
  }
  if (hasEnglish(input.partyNameEnglish) && isBlank(input.partyNameUrdu)) {
    gaps.push({ key: 'partyName', label: 'Party name (Urdu)' });
  }
  if (
    hasEnglish(input.partyAddressEnglish) &&
    isBlank(input.partyAddressUrdu)
  ) {
    gaps.push({ key: 'partyAddress', label: 'Party address (Urdu)' });
  }
  if (
    input.showGoodsField &&
    hasEnglish(input.goodsNameEnglish) &&
    isBlank(input.goodsNameUrdu)
  ) {
    gaps.push({ key: 'goodsName', label: 'Goods name (Urdu)' });
  }

  return gaps;
};
