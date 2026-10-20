import { useState, useEffect } from 'react';
import { AlertTriangle, Pencil } from 'lucide-react';
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
import type { AccountCodeConflict, AccountCollectionRole, Chart } from 'types';
import { ChartSelect } from 'renderer/components/ChartSelect';
import { Checkbox } from 'renderer/shad/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/shad/ui/select';
import { cn } from 'renderer/lib/utils';
import { isDefaultReceiptHead } from '@/core/utils/receiptAccounts';
import { AdvancedControl } from '@/renderer/components/AdvancedControl';
import { ADVANCED_CAPABILITIES } from '@/core/advancedCapabilities';

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
  onCancel?: () => void;
  onEditPolicy?: () => void;
  initialValues?: Partial<AccountFormData>;
  charts: Chart[];
  onHeadNameChange?: (value: string) => void;
  submitLabel?: string;
}

const inputClass = 'my-0 placeholder:text-muted-foreground/50';

export const AccountForm: React.FC<AccountFormProps> = ({
  onSubmit,
  onReset,
  onCancel,
  onEditPolicy,
  initialValues,
  charts,
  onHeadNameChange,
  submitLabel = 'Submit',
}: AccountFormProps) => {
  const form = useForm<AccountFormData>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { ...defaultValues, ...initialValues },
  });

  const currentCode = useWatch({ control: form.control, name: 'accountCode' });
  const [codeConflicts, setCodeConflicts] = useState<AccountCodeConflict[]>([]);
  const [isCheckingCode, setIsCheckingCode] = useState(false);
  const [showDuplicatePrompt, setShowDuplicatePrompt] = useState(false);

  // reset confirmation prompt and check for duplicates when code changes
  useEffect(() => {
    setShowDuplicatePrompt(false);
    let cancelled = false;

    if (
      currentCode === undefined ||
      currentCode === null ||
      String(currentCode).trim() === ''
    ) {
      setCodeConflicts([]);
      setIsCheckingCode(false);
      return () => {
        cancelled = true;
      };
    }

    const timer = setTimeout(async () => {
      if (typeof window === 'undefined' || !window.electron?.checkAccountCode) {
        return;
      }
      setIsCheckingCode(true);
      try {
        const conflicts = await window.electron.checkAccountCode(
          currentCode,
          initialValues?.id,
        );
        if (!cancelled) {
          setCodeConflicts(conflicts ?? []);
        }
      } catch {
        // non-blocking
      } finally {
        if (!cancelled) {
          setIsCheckingCode(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentCode, initialValues?.id]);

  const handleFormSubmit = async (values: AccountFormData) => {
    const rawCode = values.accountCode;
    const hasCode =
      rawCode !== undefined &&
      rawCode !== null &&
      String(rawCode).trim() !== '';

    // If code is supplied and the user has not yet acknowledged the duplicate warning
    if (hasCode && !showDuplicatePrompt && window.electron?.checkAccountCode) {
      try {
        const conflicts = await window.electron.checkAccountCode(
          rawCode,
          initialValues?.id,
        );
        if (conflicts && conflicts.length > 0) {
          setCodeConflicts(conflicts);
          setShowDuplicatePrompt(true);
          return;
        }
      } catch {
        // proceed if check fails
      }
    }

    setShowDuplicatePrompt(false);
    await onSubmit(values);
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleFormSubmit)}
        onReset={() => {
          form.reset(defaultValues);
          setCodeConflicts([]);
          setShowDuplicatePrompt(false);
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
                  <FormLabel className="flex items-center justify-between">
                    <span>Code</span>
                    {isCheckingCode && (
                      <span className="text-[10px] text-muted-foreground">
                        Checking...
                      </span>
                    )}
                    {!isCheckingCode && codeConflicts.length > 0 && (
                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        In use
                      </span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      className={cn(
                        inputClass,
                        codeConflicts.length > 0 &&
                          'border-amber-500 focus-visible:ring-amber-500/30',
                      )}
                      placeholder="e.g. 1001"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Duplicate Code Warning Banner */}
        {codeConflicts.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <p className="font-semibold">
                Warning: Code &ldquo;{currentCode}&rdquo; is already in use by{' '}
                {codeConflicts.length === 1
                  ? 'an active account'
                  : `${codeConflicts.length} active accounts`}
                :
              </p>
              <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-amber-900 dark:text-amber-300">
                {codeConflicts.map((c) => (
                  <li key={c.id}>
                    <span className="font-medium text-foreground">
                      {c.name}
                    </span>{' '}
                    <span className="text-muted-foreground">
                      ({c.headName})
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-800 dark:text-amber-400">
                Reusing codes across accounts can lead to mistaken account
                selection during journal entry or billing.
              </p>
            </div>
          </div>
        )}

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
                    className={inputClass}
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
                    className={inputClass}
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
                    className={inputClass}
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
                    className={inputClass}
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
                    className={inputClass}
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
                    className={inputClass}
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
                    className={inputClass}
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
                    className={inputClass}
                    placeholder="Secondary contact"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Bilty Goods Receiver (English & Urdu) */}
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
                    className={inputClass}
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
                    className={inputClass}
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

        {/* Vendor Stock Tracking Checkbox */}
        <AdvancedControl
          capability={ADVANCED_CAPABILITIES.accountTrackVendorStock}
        >
          <FormField
            control={form.control}
            name="tracksVendorStock"
            render={({ field }) => (
              <FormItem className="pt-0.5">
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
        </AdvancedControl>
        <AdvancedControl
          capability={ADVANCED_CAPABILITIES.accountCollectionRole}
        >
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
        </AdvancedControl>

        {/* Discount Policy with Non-Overpowering Edit Button */}
        {(initialValues?.discountProfileName ||
          initialValues?.discountProfileId) && (
          <div className="flex items-center justify-between rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">
                Discount Policy
              </span>
              <span className="text-muted-foreground">
                {initialValues?.discountProfileName || 'None'}
              </span>
            </div>
            {onEditPolicy && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onEditPolicy}
                className="h-6 px-2 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <Pencil className="mr-1 h-3 w-3" />
                Edit policy
              </Button>
            )}
          </div>
        )}

        {/* Footer CTAs */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
          {showDuplicatePrompt ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs dark:border-amber-800 dark:bg-amber-950/40">
              <span className="font-medium text-amber-900 dark:text-amber-200">
                Code &ldquo;{currentCode}&rdquo; is already in use. Save anyway?
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setShowDuplicatePrompt(false)}
                >
                  Change Code
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  disabled={form.formState.isSubmitting}
                  onClick={() => {
                    form.handleSubmit(async (v) => {
                      setShowDuplicatePrompt(false);
                      await onSubmit(v);
                    })();
                  }}
                >
                  {form.formState.isSubmitting ? 'Saving...' : 'Save Anyway'}
                </Button>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </form>
    </Form>
  );
};
