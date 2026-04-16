import { pick, toNumber, toString, trim } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { Account, InventoryItem } from 'types';
import { InvoiceType } from 'types';
import {
  buildPartyTypingContext,
  getHeaderTypedSuffixFromCode,
  resolvePartyRowForSplitByType,
} from '@/renderer/views/NewInvoice/lib/partyAccountTyping';
import {
  buildInventoryById,
  buildItemTypeNameById,
  buildSplitRowPlans,
  findBasePartyRowInPicked,
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
  onResolved?: (changedRowIndexes: number[]) => void;
}

interface LookupRowResult {
  rowIndex: number;
  accountId: number;
  label: string;
  code: string;
  fallback?: { expectedSuffixedName: string };
}

interface ItemTypeOption {
  id: number;
  name?: string;
}

const normalizeLookupValue = (value: unknown): string =>
  trim(toString(value ?? '')).toLowerCase();

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
  const previousResolvedAccountByRowIdRef = useRef<Record<number, number>>({});
  const allAccountsRef = useRef<Account[] | null>(null);
  const itemTypesRef = useRef<ItemTypeOption[] | null>(null);
  const primaryItemTypeRef = useRef<number | undefined>(undefined);
  const primaryItemTypeLoadedRef = useRef(false);

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
      previousResolvedAccountByRowIdRef.current = {};
      return undefined;
    }
    const singleId = toNumber(form.getValues('accountMapping.singleAccountId'));
    if (singleId <= 0) {
      setResolutionFallbacks([]);
      setResolvedRowLabels([]);
      setResolvedRowCodes([]);
      previousResolvedAccountByRowIdRef.current = {};
      return undefined;
    }

    let cancelled = false;

    const runResolution = async () => {
      const accountsPromise = allAccountsRef.current
        ? Promise.resolve(allAccountsRef.current)
        : window.electron.getAccounts();
      const itemTypesPromise = itemTypesRef.current
        ? Promise.resolve(itemTypesRef.current)
        : window.electron.getItemTypes?.() ?? Promise.resolve([]);

      const [allAccountsRaw, itemTypes] = await Promise.all([
        accountsPromise,
        itemTypesPromise,
      ]);
      if (cancelled) return;
      allAccountsRef.current = allAccountsRaw;
      itemTypesRef.current = itemTypes;

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

      let primaryId = primaryItemTypeRef.current;
      if (!primaryItemTypeLoadedRef.current) {
        primaryId = await window.electron.getPrimaryItemType?.();
        if (cancelled) return;
        primaryItemTypeRef.current = primaryId;
        primaryItemTypeLoadedRef.current = true;
      }
      if (cancelled) return;

      const rows = form.getValues('invoiceItems') as Array<{
        id?: number;
        inventoryId?: number;
        [key: string]: unknown;
      }>;
      const partyName = (party.name ?? '').trim();
      const partyCode = toString(party.code ?? '').trim();
      const headerAccount = picked.find((a) => a.id === singleId);
      const primaryRowLabel = trim(headerAccount?.name ?? '') || partyName;
      const { headerIsTyped, headerSuffix } = getHeaderTypedSuffixFromCode(
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

      const accountByNameAndCode = new Map<string, Account>();
      const accountByChartAndName = new Map<string, Account>();
      allAccountsRaw.forEach((account: Account) => {
        const normalizedName = normalizeLookupValue(account.name);
        const normalizedCode = normalizeLookupValue(account.code);
        if (normalizedName.length > 0 && normalizedCode.length > 0) {
          accountByNameAndCode.set(
            `${normalizedName}::${normalizedCode}`,
            account,
          );
        }
        const normalizedChartId = toNumber(account.chartId);
        if (normalizedChartId > 0 && normalizedName.length > 0) {
          accountByChartAndName.set(
            `${normalizedChartId}::${normalizedName}`,
            account,
          );
        }
      });

      const resolveOne = (
        plan: SplitRowResolutionKind,
        rowIndex: number,
      ): LookupRowResult => {
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
            ? accountByNameAndCode.get(
                `${normalizeLookupValue(partyName)}::${normalizeLookupValue(
                  expectedCode,
                )}`,
              )
            : undefined;
        const chartId = toNumber(party.chartId);
        const fallbackSuffixedAccount =
          suffixedAccount?.id == null && chartId > 0
            ? accountByChartAndName.get(
                `${chartId}::${normalizeLookupValue(plan.suffixedName)}`,
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

      const lookupResults = plans.map((plan, rowIndex) =>
        resolveOne(plan, rowIndex),
      );

      if (cancelled) return;

      const accountIds: number[] = new Array(rows.length);
      const labels: string[] = new Array(rows.length);
      const codes: string[] = new Array(rows.length);
      const fallbacks: ResolutionFallback[] = [];
      const nextResolvedAccountByRowId: Record<number, number> = {};
      const changedRowIndexes: number[] = [];
      const previousResolvedAccountByRowId =
        previousResolvedAccountByRowIdRef.current;
      lookupResults.forEach((r) => {
        accountIds[r.rowIndex] = r.accountId;
        labels[r.rowIndex] = r.label;
        codes[r.rowIndex] = r.code;
        const rowId = toNumber(rows[r.rowIndex]?.id);
        if (rowId > 0) {
          nextResolvedAccountByRowId[rowId] = r.accountId;
          if (previousResolvedAccountByRowId[rowId] !== r.accountId) {
            changedRowIndexes.push(r.rowIndex);
          }
        } else if (previousResolvedAccountByRowId[r.rowIndex] !== r.accountId) {
          changedRowIndexes.push(r.rowIndex);
        }
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
      previousResolvedAccountByRowIdRef.current = nextResolvedAccountByRowId;
      if (changedRowIndexes.length > 0) {
        onResolved?.(changedRowIndexes);
      }
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
