import { useCallback, useState } from 'react';
import { toast } from '@/renderer/shad/ui/use-toast';
import { ipcErrorMessage } from '@/renderer/lib/ipcUserMessage';
import {
  classifyCollectionSource,
  collectionRoleFor,
  type CollectionSourceVerdict,
} from '@/core/utils/receiptAccounts';
import type { CollectionSource } from 'types';

export interface ReviewedSource extends CollectionSource {
  verdict: CollectionSourceVerdict;
}

export interface SheetRange {
  from: string;
  to: string;
}

/**
 * accounts that credited one agent's shops in the sheet range, each with a
 * verdict. flipping one writes the smallest override and refreshes the sheet.
 */
export const useCollectionSources = (
  chartId: number,
  range: SheetRange,
  onChanged: () => void,
) => {
  const [sources, setSources] = useState<ReviewedSource[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const rows = await window.electron.getCollectionSources(
        chartId,
        range.from,
        range.to,
      );
      setSources(
        rows.map((row) => ({
          ...row,
          verdict: classifyCollectionSource(row, chartId),
        })),
      );
    } catch (error) {
      toast({ description: ipcErrorMessage(error), variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [chartId, range.from, range.to]);

  const setCounts = async (source: ReviewedSource, wantCounts: boolean) => {
    setSavingId(source.accountId);
    try {
      await window.electron.setAccountCollectionRole(
        source.accountId,
        collectionRoleFor(wantCounts, source.verdict.defaultCounts),
      );
      await load();
      onChanged();
    } catch (error) {
      toast({
        title: 'Not saved',
        description: ipcErrorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

  return { sources, isLoading, savingId, load, setCounts };
};
