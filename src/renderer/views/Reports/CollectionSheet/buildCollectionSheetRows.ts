import { format } from 'date-fns';
import { trim } from 'lodash';
import { getFixedNumber } from '@/renderer/lib/utils';
import {
  buildPartyTypingContext,
  splitPartyCode,
  splitPartyName,
  type PartyTypingContext,
} from '@/renderer/views/NewInvoice/lib/partyAccountTyping';

export type CollectionSheetLanguage = 'en' | 'ur';

export interface CollectionSheetSource {
  id: number;
  name: string;
  code?: string | number | null;
  nameUrdu?: string | null;
  address?: string | null;
  addressUrdu?: string | null;
}

export interface CollectionSheetMoney {
  balance: number;
  balanceType: string;
  collected: number;
}

export interface CollectionSheetBill {
  invoiceNumber: number;
  date: string;
}

export interface CollectionSheetHeaders {
  serial: string;
  shop: string;
  address: string;
  code: string;
  balance: string;
  collected: string;
  collection: string;
  bills: string;
  remaining: string;
  total: string;
  title: string;
}

export interface CollectionSheetRow {
  id: number;
  serial: number;
  shop: string;
  address: string;
  /** "//" when this row's address matches the previous row */
  addressDisplay: string;
  code: string;
  /** Dr positive, Cr negative. zero rows are omitted */
  balance: number;
  collected: number;
  bills: string;
  /** discount-tier ledger sitting under its base account */
  isTier: boolean;
}

interface FamilyMember {
  account: CollectionSheetSource;
  key: string;
  isTier: boolean;
  suffix: string;
  shop: string;
  address: string;
  balance: number;
  collected: number;
  bills: string;
}

const pickLabel = (
  language: CollectionSheetLanguage,
  english: string,
  urdu: string | null | undefined,
): string => {
  if (language === 'ur') {
    const urduLabel = trim(urdu ?? '');
    if (urduLabel) return urduLabel;
  }
  return trim(english);
};

/** Dr stays positive. Cr flips to a minus. */
export const signedSheetBalance = (
  balance: number,
  balanceType: string,
): number => {
  const amount = Math.abs(balance || 0);
  if (balanceType === 'Cr') return -amount;
  return amount;
};

const isZeroBalance = (balance: number): boolean =>
  getFixedNumber(balance, 2) === 0;

