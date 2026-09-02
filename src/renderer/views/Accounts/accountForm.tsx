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
  FormMessage,
} from 'renderer/shad/ui/form';
import type { Chart } from 'types';
import { ChartSelect } from 'renderer/components/ChartSelect';

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
  isActive: true,
};

interface AccountFormProps {
  onSubmit: (values: AccountFormData) => Promise<void>;
  onReset?: () => void;
  initialValues?: Partial<AccountFormData>;
  charts: Chart[];
  clearRef?: React.RefObject<HTMLButtonElement>;
  onHeadNameChange?: (value: string) => void;
}

export const AccountForm: React.FC<AccountFormProps> = ({
  onSubmit,
  onReset,
  initialValues,
  charts,
  clearRef,
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
