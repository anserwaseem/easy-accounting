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
    /** when set, form uses this header id (e.g. typed account not listed in parties) */
    singleAccountIdOverride?: number;
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
    getAccounts?: () => Promise<
      Array<{
        id: number;
        name: string;
        type: number;
        code: string;
        chartId: number;
        discountProfileId: null;
        discountProfileIsActive: null;
      }>
    >;
    getItemTypes?: () => Promise<Array<{ id: number; name: string }>>;
  }) => {
    const headerId = opts.singleAccountIdOverride ?? opts.party.id;
    (window as any).electron = {
      getPrimaryItemType: jest.fn(async () => opts.primaryItemTypeId),
      getAccountByNameAndCode: jest.fn(
        opts.lookups.byNameAndCode ?? (async () => undefined),
      ),
      getAccountByNameAndChart: jest.fn(
        opts.lookups.byNameAndChart ?? (async () => undefined),
      ),
      getAccounts:
        opts.getAccounts ??
        jest.fn(async () => [
          {
            id: opts.party.id,
            name: opts.party.name ?? '',
            type: opts.party.type ?? 1,
            code: opts.party.code ?? '',
            chartId: opts.party.chartId ?? 0,
            discountProfileId: null,
            discountProfileIsActive: null,
          },
        ]),
      getItemTypes:
        opts.getItemTypes ?? jest.fn(async () => [{ id: 1, name: 'T' }]),
    };

    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const form = useForm<FormShape>({
        defaultValues: {
          accountMapping: {
            singleAccountId: headerId,
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
          watchedSingleAccountId: headerId,
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

  it('resolves non-primary type using catalog name when inventory omits itemTypeName', async () => {
    const party = makeParty({ id: 10, name: 'Acme', code: 'AC', chartId: 111 });
    const primaryTypeId = 1;
    const inventory: InventoryItem[] = [
      makeInv({
        id: 200,
        itemTypeId: 2,
        itemTypeName: '',
      }),
    ];

    const { hookResult, form } = setup({
      party,
      parties: [party],
      inventory,
      primaryItemTypeId: primaryTypeId,
      getItemTypes: async () => [
        { id: 1, name: 'T' },
        { id: 2, name: 'X' },
      ],
      lookups: {
        byNameAndCode: async (_name, code) =>
          code === 'AC-X' ? { id: 999, name: 'Acme-X' } : undefined,
      },
      invoiceItems: [{ id: 1, inventoryId: 200 }],
    });

    await act(async () => {});

    expect(form.getValues('accountMapping.multipleAccountIds')).toEqual([999]);
    expect(hookResult.current.resolutionFallbacks).toEqual([]);
    expect(hookResult.current.resolvedRowLabels[0]).toBe('Acme-X');
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

  it('when singleAccountId is a typed header id not in parties, resolves using base party for suffixed lookups', async () => {
    const baseParty = makeParty({
      id: 10,
      name: 'Acme',
      code: 'AC',
      chartId: 111,
    });
    const primaryTypeId = 1;
    const inventory: InventoryItem[] = [
      makeInv({ id: 100, itemTypeId: primaryTypeId, itemTypeName: 'T' }),
      makeInv({ id: 200, itemTypeId: 2, itemTypeName: 'TT' }),
    ];

    const { hookResult, form } = setup({
      party: baseParty,
      singleAccountIdOverride: 55,
      parties: [baseParty],
      inventory,
      primaryItemTypeId: primaryTypeId,
      getAccounts: async () => [
        {
          id: 10,
          name: 'Acme',
          type: 1,
          code: 'AC',
          chartId: 111,
          discountProfileId: null,
          discountProfileIsActive: null,
        },
        {
          id: 55,
          name: 'Acme-TT',
          type: 1,
          code: 'AC-TT',
          chartId: 111,
          discountProfileId: null,
          discountProfileIsActive: null,
        },
      ],
      getItemTypes: async () => [
        { id: 1, name: 'T' },
        { id: 2, name: 'TT' },
      ],
      lookups: {
        byNameAndCode: async () => undefined,
      },
      invoiceItems: [
        { id: 1, inventoryId: 100 },
        { id: 2, inventoryId: 200 },
      ],
    });

    await act(async () => {});

    const ids = form.getValues('accountMapping.multipleAccountIds');
    // row 0: global-primary T while header is TT -> unsuffixed base; row 1: TT matches header -> header id
    expect(ids).toEqual([10, 55]);
    expect(ids).toHaveLength(2);
    expect(hookResult.current.resolutionFallbacks).toEqual([]);
    expect(hookResult.current.resolvedRowLabels[0]).toBe('Acme');
    expect(hookResult.current.resolvedRowLabels[1]).toBe('Acme-TT');
  });

  it('when header is typed for T1, a global-primary line resolves to unsuffixed base (not Acme-P) not the header T1', async () => {
    const baseParty = makeParty({
      id: 10,
      name: 'Acme',
      code: 'AC',
      chartId: 111,
    });
    const inventory: InventoryItem[] = [
      makeInv({
        id: 100,
        itemTypeId: 1,
        itemTypeName: 'P',
      }),
    ];

    const { hookResult, form } = setup({
      party: baseParty,
      singleAccountIdOverride: 55,
      parties: [baseParty],
      inventory,
      primaryItemTypeId: 1,
      getAccounts: async () => [
        {
          id: 10,
          name: 'Acme',
          type: 1,
          code: 'AC',
          chartId: 111,
          discountProfileId: null,
          discountProfileIsActive: null,
        },
        {
          id: 55,
          name: 'Acme-T1',
          type: 1,
          code: 'AC-T1',
          chartId: 111,
          discountProfileId: null,
          discountProfileIsActive: null,
        },
      ],
      getItemTypes: async () => [
        { id: 1, name: 'P' },
        { id: 2, name: 'T1' },
      ],
      lookups: {
        byNameAndCode: async () => undefined,
      },
      invoiceItems: [{ id: 1, inventoryId: 100 }],
    });

    await act(async () => {});

    expect(form.getValues('accountMapping.multipleAccountIds')).toEqual([10]);
    expect(hookResult.current.resolutionFallbacks).toEqual([]);
    expect(hookResult.current.resolvedRowLabels[0]).toBe('Acme');
  });
});
