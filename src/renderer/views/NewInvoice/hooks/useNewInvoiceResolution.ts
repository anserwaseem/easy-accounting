import { toNumber } from 'lodash';
import { useEffect, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { InventoryItem } from 'types';
import { InvoiceType } from 'types';
import type { PartyAccount } from './useNewInvoiceParties';

export interface ResolutionFallback {
  rowIndex: number;
  expectedSuffixedName: string;
}

export interface UseNewInvoiceResolutionParams {
  invoiceType: InvoiceType;
  useSingleAccount: boolean;
  splitByItemType: boolean;
  form: UseFormReturn<Record<string, unknown>>;
  parties: PartyAccount[] | undefined;
  inventory: InventoryItem[] | undefined;
  resolutionTrigger: string;
  watchedSingleAccountId: unknown;
  onResolved?: () => void;
}

/** when split by item type is on, resolves each row to party or suffixed account and sets multipleAccountIds + resolvedRowLabels */
export function useNewInvoiceResolution(
  params: UseNewInvoiceResolutionParams,
): {
  resolvedRowLabels: string[];
  resolutionFallbacks: ResolutionFallback[];
} {
  const {
    invoiceType,
    useSingleAccount,
    splitByItemType,
    form,
    parties,
    inventory,
    resolutionTrigger,
    watchedSingleAccountId,
    onResolved,
  } = params;

  const [resolvedRowLabels, setResolvedRowLabels] = useState<string[]>([]);
  const [resolutionFallbacks, setResolutionFallbacks] = useState<
    ResolutionFallback[]
  >([]);

  useEffect(() => {
    if (
      invoiceType !== InvoiceType.Sale ||
      !useSingleAccount ||
      !splitByItemType ||
      !parties?.length ||
      !inventory?.length
    ) {
      setResolutionFallbacks([]);
      setResolvedRowLabels([]);
      return;
    }
    const singleId = toNumber(form.getValues('accountMapping.singleAccountId'));
    if (singleId <= 0) {
      setResolutionFallbacks([]);
      setResolvedRowLabels([]);
      return;
    }

    const party = parties.find((p) => p.id === singleId);
    if (!party?.chartId) {
      setResolutionFallbacks([]);
      setResolvedRowLabels([]);
      return;
    }

    const runResolution = async () => {
      const primaryId = await window.electron.getPrimaryItemType?.();
      const rows = form.getValues('invoiceItems') as Array<{
        inventoryId?: number;
        [key: string]: unknown;
      }>;
      const partyName = (party.name ?? '').trim();

      const needLookup: Array<{ rowIndex: number; suffixedName: string }> = [];

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const invId = toNumber(rows[rowIndex]?.inventoryId);
        const invItem = inventory?.find((i) => i.id === invId);
        const itemTypeId = invItem?.itemTypeId ?? null;
        const itemTypeName = invItem?.itemTypeName?.trim() ?? null;

        if (
          primaryId == null ||
          itemTypeId == null ||
          itemTypeName == null ||
          itemTypeId === primaryId
        ) {
          needLookup.push({ rowIndex, suffixedName: '' });
          continue;
        }
        needLookup.push({
          rowIndex,
          suffixedName: `${partyName}-${itemTypeName}`,
        });
      }

      const lookupResults = await Promise.all(
        needLookup.map(async (item) => {
          if (!item.suffixedName) {
            return {
              rowIndex: item.rowIndex,
              accountId: singleId,
              label: partyName,
              fallback: undefined as
                | { expectedSuffixedName: string }
                | undefined,
            };
          }
          const suffixedAccount =
            await window.electron.getAccountByNameAndChart(
              party.chartId,
              item.suffixedName,
            );
          if (suffixedAccount?.id) {
            return {
              rowIndex: item.rowIndex,
              accountId: suffixedAccount.id,
              label: suffixedAccount.name ?? item.suffixedName,
              fallback: undefined as
                | { expectedSuffixedName: string }
                | undefined,
            };
          }
          return {
            rowIndex: item.rowIndex,
            accountId: singleId,
            label: `${partyName} (expected ${item.suffixedName} – not found)`,
            fallback: { expectedSuffixedName: item.suffixedName },
          };
        }),
      );

      const accountIds: number[] = new Array(rows.length);
      const labels: string[] = new Array(rows.length);
      const fallbacks: ResolutionFallback[] = [];
      lookupResults.forEach((r) => {
        accountIds[r.rowIndex] = r.accountId;
        labels[r.rowIndex] = r.label;
        if (r.fallback) fallbacks.push({ rowIndex: r.rowIndex, ...r.fallback });
      });

      (form.setValue as (name: string, value: number[], opts?: object) => void)(
        'accountMapping.multipleAccountIds',
        accountIds,
        { shouldValidate: false, shouldDirty: true },
      );
      setResolutionFallbacks(fallbacks);
      setResolvedRowLabels(labels);
      onResolved?.();
    };

    runResolution();
  }, [
    form,
    invoiceType,
    inventory,
    onResolved,
    parties,
    resolutionTrigger,
    splitByItemType,
    useSingleAccount,
    watchedSingleAccountId,
  ]);

  return { resolvedRowLabels, resolutionFallbacks };
}
