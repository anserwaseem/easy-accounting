import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Account, LedgerRangeResponse, LedgerView } from '@/types';
import type { DateRange } from '@/renderer/shad/ui/datePicker';
import {
  loadSavedFilters,
  saveSavedFilters,
  makeSavedState,
} from '@/renderer/lib/reportFilters';
import { addDays, format } from 'date-fns';
import { currency } from '@/renderer/lib/constants';
import { getFormattedCurrency } from '@/renderer/lib/utils';
import {
  buildPartyTypingContext,
  isTypedPartyAccount,
  splitPartyCode,
  splitPartyName,
} from '@/renderer/views/NewInvoice/lib/partyAccountTyping';
import {
  getPartyFamilyAccountIds,
  ledgerBalanceToSignedDrPositive,
} from '@/renderer/views/NewInvoice/lib/partyFamilyBalance';
import { BalanceType, REPORT_FILTER_KEYS } from 'types';
import { formatDisplayDate } from '@/lib/displayDate';
import { printLedgerReportIframe } from './printLedgerReport';

type LedgerReportTotals = {
  totalDebit: number;
  totalCredit: number;
  /** absolute difference (closing - opening) in signed-balance space */
  totalDifference: number;
  /** Cr/Dr for totalDifference */
  totalType: BalanceType | '';
};

