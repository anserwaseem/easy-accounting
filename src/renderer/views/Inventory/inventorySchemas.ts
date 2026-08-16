import { z } from 'zod';
import { itemNameError } from '@/main/utils/itemName';

/**
 * Name field, refined against characters this installation has reserved.
 *
 * The service rejects these too — names also arrive by import — but a throw
 * from the main process surfaces as a raw IPC error dialog. Validating here
 * turns it into an inline field error the user can act on, and the service
 * stays as the backstop for the paths a form cannot cover.
 */
const nameField = (reservedNameChars: string) => {
  const base = z.string().min(1, 'Name must be at least 1 character');
  if (!reservedNameChars) return base;
  return base.superRefine((value, ctx) => {
    const message = itemNameError(value, reservedNameChars);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });
};

/** Add-item schema for an installation that reserves no characters. */
export const addInventorySchema = z.object({
  name: nameField(''),
  price: z.coerce.number().nonnegative('Price must not be negative'), // allow 0 price to keep up with old data
  /** see editInventorySchema.title; hidden unless this installation publishes */
  title: z.string().optional().nullable(),
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
  /**
   * What a customer should see this called, where `name` is the identifier.
   *
   * Editable here, unlike `name`, precisely because it is not identity: nothing
   * keys off it, so changing it breaks nothing. Blank is the ordinary state and
   * is stored as NULL.
   */
  title: z.string().optional().nullable(),
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

/** Add-item schema honouring the installation's reserved characters. */
export const makeAddInventorySchema = (reservedNameChars: string) =>
  addInventorySchema.extend({ name: nameField(reservedNameChars) });

export type AddInventorySchema = z.infer<typeof addInventorySchema>;
export type EditInventorySchema = z.infer<typeof editInventorySchema>;
