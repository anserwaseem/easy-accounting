import { pick, toNumber, toString, trim } from 'lodash';
import { useEffect, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { Account, InventoryItem } from 'types';
import { InvoiceType } from 'types';
import {
  buildPartyTypingContext,
  resolvePartyRowForSplitByType,
} from '@/renderer/lib/partyAccountTyping';
import type { PartyAccount } from './useNewInvoiceParties';

const PARTY_PICK = [
  'id',
  'name',
  'type',
  'code',
  'chartId',
  'discountProfileId',
  'discountProfileIsActive',
] as const;

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

/** when split by item type is on, resolves each row to party or suffixed account and sets multipleAccountIds + resolvedRowLabels + resolvedRowCodes */
export function useNewInvoiceResolution(
  params: UseNewInvoiceResolutionParams,
): {
  resolvedRowLabels: string[];
  resolvedRowCodes: string[];
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
  const [resolvedRowCodes, setResolvedRowCodes] = useState<string[]>([]);
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
      setResolvedRowCodes([]);
      return undefined;
    }
    const singleId = toNumber(form.getValues('accountMapping.singleAccountId'));
    if (singleId <= 0) {
      setResolutionFallbacks([]);
      setResolvedRowLabels([]);
      setResolvedRowCodes([]);
      return undefined;
    }

    let cancelled = false;

    const runResolution = async () => {
      const allAccountsRaw: Account[] = await window.electron.getAccounts();
      const itemTypes = await window.electron.getItemTypes?.();
      if (cancelled) return;

      const picked = allAccountsRaw.map((account) =>
        pick(account, [...PARTY_PICK]),
      ) as PartyAccount[];
      const itemTypeNameList = (itemTypes ?? [])
        .map((it) => trim(it.name ?? ''))
        .filter((n) => n.length > 0);
      const typingCtx = buildPartyTypingContext(picked, itemTypeNameList);

      const party = resolvePartyRowForSplitByType(
        singleId,
        parties,
        picked,
        typingCtx,
      );

      if (!party?.chartId) {
        if (!cancelled) {
          setResolutionFallbacks([]);
          setResolvedRowLabels([]);
          setResolvedRowCodes([]);
        }
        return;
      }

      const primaryId = await window.electron.getPrimaryItemType?.();
      if (cancelled) return;

      const rows = form.getValues('invoiceItems') as Array<{
        inventoryId?: number;
        [key: string]: unknown;
      }>;
      const partyName = (party.name ?? '').trim();
      const partyCode = toString(party.code ?? '').trim();
      const headerAccount = picked.find((a) => a.id === singleId);
      const primaryRowLabel = trim(headerAccount?.name ?? '') || partyName;

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
            const primaryCode = trim(
              toString(headerAccount?.code ?? partyCode ?? ''),
            );
            return {
              rowIndex: item.rowIndex,
              accountId: singleId,
              label: primaryRowLabel,
              code: primaryCode,
              fallback: undefined as
                | { expectedSuffixedName: string }
                | undefined,
            };
          }
          const expectedTypeSuffix = item.suffixedName.replace(
            `${partyName}-`,
            '',
          );
          const expectedCode =
            partyCode.length > 0 ? `${partyCode}-${expectedTypeSuffix}` : '';

          const suffixedAccount =
            expectedCode.length > 0
              ? await window.electron.getAccountByNameAndCode(
                  partyName,
                  expectedCode,
                )
              : undefined;
          const chartId = toNumber(party.chartId);
          const fallbackSuffixedAccount =
            suffixedAccount?.id == null && chartId > 0
              ? await window.electron.getAccountByNameAndChart(
                  chartId,
                  item.suffixedName,
                )
              : undefined;
          const resolved = suffixedAccount ?? fallbackSuffixedAccount;

          if (resolved?.id) {
            return {
              rowIndex: item.rowIndex,
              accountId: resolved.id,
              label: resolved.name ?? item.suffixedName,
              code: trim(toString(resolved.code ?? '')),
              fallback: undefined as
                | { expectedSuffixedName: string }
                | undefined,
            };
          }
          return {
            rowIndex: item.rowIndex,
            accountId: singleId,
            label: `${partyName} (expected ${
              expectedCode.length > 0 ? expectedCode : item.suffixedName
            } – not found)`,
            code:
              expectedCode.length > 0
                ? expectedCode
                : trim(toString(partyCode)),
            fallback: {
              expectedSuffixedName:
                expectedCode.length > 0 ? expectedCode : item.suffixedName,
            },
          };
        }),
      );

      if (cancelled) return;

      const accountIds: number[] = new Array(rows.length);
      const labels: string[] = new Array(rows.length);
      const codes: string[] = new Array(rows.length);
      const fallbacks: ResolutionFallback[] = [];
      lookupResults.forEach((r) => {
        accountIds[r.rowIndex] = r.accountId;
        labels[r.rowIndex] = r.label;
        codes[r.rowIndex] = r.code;
        if (r.fallback) fallbacks.push({ rowIndex: r.rowIndex, ...r.fallback });
      });

      (form.setValue as (name: string, value: number[], opts?: object) => void)(
        'accountMapping.multipleAccountIds',
        accountIds,
        { shouldValidate: false, shouldDirty: true },
      );
      setResolutionFallbacks(fallbacks);
      setResolvedRowLabels(labels);
      setResolvedRowCodes(codes);
      onResolved?.();
    };

    runResolution();

    return () => {
      cancelled = true;
    };
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

  return { resolvedRowLabels, resolvedRowCodes, resolutionFallbacks };
}
