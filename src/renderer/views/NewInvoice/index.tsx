/* eslint-disable react/no-unstable-nested-components */
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { get, isNil, pick, sum, toNumber, toString, trim } from 'lodash';
import {
  Calendar as CalendarIcon,
  Plus,
  Printer,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { currencyFormatOptions } from 'renderer/lib/constants';
import {
  cn,
  defaultSortingFunctions,
  getFixedNumber,
  getFormattedCurrency,
  raise,
} from 'renderer/lib/utils';
import { Button } from 'renderer/shad/ui/button';
import { Calendar } from 'renderer/shad/ui/calendar';
import { type ColumnDef, DataTable } from 'renderer/shad/ui/dataTable';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from 'renderer/shad/ui/form';
import { Input } from 'renderer/shad/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'renderer/shad/ui/popover';
import { toast } from 'renderer/shad/ui/use-toast';
import {
  type Account,
  AccountType,
  type InventoryItem,
  type Invoice,
  type InvoiceItem,
  InvoiceType,
} from 'types';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'renderer/shad/ui/dialog';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { convertFileToJson } from '@/renderer/lib/lib';
import { parseInvoiceItems } from '@/renderer/lib/parser';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { AddInvoiceNumber } from './addInvoiceNumber';

interface NewInvoiceProps {
  invoiceType: InvoiceType;
}

// TODO: improve performance, check states: remove unnecessary data
const NewInvoicePage: React.FC<NewInvoiceProps> = ({
  invoiceType,
}: NewInvoiceProps) => {
  console.log('NewInvoicePage', invoiceType);
  const [inventory, setInventory] = useState<InventoryItem[]>();
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState<
    number | undefined
  >(-1);
  const [parties, setParties] =
    useState<Pick<Account, 'id' | 'type' | 'name' | 'code'>[]>();
  const [requiredAccountsExist, setRequiredAccountsExist] = useState<{
    sale: boolean;
    purchase: boolean;
    loading: boolean;
  }>({ sale: false, purchase: false, loading: false });
  const [enableCumulativeDiscount, setEnableCumulativeDiscount] =
    useState(false);
  const [cumulativeDiscount, setCumulativeDiscount] = useState<number>();
  const [useSingleAccount, setUseSingleAccount] = useState(true);
  const useSingleAccountRef = useRef(useSingleAccount);
  useSingleAccountRef.current = useSingleAccount;
  const [isDateExplicitlySet, setIsDateExplicitlySet] = useState(false);
  const [showDateConfirmation, setShowDateConfirmation] = useState(false);
  const dateConfirmedInModalRef = useRef(false);
  const openPrintAfterSaveRef = useRef(false);
  const [isRefreshingParties, setIsRefreshingParties] = useState(false);

  const navigate = useNavigate();

  const getInitialEntry = useCallback(
    () => ({
      id: Date.now(), // generates a unique ID for each new entry. not used to insert into db
      inventoryId: 0,
      quantity: 0,
      discount: 0,
      price: 0,
      discountedPrice: 0,
    }),
    [],
  );

  const defaultFormValues: Invoice = {
    id: -1,
    date: new Date().toISOString(),
    invoiceNumber: -1,
    extraDiscount: 0,
    totalAmount: 0,
    invoiceItems: [],
    invoiceType,
    biltyNumber: '',
    cartons: 0,
    accountMapping: {
      singleAccountId: -1,
      multipleAccountIds: [],
    },
  };

  const formSchema = z
    .object({
      id: z.number(),
      date: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
        message: 'Select a valid date',
      }),
      biltyNumber: z.string().optional(),
      cartons: z.coerce
        .number()
        .nonnegative('Cartons must be greater than 0')
        .optional(),
      extraDiscount: z.coerce
        .number()
        .nonnegative('Extra Discount must be greater than 0'),
      totalAmount:
        invoiceType === InvoiceType.Sale
          ? z.coerce.number().positive('Total Amount must be greater than 0')
          : z.coerce.number(),
      invoiceItems: z
        .array(
          z.object({
            id: z.number(),
            inventoryId: z.coerce.number().positive('Select an item'),
            quantity: z.coerce
              .number()
              .int('Quantity must be a whole number')
              .positive('Quantity must be greater than 0'),
            discount: z.coerce
              .number()
              .multipleOf(0.01, 'Discount must be at-most 2 decimal places')
              .nonnegative('Discount must be greater than 0')
              .max(100, 'Discount must be less than 100%')
              .min(0, 'Discount must be greater than 0%'),
            price:
              invoiceType === InvoiceType.Sale
                ? z.number().positive('Price must be greater than 0')
                : z.number(),
            discountedPrice: z
              .number()
              .nonnegative('Discounted price must be greater than 0'),
          }),
        )
        .min(1, 'Add at-least one invoice item')
        // validate each item can only be added once
        .refine(
          (items) => {
            const ids = items.map((i) => i.inventoryId).filter((id) => id > 0);
            return new Set(ids).size === ids.length;
          },
          { message: 'Each item can only be added once' },
        )
        // validate max quantity of selected inventory item
        .superRefine((items, ctx) => {
          if (!inventory?.length) return;
          items.forEach((item, idx) => {
            if (item.inventoryId <= 0) return;
            const inv = inventory.find((i) => i.id === item.inventoryId);
            if (!inv || item.quantity <= inv.quantity) return;
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Max ${inv.quantity} available`,
              path: [idx, 'quantity'],
            });
          });
        }),
      accountMapping: z.object({
        singleAccountId: z.coerce
          .number()
          .positive(
            `Select a ${
              invoiceType === InvoiceType.Sale ? 'customer' : 'vendor'
            }`,
          )
          .optional(),
        multipleAccountIds: z
          .array(
            z.coerce
              .number({
                invalid_type_error: `Select a ${
                  invoiceType === InvoiceType.Sale ? 'customer' : 'vendor'
                } for this row`,
              })
              .refine((n) => Number.isFinite(n) && n > 0, {
                message: `Select a ${
                  invoiceType === InvoiceType.Sale ? 'customer' : 'vendor'
                } for this row`,
              }),
          )
          .optional(),
      }),
    })
    // validate account mapping
    // if single account is checked, validate that account is selected
    // if single account is unchecked, validate that multiple accounts are selected for each invoice item
    .superRefine((data, ctx) => {
      const partyLabel =
        invoiceType === InvoiceType.Sale ? 'customer' : 'vendor';
      if (useSingleAccountRef.current) {
        const sid = data.accountMapping.singleAccountId;
        if (typeof sid !== 'number' || sid <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Select a ${partyLabel}`,
            path: ['accountMapping', 'singleAccountId'],
          });
        }
        return;
      }
      const ids = data.accountMapping.multipleAccountIds ?? [];
      const itemCount = data.invoiceItems?.length ?? 0;
      const message = `Select a ${partyLabel} for each invoice item`;
      if (ids.length !== itemCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message,
          path: ['accountMapping', 'multipleAccountIds'],
        });
        for (let i = 0; i < itemCount; i++) {
          const id = ids[i];
          if (typeof id !== 'number' || id <= 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Select a ${partyLabel}`,
              path: ['accountMapping', 'multipleAccountIds', i],
            });
          }
        }
        return;
      }
      ids.forEach((id, index) => {
        if (typeof id !== 'number' || id <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Select a ${partyLabel}`,
            path: ['accountMapping', 'multipleAccountIds', index],
          });
        }
      });
    });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultFormValues,
    mode: 'onSubmit', // show validation errors only after user attempts submit
  });

  const watchedInvoiceItems = useWatch({
    control: form.control,
    name: 'invoiceItems',
  });

  const watchedExtraDiscount = useWatch({
    control: form.control,
    name: 'extraDiscount',
  });
  const watchedTotalAmount = useWatch({
    control: form.control,
    name: 'totalAmount',
  });
  const watchedSingleAccountId = useWatch({
    control: form.control,
    name: 'accountMapping.singleAccountId',
  });

  const { fields, append } = useFieldArray({
    control: form.control,
    name: 'invoiceItems',
  });

  // clear form errors when invoiceType changes
  useEffect(() => {
    form.clearErrors();
  }, [invoiceType, form]);

  // fetch data for this page
  useEffect(() => {
    (async () => {
      if (isNil(inventory)) {
        const inv: InventoryItem[] = await window.electron.getInventory();
        const filteredInv = inv
          .map((item) =>
            pick(item, ['id', 'name', 'price', 'quantity', 'description']),
          )
          .filter((item) => item.quantity > 0 && item.price > 0);
        setInventory(filteredInv);
      }
    })();
  }, [inventory]);
  useEffect(() => {
    (async () => {
      if (nextInvoiceNumber === -1) {
        setNextInvoiceNumber(
          await window.electron.getNextInvoiceNumber(invoiceType),
        );
      }
    })();
  }, [invoiceType, nextInvoiceNumber]);
  const fetchPartiesAndRequiredAccounts = useCallback(async () => {
    const allAccounts: Account[] = await window.electron.getAccounts();
    const accounts = allAccounts.map((account) =>
      pick(account, ['id', 'name', 'type', 'code']),
    );
    const saleAccount = accounts.find(
      (account) =>
        trim(account.name).toLowerCase() === InvoiceType.Sale.toLowerCase(),
    );
    const purchaseAccount = accounts.find(
      (account) =>
        trim(account.name).toLowerCase() === InvoiceType.Purchase.toLowerCase(),
    );
    const partyAccounts = accounts.filter(
      (account) =>
        account.type ===
        (invoiceType === InvoiceType.Sale
          ? AccountType.Asset
          : AccountType.Liability),
    );
    return {
      partyAccounts,
      sale: !!saleAccount,
      purchase: !!purchaseAccount,
    };
  }, [invoiceType]);

  useEffect(() => {
    if (isNil(parties)) {
      setRequiredAccountsExist({
        sale: false,
        purchase: false,
        loading: true,
      });
      fetchPartiesAndRequiredAccounts()
        .then(({ partyAccounts, sale, purchase }) => {
          setRequiredAccountsExist({
            sale,
            purchase,
            loading: false,
          });
          setParties(partyAccounts);
        })
        .catch((error) => {
          console.error('Error fetching accounts:', error);
          setRequiredAccountsExist((prev) => ({ ...prev, loading: false }));
        });
    }
  }, [invoiceType, parties, fetchPartiesAndRequiredAccounts]);

  const refreshParties = useCallback(async () => {
    setIsRefreshingParties(true);
    try {
      const { partyAccounts, sale, purchase } =
        await fetchPartiesAndRequiredAccounts();
      setRequiredAccountsExist((prev) => ({
        ...prev,
        sale,
        purchase,
      }));
      setParties(partyAccounts);
      toast({
        description: 'Accounts refreshed successfully',
        variant: 'success',
      });
    } catch (error) {
      toast({
        description: 'Failed to refresh accounts',
        variant: 'destructive',
      });
      console.error('Error refreshing accounts:', error);
    } finally {
      setIsRefreshingParties(false);
    }
  }, [fetchPartiesAndRequiredAccounts]);

  const handleRemoveRow = useCallback(
    (rowIndex: number) => {
      const latestInvoice = form.getValues();

      if (fields.length > 0) {
        form.clearErrors(`invoiceItems.${rowIndex}` as const);
        form.setValue(
          'invoiceItems',
          latestInvoice.invoiceItems.filter((_, index) => index !== rowIndex),
        );
      }
    },
    [fields.length, form],
  );

  const getInvoiceItemTotal = (
    quantity: number,
    discount: number,
    price?: number,
  ) => quantity * (price ?? 0) * (1 - discount / 100);

  /** has item + its quantity selected */
  const hasActiveInvoiceItem = useMemo(
    () => !!watchedInvoiceItems.at(0)?.discountedPrice,
    [watchedInvoiceItems],
  );

  // calculate and update total amount whenever relevant values change
  useEffect(() => {
    if (!hasActiveInvoiceItem) {
      form.setValue('totalAmount', 0, {
        shouldValidate: false,
        shouldDirty: true,
      });
      return;
    }

    const grossTotal = sum(
      watchedInvoiceItems.map((item) =>
        enableCumulativeDiscount && cumulativeDiscount
          ? getInvoiceItemTotal(item.quantity, cumulativeDiscount, item.price)
          : item.discountedPrice,
      ),
    );
    const total = grossTotal - watchedExtraDiscount;

    form.setValue('totalAmount', getFixedNumber(total, 2), {
      shouldValidate: false,
      shouldDirty: true,
    });
  }, [
    cumulativeDiscount,
    enableCumulativeDiscount,
    form,
    hasActiveInvoiceItem,
    watchedExtraDiscount,
    watchedInvoiceItems,
  ]);

  const getSelectedItem = useCallback(
    (fieldValue: number) =>
      inventory?.find((item) => item.id === toNumber(fieldValue)),
    [inventory],
  );
  const onItemSelectionChange = useCallback(
    (rowIndex: number, val: string, onChange: Function) => {
      onChange(val);
      const item = getSelectedItem(toNumber(val));
      form.setValue(`invoiceItems.${rowIndex}.price`, item?.price || 0);
      form.setValue(
        `invoiceItems.${rowIndex}.discountedPrice`,
        getInvoiceItemTotal(
          form.getValues(`invoiceItems.${rowIndex}.quantity`),
          form.getValues(`invoiceItems.${rowIndex}.discount`),
          item?.price,
        ),
        {
          shouldValidate: false,
          shouldDirty: true,
        },
      );
    },
    [form, getSelectedItem],
  );
  const getDiscountValue = useCallback(
    (fieldValue: number) =>
      enableCumulativeDiscount && cumulativeDiscount
        ? cumulativeDiscount
        : fieldValue,
    [cumulativeDiscount, enableCumulativeDiscount],
  );
  const onDiscountChange = useCallback(
    (rowIndex: number, value: string, onChange: Function) => {
      onChange(toNumber(value));
      form.setValue(
        `invoiceItems.${rowIndex}.discountedPrice`,
        getInvoiceItemTotal(
          form.getValues(`invoiceItems.${rowIndex}.quantity`),
          toNumber(value),
          form.getValues(`invoiceItems.${rowIndex}.price`),
        ),
        {
          shouldValidate: false,
          shouldDirty: true,
        },
      );
    },
    [form],
  );
  const onQuantityChange = useCallback(
    (rowIndex: number, value: string, onChange: Function) => {
      onChange(toNumber(value));
      form.setValue(
        `invoiceItems.${rowIndex}.discountedPrice`,
        getInvoiceItemTotal(
          toNumber(value),
          form.getValues(`invoiceItems.${rowIndex}.discount`),
          form.getValues(`invoiceItems.${rowIndex}.price`),
        ),
        {
          shouldValidate: false,
          shouldDirty: true,
        },
      );
    },
    [form],
  );
  const renderDiscountedPrice = useCallback(
    (rowIndex: number, fieldValue?: number) => {
      if (enableCumulativeDiscount && cumulativeDiscount) {
        return getFormattedCurrency(
          getInvoiceItemTotal(
            form.getValues(`invoiceItems.${rowIndex}.quantity`),
            cumulativeDiscount,
            form.getValues(`invoiceItems.${rowIndex}.price`),
          ),
        );
      }

      return typeof fieldValue === 'number' && fieldValue >= 0
        ? getFormattedCurrency(fieldValue)
        : null;
    },
    [cumulativeDiscount, enableCumulativeDiscount, form],
  );

  const onAccountSelection = useCallback(
    (accountId: string, onChange: Function) => {
      onChange(accountId);
    },
    [],
  );

  const columns: ColumnDef<InvoiceItem>[] = useMemo(() => {
    const getItemOptionsForRow = (rowIndex: number) => {
      const items = form.getValues('invoiceItems') || [];
      const selectedElsewhere = items
        .filter((item, idx) => idx !== rowIndex && item.inventoryId > 0)
        .map((item) => item.inventoryId);
      return (inventory || []).filter(
        (inv) => !selectedElsewhere.includes(inv.id),
      );
    };

    const baseColumns: ColumnDef<InvoiceItem>[] = [
      {
        header: 'Item',
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`invoiceItems.${row.index}.inventoryId` as const}
            render={({ field }) => (
              <FormItem className="w-max min-w-[200px] space-y-0">
                <VirtualSelect<InventoryItem>
                  options={getItemOptionsForRow(row.index)}
                  value={field.value?.toString()}
                  onChange={(val) =>
                    onItemSelectionChange(
                      row.index,
                      toString(val),
                      field.onChange,
                    )
                  }
                  placeholder="Select item"
                  searchPlaceholder="Search items..."
                  renderSelectItem={(item) => (
                    <div className="flex w-40 justify-between gap-2">
                      <h2 className="supports-[overflow-wrap:anywhere]:[overflow-wrap:anywhere]">
                        {item.name}
                      </h2>

                      <div className="text-xs text-muted-foreground text-end">
                        <div className="flex gap-2">
                          <p className="font-bold">{item.quantity}</p>

                          <span className="font-extralight">
                            item{item.quantity < 2 ? '' : 's'} left
                          </span>
                        </div>
                        <p>{getFormattedCurrency(item.price)}</p>
                      </div>
                    </div>
                  )}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        ),
      },
      {
        header: 'Quantity',
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`invoiceItems.${row.index}.quantity` as const}
            render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    step={1}
                    min={0}
                    onBlur={(e) => field.onChange(toNumber(e.target.value))}
                    onChange={(e) =>
                      onQuantityChange(
                        row.index,
                        e.target.value,
                        field.onChange,
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ),
      },
      {
        id: 'remove',
        header: 'Action',
        cell: ({ row }) => (
          <X
            color="red"
            size={16}
            onClick={() => handleRemoveRow(row.index)}
            cursor="pointer"
          />
        ),
      },
    ];

    if (invoiceType === InvoiceType.Sale) {
      const priceColumns: ColumnDef<InvoiceItem>[] = [
        {
          header: 'Price',
          cell: ({ row }) => (
            <FormField
              control={form.control}
              name={`invoiceItems.${row.index}.price` as const}
              render={({ field }) => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <p className="text-muted-foreground min-h-[1.5rem]">
                      {typeof field.value === 'number' && field.value >= 0
                        ? getFormattedCurrency(toNumber(field.value))
                        : '—'}
                    </p>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ),
        },
        {
          header: 'Discount',
          cell: ({ row }) => (
            <FormField
              control={form.control}
              name={`invoiceItems.${row.index}.discount` as const}
              render={({ field }) => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <Input
                      {...field}
                      value={getDiscountValue(field.value)}
                      type="number"
                      step="any"
                      min={0}
                      max={100}
                      disabled={enableCumulativeDiscount}
                      onBlur={(e) => field.onChange(toNumber(e.target.value))}
                      onChange={(e) =>
                        onDiscountChange(
                          row.index,
                          e.target.value,
                          field.onChange,
                        )
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ),
        },
        {
          header: 'Discounted Price',
          cell: ({ row }) => (
            <FormField
              control={form.control}
              name={`invoiceItems.${row.index}.discountedPrice` as const}
              render={({ field }) => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <p>{renderDiscountedPrice(row.index, field.value)}</p>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ),
        },
      ];

      const accountColumn: ColumnDef<InvoiceItem>[] = useSingleAccount
        ? []
        : [
            {
              header: `Customer *`,
              cell: ({ row }) => (
                <FormField
                  control={form.control}
                  name={
                    `accountMapping.multipleAccountIds.${row.index}` as const
                  }
                  render={({ field }) => (
                    <FormItem className="w-auto min-w-[200px] space-y-0">
                      <VirtualSelect
                        options={parties || []}
                        value={field.value}
                        onChange={(val) =>
                          onAccountSelection(toString(val), field.onChange)
                        }
                        placeholder={`Select ${
                          invoiceType === InvoiceType.Sale
                            ? 'customer'
                            : 'vendor'
                        }`}
                        searchPlaceholder="Search parties..."
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ),
            },
          ];

      // insert additional columns before the remove action (last) column
      baseColumns.splice(baseColumns.length - 1, 0, ...priceColumns);
      baseColumns.splice(baseColumns.length - 1, 0, ...accountColumn);
    }

    return baseColumns;
  }, [
    invoiceType,
    form,
    inventory,
    onItemSelectionChange,
    onQuantityChange,
    handleRemoveRow,
    useSingleAccount,
    getDiscountValue,
    enableCumulativeDiscount,
    onDiscountChange,
    renderDiscountedPrice,
    parties,
    onAccountSelection,
  ]);

  const handleAddNewRow = useCallback(
    () => append({ ...getInitialEntry() }),
    [append, getInitialEntry],
  );

  const isSubmitDisabled = useMemo(() => {
    if (form.formState.isSubmitting) return true;
    const total = watchedTotalAmount;
    if (
      invoiceType === InvoiceType.Sale &&
      (typeof total !== 'number' || total <= 0)
    )
      return true;
    if (
      invoiceType === InvoiceType.Purchase &&
      typeof total === 'number' &&
      total < 0
    )
      return true;
    if (
      useSingleAccount &&
      (watchedSingleAccountId == null || watchedSingleAccountId <= 0)
    )
      return true;
    return false;
  }, [
    form.formState.isSubmitting,
    invoiceType,
    useSingleAccount,
    watchedSingleAccountId,
    watchedTotalAmount,
  ]);

  const onCumulativeDiscountChange = useCallback(
    (value: string) => {
      const discount = toNumber(value);
      setCumulativeDiscount(discount);

      const updatedInvoiceItems = form
        .getValues('invoiceItems')
        .map((item) => ({
          ...item,
          discount,
          discountedPrice: getInvoiceItemTotal(
            item.quantity,
            discount,
            item.price,
          ),
        }));

      form.setValue('invoiceItems', updatedInvoiceItems, {
        shouldValidate: false,
        shouldDirty: true,
      });
    },
    [form],
  );

  const tableInfoData = useMemo(() => {
    if (invoiceType === InvoiceType.Purchase) {
      return [];
    }

    return [
      [
        <h1>Cumulative Discount (%)</h1>,
        <div className="flex gap-2 ml-1">
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
      ],
      [
        <h1>Extra Discount ({currencyFormatOptions.currency})</h1>,
        null,
        null,
        null,
        <FormField
          control={form.control}
          name="extraDiscount"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  step="any"
                  min={0}
                  disabled={!hasActiveInvoiceItem || !useSingleAccount}
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
      [
        <h1 className="text-green-500 text-lg font-bold">Total</h1>,
        null,
        null,
        null,
        <FormField
          control={form.control}
          name="totalAmount"
          render={() => (
            <FormItem className="w-1/2 space-y-0">
              <FormControl>
                <p
                  className={cn(
                    typeof watchedTotalAmount === 'number' &&
                      'border-2 border-green-500 rounded-lg h-10 pl-2 pr-4 pt-2 w-fit',
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
    ].map((row) => (useSingleAccount ? row : [...row, null]));
  }, [
    invoiceType,
    enableCumulativeDiscount,
    cumulativeDiscount,
    form.control,
    onCumulativeDiscountChange,
    hasActiveInvoiceItem,
    watchedTotalAmount,
    useSingleAccount,
  ]);

  const submitInvoice = async (
    values: z.infer<typeof formSchema>,
  ): Promise<number | undefined> => {
    try {
      const invoice = {
        ...values,
        invoiceNumber: nextInvoiceNumber,
      };
      const result = (await window.electron.insertInvoice(
        invoiceType,
        invoice,
      )) as { invoiceId: number; nextInvoiceNumber: number };

      if (result.nextInvoiceNumber > 0) {
        setNextInvoiceNumber(result.nextInvoiceNumber);
        form.reset(defaultFormValues);
        setIsDateExplicitlySet(false);
        toast({
          description: `${invoiceType} invoice saved successfully`,
          variant: 'success',
        });
        return result.invoiceId > 0 ? result.invoiceId : undefined;
      }
      raise(`Failed to save ${invoiceType} invoice`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      toast({
        description: toString(error),
        variant: 'destructive',
      });
    }
    return undefined;
  };

  const validateInvoiceDateAgainstParties = useCallback(
    async (values: z.infer<typeof formSchema>): Promise<string | null> => {
      const dateStr = values.date;
      if (!dateStr) return null;
      const invoiceDate = new Date(dateStr);
      invoiceDate.setHours(0, 0, 0, 0);

      let accountIds: number[];
      if (useSingleAccount) {
        const sid = values.accountMapping.singleAccountId;
        accountIds = typeof sid === 'number' && sid > 0 ? [sid] : [];
      } else {
        accountIds = (values.accountMapping.multipleAccountIds || []).filter(
          (id): id is number => typeof id === 'number' && id > 0,
        );
      }
      if (accountIds.length === 0) return null;

      const lastDatesResults = await Promise.all(
        accountIds.map((accountId) =>
          window.electron.getLedger(accountId).then((ledger) => {
            const latest = ledger.at(-1)?.date;
            return latest ? new Date(latest) : null;
          }),
        ),
      );
      const lastDates = lastDatesResults.filter((d): d is Date => d != null);
      if (lastDates.length === 0) return null;

      const minRequired = new Date(
        Math.max(...lastDates.map((d) => d.getTime())),
      );
      minRequired.setHours(0, 0, 0, 0);
      if (invoiceDate >= minRequired) return null;
      const partyLabel =
        invoiceType === InvoiceType.Sale ? 'customer' : 'vendor';
      return `Invoice date must be on or after ${format(
        minRequired,
        'PPP',
      )} for the selected ${partyLabel}${
        useSingleAccount ? '' : '(s)'
      } (last ledger date).`;
    },
    [invoiceType, useSingleAccount],
  );

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    // eslint-disable-next-line no-console
    console.log('onSubmit invoice:', values);

    const dateError = await validateInvoiceDateAgainstParties(values);
    if (dateError) {
      form.setError('date', { type: 'manual', message: dateError });
      return;
    }

    // when user clicked "Use current date" in modal, state may not have updated yet
    if (dateConfirmedInModalRef.current) {
      dateConfirmedInModalRef.current = false;
      setIsDateExplicitlySet(true);
      const invoiceId = await submitInvoice(values);
      if (openPrintAfterSaveRef.current && invoiceId != null) {
        openPrintAfterSaveRef.current = false;
        navigate(`/invoices/${invoiceId}/print`);
      }
      return;
    }

    if (!isDateExplicitlySet) {
      setShowDateConfirmation(true);
      return;
    }

    const invoiceId = await submitInvoice(values);
    if (openPrintAfterSaveRef.current && invoiceId != null) {
      openPrintAfterSaveRef.current = false;
      navigate(`/invoices/${invoiceId}/print`);
    }
  };

  const uploadInvoiceItems = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    try {
      const json = await convertFileToJson(file);
      const parsedItems = parseInvoiceItems(json);
      const items = (await window.electron.getInventory()) as InventoryItem[];
      const areItemsAvailable = checkParsedItemsAvailability(
        parsedItems,
        items,
      );
      if (!areItemsAvailable) {
        toast({
          description:
            'Some items are not in inventory. Please recheck and try again.',
          variant: 'destructive',
        });
        return;
      }

      parsedItems.forEach((pItem) => {
        const inventoryItem = items.find((i) => i.name === pItem.name);
        append({
          id: Date.now(),
          inventoryId: inventoryItem?.id ?? 0,
          quantity: pItem.quantity,
          discount: 0,
          price: inventoryItem?.price ?? 0,
          discountedPrice: 0,
        });
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      toast({
        description: toString(error),
        variant: 'destructive',
      });
    }
  };

  const checkKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLFormElement> | undefined) =>
      e?.key === 'Enter' && e.preventDefault(),
    [],
  );

  const onInvoiceNumberSet = (invoiceNumber: number) =>
    setNextInvoiceNumber(invoiceNumber);

  const onDateSelection = useCallback(
    (date?: Date) => {
      if (!date) return;
      form.setValue('date', date.toISOString());
      setIsDateExplicitlySet(true);
    },
    [form],
  );

  const onSingleAccountToggle = useCallback(
    (isChecked: boolean) => {
      setUseSingleAccount(isChecked);
      // clear the appropriate account mapping fields based on the toggle
      if (isChecked) {
        form.setValue('accountMapping.multipleAccountIds', [], {
          shouldValidate: false,
        });
      } else {
        form.setValue('accountMapping.singleAccountId', undefined, {
          shouldValidate: false,
        });
        form.setValue('extraDiscount', 0);
      }
    },
    [form],
  );

  if (isNil(inventory)) {
    return <>Loading...</>;
  }

  if (!inventory?.length) {
    return (
      <div className="block fixed z-10 bg-green-400 text-center text-xl bg-opacity-60 w-full left-0 top-[50%] py-4 px-8">
        Please add inventory before creating an invoice.
      </div>
    );
  }

  if (requiredAccountsExist.loading) {
    return <>Loading...</>;
  }

  if (!requiredAccountsExist.sale || !requiredAccountsExist.purchase) {
    return (
      <div className="block fixed z-10 bg-green-400 text-center text-xl bg-opacity-60 w-full left-0 top-[50%] py-4 px-8">
        Please add both Sale and Purchase accounts before creating an invoice.
      </div>
    );
  }

  return (
    <>
      <Dialog
        open={showDateConfirmation}
        onOpenChange={setShowDateConfirmation}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm date</DialogTitle>
            <DialogDescription>
              You are using today&apos;s date ({format(new Date(), 'PPP')}).
              Would you like to proceed with this date or set a different one?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-between">
            <Button
              variant="secondary"
              onClick={() => setShowDateConfirmation(false)}
            >
              Change date
            </Button>
            <Button
              onClick={() => {
                setShowDateConfirmation(false);
                form.setValue('date', new Date().toISOString());
                dateConfirmedInModalRef.current = true;
                form.handleSubmit(onSubmit)();
              }}
            >
              Use current date
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="py-1 flex flex-col gap-y-4">
        <div className="flex justify-between items-center">
          <h1 className="title-new">{`New ${invoiceType} Invoice`}</h1>
          <Button
            variant="outline"
            size="icon"
            onClick={refreshParties}
            title="Refresh accounts"
            disabled={isRefreshingParties}
          >
            <RefreshCw
              className={cn('h-4 w-4', isRefreshingParties && 'animate-spin')}
            />
          </Button>
        </div>

        {isNil(nextInvoiceNumber) ? (
          <AddInvoiceNumber
            invoiceType={invoiceType}
            onInvoiceNumberSet={onInvoiceNumberSet}
          />
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit, (errors) =>
                console.log('onSubmit errors', errors),
              )}
              onReset={() => {
                form.reset(defaultFormValues);
                setIsDateExplicitlySet(false);
              }}
              onKeyDown={checkKeyDown}
              role="presentation"
            >
              <div className="flex flex-col gap-2">
                {invoiceType === InvoiceType.Sale && (
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox
                      id="useSingleAccount"
                      checked={useSingleAccount}
                      onCheckedChange={onSingleAccountToggle}
                    />
                    <label
                      htmlFor="useSingleAccount"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Use single customer for entire invoice{' '}
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-2 row-gap-4">
                  {useSingleAccount || invoiceType === InvoiceType.Purchase ? (
                    <FormField
                      control={form.control}
                      name="accountMapping.singleAccountId"
                      render={({ field }) => (
                        <FormItem labelPosition="start" className="pr-16">
                          <FormLabel className="text-base">
                            {invoiceType === InvoiceType.Sale
                              ? 'Customer'
                              : 'Vendor'}
                            <span className="text-destructive"> *</span>
                          </FormLabel>
                          <VirtualSelect
                            options={parties || []}
                            value={field.value}
                            onChange={(val) =>
                              onAccountSelection(toString(val), field.onChange)
                            }
                            placeholder="Select a party"
                            searchPlaceholder="Search parties..."
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div className="flex items-center">
                      <p className="text-sm text-muted-foreground">
                        One invoice per customer; select account per line.
                      </p>
                    </div>
                  )}

                  {invoiceType === InvoiceType.Sale && (
                    <FormField
                      control={form.control}
                      name="biltyNumber"
                      render={({ field }) => (
                        <FormItem labelPosition="start" className="pl-16">
                          <FormLabel className="text-base">
                            Bilty Number
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="Enter bilty number"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem
                        labelPosition="start"
                        className="pr-16 row-start-2"
                      >
                        <FormLabel className="text-base">
                          Date<span className="text-destructive"> *</span>
                        </FormLabel>
                        <FormControl>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={cn(
                                  'w-full justify-start text-left font-normal',
                                  !field.value && 'text-muted-foreground',
                                )}
                              >
                                <CalendarIcon className="mr-2 h-12 w-4" />
                                {field.value ? (
                                  format(field.value, 'PPP')
                                ) : (
                                  <span>Pick a date</span>
                                )}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                {...field}
                                mode="single"
                                selected={
                                  field.value
                                    ? new Date(field.value)
                                    : undefined
                                }
                                onSelect={onDateSelection}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {invoiceType === InvoiceType.Sale && (
                    <FormField
                      control={form.control}
                      name="cartons"
                      render={({ field }) => (
                        <FormItem labelPosition="start" className="pl-16">
                          <FormLabel className="text-base">Cartons</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              step={1}
                              min={0}
                              placeholder="Number of cartons"
                              onBlur={(e) =>
                                field.onChange(toNumber(e.target.value))
                              }
                              onChange={(e) =>
                                field.onChange(toNumber(e.target.value))
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </div>

              <div className="py-8 flex flex-col gap-3">
                <DataTable
                  columns={columns}
                  data={fields}
                  sortingFns={defaultSortingFunctions}
                  infoData={tableInfoData}
                />
                {form.formState.errors.invoiceItems && (
                  <p className="text-sm font-medium text-destructive">
                    {get(form.formState.errors.invoiceItems, 'message', null)}
                  </p>
                )}
              </div>

              <div className="flex justify-between gap-20 pb-20">
                <Button
                  type="button"
                  className="dark:bg-gray-200 bg-gray-800 gap-2 px-16 py-4 rounded-3xl"
                  onClick={() => handleAddNewRow()}
                >
                  <Plus size={20} />
                  <span className="w-max">Add New Item</span>
                </Button>
                <div
                  className={`flex flex-row gap-4 ${
                    invoiceType === InvoiceType.Sale ? 'hidden' : ''
                  }`}
                >
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      document
                        .getElementById('uploadInvoiceItemsInput')
                        ?.click()
                    }
                  >
                    <Upload size={16} className="mr-2" />
                    Upload Invoice Items
                  </Button>
                  <Input
                    id="uploadInvoiceItemsInput"
                    type="file"
                    accept=".xlsx, .xls"
                    className="hidden"
                    onChange={uploadInvoiceItems}
                  />
                </div>
              </div>

              <div className="flex justify-between">
                <div className="flex gap-4">
                  <Button
                    type="submit"
                    variant="default"
                    disabled={isSubmitDisabled}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    disabled={isSubmitDisabled}
                    onClick={() => {
                      openPrintAfterSaveRef.current = true;
                      form.handleSubmit(onSubmit)();
                    }}
                  >
                    <Printer size={16} className="mr-2" />
                    Save and Print
                  </Button>
                  <Button type="reset" variant="ghost">
                    Clear
                  </Button>
                </div>

                <Button
                  variant="secondary"
                  onClick={() => {
                    form.reset(defaultFormValues);
                    setIsDateExplicitlySet(false);
                    navigate(-1);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        )}
      </div>
    </>
  );
};

export default NewInvoicePage;

function checkParsedItemsAvailability(
  parsedItems: ReturnType<typeof parseInvoiceItems>,
  items: InventoryItem[],
): boolean {
  return parsedItems.every((parsedItem) => {
    const item = items.find((i) => i.name === parsedItem.name);
    if (!item) {
      return false;
    }
    return true;
  });
}
