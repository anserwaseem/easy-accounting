import { useEffect, useState } from 'react';
import type { SaleReturnSource } from 'types';

/** loads the sale lines a Return items screen can copy */
export function useSaleReturnSource(invoiceId: number): {
  source: SaleReturnSource | null;
  error: string | null;
} {
  const [source, setSource] = useState<SaleReturnSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!(invoiceId > 0)) {
      setError('Sale invoice not found.');
      return undefined;
    }
    let cancelled = false;
    setSource(null);
    setError(null);
    window.electron
      .getSaleReturnSource(invoiceId)
      .then((loaded: SaleReturnSource) => {
        if (!cancelled) setSource(loaded);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'Could not load the sale.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  return { source, error };
}
