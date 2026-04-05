import { pick, toNumber, toString, trim } from 'lodash';
import { useEffect, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { Account, InventoryItem } from 'types';
import { InvoiceType } from 'types';
import {
  buildPartyTypingContext,
  resolvePartyRowForSplitByType,
} from '@/renderer/views/NewInvoice/lib/partyAccountTyping';
import {
  buildInventoryById,
  buildItemTypeNameById,
  buildSplitRowPlans,
  findBasePartyRowInPicked,
  getHeaderTypedSuffix,
  type SplitRowResolutionKind,
} from '../lib/splitInvoiceRowResolution';
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

interface LookupRowResult {
  rowIndex: number;
  accountId: number;
  label: string;
  code: string;
  fallback?: { expectedSuffixedName: string };
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
      const [allAccountsRaw, itemTypes] = await Promise.all([
        window.electron.getAccounts(),
        window.electron.getItemTypes?.() ?? Promise.resolve([]),
      ]);
      if (cancelled) return;

      const picked = allAccountsRaw.map((account: Account) =>
        pick(account, [...PARTY_PICK]),
      ) as PartyAccount[];
      const itemTypeNameList = (itemTypes ?? [])
        .map((it) => trim(it.name ?? ''))
        .filter((n) => n.length > 0);
      const itemTypeNameById = buildItemTypeNameById(itemTypes);
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
      const { headerIsTyped, headerSuffix } = getHeaderTypedSuffix(
        headerAccount,
        typingCtx,
      );
      const primaryNum = primaryId != null ? toNumber(primaryId) : Number.NaN;

      const invById = buildInventoryById(inventory);
      const plans = buildSplitRowPlans(
        rows,
        invById,
        itemTypeNameById,
        partyName,
        primaryId,
        primaryNum,
        headerIsTyped,
        headerSuffix,
      );

      const resolveOne = async (
        plan: SplitRowResolutionKind,
        rowIndex: number,
      ): Promise<LookupRowResult> => {
        if (plan.kind === 'header') {
          return {
            rowIndex,
            accountId: singleId,
            label: primaryRowLabel,
            code: trim(toString(headerAccount?.code ?? partyCode ?? '')),
          };
        }
        if (plan.kind === 'base') {
          const baseRow = findBasePartyRowInPicked(
            picked,
            partyName,
            partyCode,
          );
          const baseId = toNumber(baseRow?.id ?? 0);
          return {
            rowIndex,
            accountId: baseId > 0 ? baseId : singleId,
            label: trim(baseRow?.name ?? '') || partyName,
            code: trim(toString(baseRow?.code ?? partyCode ?? '')),
          };
        }

        const expectedTypeSuffix = plan.suffixedName.replace(
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
                plan.suffixedName,
              )
            : undefined;
        const resolved = suffixedAccount ?? fallbackSuffixedAccount;

        if (resolved?.id) {
          return {
            rowIndex,
            accountId: resolved.id,
            label: resolved.name ?? plan.suffixedName,
            code: trim(toString(resolved.code ?? '')),
          };
        }
        const notFoundCode =
          expectedCode.length > 0 ? expectedCode : trim(toString(partyCode));
        return {
          rowIndex,
          accountId: singleId,
          label: `${partyName} (expected ${
            expectedCode.length > 0 ? expectedCode : plan.suffixedName
          } – not found)`,
          code: notFoundCode,
          fallback: {
            expectedSuffixedName:
              expectedCode.length > 0 ? expectedCode : plan.suffixedName,
          },
        };
      };

      const lookupResults = await Promise.all(
        plans.map((plan, rowIndex) => resolveOne(plan, rowIndex)),
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
        if (r.fallback) {
          fallbacks.push({ rowIndex: r.rowIndex, ...r.fallback });
        }
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
