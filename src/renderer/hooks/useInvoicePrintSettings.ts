import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  InvoicePrintLabelKey,
  InvoicePrintLabels,
  InvoicePrintLocale,
} from '@/renderer/lib/invoicePrint/locale';
import {
  getDefaultInvoicePrintLabels,
  INVOICE_PRINT_LABEL_KEYS,
} from '@/renderer/lib/invoicePrint/locale';
import { INVOICE_PRINT_SETTING_KEYS as KEYS } from '@/core/services/businessSettingKeys';

export interface InvoicePrintSettings {
  locale: InvoicePrintLocale;
  /** empty/missing keys keep built-in English defaults */
  englishLabelOverrides: Partial<InvoicePrintLabels>;
  /** only applied when locale is Urdu; empty/missing keys keep defaults */
  urduLabelOverrides: Partial<InvoicePrintLabels>;
  /** سابقہ بقایا / نیا بقایا on named-party invoices */
  showPartyBalances: boolean;
  /** custom-head / marketing representative name on the party row */
  showAgent: boolean;
  /** CREDIT / ادھار stamp on named-party sale invoices */
  showBillBalance: boolean;
}

const DEFAULT_LOCALE: InvoicePrintLocale = 'en';
const DEFAULT_SHOW_PARTY_BALANCES = true;
const DEFAULT_SHOW_AGENT = true;
const DEFAULT_SHOW_BILL_BALANCE = true;

const SYNC_APPLIED_EVENT = 'easyaccounting:sync-applied';

const parseLocale = (value: unknown): InvoicePrintLocale =>
  value === 'ur' ? 'ur' : DEFAULT_LOCALE;

const parseShowPartyBalances = (value: unknown): boolean => value !== false;

const parseLabelOverrides = (value: unknown): Partial<InvoicePrintLabels> => {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const next: Partial<InvoicePrintLabels> = {};
  INVOICE_PRINT_LABEL_KEYS.forEach((key: InvoicePrintLabelKey) => {
    const candidate = raw[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      next[key] = candidate.trim();
    }
  });
  return next;
};

const DEFAULT_PRINT: InvoicePrintSettings = {
  locale: DEFAULT_LOCALE,
  englishLabelOverrides: {},
  urduLabelOverrides: {},
  showPartyBalances: DEFAULT_SHOW_PARTY_BALANCES,
  showAgent: DEFAULT_SHOW_AGENT,
  showBillBalance: DEFAULT_SHOW_BILL_BALANCE,
};

const readInvoicePrintSettings = async (): Promise<InvoicePrintSettings> => {
  if (!window.electron.getSetting) return DEFAULT_PRINT;
  const [
    locale,
    englishLabelOverrides,
    urduLabelOverrides,
    showPartyBalances,
    showAgent,
    showBillBalance,
  ] = await Promise.all([
    window.electron.getSetting(KEYS.locale),
    window.electron.getSetting(KEYS.englishLabelOverrides),
    window.electron.getSetting(KEYS.urduLabelOverrides),
    window.electron.getSetting(KEYS.showPartyBalances),
    window.electron.getSetting(KEYS.showAgent),
    window.electron.getSetting(KEYS.showBillBalance),
  ]);
  return {
    locale: parseLocale(locale),
    englishLabelOverrides: parseLabelOverrides(englishLabelOverrides),
    urduLabelOverrides: parseLabelOverrides(urduLabelOverrides),
    showPartyBalances: parseShowPartyBalances(showPartyBalances),
    showAgent: parseShowPartyBalances(showAgent),
    showBillBalance: parseShowPartyBalances(showBillBalance),
  };
};

export const useInvoicePrintSettings = () => {
  const [settings, setSettings] = useState<InvoicePrintSettings>(DEFAULT_PRINT);

  const refresh = useCallback(async () => {
    setSettings(await readInvoicePrintSettings());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(SYNC_APPLIED_EVENT, refresh);
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, refresh);
  }, [refresh]);

  const saveInvoicePrintSettings = useCallback(
    async (next: InvoicePrintSettings) => {
      if (!window.electron.setSetting) return;
      await Promise.all([
        window.electron.setSetting(KEYS.locale, next.locale),
        window.electron.setSetting(
          KEYS.englishLabelOverrides,
          next.englishLabelOverrides,
        ),
        window.electron.setSetting(
          KEYS.urduLabelOverrides,
          next.urduLabelOverrides,
        ),
        window.electron.setSetting(
          KEYS.showPartyBalances,
          next.showPartyBalances,
        ),
        window.electron.setSetting(KEYS.showAgent, next.showAgent),
        window.electron.setSetting(KEYS.showBillBalance, next.showBillBalance),
      ]);
      setSettings(next);
    },
    [],
  );

  return useMemo(
    () => ({
      settings,
      saveInvoicePrintSettings,
      defaults: {
        locale: DEFAULT_LOCALE,
        showPartyBalances: DEFAULT_SHOW_PARTY_BALANCES,
        showAgent: DEFAULT_SHOW_AGENT,
        showBillBalance: DEFAULT_SHOW_BILL_BALANCE,
        englishLabels: getDefaultInvoicePrintLabels('en'),
        urduLabels: getDefaultInvoicePrintLabels('ur'),
      },
    }),
    [settings, saveInvoicePrintSettings],
  );
};
