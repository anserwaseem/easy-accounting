import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, startOfYear } from 'date-fns';
import type { DateRange } from '@/renderer/shad/ui/datePicker';
import {
  loadSavedFilters,
  saveSavedFilters,
  makeSavedState,
} from '@/renderer/lib/reportFilters';
import { toLowerTrim } from '@/renderer/lib/utils';
import type { Account, PurchasesByVendorResponse } from 'types';
import { AccountType, InvoiceType, REPORT_FILTER_KEYS } from 'types';

const isVendorParty = (account: Account): boolean => {
  if (toLowerTrim(account.name) === InvoiceType.Sale.toLowerCase()) {
    return false;
  }
  if (toLowerTrim(account.name) === InvoiceType.Purchase.toLowerCase()) {
    return false;
  }
  return (
    account.type === AccountType.Liability || account.type === AccountType.Asset
  );
};

export const usePurchasesByVendor = () => {
  const saved = useMemo(
    () => loadSavedFilters(REPORT_FILTER_KEYS.purchasesByVendor),
    [],
  );

  const defaultDateRange: DateRange = useMemo(() => {
    if (saved.dateRange?.from && saved.dateRange?.to) {
      return {
        from: new Date(saved.dateRange.from),
        to: new Date(saved.dateRange.to),
      };
    }
    return { from: startOfYear(new Date()), to: new Date() };
  }, [saved.dateRange]);

  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    defaultDateRange,
  );
  const [presetValue, setPresetValue] = useState<string>(
    saved.presetValue ?? 'current-year',
  );
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(
    saved.accountIds?.[0] ?? null,
  );
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<PurchasesByVendorResponse | null>(
    null,
  );
  const filterRef = useRef(0);

  const vendors = useMemo(() => accounts.filter(isVendorParty), [accounts]);

  const selectedVendorName = useMemo(() => {
    if (selectedVendorId == null) return '';
    return (
      vendors.find((account) => account.id === selectedVendorId)?.name ?? ''
    );
  }, [selectedVendorId, vendors]);

  const persistFilters = useCallback(
    (range: DateRange | undefined, vendorId: number | null, preset: string) => {
      saveSavedFilters(
        REPORT_FILTER_KEYS.purchasesByVendor,
        makeSavedState(range, undefined, {
          presetValue: preset,
          ...(vendorId != null ? { accountIds: [vendorId] } : {}),
        }),
      );
    },
    [],
  );

  const fetchAccounts = useCallback(async () => {
    try {
      const accountsData = await window.electron.getAccounts();
      setAccounts(accountsData || []);
    } catch (error) {
      console.error('Error fetching vendor accounts:', error);
    }
  }, []);

  const fetchReport = useCallback(async () => {
    if (!selectedVendorId || !dateRange?.from || !dateRange?.to) {
      setResponse(null);
      return;
    }

    setIsLoading(true);
    filterRef.current += 1;
    const thisFilter = filterRef.current;

    const startDate = format(dateRange.from, 'yyyy-MM-dd');
    const endDate = format(dateRange.to, 'yyyy-MM-dd');

    try {
      const resp = await window.electron.reportGetPurchasesByVendor({
        vendorAccountId: selectedVendorId,
        startDate,
        endDate,
      });
      if (thisFilter === filterRef.current) {
        setResponse(resp);
      }
    } catch (error) {
      console.error('Error fetching purchases by vendor:', error);
      if (thisFilter === filterRef.current) {
        setResponse(null);
      }
    } finally {
      if (thisFilter === filterRef.current) {
        setIsLoading(false);
      }
    }
  }, [selectedVendorId, dateRange]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleDateChange = useCallback(
    (range?: DateRange, selectValue?: string) => {
      if (!range) return;
      setDateRange(range);
      const nextPreset = selectValue || presetValue;
      if (selectValue) setPresetValue(selectValue);
      persistFilters(range, selectedVendorId, nextPreset);
    },
    [persistFilters, presetValue, selectedVendorId],
  );

  const handleVendorChange = useCallback(
    (value: string | number) => {
      const vendorId = Number(value);
      setSelectedVendorId(vendorId);
      persistFilters(dateRange, vendorId, presetValue);
    },
    [dateRange, persistFilters, presetValue],
  );

  const refreshData = useCallback(() => {
    fetchAccounts();
    fetchReport();
  }, [fetchAccounts, fetchReport]);

  const dateSubtitle = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return '';
    return `${format(dateRange.from, 'PP')} – ${format(dateRange.to, 'PP')}`;
  }, [dateRange]);

  return {
    vendors,
    selectedVendorId,
    selectedVendorName,
    handleVendorChange,
    dateRange,
    handleDateChange,
    presetValue,
    isLoading,
    response,
    refreshData,
    dateSubtitle,
  };
};
