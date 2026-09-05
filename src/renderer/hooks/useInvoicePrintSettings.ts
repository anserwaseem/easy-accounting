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
  /** only applied when locale is Urdu; empty/missing keys keep defaults */
  urduLabelOverrides: Partial<InvoicePrintLabels>;
}

const INVOICE_PRINT_KEYS = {
  locale: 'print.locale',
  urduLabelOverrides: 'print.urduLabelOverrides',
  /** legacy key removed from Settings UI; ignored when present */
  totalQuantityLabel: 'print.totalQuantityLabel',
} as const;

const DEFAULT_LOCALE: InvoicePrintLocale = 'en';

const parseLocale = (value: unknown): InvoicePrintLocale =>
  value === 'ur' ? 'ur' : DEFAULT_LOCALE;

const parseUrduLabelOverrides = (
  value: unknown,
): Partial<InvoicePrintLabels> => {
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
  urduLabelOverrides: parseUrduLabelOverrides(
    window.electron.store.get(INVOICE_PRINT_KEYS.urduLabelOverrides),
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
      INVOICE_PRINT_KEYS.urduLabelOverrides,
      next.urduLabelOverrides,
    );
    setSettings(next);
  }, []);

  return useMemo(
    () => ({
      settings,
      saveInvoicePrintSettings,
      defaults: {
        locale: DEFAULT_LOCALE,
        urduLabels: getDefaultInvoicePrintLabels('ur'),
      },
    }),
    [settings, saveInvoicePrintSettings],
  );
};
