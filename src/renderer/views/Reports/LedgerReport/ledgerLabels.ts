export type LedgerReportLanguage = 'en' | 'ur';

export const ledgerReportLabels = (
  language: LedgerReportLanguage = 'en',
): {
  date: string;
  particulars: string;
  tierBreakdown: string;
  narration: string;
  debit: string;
  credit: string;
  balance: string;
  balanceType: string;
} => {
  if (language === 'ur') {
    return {
      date: 'تاریخ',
      particulars: 'تفصیل',
      tierBreakdown: 'تْقسیم',
      narration: 'تشریح',
      debit: 'نام',
      credit: 'جمع',
      balance: 'بقایا',
      balanceType: 'قسم',
    };
  }
  return {
    date: 'Date',
    particulars: 'Particulars',
    tierBreakdown: 'Tier breakdown',
    narration: 'Narration',
    debit: 'Debit',
    credit: 'Credit',
    balance: 'Balance',
    balanceType: 'Type',
  };
};

export type LedgerBalanceTypeLabel = 'Dr' | 'Cr' | string;

export const localizedBalanceType = (
  language: LedgerReportLanguage,
  value: LedgerBalanceTypeLabel,
): LedgerBalanceTypeLabel => {
  if (language !== 'ur') return value;
  if (value === 'Dr') return 'ڈیبٹ';
  if (value === 'Cr') return 'کریڈٹ';
  return value;
};
