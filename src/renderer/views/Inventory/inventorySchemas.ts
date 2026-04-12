import { z } from 'zod';

export const addInventorySchema = z.object({
  name: z.string().min(1, 'Name must be at least 1 character'),
  price: z.coerce.number().nonnegative('Price must not be negative'), // allow 0 price to keep up with old data
  description: z.string().optional().nullable(),
  itemTypeId: z.coerce
    .number()
    .optional()
    .nullable()
    .transform((val) => (val && val > 0 ? val : undefined)),
  listPosition: z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'number') return v;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : undefined;
  }, z.number().int().nonnegative('List # must be a non-negative whole number').optional()),
});

export const editInventorySchema = z.object({
  id: z.number(),
  name: z.string().optional(), // disabled in UI
  quantity: z.number().optional(), // disabled in UI
  price: z.coerce.number().nonnegative('Price must not be negative'), // allow 0 price to keep up with old data
  description: z.string().optional().nullable(),
  itemTypeId: z.coerce
    .number()
    .optional()
    .nullable()
    .transform((val) => (val && val > 0 ? val : undefined)),
  listPosition: z.preprocess((v) => {
    if (v === '' || v == null) return null;
    if (typeof v === 'number') return v;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  }, z.number().int().nonnegative('List # must be a non-negative whole number').nullable()),
});

export type AddInventorySchema = z.infer<typeof addInventorySchema>;
export type EditInventorySchema = z.infer<typeof editInventorySchema>;
