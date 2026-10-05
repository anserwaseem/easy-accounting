import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from 'renderer/shad/ui/form';
import type { AccountCollectionRole, Chart } from 'types';
import { ChartSelect } from 'renderer/components/ChartSelect';
import { Checkbox } from 'renderer/shad/ui/checkbox';
import { Badge } from 'renderer/shad/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/shad/ui/select';
import { isDefaultReceiptHead } from '@/core/utils/receiptAccounts';

const COLLECTION_ROLE_OPTIONS = ['default', 'receipt', 'exclude'] as const;
type CollectionRoleOption = (typeof COLLECTION_ROLE_OPTIONS)[number];

/** form option to the stored column: 'default' is NULL */
export const toCollectionRole = (
  option: CollectionRoleOption | undefined,
): AccountCollectionRole | null =>
  option === 'receipt' || option === 'exclude' ? option : null;

export const toCollectionRoleOption = (
  role: AccountCollectionRole | null | undefined,
): CollectionRoleOption => role ?? 'default';

const optionalText = z
  .string()
  .optional()
  .nullable()
  .transform((val) => val ?? undefined);

export const accountFormSchema = z.object({
  id: z.number().optional(),
  headName: z.string().min(2).max(50),
  accountName: z.string().min(2).max(50),
  accountCode: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .nullable()
    .transform((val) => val ?? undefined),
  address: optionalText,
  phone1: optionalText,
  phone2: optionalText,
  goodsName: optionalText,
  // urdu print fields — optional; empty means fall back to English on print
  nameUrdu: optionalText,
  addressUrdu: optionalText,
  goodsNameUrdu: optionalText,
  isActive: z.boolean().default(true),
  tracksVendorStock: z.boolean().default(false),
  collectionRole: z.enum(COLLECTION_ROLE_OPTIONS).default('default'),
  discountProfileId: z.number().nullable().optional(),
  discountProfileName: z.string().nullable().optional(),
});

export type AccountFormData = z.infer<typeof accountFormSchema>;

export const defaultValues: AccountFormData = {
  headName: '',
  accountName: '',
  accountCode: undefined,
  address: undefined,
  phone1: undefined,
  phone2: undefined,
  goodsName: undefined,
  nameUrdu: undefined,
  addressUrdu: undefined,
  goodsNameUrdu: undefined,
  isActive: true,
  tracksVendorStock: false,
  collectionRole: 'default',
  discountProfileId: null,
  discountProfileName: null,
};

interface CollectionRoleHintProps {
  control: Control<AccountFormData>;
  charts: Chart[];
}

/** what "Default" resolves to for the chosen head; watches one field only */
const CollectionRoleHint: React.FC<CollectionRoleHintProps> = ({
  control,
  charts,
}: CollectionRoleHintProps) => {
  const headName = useWatch({ control, name: 'headName' });
  const counts = isDefaultReceiptHead(
    charts.find((chart) => chart.name === headName),
  );
  return (
    <p className="text-xs leading-snug text-muted-foreground">
      Whether money this account receives from a customer is shown in that
      agent&apos;s tour columns on the collection sheet. Default here:{' '}
      <span className="font-medium text-foreground">
        {counts ? 'counts' : 'does not count'}
      </span>{' '}
      (only accounts directly under an Asset head, such as cash and bank, count
      by default).
    </p>
  );
};

interface AccountFormProps {
  onSubmit: (values: AccountFormData) => Promise<void>;
  onReset?: () => void;
  initialValues?: Partial<AccountFormData>;
  charts: Chart[];
  onHeadNameChange?: (value: string) => void;
}

export const AccountForm: React.FC<AccountFormProps> = ({
  onSubmit,
  onReset,
  initialValues,
  charts,
  onHeadNameChange,
}: AccountFormProps) => {
  const form = useForm<AccountFormData>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { ...defaultValues, ...initialValues },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onReset={() => {
          form.reset(defaultValues);
          onReset?.();
        }}
      >
        <FormField
          control={form.control}
          name="headName"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Head</FormLabel>
              <FormControl>
                <ChartSelect
                  charts={charts}
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    onHeadNameChange?.(value);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="accountName"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="nameUrdu"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Name (Urdu)</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  dir="rtl"
                  lang="ur"
                  placeholder="اردو نام برائے پرنٹ"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="accountCode"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Code</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="addressUrdu"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Address (Urdu)</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  dir="rtl"
                  lang="ur"
                  placeholder="اردو پتہ برائے پرنٹ"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="goodsName"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Goods Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="goodsNameUrdu"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Goods Name (Urdu)</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  dir="rtl"
                  lang="ur"
                  placeholder="اردو مال برداری نام"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone1"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Phone 1</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone2"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Phone 2</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="tracksVendorStock"
          render={({ field }) => (
            <FormItem className="py-1">
              <div className="flex items-start gap-2">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                    className="mt-0.5"
                  />
                </FormControl>
                <div className="min-w-0 space-y-1">
                  <FormLabel className="cursor-pointer font-normal leading-snug">
                    Track stock at this vendor
                  </FormLabel>
                  <p className="text-xs leading-snug text-muted-foreground">
                    Count goods sitting here until you buy them back. Leave off
                    for agents who only book consignment returns.
                  </p>
                </div>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="collectionRole"
          render={({ field }) => (
            <FormItem className="py-1">
              <div className="flex items-center justify-between gap-3">
                <FormLabel>Counts as collection</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="receipt">Always</SelectItem>
                    <SelectItem value="exclude">Never</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <CollectionRoleHint control={form.control} charts={charts} />
              <FormMessage />
            </FormItem>
          )}
        />

        {(initialValues?.discountProfileName ||
          initialValues?.discountProfileId) && (
          <div className="mb-4 flex items-center justify-between rounded-md border p-3 text-sm bg-muted/40">
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">Discount Policy</p>
              <p className="text-xs text-muted-foreground">
                Managed from the Policy column in the accounts table
              </p>
            </div>
            <Badge variant="secondary">
              {initialValues?.discountProfileName || 'Assigned'}
            </Badge>
          </div>
        )}

        <Button type="submit" className="w-full">
          Submit
        </Button>
      </form>
    </Form>
  );
};
