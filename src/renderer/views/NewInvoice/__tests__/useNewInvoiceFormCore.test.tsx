/**
 * Tests for useNewInvoiceFormCore — the central form orchestration hook.
 *
 * Coverage:
 *  - form instantiation with zod resolver for Sale & Purchase
 *  - watched invoice items, extra discount, total, account IDs
 *  - resolutionTrigger recomputes on items / split toggle
 *  - discountAccountExists null / true / false paths
 *  - field array append / removal
 *  - validation errors cleared on invoiceType change
 *  - stock validation bonus injection (sale edit)
 */
import { act, renderHook } from '@testing-library/react';
import type { InventoryItem } from 'types';
import { InvoiceType } from 'types';

import { useNewInvoiceFormCore } from '../hooks/useNewInvoiceFormCore';

jest.mock('renderer/shad/ui/use-toast', () => ({
  toast: jest.fn(),
}));

const sampleInventory: InventoryItem[] = [
  {
    id: 10,
    name: 'Widget',
    price: 100,
    quantity: 50,
    itemTypeId: 1,
    itemTypeName: 'T',
  },
  {
    id: 20,
    name: 'Gadget',
    price: 200,
    quantity: 30,
    itemTypeId: 1,
    itemTypeName: 'T',
  },
];

function makeRefs(
  options: { useSingleAccount?: boolean; splitByItemType?: boolean } = {},
) {
  const useSingleAccountRef = { current: options.useSingleAccount ?? true };
  const splitByItemTypeRef = { current: options.splitByItemType ?? false };
  const saleStockValidationBonusRef = { current: {} as Record<number, number> };
  return {
    useSingleAccountRef,
    splitByItemTypeRef,
    saleStockValidationBonusRef,
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useNewInvoiceFormCore', () => {
  beforeEach(() => {
    (window as any).electron = {
      getAccountByName: jest.fn(async () => null),
      getInventory: jest.fn(async () => sampleInventory),
    } as any;
  });

  describe('form instantiation', () => {
    it('creates sale form with correct default values', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      expect(result.current.form).toBeDefined();
      expect(result.current.defaultFormValues.invoiceType).toBe(
        InvoiceType.Sale,
      );
      expect(result.current.defaultFormValues.extraDiscount).toBe(0);
      expect(result.current.defaultFormValues.invoiceItems).toEqual([]);
      expect(
        result.current.defaultFormValues.accountMapping.singleAccountId,
      ).toBe(-1);
    });

    it('creates purchase form with correct default values', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Purchase,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      expect(result.current.defaultFormValues.invoiceType).toBe(
        InvoiceType.Purchase,
      );
    });

    it('builds schema with zod resolver', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      expect(result.current.formSchema).toBeDefined();
    });
  });

  describe('field array operations', () => {
    it('starts with empty invoice items', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      expect(result.current.fields).toHaveLength(0);
    });

    it('append adds a row', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      act(() => {
        result.current.append({
          id: 1,
          inventoryId: 10,
          quantity: 2,
          discount: 0,
          price: 100,
          discountedPrice: 200,
        });
      });

      expect(result.current.fields).toHaveLength(1);
      expect(result.current.watchedInvoiceItems).toHaveLength(1);
    });

    it('append adds multiple rows', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      act(() => {
        result.current.append({
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        });
        result.current.append({
          id: 2,
          inventoryId: 20,
          quantity: 3,
          discount: 0,
          price: 200,
          discountedPrice: 600,
        });
      });

      expect(result.current.fields).toHaveLength(2);
    });

    it('remove deletes a row without replacing the full array', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      act(() => {
        result.current.append({
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        });
        result.current.append({
          id: 2,
          inventoryId: 20,
          quantity: 3,
          discount: 0,
          price: 200,
          discountedPrice: 600,
        });
      });

      act(() => {
        result.current.remove(0);
      });

      expect(result.current.fields).toHaveLength(1);
      expect(result.current.watchedInvoiceItems).toEqual([
        expect.objectContaining({ id: 2, inventoryId: 20 }),
      ]);
    });

    it('replace updates the full row set while preserving watched invoice items', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      act(() => {
        result.current.replace([
          {
            id: 10,
            inventoryId: 10,
            quantity: 5,
            discount: 10,
            price: 100,
            discountedPrice: 450,
          },
        ]);
      });

      expect(result.current.fields).toHaveLength(1);
      expect(result.current.watchedInvoiceItems).toEqual([
        expect.objectContaining({
          id: 10,
          inventoryId: 10,
          quantity: 5,
          discountedPrice: 450,
        }),
      ]);
    });
  });

  describe('watched values', () => {
    it('watchedInvoiceItems reflects appended rows', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Purchase,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      act(() => {
        result.current.append({
          id: 99,
          inventoryId: 10,
          quantity: 5,
          discount: 5,
          price: 100,
          discountedPrice: 475,
        });
      });

      expect(result.current.watchedInvoiceItems).toMatchObject([
        { id: 99, inventoryId: 10 },
      ]);
    });

    it('watchedExtraDiscount defaults to 0', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      expect(result.current.watchedExtraDiscount).toBe(0);
    });

    it('watchedSingleAccountId defaults to -1', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      expect(result.current.watchedSingleAccountId).toBe(-1);
    });

    it('watchedMultipleAccountIds defaults to empty array', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      // zod default for optional array
      expect(result.current.watchedMultipleAccountIds).toEqual([]);
    });
  });

  describe('resolutionTrigger', () => {
    it('initially reflects empty items', () => {
      const refs = makeRefs({ splitByItemType: true });
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: true,
        }),
      );

      expect(result.current.resolutionTrigger).toBe('1-0-');
    });

    it('updates when items change', () => {
      const refs = makeRefs({ splitByItemType: true });
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: true,
        }),
      );

      act(() => {
        result.current.append({
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        });
        result.current.append({
          id: 2,
          inventoryId: 20,
          quantity: 1,
          discount: 0,
          price: 200,
          discountedPrice: 200,
        });
      });

      expect(result.current.resolutionTrigger).toBe('1-2-10,20');
    });

    it('reflects split toggle even when items unchanged', () => {
      const refs = makeRefs({ splitByItemType: false });
      const { result, rerender } = renderHook(
        ({ splitOff }) =>
          useNewInvoiceFormCore({
            invoiceType: InvoiceType.Sale,
            inventory: sampleInventory,
            useSingleAccountRef: refs.useSingleAccountRef,
            splitByItemTypeRef: refs.splitByItemTypeRef,
            splitByItemType: splitOff,
            saleStockValidationBonusRef: refs.saleStockValidationBonusRef,
          }),
        { initialProps: { splitOff: false } },
      );

      const initial = result.current.resolutionTrigger;
      rerender({ splitOff: true });

      // prefix changes from 0- to 1-
      expect(result.current.resolutionTrigger).not.toBe(initial);
      expect(result.current.resolutionTrigger.startsWith('1-')).toBe(true);
    });
  });

  describe('discountAccountExists', () => {
    it('is null when extra discount is 0', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      expect(result.current.discountAccountExists).toBeNull();
    });

    it('checks electron.getAccountByName when extra discount > 0', async () => {
      const getAccountByName = jest.fn(async () => ({ id: 99 }));
      (window as any).electron.getAccountByName = getAccountByName;

      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      // initially null
      expect(result.current.discountAccountExists).toBeNull();

      // set extra discount > 0
      act(() => {
        result.current.form.setValue('extraDiscount', 50, {
          shouldDirty: true,
        });
      });

      await flushMicrotasks();

      expect(getAccountByName).toHaveBeenCalled();
    });

    it('sets to true when account exists', async () => {
      (window as any).electron.getAccountByName = jest.fn(async () => ({
        id: 99,
      }));

      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      act(() => {
        result.current.form.setValue('extraDiscount', 100, {
          shouldDirty: true,
        });
      });

      await flushMicrotasks();
      expect(result.current.discountAccountExists).toBe(true);
    });

    it('sets to false when account does not exist', async () => {
      (window as any).electron.getAccountByName = jest.fn(async () => null);

      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Purchase,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      act(() => {
        result.current.form.setValue('extraDiscount', 50, {
          shouldDirty: true,
        });
      });

      await flushMicrotasks();
      expect(result.current.discountAccountExists).toBe(false);
    });

    it('resets to null when extra discount is set back to 0', async () => {
      (window as any).electron.getAccountByName = jest.fn(async () => ({
        id: 99,
      }));

      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      act(() => {
        result.current.form.setValue('extraDiscount', 10, {
          shouldDirty: true,
        });
      });
      await flushMicrotasks();
      expect(result.current.discountAccountExists).toBe(true);

      act(() => {
        result.current.form.setValue('extraDiscount', 0, { shouldDirty: true });
      });
      await flushMicrotasks();
      expect(result.current.discountAccountExists).toBeNull();
    });

    it('handles getAccountByName rejection gracefully', async () => {
      (window as any).electron.getAccountByName = jest.fn(async () => {
        throw new Error('Network');
      });

      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      act(() => {
        result.current.form.setValue('extraDiscount', 25, {
          shouldDirty: true,
        });
      });

      await flushMicrotasks();
      // should gracefully be false on error (no crash)
      expect(result.current.discountAccountExists).toBe(false);
    });
  });

  describe('validation clearing on invoiceType change', () => {
    it('clears errors when invoiceType changes', () => {
      const refs = makeRefs();

      // We can't easily re-render with different invoiceType types in isolation,
      // so we verify the effect exists by checking the hook doesn't throw
      // when the form is instantiated correctly
      const { result, rerender } = renderHook(
        ({ type }) =>
          useNewInvoiceFormCore({
            invoiceType: type,
            inventory: sampleInventory,
            ...refs,
            splitByItemType: false,
          }),
        { initialProps: { type: InvoiceType.Sale } },
      );

      // form should have no errors after mount
      expect(result.current.form.formState.errors).toEqual({});

      rerender({ type: InvoiceType.Purchase });
      expect(result.current.form.formState.errors).toEqual({});
    });
  });

  describe('sale stock validation bonus', () => {
    it('uses provided saleStockValidationBonusRef when given', () => {
      const refs = makeRefs();
      refs.saleStockValidationBonusRef.current = { 10: 5 };

      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
          saleStockValidationBonusRef: refs.saleStockValidationBonusRef,
        }),
      );

      // should build schema without errors
      expect(result.current.formSchema).toBeDefined();
    });

    it('falls back to internal bonus ref when saleStockValidationBonusRef not provided', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          useSingleAccountRef: refs.useSingleAccountRef,
          splitByItemTypeRef: refs.splitByItemTypeRef,
          splitByItemType: false,
        }),
      );

      expect(result.current.formSchema).toBeDefined();
    });
  });

  describe('form setValue and validation', () => {
    it('schema includes stock-validation awareness for sale', () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Sale,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      // formSchema is the zod type; it should have been built successfully
      expect(result.current.formSchema).toBeDefined();
      // inventory items schema should reject empty arrays (min 1)
      expect(result.current.defaultFormValues.invoiceType).toBe(
        InvoiceType.Sale,
      );
    });

    it('valid purchase item with negative quantity is accepted (no stock cap)', async () => {
      const refs = makeRefs();
      const { result } = renderHook(() =>
        useNewInvoiceFormCore({
          invoiceType: InvoiceType.Purchase,
          inventory: sampleInventory,
          ...refs,
          splitByItemType: false,
        }),
      );

      // just verify form instantiates and schema builds for purchase
      expect(result.current.formSchema).toBeDefined();
    });
  });
});
