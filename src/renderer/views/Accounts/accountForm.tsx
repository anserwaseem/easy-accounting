import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
import { Checkbox } from 'renderer/shad/ui/checkbox';
import { Badge } from 'renderer/shad/ui/badge';
import { cn } from 'renderer/lib/utils';

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
  addressUrdu: optionalText,
  city: optionalText,
  cityUrdu: optionalText,
  phone1: optionalText,
  phone2: optionalText,
  goodsName: optionalText,
  // urdu print fields — optional; empty means fall back to English on print
  nameUrdu: optionalText,
  goodsNameUrdu: optionalText,
  isActive: z.boolean().default(true),
  tracksVendorStock: z.boolean().default(false),
  discountProfileId: z.number().nullable().optional(),
  discountProfileName: z.string().nullable().optional(),
});

export type AccountFormData = z.infer<typeof accountFormSchema>;

export const defaultValues: AccountFormData = {
  headName: '',
  accountName: '',
  accountCode: undefined,
  address: undefined,
  addressUrdu: undefined,
  city: undefined,
  cityUrdu: undefined,
  phone1: undefined,
  phone2: undefined,
  goodsName: undefined,
  nameUrdu: undefined,
  goodsNameUrdu: undefined,
  isActive: true,
  tracksVendorStock: false,
  discountProfileId: null,
  discountProfileName: null,
};

interface AccountFormProps {
  onSubmit: (values: AccountFormData) => Promise<void>;
  onReset?: () => void;
  onCancel?: () => void;
  initialValues?: Partial<AccountFormData>;
  charts: Chart[];
  onHeadNameChange?: (value: string) => void;
  submitLabel?: string;
}

export const AccountForm: React.FC<AccountFormProps> = ({
  onSubmit,
  onReset,
  onCancel,
  initialValues,
  charts,
  onHeadNameChange,
  submitLabel = 'Submit',
}: AccountFormProps) => {
  const form = useForm<AccountFormData>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { ...defaultValues, ...initialValues },
  });

  const hasLogisticsData = Boolean(
    initialValues?.goodsName ||
      initialValues?.goodsNameUrdu ||
      initialValues?.tracksVendorStock,
  );
  const [showLogistics, setShowLogistics] = useState(hasLogisticsData);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onReset={() => {
          form.reset(defaultValues);
          onReset?.();
        }}
        className="space-y-3.5"
      >
        {/* Head & Code Row */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <FormField
              control={form.control}
              name="headName"
              render={({ field }) => (
                <FormItem className="space-y-1">
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
          </div>
          <div className="sm:col-span-1">
            <FormField
              control={form.control}
              name="accountCode"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel>Code</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="my-0"
                      placeholder="e.g. 1001"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Account Names (English & Urdu) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="accountName"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel>Account Name</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="my-0"
                    placeholder="Official account title"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="nameUrdu"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel>Name in Urdu (Print)</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="my-0"
                    dir="rtl"
                    lang="ur"
                    placeholder="اردو نام برائے پرنٹ"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* City (English & Urdu) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel>City</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="my-0"
                    placeholder="e.g. Lahore, Karachi"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="cityUrdu"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel>City in Urdu</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="my-0"
                    dir="rtl"
                    lang="ur"
                    placeholder="اردو شہر برائے پرنٹ"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Address (English & Urdu) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel>Address</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="my-0"
                    placeholder="Street or market address"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="addressUrdu"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel>Address in Urdu</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="my-0"
                    dir="rtl"
                    lang="ur"
                    placeholder="اردو پتہ برائے پرنٹ"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Phone Numbers */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="phone1"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel>Phone 1</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="my-0"
                    placeholder="Primary contact"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone2"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel>Phone 2</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="my-0"
                    placeholder="Secondary contact"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Progressive Disclosure for Bilty & Vendor Stock */}
        <div className="pt-0.5">
          <button
            type="button"
            onClick={() => setShowLogistics((prev) => !prev)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-200',
                !showLogistics && '-rotate-90',
              )}
            />
            <span>Bilty Transport & Consignment Stock (Optional)</span>
            {hasLogisticsData && !showLogistics && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-foreground">
                Configured
              </span>
            )}
          </button>
        </div>

        {showLogistics && (
          <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="goodsName"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel>Goods Receiver Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        className="my-0"
                        placeholder="Transport bilty consignee"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="goodsNameUrdu"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel>Goods Receiver (Urdu)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        className="my-0"
                        dir="rtl"
                        lang="ur"
                        placeholder="اردو مال برداری نام"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="tracksVendorStock"
              render={({ field }) => (
                <FormItem className="pt-1">
                  <div className="flex items-start gap-2.5">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                        className="mt-0.5"
                      />
                    </FormControl>
                    <div className="space-y-0.5">
                      <FormLabel className="cursor-pointer text-xs font-normal text-foreground">
                        Track stock at this vendor
                      </FormLabel>
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Count goods held here until repurchased. Leave off for
                        agents booking consignment returns.
                      </p>
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {(initialValues?.discountProfileName ||
          initialValues?.discountProfileId) && (
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">Discount Policy</p>
              <p className="text-[11px] text-muted-foreground">
                Managed from the Policy column in the accounts table
              </p>
            </div>
            <Badge variant="secondary">
              {initialValues?.discountProfileName || 'Assigned'}
            </Badge>
          </div>
        )}

        {/* Footer CTAs */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            aria-label="Submit"
            disabled={form.formState.isSubmitting}
            className="min-w-[100px]"
          >
            {form.formState.isSubmitting ? 'Saving...' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
};