export const useLedgerReport = (
  visibleColumns?: ReadonlySet<string>,
  externalFamilyMode?: boolean,
  externalSetFamilyMode?: (
    value: boolean | ((prev: boolean) => boolean),
  ) => void,
  externalLanguage?: 'en' | 'ur',
  externalSetLanguage?: (value: 'en' | 'ur') => void,
) => {
  const [internalFamilyMode, setInternalFamilyMode] = useState(false);
  const familyMode = externalFamilyMode ?? internalFamilyMode;
  const setFamilyMode = externalSetFamilyMode ?? setInternalFamilyMode;

  const saved = useMemo(() => loadSavedFilters(REPORT_FILTER_KEYS.ledger), []);

  const defaultDateRange: DateRange = useMemo(() => {
    if (saved.dateRange?.from && saved.dateRange?.to) {
      return {
        from: new Date(saved.dateRange.from),
        to: new Date(saved.dateRange.to),
      };
    }
    const now = new Date();
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  }, [saved.dateRange]);

  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    defaultDateRange,
  );
  const [presetValue, setPresetValue] = useState<string>(
    saved.presetValue ?? 'current-year',
  );
  const [selectedAccount, setSelectedAccount] = useState<number | null>(
    saved.accountId ?? null,
  );
  const [internalLanguage, setInternalLanguage] = useState<'en' | 'ur'>(
    saved.language === 'ur' ? 'ur' : 'en',
  );
  const language = externalLanguage ?? internalLanguage;
  const setLanguage = externalSetLanguage ?? setInternalLanguage;
  const [selectedAccountName, setSelectedAccountName] = useState<string>('');
  const [itemTypes, setItemTypes] = useState<Array<{ name: string }>>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [rangeResponse, setRangeResponse] =
    useState<LedgerRangeResponse | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const accountsData = await window.electron.getAccounts();
      setAccounts(accountsData || []);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (!familyMode) return;
    if (itemTypes.length > 0) return;
    (async () => {
      try {
        const types = await window.electron.getItemTypes?.();
        setItemTypes(types ?? []);
      } catch {
        setItemTypes([]);
      }
    })();
  }, [familyMode, itemTypes.length]);

  const itemTypeNames = useMemo(
    () => itemTypes.map((t) => t.name).filter(Boolean),
    [itemTypes],
  );

  const familyAccountIds = useMemo<number[]>(() => {
    if (!selectedAccount) return [];
    if (!familyMode) return [selectedAccount];
    return getPartyFamilyAccountIds(
      selectedAccount,
      accounts as any,
      itemTypeNames,
    );
  }, [familyMode, selectedAccount, accounts, itemTypeNames]);

  // persist customer + range + mode selections for easier repeat use
  useEffect(() => {
    saveSavedFilters(
      REPORT_FILTER_KEYS.ledger,
      makeSavedState(dateRange, undefined, {
        presetValue,
        familyMode,
        accountId: selectedAccount ?? undefined,
        language,
      }),
    );
  }, [selectedAccount, dateRange, presetValue, familyMode, language]);

  const filterRef = useRef(0);

  useEffect(() => {
    if (selectedAccount && accounts.length > 0) {
      const account = accounts.find((a) => a.id === selectedAccount);
      if (account) {
        setSelectedAccountName(
          language === 'ur' && account.nameUrdu
            ? account.nameUrdu
            : account.name || '',
        );
      }
    } else {
      setSelectedAccountName('');
    }
  }, [selectedAccount, accounts, language]);

  const fetchLedgerRange = useCallback(async () => {
    if (!selectedAccount || !dateRange?.from || !dateRange?.to) {
      setRangeResponse(null);
      return;
    }

    setIsLoading(true);
    filterRef.current += 1;
    const thisFilter = filterRef.current;

    // use local calendar date (avoid UTC shifting via toISOString)
    const startDate = format(dateRange.from, 'yyyy-MM-dd');
    const endDate = format(dateRange.to, 'yyyy-MM-dd');

    try {
      if (!familyMode) {
        const resp = await window.electron.reportGetLedgerRange({
          accountId: selectedAccount,
          startDate,
          endDate,
        });

        // only apply if filter hasn't changed
        if (thisFilter === filterRef.current) {
          setRangeResponse(resp);
        }
        return;
      }

      // consolidated customer family ledger: combine the base + item-type tier accounts
      const ids =
        familyAccountIds.length > 0 ? familyAccountIds : [selectedAccount];
      const dayBefore = format(addDays(dateRange.from, -1), 'yyyy-MM-dd');

      const [openBalances, entriesMap] = await Promise.all([
        window.electron.getLedgerBalancesForAccountIdsAsOfDate(ids, dayBefore),
        window.electron.getLedgerRangeForAccountIds(ids, startDate, endDate),
      ]);

      // tier label derived from the typed suffix (code authoritative, name fallback)
      const ctx = buildPartyTypingContext(accounts as any, itemTypeNames);
      const typedLabelFor = (acc: any): string => {
        if (!acc || !isTypedPartyAccount(acc, ctx)) return '';
        const codeSuffix = splitPartyCode(String(acc?.code ?? '')).suffix;
        if (
          codeSuffix &&
          ctx.itemTypeSuffixesLower.has(codeSuffix.toLowerCase())
        ) {
          return codeSuffix;
        }
        const nameSuffix = splitPartyName(String(acc?.name ?? '')).suffix;
        return nameSuffix;
      };
      const accountById = new Map((accounts as any[]).map((a) => [a.id, a]));

      let openingSigned = 0;
      for (const id of ids) {
        const b = (openBalances as any)?.[id];
        openingSigned += ledgerBalanceToSignedDrPositive(
          b ?? { balance: 0, balanceType: BalanceType.Dr },
        );
      }

      const flat: any[] = [];
      for (const id of ids) {
        const rows = (entriesMap as any)?.[id] ?? [];
        for (const r of rows) {
          flat.push({
            ...r,
            _label: typedLabelFor(
              accountById.get(r.accountId) ?? accountById.get(id),
            ),
          });
        }
      }
      flat.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        if (a.accountId !== b.accountId) return a.accountId - b.accountId;
        return (a.id ?? 0) - (b.id ?? 0);
      });

      let signed = openingSigned;
      const outEntries = flat.map((e) => {
        signed += (Number(e.debit) || 0) - (Number(e.credit) || 0);
        const prefix = e._label ? `[${e._label}] ` : '';
        return {
          id: e.id,
          date: e.date,
          accountId: e.accountId,
          particulars: `${prefix}${e.particulars ?? ''}`,
          debit: e.debit,
          credit: e.credit,
          balance: Math.abs(signed),
          balanceType: signed >= 0 ? BalanceType.Dr : BalanceType.Cr,
          linkedAccountId: e.linkedAccountId,
          linkedAccountName: e.linkedAccountName ?? undefined,
          linkedAccountCode: e.linkedAccountCode ?? undefined,
          journalSummary: e.journalSummary,
        };
      });

      // group split sale-invoice entries sharing the same invoice number + date
      // into a single invoice-level row, keeping the tier breakdown inline.
      const isSaleInvoiceEntry = (e: any) =>
        typeof e.journalSummary?.narration === 'string' &&
        /^sale invoice/i.test(e.journalSummary.narration);

      const invoiceKeyOf = (e: any) =>
        `${e.date}|${
          e.journalSummary?.billNumber ?? e.journalSummary?.invoiceId ?? ''
        }`;

      const groupMap = new Map<string, any[]>();
      for (const e of outEntries) {
        if (!isSaleInvoiceEntry(e)) continue;
        const key = invoiceKeyOf(e);
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(e);
      }
      // only keys with more than one member qualify as a split invoice
      for (const [key, members] of groupMap) {
        if (members.length <= 1) groupMap.delete(key);
      }

      const tierLineFor = (m: any): string => {
        const tier = /^\[([^\]]+)\]\s*/.exec(m.particulars ?? '')?.[1] ?? '';
        const amt = Number(m.debit || m.credit || 0);
        const disc = m.journalSummary?.discountPercentage;
        const discText =
          disc != null && disc !== '' && !Number.isNaN(Number(disc))
            ? `${Number(disc)}% — `
            : '';
        const amtText = getFormattedCurrency(amt).replace(currency, '').trim();
        return tier
          ? `${tier} · ${discText}${amtText}`
          : `${discText}${amtText}`.trim();
      };

      const seenKeys = new Set<string>();
      const groupedEntries: any[] = [];
      for (const e of outEntries) {
        if (!isSaleInvoiceEntry(e)) {
          groupedEntries.push(e);
          continue;
        }
        const key = invoiceKeyOf(e);
        const members = groupMap.get(key);
        if (!members) {
          groupedEntries.push({ ...e, tierBreakdown: tierLineFor(e) });
          continue;
        }
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const tierLines = members
          .map((m: any) => {
            const tier =
              /^\[([^\]]+)\]\s*/.exec(m.particulars ?? '')?.[1] ?? '';
            const amt = Number(m.debit || m.credit || 0);
            const disc = m.journalSummary?.discountPercentage;
            const discText =
              disc != null && disc !== '' && !Number.isNaN(Number(disc))
                ? `${Number(disc)}% — `
                : '';
            const amtText = getFormattedCurrency(amt)
              .replace(currency, '')
              .trim();
            const label = tier
              ? `${tier} · ${discText}${amtText}`
              : `${discText}${amtText}`.trim();
            return label;
          })
          .join('\n');

        const totalDebit = members.reduce(
          (a: number, m: any) => a + (Number(m.debit) || 0),
          0,
        );
        const totalCredit = members.reduce(
          (a: number, m: any) => a + (Number(m.credit) || 0),
          0,
        );
        const cleanParticulars = String(members[0].particulars ?? '').replace(
          /^\[[^\]]*\]\s*/,
          '',
        );

        groupedEntries.push({
          id: members[0].id,
          date: members[0].date,
          accountId: members[0].accountId,
          particulars: cleanParticulars,
          debit: totalDebit,
          credit: totalCredit,
          balance: 0,
          balanceType: BalanceType.Dr,
          linkedAccountId: members[0].linkedAccountId,
          linkedAccountName: members[0].linkedAccountName ?? undefined,
          linkedAccountCode: members[0].linkedAccountCode ?? undefined,
          journalSummary: members[0].journalSummary,
          tierBreakdown: tierLines,
        });
      }

      // recompute running balances cleanly for all rows in order
      let r2 = openingSigned;
      const normalized = groupedEntries.map((e: any) => {
        r2 += (Number(e.debit) || 0) - (Number(e.credit) || 0);
        return {
          ...e,
          balance: Math.abs(r2),
          balanceType: r2 >= 0 ? BalanceType.Dr : BalanceType.Cr,
        };
      });
      const finalSigned = r2;

      const consolidated: any = {
        openingBalance: {
          balance: Math.abs(openingSigned),
          balanceType: openingSigned >= 0 ? BalanceType.Dr : BalanceType.Cr,
          date: dayBefore,
        },
        entries: normalized,
        closingBalance: {
          balance: Math.abs(finalSigned),
          balanceType: finalSigned >= 0 ? BalanceType.Dr : BalanceType.Cr,
        },
      };

      if (thisFilter === filterRef.current) {
        setRangeResponse(consolidated);
      }
    } catch (error) {
      console.error('Error fetching ledger range:', error);
      if (thisFilter === filterRef.current) {
        setRangeResponse(null);
      }
    } finally {
      if (thisFilter === filterRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    selectedAccount,
    dateRange,
    familyMode,
    familyAccountIds,
    accounts,
    itemTypeNames,
  ]);

  useEffect(() => {
    fetchLedgerRange();
  }, [fetchLedgerRange]);

  const handleDateChange = useCallback(
    (range?: DateRange, selectValue?: string) => {
      if (!range) return;
      setDateRange(range);
      if (selectValue) setPresetValue(selectValue);

      // persist after debouncing
      setTimeout(() => {
        saveSavedFilters(
          REPORT_FILTER_KEYS.ledger,
          makeSavedState(range, undefined, {
            presetValue: selectValue ?? presetValue,
          }),
        );
      }, 300);
    },
    [presetValue],
  );

  const refreshData = useCallback(() => {
    fetchAccounts();
    fetchLedgerRange();
  }, [fetchAccounts, fetchLedgerRange]);

  const printDateSubtitle = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return '';
    return `${formatDisplayDate(dateRange.from)} – ${formatDisplayDate(
      dateRange.to,
    )}`;
  }, [dateRange]);

  const totals = useMemo<LedgerReportTotals>(() => {
    if (!rangeResponse) {
      return {
        totalDebit: 0,
        totalCredit: 0,
        totalDifference: 0,
        totalType: '',
      };
    }

    const totalDebit = rangeResponse.entries.reduce(
      (acc, e) => acc + e.debit,
      0,
    );
    const totalCredit = rangeResponse.entries.reduce(
      (acc, e) => acc + e.credit,
      0,
    );

    const opening = rangeResponse.openingBalance;
    const closing = rangeResponse.closingBalance;

    const toSigned = (
      b: { balance: number; balanceType: BalanceType } | null,
    ): number => {
      if (!b) return 0;
      return b.balanceType === BalanceType.Cr ? b.balance : -b.balance;
    };

    const diffSigned = toSigned(closing) - toSigned(opening);
    let totalType: BalanceType | '' = '';
    if (diffSigned > 0) totalType = BalanceType.Cr;
    if (diffSigned < 0) totalType = BalanceType.Dr;

    return {
      totalDebit,
      totalCredit,
      totalDifference: Math.abs(diffSigned),
      totalType,
    };
  }, [rangeResponse]);

  // merged entries: opening balance row (synthetic) + in-range entries + closing summary
  const displayedEntries = useMemo<LedgerView[]>(() => {
    if (!rangeResponse) return [];
    const rows: LedgerView[] = [];

    if (rangeResponse.openingBalance) {
      rows.push({
        id: 0,
        // opening balance is "as of end of previous day" relative to the selected range
        date: dateRange?.from
          ? format(addDays(dateRange.from, -1), 'yyyy-MM-dd')
          : '',
        accountId: selectedAccount ?? 0,
        particulars: language === 'ur' ? 'ابتدائی بقایا' : 'Opening Balance',
        debit: 0,
        credit: 0,
        balance: rangeResponse.openingBalance.balance,
        balanceType: rangeResponse.openingBalance.balanceType,
        linkedAccountId: undefined,
        linkedAccountName: undefined,
      });
    }

    for (const entry of rangeResponse.entries) {
      rows.push({
        id: entry.id,
        date: entry.date,
        accountId: entry.accountId,
        particulars: entry.particulars ?? '',
        debit: entry.debit,
        credit: entry.credit,
        balance: entry.balance,
        balanceType: entry.balanceType,
        linkedAccountId: entry.linkedAccountId,
        linkedAccountName:
          language === 'ur'
            ? (accounts as any[]).find((a) => a.id === entry.linkedAccountId)
                ?.nameUrdu ??
              entry.linkedAccountName ??
              undefined
            : entry.linkedAccountName ?? undefined,
        linkedAccountCode: entry.linkedAccountCode ?? undefined,
        journalSummary: entry.journalSummary,
        tierBreakdown: entry.tierBreakdown ?? undefined,
      });
    }

    return rows;
  }, [rangeResponse, dateRange, selectedAccount, language, accounts]);

  const ledgerAccountName = useMemo(() => {
    if (!familyMode) return selectedAccountName;
    const names = (accounts as any[])
      .filter((a) => familyAccountIds.includes(a.id))
      .map((a) => a.name);
    return names.length ? names.join(', ') : selectedAccountName;
  }, [familyMode, accounts, familyAccountIds, selectedAccountName]);

  // print/export should name the base customer only, not every tier
  const printAccountName = useMemo(() => {
    if (!familyMode) return selectedAccountName;
    const ctx = buildPartyTypingContext(accounts as any, itemTypeNames);
    const baseMember = (accounts as any[]).find(
      (a) => familyAccountIds.includes(a.id) && !isTypedPartyAccount(a, ctx),
    );
    return baseMember?.name ?? selectedAccountName;
  }, [
    familyMode,
    accounts,
    familyAccountIds,
    itemTypeNames,
    selectedAccountName,
  ]);

  const handlePrint = useCallback(() => {
    if (!displayedEntries.length) return;
    printLedgerReportIframe({
      rows: displayedEntries,
      accountName: printAccountName,
      dateSubtitle: printDateSubtitle,
      totals,
      visibleColumns,
      language,
    });
  }, [
    displayedEntries,
    printAccountName,
    printDateSubtitle,
    totals,
    visibleColumns,
    language,
  ]);

  return {
    accounts,
    selectedAccount,
    setSelectedAccount,
    dateRange,
    setDateRange,
    presetValue,
    handleDateChange,
    ledgerEntries: displayedEntries,
    isLoading,
    selectedAccountName,
    accountDisplayName: ledgerAccountName,
    printAccountName,
    refreshData,
    handlePrint,
    rangeResponse,
    totals,
    familyMode,
    setFamilyMode,
    familyAccountIds,
    language,
    setLanguage,
  };
};
