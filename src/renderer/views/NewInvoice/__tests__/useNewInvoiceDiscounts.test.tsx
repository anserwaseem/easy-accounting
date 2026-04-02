import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { InvoiceType } from 'types';
import { useNewInvoiceDiscounts } from '../hooks/useNewInvoiceDiscounts';

interface FormShape {
  accountMapping: {
    singleAccountId?: number;
    multipleAccountIds?: number[];
  };
  invoiceItems: Array<{
    id: number;
    inventoryId: number;
    quantity: number;
    discount: number;
    price: number;
    discountedPrice: number;
  }>;
}

describe('useNewInvoiceDiscounts', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('applyAutoDiscountForRow sets discount + discountedPrice using window.electron.getAutoDiscount (sale only)', async () => {
    (window as any).electron = {
      getAutoDiscount: jest.fn(async () => 12.5),
    };

    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const form = useForm<FormShape>({
        defaultValues: {
          accountMapping: { singleAccountId: 10, multipleAccountIds: [] },
          invoiceItems: [
            {
              id: 1,
              inventoryId: 100,
              quantity: 2,
              discount: 0,
              price: 200,
              discountedPrice: 0,
            },
          ],
        },
      });
      (Wrapper as { form?: ReturnType<typeof useForm<FormShape>> }).form = form;
      return children;
    };

    const { result } = renderHook(
      () => {
        const form = (
          Wrapper as { form?: ReturnType<typeof useForm<FormShape>> }
        ).form as ReturnType<typeof useForm<FormShape>>;
        return useNewInvoiceDiscounts({
          invoiceType: InvoiceType.Sale,
          form: form as unknown as any,
          useSingleAccount: true,
          useSingleAccountRef: {
            current: true,
          } as React.MutableRefObject<boolean>,
          splitByItemTypeRef: {
            current: false,
          } as React.MutableRefObject<boolean>,
          parties: [
            {
              id: 10,
              name: 'Party',
              type: undefined as unknown as any,
              code: 'P',
              chartId: 1,
              discountProfileId: null,
              discountProfileIsActive: null,
            },
          ],
          sections: [],
          rowSectionMap: {},
          watchedSingleAccountId: 10,
        });
      },
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.applyAutoDiscountForRow(0);
    });

    const form = (Wrapper as { form?: ReturnType<typeof useForm<FormShape>> })
      .form as ReturnType<typeof useForm<FormShape>>;
    expect((window as any).electron.getAutoDiscount).toHaveBeenCalledWith(
      10,
      100,
    );
    expect(form.getValues('invoiceItems.0.discount')).toBe(12.5);

    const expected = 2 * 200 * (1 - 12.5 / 100);
    expect(form.getValues('invoiceItems.0.discountedPrice')).toBe(expected);
  });

  it('recalculateAutoDiscounts skips rows marked manual when discount-edit feature flag is enabled (current flag is off, so it recalculates all rows)', async () => {
    (window as any).electron = {
      getAutoDiscount: jest.fn(
        async (_accountId: number, inventoryId: number) =>
          inventoryId === 100 ? 10 : 20,
      ),
    };

    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const form = useForm<FormShape>({
        defaultValues: {
          accountMapping: { singleAccountId: 10, multipleAccountIds: [] },
          invoiceItems: [
            {
              id: 1,
              inventoryId: 100,
              quantity: 1,
              discount: 0,
              price: 100,
              discountedPrice: 0,
            },
            {
              id: 2,
              inventoryId: 200,
              quantity: 1,
              discount: 0,
              price: 100,
              discountedPrice: 0,
            },
          ],
        },
      });
      (Wrapper as { form?: ReturnType<typeof useForm<FormShape>> }).form = form;
      return children;
    };

    const { result } = renderHook(
      () => {
        const form = (
          Wrapper as { form?: ReturnType<typeof useForm<FormShape>> }
        ).form as ReturnType<typeof useForm<FormShape>>;
        return useNewInvoiceDiscounts({
          invoiceType: InvoiceType.Sale,
          form: form as unknown as any,
          useSingleAccount: true,
          useSingleAccountRef: {
            current: true,
          } as React.MutableRefObject<boolean>,
          splitByItemTypeRef: {
            current: false,
          } as React.MutableRefObject<boolean>,
          parties: [
            {
              id: 10,
              name: 'Party',
              type: undefined as unknown as any,
              code: 'P',
              chartId: 1,
              discountProfileId: null,
              discountProfileIsActive: null,
            },
          ],
          sections: [],
          rowSectionMap: {},
          watchedSingleAccountId: 10,
        });
      },
      { wrapper: Wrapper },
    );

    // mark row 1 as manual; current FF is off so it should still recalc it.
    await act(async () => {
      result.current.setManualDiscountRows({ 2: true });
    });

    await act(async () => {
      await result.current.recalculateAutoDiscounts();
    });

    const form = (Wrapper as { form?: ReturnType<typeof useForm<FormShape>> })
      .form as ReturnType<typeof useForm<FormShape>>;
    expect(form.getValues('invoiceItems.0.discount')).toBe(10);
    expect(form.getValues('invoiceItems.1.discount')).toBe(20);
  });
});
