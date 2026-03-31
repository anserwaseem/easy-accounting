import { useCallback, useEffect, useMemo, useState } from 'react';

export interface InvoicePrintSettings {
  totalQuantityLabel: string;
}

const INVOICE_PRINT_KEYS = {
  totalQuantityLabel: 'print.totalQuantityLabel',
} as const;

const DEFAULT_TOTAL_QUANTITY_LABEL = 'Total quantity:';

const readInvoicePrintSettings = (): InvoicePrintSettings => ({
  totalQuantityLabel: String(
    window.electron.store.get(INVOICE_PRINT_KEYS.totalQuantityLabel) ??
      DEFAULT_TOTAL_QUANTITY_LABEL,
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
    window.electron.store.set(
      INVOICE_PRINT_KEYS.totalQuantityLabel,
      next.totalQuantityLabel,
    );
    setSettings(next);
  }, []);

  return useMemo(
    () => ({
      settings,
      saveInvoicePrintSettings,
      defaults: {
        totalQuantityLabel: DEFAULT_TOTAL_QUANTITY_LABEL,
      },
    }),
    [settings, saveInvoicePrintSettings],
  );
};
