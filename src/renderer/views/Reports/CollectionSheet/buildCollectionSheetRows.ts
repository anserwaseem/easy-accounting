import { format } from 'date-fns';
import { sumBy, trim } from 'lodash';
import { getFixedNumber } from '@/renderer/lib/utils';
import { formatDisplayDate, formatDisplayDayMonth } from '@/lib/displayDate';
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
  city?: string | null;
  cityUrdu?: string | null;
}

export interface CollectionSheetMoney {
  balance: number;
  balanceType: string;
  collected: number;
}

export interface CollectionSheetBill {
  invoiceNumber: number | string;
  date: string;
  /** this account's share of the bill. same invoice number is added across tiers */
  amount: number;
}

export interface CollectionSheetHeaders {
  serial: string;
  shop: string;
  address: string;
  code: string;
  balance: string;
  collected: string;
  collection: string;
  bill: string;
  billDate: string;
  difference: string;
  remaining: string;
  total: string;
  title: string;
  /** spans the per-tour columns */
  tours: string;
  untoured: string;
}

export interface CollectionSheetRow {
  id: string;
  serial: number;
  shop: string;
  /** "//" when this row's shop matches the previous row */
  shopDisplay: string;
  address: string;
  /** "//" when this row's address matches the previous row */
  addressDisplay: string;
  code: string;
  /** "//" when this row's code matches the previous row */
  codeDisplay: string;
  billNumber: string;
  billDate: string;
  /** this bill's amount, tier shares added. ledger balance only when the shop has no bill in the range */
  balance: number | null;
  collected: number | null;
  /** receipts per tour id, on the shop's first row only (0 = did not pay that tour); null on later rows */
  tourPaid: Record<number, number | null>;
  /** receipts in the range that no tour covers, first row only; null on later rows or when the column is off */
  untoured: number | null;
  /** 1-based index of this bill for the shop */
  billIndex: number;
  /** Total count of bills for this shop in this date range */
  billCount: number;
  /** Sum of all bill amounts for this shop in this date range (first row only) */
  totalBilled: number | null;
}

/** receipts per account per tour id (LedgerService.getTourCollectionsForAccountIds) */
export type CollectionSheetTourPaid = Record<number, Record<number, number>>;

