import { act, renderHook, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { InvoiceType } from 'types';
import { useNewInvoiceSections } from '../useNewInvoiceSections';

describe('useNewInvoiceSections', () => {
  it('creates initial section when multi-customer sale mounts with no sections', async () => {
    const { result } = renderHook(() => {
      const form = useForm<Record<string, unknown>>({
        defaultValues: {
          accountMapping: {
            singleAccountId: undefined,
            multipleAccountIds: [],
          },
          invoiceItems: [{ id: 1, inventoryId: 10 }],
        },
      });
      const hook = useNewInvoiceSections({
        invoiceType: InvoiceType.Sale,
        useSingleAccount: false,
        splitByItemType: false,
        form,
        watchedInvoiceItems: [{ id: 1, inventoryId: 10 }],
      });
      return { form, hook };
    });

    await waitFor(() => {
      expect(result.current.hook.sections.length).toBe(1);
      expect(result.current.hook.activeSectionId).not.toBeNull();
    });
  });

  it('syncs multipleAccountIds from section account ids per row', async () => {
    const { result } = renderHook(() => {
      const form = useForm<Record<string, unknown>>({
        defaultValues: {
          accountMapping: {
            singleAccountId: undefined,
            multipleAccountIds: [],
          },
          invoiceItems: [
            { id: 10, inventoryId: 1 },
            { id: 20, inventoryId: 2 },
          ],
        },
      });
      const hook = useNewInvoiceSections({
        invoiceType: InvoiceType.Sale,
        useSingleAccount: false,
        splitByItemType: false,
        form,
        watchedInvoiceItems: [
          { id: 10, inventoryId: 1 },
          { id: 20, inventoryId: 2 },
        ],
      });
      return { form, hook };
    });

    const sectionA = 'section-a';
    const sectionB = 'section-b';

    act(() => {
      result.current.hook.setSections([
        { id: sectionA, accountId: 100 },
        { id: sectionB, accountId: 200 },
      ]);
      result.current.hook.setActiveSectionId(sectionA);
      result.current.hook.setRowSectionMap({
        10: sectionA,
        20: sectionB,
      });
    });

    await waitFor(() => {
      const raw = result.current.form.getValues(
        'accountMapping.multipleAccountIds',
      ) as unknown;
      expect(Array.isArray(raw) ? raw : []).toEqual([100, 200]);
    });
  });

  it('clears stale multipleAccountIds on mount when single-account and split is off', async () => {
    const { result } = renderHook(() => {
      const form = useForm<Record<string, unknown>>({
        defaultValues: {
          accountMapping: {
            singleAccountId: 10,
            multipleAccountIds: [5, 6],
          },
          invoiceItems: [{ id: 1, inventoryId: 1 }],
        },
      });
      const hook = useNewInvoiceSections({
        invoiceType: InvoiceType.Sale,
        useSingleAccount: true,
        splitByItemType: false,
        form,
        watchedInvoiceItems: [{ id: 1, inventoryId: 1 }],
      });
      return { form, hook };
    });

    await waitFor(() => {
      expect(
        result.current.form.getValues('accountMapping.multipleAccountIds'),
      ).toEqual([]);
    });
  });
});
