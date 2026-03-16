import { toNumber } from 'lodash';
import { useMemo } from 'react';
import type { Control, FieldValues, Path } from 'react-hook-form';
import {
  currencyFormatOptions,
  DISCOUNT_ACCOUNT_NAME,
} from 'renderer/lib/constants';
import { cn, getFormattedCurrency } from 'renderer/lib/utils';
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from 'renderer/shad/ui/form';
import { Input } from 'renderer/shad/ui/input';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { InvoiceType } from 'types';

interface UseNewInvoiceTableInfoParams<T extends FieldValues = FieldValues> {
  control: Control<T>;
  invoiceType: InvoiceType;
  watchedExtraDiscount: unknown;
  watchedTotalAmount: unknown;
  extraDiscountAccountOptions: Array<{ id: number; name: string }>;
  discountAccountExists: boolean | null;
  enableCumulativeDiscount: boolean;
  setEnableCumulativeDiscount: (value: boolean) => void;
  cumulativeDiscount: number | undefined;
  isDiscountEditEnabled: boolean;
  onCumulativeDiscountChange: (value: string) => void;
  useSingleAccount: boolean;
  splitByItemType: boolean;
}

/** returns table footer rows (extra discount, extra discount account, total; optionally cumulative discount) for the invoice DataTable infoData */
export function useNewInvoiceTableInfo<T extends FieldValues>(
  params: UseNewInvoiceTableInfoParams<T>,
): React.ReactNode[][] {
  const {
    control,
    invoiceType,
    watchedExtraDiscount,
    watchedTotalAmount,
    extraDiscountAccountOptions,
    discountAccountExists,
    enableCumulativeDiscount,
    setEnableCumulativeDiscount,
    cumulativeDiscount,
    isDiscountEditEnabled,
    onCumulativeDiscountChange,
    useSingleAccount,
    splitByItemType,
  } = params;

  return useMemo(() => {
    if (invoiceType === InvoiceType.Purchase) {
      return [];
    }

    const rows: React.ReactNode[][] = [
      [
        <span
          key="extra-discount-label"
          className="text-sm font-medium text-muted-foreground"
        >
          Extra discount ({currencyFormatOptions.currency})
        </span>,
        null,
        null,
        null,
        <FormField
          control={control}
          name={'extraDiscount' as Path<T>}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  step="any"
                  min={0}
                  onBlur={(e) => field.onChange(toNumber(e.target.value))}
                  onChange={(e) => field.onChange(toNumber(e.target.value))}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />,
        null,
      ],
      // only show "Extra discount from account" when split by item type (multiple accounts); when false, single account is used implicitly
      ...(toNumber(watchedExtraDiscount) > 0 && splitByItemType
        ? [
            [
              <span
                key="extra-discount-account-label"
                className="text-sm font-medium text-muted-foreground"
              >
                Extra discount from account
              </span>,
              null,
              null,
              null,
              <FormField
                key="extra-discount-account-field"
                control={control}
                name={'extraDiscountAccountId' as Path<T>}
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <VirtualSelect<{ id: number; name: string }>
                        options={extraDiscountAccountOptions}
                        value={field.value ?? null}
                        onChange={(val) =>
                          field.onChange(val ? toNumber(val) : undefined)
                        }
                        placeholder="Select account"
                        searchPlaceholder="Search accounts..."
                        disabled={extraDiscountAccountOptions.length === 0}
                      />
                    </FormControl>
                    {discountAccountExists === false && (
                      <p className="text-sm text-destructive mt-1">
                        Create a &quot;{DISCOUNT_ACCOUNT_NAME}&quot; expense
                        account to use extra discount.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />,
              discountAccountExists === false ? (
                <span
                  key="extra-discount-warning"
                  className="text-sm text-destructive"
                >
                  Required for posting
                </span>
              ) : null,
            ],
          ]
        : []),
      [
        <span
          key="total-label"
          className="text-base font-semibold text-primary"
        >
          Total
        </span>,
        null,
        null,
        null,
        <FormField
          control={control}
          name={'totalAmount' as Path<T>}
          render={() => (
            <FormItem className="w-1/2 space-y-0">
              <FormControl>
                <p
                  className={cn(
                    'font-semibold tabular-nums',
                    typeof watchedTotalAmount === 'number' &&
                      'border-2 border-primary rounded-lg h-10 pl-2 pr-4 pt-2 w-fit',
                  )}
                >
                  {typeof watchedTotalAmount === 'number'
                    ? getFormattedCurrency(watchedTotalAmount)
                    : null}
                </p>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />,
        null,
      ],
    ];

    if (isDiscountEditEnabled) {
      rows.unshift([
        <h1 key="cumulative-label">Cumulative Discount (%)</h1>,
        <div key="cumulative-enable" className="flex gap-2 ml-1">
          <Checkbox
            checked={enableCumulativeDiscount}
            onCheckedChange={(checked) =>
              setEnableCumulativeDiscount(checked === true)
            }
          />
          <h2 className="text-xs">Enable</h2>
        </div>,
        null,
        <Input
          key="cumulative-input"
          value={cumulativeDiscount}
          type="number"
          step="any"
          min={0}
          max={100}
          disabled={!enableCumulativeDiscount}
          onChange={(e) => onCumulativeDiscountChange(e.target.value)}
        />,
        null,
        null,
      ]);
    }

    return rows.map((row) =>
      useSingleAccount && !splitByItemType ? row : [...row, null],
    );
  }, [
    control,
    invoiceType,
    watchedExtraDiscount,
    watchedTotalAmount,
    extraDiscountAccountOptions,
    discountAccountExists,
    enableCumulativeDiscount,
    setEnableCumulativeDiscount,
    cumulativeDiscount,
    isDiscountEditEnabled,
    onCumulativeDiscountChange,
    useSingleAccount,
    splitByItemType,
  ]);
}
