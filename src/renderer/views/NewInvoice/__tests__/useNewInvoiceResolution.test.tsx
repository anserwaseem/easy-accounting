import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { AccountType, InvoiceType } from 'types';
import type { InventoryItem } from 'types';
import type { PartyAccount } from '../hooks/useNewInvoiceParties';
import { useNewInvoiceResolution } from '../hooks/useNewInvoiceResolution';

interface FormShape {
  accountMapping: {
    singleAccountId?: number;
    multipleAccountIds?: number[];
  };
  invoiceItems: Array<{ id: number; inventoryId: number }>;
}

const makeParty = (overrides: Partial<PartyAccount> = {}): PartyAccount => ({
  id: overrides.id ?? 1,
  name: overrides.name ?? 'Acme',
  chartId: overrides.chartId ?? 10,
  type: overrides.type ?? AccountType.Asset,
  code: overrides.code ?? 'AC',
  discountProfileId: overrides.discountProfileId ?? null,
  discountProfileIsActive: overrides.discountProfileIsActive ?? null,
});

const makeInv = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: overrides.id ?? 101,
  name: overrides.name ?? 'Item',
  price: overrides.price ?? 100,
  quantity: overrides.quantity ?? 10,
  description: overrides.description,
  itemTypeId: overrides.itemTypeId ?? 1,
  itemTypeName: overrides.itemTypeName ?? 'T',
  createdAt: overrides.createdAt,
  updatedAt: overrides.updatedAt,
});

describe('useNewInvoiceResolution', () => {
  const setup = (opts: {
    party: PartyAccount;
    parties: PartyAccount[];
    inventory: InventoryItem[];
    primaryItemTypeId: number | undefined;
    lookups: {
      byNameAndCode?: (
        name: string,
        code?: string,
      ) => Promise<{ id: number; name: string } | undefined>;
      byNameAndChart?: (
        chartId: number,
        name: string,
      ) => Promise<{ id: number; name: string } | undefined>;
    };
    invoiceItems: Array<{ id: number; inventoryId: number }>;
  }) => {
    (window as any).electron = {
      getPrimaryItemType: jest.fn(async () => opts.primaryItemTypeId),
      getAccountByNameAndCode: jest.fn(
        opts.lookups.byNameAndCode ?? (async () => undefined),
      ),
      getAccountByNameAndChart: jest.fn(
        opts.lookups.byNameAndChart ?? (async () => undefined),
      ),
    };

    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const form = useForm<FormShape>({
        defaultValues: {
          accountMapping: {
            singleAccountId: opts.party.id,
            multipleAccountIds: [],
          },
          invoiceItems: opts.invoiceItems,
        },
      });

      (Wrapper as { form?: ReturnType<typeof useForm<FormShape>> }).form = form;
      return children;
    };

    const { result: hookResult } = renderHook(
      () => {
        const form = (
          Wrapper as { form?: ReturnType<typeof useForm<FormShape>> }
        ).form as ReturnType<typeof useForm<FormShape>>;
        return useNewInvoiceResolution({
          invoiceType: InvoiceType.Sale,
          useSingleAccount: true,
          splitByItemType: true,
          // hook expects UseFormReturn<Record<string, unknown>>
          form: form as unknown as any,
          parties: opts.parties,
          inventory: opts.inventory,
          resolutionTrigger: `${opts.invoiceItems.length}-${opts.invoiceItems
            .map((i) => i.inventoryId)
            .join(',')}`,
          watchedSingleAccountId: opts.party.id,
        });
      },
      { wrapper: Wrapper },
    );

    const form = (Wrapper as { form?: ReturnType<typeof useForm<FormShape>> })
      .form as ReturnType<typeof useForm<FormShape>>;
    return { hookResult, form };
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('resolves non-primary item types via name+code lookup (and leaves primary types on the base party)', async () => {
    const party = makeParty({ id: 10, name: 'Acme', code: 'AC', chartId: 111 });
    const primaryTypeId = 1;
    const inventory: InventoryItem[] = [
      makeInv({ id: 100, itemTypeId: primaryTypeId, itemTypeName: 'T' }),
      makeInv({ id: 200, itemTypeId: 2, itemTypeName: 'TT' }),
    ];

    const { hookResult, form } = setup({
      party,
      parties: [party],
      inventory,
      primaryItemTypeId: primaryTypeId,
      lookups: {
        byNameAndCode: async (_name, code) =>
          code === 'AC-TT' ? { id: 999, name: 'Acme-TT' } : undefined,
      },
      invoiceItems: [
        { id: 1, inventoryId: 100 }, // primary type => base party
        { id: 2, inventoryId: 200 }, // TT => suffixed
      ],
    });

    // let effect run
    await act(async () => {});

    const ids = form.getValues('accountMapping.multipleAccountIds');
    expect(ids).toEqual([party.id, 999]);
    expect(hookResult.current.resolutionFallbacks).toEqual([]);
    expect(hookResult.current.resolvedRowLabels[0]).toBe('Acme');
    expect(hookResult.current.resolvedRowLabels[1]).toBe('Acme-TT');
  });

  it('falls back to chart+name lookup when name+code is not found', async () => {
    const party = makeParty({ id: 10, name: 'Acme', code: 'AC', chartId: 111 });
    const inventory: InventoryItem[] = [
      makeInv({ id: 200, itemTypeId: 2, itemTypeName: 'TT' }),
    ];

    const { hookResult, form } = setup({
      party,
      parties: [party],
      inventory,
      primaryItemTypeId: 1,
      lookups: {
        byNameAndCode: async () => undefined,
        byNameAndChart: async (_chartId, name) =>
          name === 'Acme-TT' ? { id: 888, name: 'Acme-TT' } : undefined,
      },
      invoiceItems: [{ id: 1, inventoryId: 200 }],
    });

    await act(async () => {});

    expect(form.getValues('accountMapping.multipleAccountIds')).toEqual([888]);
    expect(hookResult.current.resolutionFallbacks).toEqual([]);
    expect(hookResult.current.resolvedRowLabels[0]).toBe('Acme-TT');
  });

  it('when suffixed account is missing, falls back to base party and reports a fallback', async () => {
    const party = makeParty({ id: 10, name: 'Acme', code: 'AC', chartId: 111 });
    const inventory: InventoryItem[] = [
      makeInv({ id: 200, itemTypeId: 2, itemTypeName: 'TT' }),
    ];

    const { hookResult, form } = setup({
      party,
      parties: [party],
      inventory,
      primaryItemTypeId: 1,
      lookups: {
        byNameAndCode: async () => undefined,
        byNameAndChart: async () => undefined,
      },
      invoiceItems: [{ id: 1, inventoryId: 200 }],
    });

    await act(async () => {});

    expect(form.getValues('accountMapping.multipleAccountIds')).toEqual([
      party.id,
    ]);
    expect(hookResult.current.resolutionFallbacks).toEqual([
      { rowIndex: 0, expectedSuffixedName: 'AC-TT' },
    ]);
    expect(hookResult.current.resolvedRowLabels[0]).toContain('not found');
  });
});
