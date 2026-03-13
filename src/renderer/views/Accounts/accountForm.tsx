import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from 'renderer/shad/ui/form';
import { useEffect, useMemo } from 'react';
import type { Chart, DiscountProfile } from 'types';
import { AccountType } from 'types';
import { ChartSelect } from 'renderer/components/ChartSelect';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { NO_DISCOUNT_POLICY_OPTION } from '@/renderer/lib/constants';

export const accountFormSchema = z.object({
  id: z.number().optional(),
  headName: z.string().min(2).max(50),
  accountName: z.string().min(2).max(50),
  accountCode: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .nullable()
    .transform((val) => val ?? undefined),
  address: z
    .string()
    .optional()
    .nullable()
    .transform((val) => val ?? undefined),
  phone1: z
    .string()
    .optional()
    .nullable()
    .transform((val) => val ?? undefined),
  phone2: z
    .string()
    .optional()
    .nullable()
    .transform((val) => val ?? undefined),
  goodsName: z
    .string()
    .optional()
    .nullable()
    .transform((val) => val ?? undefined),
  discountProfileId: z.coerce
    .number()
    .optional()
    .nullable()
    .transform((val) => (val && val > 0 ? val : undefined)),
  isActive: z.boolean().default(true),
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
  discountProfileId: undefined,
  isActive: true,
};

interface AccountFormProps {
  onSubmit: (values: AccountFormData) => Promise<void>;
  onReset?: () => void;
  initialValues?: Partial<AccountFormData>;
  charts: Chart[];
  discountProfiles: DiscountProfile[];
  clearRef?: React.RefObject<HTMLButtonElement>;
  onHeadNameChange?: (value: string) => void;
}

export const AccountForm: React.FC<AccountFormProps> = ({
  onSubmit,
  onReset,
  initialValues,
  charts,
  discountProfiles,
  clearRef,
  onHeadNameChange,
}: AccountFormProps) => {
  const form = useForm<AccountFormData>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { ...defaultValues, ...initialValues },
  });

  const selectedHeadName = form.watch('headName');
  const selectedChartType = useMemo(
    () => charts.find((chart) => chart.name === selectedHeadName)?.type,
    [charts, selectedHeadName],
  );
  const showDiscountProfileField = selectedChartType === AccountType.Asset;
  const activeDiscountProfiles = useMemo(
    () => discountProfiles.filter((profile) => profile.isActive),
    [discountProfiles],
  );

  // reset profile selection when selected account head is not an Asset.
  useEffect(() => {
    if (!showDiscountProfileField) {
      form.setValue('discountProfileId', undefined, { shouldValidate: false });
    }
  }, [form, showDiscountProfileField]);

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
              <FormLabel>Account Head</FormLabel>
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
              <FormLabel>Account Name</FormLabel>
              <FormControl>
                <Input {...field} />
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
              <FormLabel>Account Code</FormLabel>
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

        {showDiscountProfileField && (
          <FormField
            control={form.control}
            name="discountProfileId"
            render={({ field }) => (
              <FormItem labelPosition="start">
                <FormLabel>Policy</FormLabel>
                <FormControl>
                  <VirtualSelect
                    options={[
                      NO_DISCOUNT_POLICY_OPTION,
                      ...activeDiscountProfiles,
                    ]}
                    value={field.value ?? 0}
                    onChange={(value) => field.onChange(Number(value))}
                    placeholder="Select policy"
                    searchPlaceholder="Search policies..."
                  />
                </FormControl>
                <FormDescription>
                  This policy controls auto discount by item type for this
                  customer account.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="flex justify-between">
          <Button type="submit" className="w-1/2">
            Submit
          </Button>
          <Button type="reset" variant="ghost" ref={clearRef}>
            Clear
          </Button>
        </div>
      </form>
    </Form>
  );
};
