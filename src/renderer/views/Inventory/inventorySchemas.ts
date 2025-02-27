import { z } from 'zod';

export const addInventorySchema = z.object({
  name: z.string().min(1, 'Name must be at least 1 character'),
  price: z.coerce.number().nonnegative('Price must not be negative'), // allow 0 price to keep up with old data
  description: z.string().optional().nullable(),
});

export const editInventorySchema = z.object({
  id: z.number(),
  name: z.string().optional(), // disabled in UI
  quantity: z.number().optional(), // disabled in UI
  price: z.coerce.number().nonnegative('Price must not be negative'), // allow 0 price to keep up with old data
  description: z.string().optional().nullable(),
});

export type AddInventorySchema = z.infer<typeof addInventorySchema>;
export type EditInventorySchema = z.infer<typeof editInventorySchema>;