/** date-only strings stay as written. timestamps use the local calendar day. */
export const formatBillDate = (raw: string): string => {
  const trimmed = trim(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-');
    return `${day}/${month}/${year.slice(2)}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return format(parsed, 'dd/MM/yy');
};

export const formatBillList = (bills: CollectionSheetBill[]): string =>
  bills
    .map((bill) => `${bill.invoiceNumber} (${formatBillDate(bill.date)})`)
    .join(', ');

export const collectionSheetHeaders = (
  language: CollectionSheetLanguage,
): CollectionSheetHeaders => {
  if (language === 'ur') {
    return {
      serial: 'نمبر',
      shop: 'نام دوکان دار',
      address: 'پتہ',
      code: 'کوڈ',
      balance: 'کھاتہ',
      collected: 'سابقہ وصولی',
      collection: 'وصولی',
      bills: 'بل',
      remaining: 'بقایا',
      total: 'کل',
      title: 'وصولی شیٹ',
    };
  }
  return {
    serial: '#',
    shop: 'Shop',
    address: 'Address',
    code: 'Code',
    balance: 'Balance',
    collected: 'Collected',
    collection: 'Collection',
    bills: 'Bills',
    remaining: 'Remaining',
    total: 'Total',
    title: 'Collection sheet',
  };
};

/**
 * family key keeps a base account next to its item-type tiers.
 * code suffix wins (KAR-USMANIA / KAR-USMANIA-T stay apart from Bon-Usmania).
 * name suffix is the fallback when the tier code is not suffixed (NOOR BOOK DEPO-T
 * shares code CHITRAL-NOOR with its base).
 */
const familyMember = (
  account: CollectionSheetSource,
  ctx: PartyTypingContext,
  language: CollectionSheetLanguage,
  money: CollectionSheetMoney | undefined,
  bills: CollectionSheetBill[],
): FamilyMember => {
  const code = trim(String(account.code ?? ''));
  const codeLower = code.toLowerCase();
  const { baseCode, suffix } = splitPartyCode(code);
  const suffixLower = suffix.toLowerCase();
  const shop = pickLabel(language, account.name, account.nameUrdu);
  const address = pickLabel(
    language,
    account.address ?? '',
    account.addressUrdu,
  );
  const balance = signedSheetBalance(
    money?.balance ?? 0,
    money?.balanceType ?? '',
  );

  const shared = {
    account,
    shop,
    address,
    balance,
    collected: money?.collected ?? 0,
    bills: formatBillList(bills),
  };

  if (
    suffix &&
    ctx.itemTypeSuffixesLower.has(suffixLower) &&
    ctx.allCodesLower.has(baseCode.toLowerCase())
  ) {
    return {
      ...shared,
      key: `c:${baseCode.toLowerCase()}`,
      isTier: true,
      suffix,
    };
  }

  const { baseName, suffix: nameSuffix } = splitPartyName(account.name ?? '');
  const nameSuffixLower = nameSuffix.toLowerCase();
  if (
    nameSuffix &&
    ctx.itemTypeSuffixesLower.has(nameSuffixLower) &&
    ctx.allNamesLower.has(trim(baseName).toLowerCase())
  ) {
    return {
      ...shared,
      key: code ? `c:${codeLower}` : `n:${trim(baseName).toLowerCase()}`,
      isTier: true,
      suffix: nameSuffix,
    };
  }

  return {
    ...shared,
    key: code ? `c:${codeLower}` : `n:${trim(account.name).toLowerCase()}`,
    isTier: false,
    suffix: '',
  };
};

/**
 * zero balances dropped.
 * order matches bills aging's default: account code, case-insensitive, numeric.
 * code does not change with the Eng/Urdu toggle, so the row order stays put.
 */
export const buildCollectionSheetRows = (
  accounts: CollectionSheetSource[],
  itemTypeNames: string[],
  moneyByAccountId: Record<number, CollectionSheetMoney>,
  billsByAccountId: Record<number, CollectionSheetBill[]>,
  language: CollectionSheetLanguage,
): CollectionSheetRow[] => {
  const ctx = buildPartyTypingContext(accounts, itemTypeNames);
  const members = accounts.map((account) =>
    familyMember(
      account,
      ctx,
      language,
      moneyByAccountId[account.id],
      billsByAccountId[account.id] ?? [],
    ),
  );
  const flat = [...members]
    .filter((member) => !isZeroBalance(member.balance))
    .sort((a, b) => {
      const codeA = trim(String(a.account.code ?? ''));
      const codeB = trim(String(b.account.code ?? ''));
      const codeDiff = codeA.localeCompare(codeB, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (codeDiff !== 0) return codeDiff;
      return a.account.id - b.account.id;
    });

  let previousAddress = '';
  return flat.map((member, index) => {
    const sameAddress =
      member.address.length > 0 && member.address === previousAddress;
    previousAddress = member.address;
    return {
      id: member.account.id,
      serial: index + 1,
      shop: member.shop,
      address: member.address,
      addressDisplay: sameAddress ? '//' : member.address,
      code: trim(String(member.account.code ?? '')),
      balance: member.balance,
      collected: member.collected,
      bills: member.bills,
      isTier: member.isTier,
    };
  });
};

export const collectionSheetTotals = (
  rows: CollectionSheetRow[],
): { balance: number; collected: number } => {
  let balance = 0;
  let collected = 0;
  for (const row of rows) {
    balance += row.balance || 0;
    collected += row.collected || 0;
  }
  return { balance, collected };
};

export const formatSheetAmount = (value: number): string => {
  if (!Number.isFinite(value)) return '';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
};
