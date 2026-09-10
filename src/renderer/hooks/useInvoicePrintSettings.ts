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
}

const INVOICE_PRINT_KEYS = {
  locale: 'print.locale',
  englishLabelOverrides: 'print.englishLabelOverrides',
  urduLabelOverrides: 'print.urduLabelOverrides',
  showPartyBalances: 'print.showPartyBalances',
  showAgent: 'print.showAgent',
  /** legacy key removed from Settings UI; ignored when present */
  totalQuantityLabel: 'print.totalQuantityLabel',
} as const;

const DEFAULT_LOCALE: InvoicePrintLocale = 'en';
const DEFAULT_SHOW_PARTY_BALANCES = true;
const DEFAULT_SHOW_AGENT = true;

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

const readInvoicePrintSettings = (): InvoicePrintSettings => ({
  locale: parseLocale(window.electron.store.get(INVOICE_PRINT_KEYS.locale)),
  englishLabelOverrides: parseLabelOverrides(
    window.electron.store.get(INVOICE_PRINT_KEYS.englishLabelOverrides),
  ),
  urduLabelOverrides: parseLabelOverrides(
    window.electron.store.get(INVOICE_PRINT_KEYS.urduLabelOverrides),
  ),
  showPartyBalances: parseShowPartyBalances(
    window.electron.store.get(INVOICE_PRINT_KEYS.showPartyBalances),
  ),
  showAgent: parseShowPartyBalances(
    window.electron.store.get(INVOICE_PRINT_KEYS.showAgent),
  ),
});

export const useInvoicePrintSettings = () => {
  const [settings, setSettings] = useState<InvoicePrintSettings>(() =>
    readInvoicePrintSettings(),
  );

  useEffect(() => {
    setSettings(readInvoicePrintSettings());
  }, []);

  const saveInvoicePrintSettings = useCallback((next: InvoicePrintSettings) => {
    window.electron.store.set(INVOICE_PRINT_KEYS.locale, next.locale);
    window.electron.store.set(
      INVOICE_PRINT_KEYS.englishLabelOverrides,
      next.englishLabelOverrides,
    );
    window.electron.store.set(
      INVOICE_PRINT_KEYS.urduLabelOverrides,
      next.urduLabelOverrides,
    );
    window.electron.store.set(
      INVOICE_PRINT_KEYS.showPartyBalances,
      next.showPartyBalances,
    );
    window.electron.store.set(INVOICE_PRINT_KEYS.showAgent, next.showAgent);
    setSettings(next);
  }, []);

  return useMemo(
    () => ({
      settings,
      saveInvoicePrintSettings,
      defaults: {
        locale: DEFAULT_LOCALE,
        showPartyBalances: DEFAULT_SHOW_PARTY_BALANCES,
        showAgent: DEFAULT_SHOW_AGENT,
        englishLabels: getDefaultInvoicePrintLabels('en'),
        urduLabels: getDefaultInvoicePrintLabels('ur'),
      },
    }),
    [settings, saveInvoicePrintSettings],
  );
};
