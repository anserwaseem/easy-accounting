import { type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';

export const formSchema = z.object({
  id: z.number(),
  date: z.string().datetime({ local: true, message: 'Select a valid date' }),
  narration: z.string().optional(),
  isPosted: z.boolean(),
  billNumber: z.number().optional(),
  discountPercentage: z.number().optional(),
  journalEntries: z.array(
    z
      .object({
        id: z.number(),
        journalId: z.number(),
        debitAmount: z.number(),
        accountId: z.coerce.number().gt(0, 'Select an account'),
        creditAmount: z.number(),
      })
      .refine((data) => !(data.debitAmount === 0 && data.creditAmount === 0), {
        message:
          'Debit amount and credit amount cannot be zero at the same time',
      }),
  ),
});

export type FormType = UseFormReturn<z.infer<typeof formSchema>>;
