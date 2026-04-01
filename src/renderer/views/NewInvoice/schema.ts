import { toNumber } from 'lodash';
import type { Invoice, InventoryItem } from 'types';
import { InvoiceType } from 'types';
import { z } from 'zod';
import { toLocalNoonIsoString } from '@/renderer/lib/localDate';

export interface NewInvoiceSchemaOptions {
  invoiceType: InvoiceType;
  inventory: InventoryItem[];
  getUseSingleAccount: () => boolean;
  getSplitByItemType: () => boolean;
}

export const getDefaultFormValues = (invoiceType: InvoiceType): Invoice => ({
  id: -1,
  // use local noon to avoid timezone "previous day" shifts when serializing to ISO
  date: toLocalNoonIsoString(new Date()),
  invoiceNumber: -1,
  extraDiscount: 0,
  extraDiscountAccountId: undefined,
  totalAmount: 0,
  invoiceItems: [],
  invoiceType,
  biltyNumber: '',
  cartons: 0,
  accountMapping: {
    singleAccountId: -1,
    multipleAccountIds: [],
  },
});

export const buildNewInvoiceFormSchema = (
  opts: NewInvoiceSchemaOptions,
): z.ZodType<Invoice> => {
  const { invoiceType, inventory, getUseSingleAccount, getSplitByItemType } =
    opts;

  return (
    z
      .object({
        id: z.number(),
        date: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
          message: 'Select a valid date',
        }),
        biltyNumber: z
          .string()
          .optional()
          .refine(
            (val) =>
              val === undefined ||
              (typeof val === 'string' &&
                (val.trim() === '' || /^\d+$/.test(val.trim()))),
            { message: 'Bilty number must be digits only' },
          ),
        cartons: z.coerce
          .number()
          .nonnegative('Cartons must be greater than 0')
          .optional(),
        extraDiscount: z.coerce
          .number()
          .nonnegative('Extra Discount must be greater than 0'),
        extraDiscountAccountId: z.coerce.number().optional(),
        totalAmount:
          invoiceType === InvoiceType.Sale
            ? z.coerce.number().positive('Total Amount must be greater than 0')
            : z.coerce.number(),
        invoiceItems: z
          .array(
            z.object({
              id: z.number(),
              inventoryId: z.coerce.number().positive('Select an item'),
              quantity: z.coerce
                .number()
                .int('Quantity must be a whole number')
                .positive('Quantity must be greater than 0'),
              discount: z.coerce
                .number()
                .multipleOf(0.01, 'Discount must be at-most 2 decimal places')
                .nonnegative('Discount must be greater than 0')
                .max(100, 'Discount must be less than 100%')
                .min(0, 'Discount must be greater than 0%'),
              price:
                invoiceType === InvoiceType.Sale
                  ? z.number().positive('Price must be greater than 0')
                  : z.number(),
              discountedPrice: z
                .number()
                .nonnegative('Discounted price must be greater than 0'),
            }),
          )
          .min(1, 'Add at-least one invoice item')
          // validate each item can only be added once
          .refine(
            (items) => {
              const ids = items
                .map((i) => i.inventoryId)
                .filter((id) => id > 0);
              return new Set(ids).size === ids.length;
            },
            { message: 'Each item can only be added once' },
          )
          // sale only: cannot invoice more than current stock; purchase has no on-hand cap
          .superRefine((items, ctx) => {
            if (invoiceType !== InvoiceType.Sale) return;
            if (!inventory?.length) return;
            items.forEach((item, idx) => {
              if (item.inventoryId <= 0) return;
              const inv = inventory.find((i) => i.id === item.inventoryId);
              if (!inv || item.quantity <= inv.quantity) return;
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Max ${inv.quantity} available`,
                path: [idx, 'quantity'],
              });
            });
          }),
        accountMapping: z.object({
          singleAccountId: z.coerce
            .number()
            .positive(
              `Select a ${
                invoiceType === InvoiceType.Sale ? 'customer' : 'vendor'
              }`,
            )
            .optional(),
          multipleAccountIds: z
            .array(
              z.coerce
                .number({
                  invalid_type_error: `Select a ${
                    invoiceType === InvoiceType.Sale ? 'customer' : 'vendor'
                  } for this row`,
                })
                .refine((n) => Number.isFinite(n) && n > 0, {
                  message: `Select a ${
                    invoiceType === InvoiceType.Sale ? 'customer' : 'vendor'
                  } for this row`,
                }),
            )
            .optional(),
        }),
      })
      // validate account mapping:
      // if single account is checked (and not split by type), validate that account is selected
      // if split by type is on, validate multipleAccountIds from resolution
      // if single account is unchecked, validate that multiple accounts are selected for each invoice item
      .superRefine((data, ctx) => {
        const partyLabel =
          invoiceType === InvoiceType.Sale ? 'customer' : 'vendor';
        if (getUseSingleAccount()) {
          if (invoiceType === InvoiceType.Sale && getSplitByItemType()) {
            const ids = data.accountMapping.multipleAccountIds ?? [];
            const itemCount = data.invoiceItems?.length ?? 0;
            if (
              ids.length !== itemCount ||
              ids.some((id) => typeof id !== 'number' || id <= 0)
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Resolve accounts for each row (select a ${partyLabel} and items)`,
                path: ['accountMapping', 'multipleAccountIds'],
              });
            }
            return;
          }
          const sid = data.accountMapping.singleAccountId;
          if (typeof sid !== 'number' || sid <= 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Select a ${partyLabel}`,
              path: ['accountMapping', 'singleAccountId'],
            });
          }
          return;
        }
        const ids = data.accountMapping.multipleAccountIds ?? [];
        const itemCount = data.invoiceItems?.length ?? 0;
        const message = `Select a ${partyLabel} for each invoice item`;
        if (ids.length !== itemCount) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message,
            path: ['accountMapping', 'multipleAccountIds'],
          });
          for (let i = 0; i < itemCount; i++) {
            const id = ids[i];
            if (typeof id !== 'number' || id <= 0) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Select a ${partyLabel}`,
                path: ['accountMapping', 'multipleAccountIds', i],
              });
            }
          }
          return;
        }
        ids.forEach((id, index) => {
          if (typeof id !== 'number' || id <= 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Select a ${partyLabel}`,
              path: ['accountMapping', 'multipleAccountIds', index],
            });
          }
        });
      })
      // when extra discount > 0: require an account to be selected for the discount, and that account
      // must be one of the accounts already on the invoice (single or per-row).
      // we derive the allowed account list from accountMapping based on useSingleAccount and splitByItemType.
      .superRefine((data, ctx) => {
        if (!(data.extraDiscount > 0)) return;
        let accountIds: number[];
        if (getUseSingleAccount()) {
          if (
            invoiceType === InvoiceType.Sale &&
            getSplitByItemType() &&
            Array.isArray(data.accountMapping.multipleAccountIds) &&
            data.accountMapping.multipleAccountIds.length > 0
          ) {
            accountIds = [
              ...new Set(
                data.accountMapping.multipleAccountIds.filter(
                  (id): id is number => typeof id === 'number' && id > 0,
                ),
              ),
            ];
          } else {
            const sid = data.accountMapping.singleAccountId;
            accountIds = typeof sid === 'number' && sid > 0 ? [sid] : [];
          }
        } else {
          accountIds = (data.accountMapping.multipleAccountIds ?? []).filter(
            (id): id is number => typeof id === 'number' && id > 0,
          );
        }
        if (accountIds.length === 0) return;
        const selected = toNumber(data.extraDiscountAccountId);
        if (!Number.isFinite(selected) || selected <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Select an account for extra discount',
            path: ['extraDiscountAccountId'],
          });
          return;
        }
        if (!accountIds.includes(selected)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Extra discount account must be one of the invoice accounts',
            path: ['extraDiscountAccountId'],
          });
        }
      }) as z.ZodType<Invoice>
  );
};
