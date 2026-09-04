import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InvoicePrintLocale } from '@/renderer/lib/invoicePrint/locale';

export interface InvoicePrintSettings {
  locale: InvoicePrintLocale;
}

const INVOICE_PRINT_KEYS = {
  locale: 'print.locale',
  /** legacy key removed from Settings UI; ignored when present */
  totalQuantityLabel: 'print.totalQuantityLabel',
} as const;

const DEFAULT_LOCALE: InvoicePrintLocale = 'en';

const parseLocale = (value: unknown): InvoicePrintLocale =>
  value === 'ur' ? 'ur' : DEFAULT_LOCALE;

const readInvoicePrintSettings = (): InvoicePrintSettings => ({
  locale: parseLocale(window.electron.store.get(INVOICE_PRINT_KEYS.locale)),
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
    setSettings(next);
  }, []);

  return useMemo(
    () => ({
      settings,
      saveInvoicePrintSettings,
      defaults: {
        locale: DEFAULT_LOCALE,
      },
    }),
    [settings, saveInvoicePrintSettings],
  );
};