interface FamilyMember {
  account: CollectionSheetSource;
  key: string;
  isTier: boolean;
  suffix: string;
  shop: string;
  address: string;
  balance: number;
  collected: number;
  tourPaid: Record<number, number>;
  untoured: number;
  bills: CollectionSheetBill[];
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

/** the bill's calendar day, in the app-wide display format. */
export const formatBillDate = (raw: string): string => formatDisplayDate(raw);

const billSortKey = (raw: string): string => {
  const trimmed = trim(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return format(parsed, 'yyyy-MM-dd');
};

export const collectionSheetHeaders = (
  language: CollectionSheetLanguage,
): CollectionSheetHeaders => {
  if (language === 'ur') {
    return {
      serial: 'نمبر',
      shop: 'نام دوکان دار',
      address: 'پتہ',
      code: 'کوڈ',
      balance: 'واجب الادا',
      collected: 'کل وصولی',
      collection: 'وصولی',
      bill: 'بل',
      billDate: 'تاریخ',
      difference: 'فرق',
      remaining: 'بقایا',
      total: 'کل',
      title: 'وصولی شیٹ',
      tours: 'دورہ وار وصولی',
      untoured: 'بغیر دورہ وصولی',
    };
  }
  return {
    serial: '#',
    shop: 'Shop',
    address: 'Address',
    code: 'Code',
    balance: 'Due amount',
    collected: 'Total Collected',
    collection: 'Collection',
    bill: 'Bill',
    billDate: 'Date',
    difference: 'Difference',
    remaining: 'Remaining',
    total: 'Total',
    title: 'Collection sheet',
    tours: 'Collected per tour',
    untoured: 'Not in a tour',
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
  tourPaid: Record<number, number>,
  untoured: number,
): FamilyMember => {
  const code = trim(String(account.code ?? ''));
  const codeLower = code.toLowerCase();
  const { baseCode, suffix } = splitPartyCode(code);
  const suffixLower = suffix.toLowerCase();
  const shop = pickLabel(language, account.name, account.nameUrdu);
  const addr = pickLabel(language, account.address ?? '', account.addressUrdu);
  const city = pickLabel(language, account.city ?? '', account.cityUrdu);
  let address = addr || city || '';
  if (addr && city) {
    address = language === 'ur' ? `${addr}، ${city}` : `${addr}, ${city}`;
  }
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
    tourPaid,
    untoured,
    bills,
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

const compareCode = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const baseDisplay = (
  family: FamilyMember[],
  language: CollectionSheetLanguage,
): { shop: string; address: string; code: string; accountId: number } => {
  const base = family.find((member) => !member.isTier);
  if (base) {
    return {
      shop: base.shop,
      address: base.address,
      code: trim(String(base.account.code ?? '')),
      accountId: base.account.id,
    };
  }
  const tier = family[0];
  const { baseName } = splitPartyName(tier.account.name ?? '');
  const { baseCode } = splitPartyCode(trim(String(tier.account.code ?? '')));
  return {
    shop: pickLabel(language, baseName, undefined),
    address: tier.address,
    code: baseCode || trim(String(tier.account.code ?? '')),
    accountId: tier.account.id,
  };
};

const mergedBills = (family: FamilyMember[]): CollectionSheetBill[] => {
  const byNumber = new Map<number | string, CollectionSheetBill>();
  for (const member of family) {
    for (const bill of member.bills) {
      const existing = byNumber.get(bill.invoiceNumber);
      if (!existing) {
        byNumber.set(bill.invoiceNumber, { ...bill, amount: bill.amount || 0 });
        continue;
      }
      existing.amount += bill.amount || 0;
    }
  }
  const bills = [...byNumber.values()];
  return bills.sort((a, b) => {
    const dateDiff = billSortKey(b.date).localeCompare(billSortKey(a.date));
    if (dateDiff !== 0) return dateDiff;
    const aNum = Number(a.invoiceNumber) || 0;
    const bNum = Number(b.invoiceNumber) || 0;
    return bNum - aNum;
  });
};

/**
 * Resolves candidate bills against current outstanding balance under FIFO.
 * Payments extinguish older debt first, so active unpaid debt rests on the newest bills.
 * If debt exceeds candidate bills, an opening balance row is created for the remainder.
 * If balance <= 0 or candidateBills is empty, returns [].
 */
export const computeDueBills = (
  candidateBills: CollectionSheetBill[],
  balance: number,
  language: CollectionSheetLanguage,
): CollectionSheetBill[] => {
  if (balance <= 0.005 || candidateBills.length === 0) {
    return [];
  }

  // Sort candidate bills descending (newest first)
  const sorted = [...candidateBills].sort((a, b) => {
    const dateDiff = billSortKey(b.date).localeCompare(billSortKey(a.date));
    if (dateDiff !== 0) return dateDiff;
    const aNum = Number(a.invoiceNumber) || 0;
    const bNum = Number(b.invoiceNumber) || 0;
    return bNum - aNum;
  });

  let remainingDue = balance;
  const dueBills: CollectionSheetBill[] = [];

  for (const bill of sorted) {
    if (remainingDue <= 0.005) break;
    const billAmt = bill.amount || 0;
    if (billAmt <= 0.005) continue;

    if (remainingDue >= billAmt - 0.005) {
      dueBills.push({
        ...bill,
        amount: billAmt,
      });
      remainingDue -= billAmt;
    } else {
      dueBills.push({
        ...bill,
        amount: remainingDue,
      });
      remainingDue = 0;
      break;
    }
  }

  if (remainingDue > 0.5) {
    dueBills.push({
      invoiceNumber: language === 'ur' ? 'سابقہ بقایا' : 'Opening Bal',
      date: '',
      amount: remainingDue,
    });
  }

  // Present chronologically: oldest due bill first, newest due bill last
  return dueBills.reverse();
};

/** a tour's family total: every tier's receipts for that tour added */
const familyTourPaid = (
  family: FamilyMember[],
  tourIds: number[],
): Record<number, number> =>
  Object.fromEntries(
    tourIds.map((tourId) => [
      tourId,
      sumBy(family, (member) => member.tourPaid[tourId] ?? 0),
    ]),
  );

/**
 * tier ledgers fold into the base shop. each row's amount is that bill, tier shares added.
 * one invoice per row. bill amount is rounded to the nearest rupee.
 * collected is the money the shop paid (receipt accounts only). a shop with none shows 0. a real collection is written once.
 * tour columns follow the same rule: the shop's first row holds each tour's receipts (0 when unpaid).
 * order is the base account code, same in Eng and Urdu.
 */
export type CollectionSheetSortBy =
  | 'code'
  | 'outstanding-desc'
  | 'unpaid-tours-desc'
  | 'bills-desc';

export const buildCollectionSheetRows = (
  accounts: CollectionSheetSource[],
  itemTypeNames: string[],
  moneyByAccountId: Record<number, CollectionSheetMoney>,
  billsByAccountId: Record<number, CollectionSheetBill[]>,
  language: CollectionSheetLanguage,
  tourIds: number[] = [],
  tourPaidByAccountId: CollectionSheetTourPaid = {},
  /** null hides the "not in a tour" column (the agent has no tours) */
  untouredByAccountId: Record<number, number> | null = null,
  sortBy: CollectionSheetSortBy = 'code',
): CollectionSheetRow[] => {
  const ctx = buildPartyTypingContext(accounts, itemTypeNames);
  const members = accounts.map((account) =>
    familyMember(
      account,
      ctx,
      language,
      moneyByAccountId[account.id],
      billsByAccountId[account.id] ?? [],
      tourPaidByAccountId[account.id] ?? {},
      untouredByAccountId?.[account.id] ?? 0,
    ),
  );
  const laterRowTourPaid: Record<number, null> = Object.fromEntries(
    tourIds.map((tourId) => [tourId, null]),
  );
  const groups = new Map<string, FamilyMember[]>();
  for (const member of members) {
    const family = groups.get(member.key) ?? [];
    family.push(member);
    groups.set(member.key, family);
  }

  const shops = [...groups.values()]
    .map((family) => {
      const display = baseDisplay(family, language);
      const balance = family.reduce((sum, member) => sum + member.balance, 0);
      const collected = family.reduce(
        (sum, member) => sum + member.collected,
        0,
      );
      const tourPaid = familyTourPaid(family, tourIds);
      const candidateBills = mergedBills(family);
      const bills = computeDueBills(candidateBills, balance, language);
      const totalBilled = bills.reduce(
        (sum, b) => sum + Math.round(b.amount || 0),
        0,
      );
      const outstanding = balance;
      const unpaidToursCount = tourIds.filter((tId) =>
        isZeroBalance(tourPaid[tId] ?? 0),
      ).length;

      return {
        display,
        balance,
        collected,
        tourPaid,
        untoured: sumBy(family, 'untoured'),
        bills,
        totalBilled,
        outstanding,
        unpaidToursCount,
      };
    })
    .filter((shop) => !isZeroBalance(shop.balance) && shop.balance > 0)
    .sort((a, b) => {
      if (sortBy === 'outstanding-desc') {
        const diff = b.outstanding - a.outstanding;
        if (Math.abs(diff) >= 0.01) return diff;
      } else if (sortBy === 'unpaid-tours-desc') {
        const diff = b.unpaidToursCount - a.unpaidToursCount;
        if (diff !== 0) return diff;
        const outDiff = b.outstanding - a.outstanding;
        if (Math.abs(outDiff) >= 0.01) return outDiff;
      } else if (sortBy === 'bills-desc') {
        const diff = b.totalBilled - a.totalBilled;
        if (Math.abs(diff) >= 0.01) return diff;
        const countDiff = b.bills.length - a.bills.length;
        if (countDiff !== 0) return countDiff;
      }
      const codeDiff = compareCode(a.display.code, b.display.code);
      if (codeDiff !== 0) return codeDiff;
      return a.display.accountId - b.display.accountId;
    });

  const rows: CollectionSheetRow[] = [];
  let previousShop = '';
  let previousAddress = '';
  let previousCode = '';
  let serial = 0;
  for (const shop of shops) {
    // no sale bill in the range: do not invent a row with an empty bill
    if (shop.bills.length === 0) continue;
    const noCollection = isZeroBalance(shop.collected);
    let collectedPlaced = false;
    for (let index = 0; index < shop.bills.length; index += 1) {
      const bill = shop.bills[index];
      let collectedCell: number | null = null;
      if (noCollection) collectedCell = 0;
      else if (!collectedPlaced) collectedCell = shop.collected;
      if (!noCollection && collectedCell != null) collectedPlaced = true;
      serial += 1;
      const sameShop =
        shop.display.shop.length > 0 && shop.display.shop === previousShop;
      previousShop = shop.display.shop;

      const sameAddress =
        shop.display.address.length > 0 &&
        shop.display.address === previousAddress;
      previousAddress = shop.display.address;

      const sameCode =
        shop.display.code.length > 0 && shop.display.code === previousCode;
      previousCode = shop.display.code;

      rows.push({
        id: `${shop.display.accountId}:${bill.invoiceNumber}`,
        serial,
        shop: shop.display.shop,
        shopDisplay: sameShop ? '//' : shop.display.shop,
        address: shop.display.address,
        addressDisplay: sameAddress ? '//' : shop.display.address,
        code: shop.display.code,
        codeDisplay: sameCode ? '//' : shop.display.code,
        billNumber: String(bill.invoiceNumber),
        billDate: formatBillDate(bill.date),
        // same rounding as the invoice screen: nearest rupee on the bill total
        balance: Math.round(bill.amount || 0),
        collected: collectedCell,
        tourPaid: index === 0 ? shop.tourPaid : laterRowTourPaid,
        untoured:
          index === 0 && untouredByAccountId != null ? shop.untoured : null,
        billIndex: index + 1,
        billCount: shop.bills.length,
        totalBilled: index === 0 ? shop.totalBilled : null,
      });
    }
  }
  return rows;
};

export const collectionSheetTotals = (
  rows: CollectionSheetRow[],
): { balance: number; collected: number } => {
  let balance = 0;
  let collected = 0;
  for (const row of rows) {
    if (row.balance != null) balance += row.balance;
    if (row.collected != null) collected += row.collected;
  }
  return { balance, collected };
};

export const formatSheetAmount = (value: number | null): string => {
  if (value == null || !Number.isFinite(value)) return '';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

/** per tour id: the sum of every shop's receipts in that tour */
export const collectionSheetTourTotals = (
  rows: CollectionSheetRow[],
  tourIds: number[],
): Record<number, number> =>
  Object.fromEntries(
    tourIds.map((tourId) => [
      tourId,
      sumBy(rows, (row) => row.tourPaid[tourId] ?? 0),
    ]),
  );

/** sum of every shop's receipts that no tour covers */
export const collectionSheetUntouredTotal = (
  rows: CollectionSheetRow[],
): number => sumBy(rows, (row) => row.untoured ?? 0);

/** money outside every tour: usually a missing or mis-dated tour */
export const isUntouredCell = (value: number | null | undefined): boolean =>
  value != null && !isZeroBalance(value);

/** a first-row tour cell of 0: the shop paid nothing on that tour */
export const isUnpaidTourCell = (value: number | null | undefined): boolean =>
  value != null && isZeroBalance(value);

/** tour cells leave zero blank; the cell's highlight says "did not pay" */
export const formatTourAmount = (value: number | null | undefined): string =>
  value == null || isZeroBalance(value) ? '' : formatSheetAmount(value);

export interface CollectionSheetTourColumn {
  id: number;
  name: string;
  startDate: string;
  endDate: string | null;
  /** cut to the sheet range; the column holds only that part of the tour */
  clipped?: boolean;
}

/** "Aug 2026 · 27 Jul–30 Aug"; a running tour shows "…" for its end, a clipped one "(part)" */
export const tourColumnHeader = (tour: CollectionSheetTourColumn): string => {
  const end = tour.endDate ? formatDisplayDayMonth(tour.endDate) : '…';
  const part = tour.clipped ? ' (part)' : '';
  return `${tour.name} · ${formatDisplayDayMonth(
    tour.startDate,
  )}–${end}${part}`;
};
