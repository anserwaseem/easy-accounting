/* eslint-disable react/no-unstable-nested-components */
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { get, isNaN, isNil, pick, sum, toNumber, toString } from 'lodash';
import { Calendar as CalendarIcon, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import {
  currencyFormatOptions,
  dateFormatOptions,
} from 'renderer/lib/constants';
import {
  cn,
  defaultSortingFunctions,
  getFixedNumber,
  getFormattedCurrency,
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
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { convertFileToJson } from '@/renderer/lib/lib';
import { parseInvoiceItems } from '@/renderer/lib/parser';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { AddInvoiceNumber } from './addInvoiceNumber';

interface NewInvoiceProps {
  invoiceType: InvoiceType;
}

// FIXME: set validation for max quantity of selected inventory item
// FIXME: do not allow selecting same inventory item multiple times
// TODO: improve performance, check states: remove unnecessary data
// TODO: in new sale invoice, date format is not matching with existing invoices: can we keep MM/DD/YYYY format when importing?
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
  const [partyLastDateInLedger, setPartyLastDateInLedger] = useState<
    Date | undefined | null // default state: undefined, null represents customer with no ledger entry hence no date selection restriction
  >();
  const [requiredAccountsExist, setRequiredAccountsExist] = useState<{
    sale: boolean;
    purchase: boolean;
    loading: boolean;
  }>({ sale: false, purchase: false, loading: false });
  const [enableCumulativeDiscount, setEnableCumulativeDiscount] =
    useState(false);
  const [cumulativeDiscount, setCumulativeDiscount] = useState<number>();
  const [useSingleAccount, setUseSingleAccount] = useState(true);

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
    date: '',
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

  const formSchema = z.object({
    id: z.number(),
    date: z
      .string()
      .transform((val) =>
        new Date(val).toLocaleString('en-US', dateFormatOptions),
      )
      .refine((val) => !isNaN(new Date(val).getTime()), {
        message: 'Select a valid date',
      }),
    biltyNumber: z.string().optional(),
    cartons: z.coerce
      .number()
      .nonnegative('Cartons must be non-negative')
      .optional(),
    extraDiscount: z.coerce
      .number()
      .nonnegative('Extra Discount must be non-negative'),
    totalAmount: z.coerce
      .number()
      .positive('Total Amount must be greater than 0'),
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
            .nonnegative('Discount must be non-negative')
            .max(100, 'Discount must be less than 100%')
            .min(0, 'Discount must be greater than 0%'),
          price: z.number().positive('Price must be greater than 0'),
          discountedPrice: z
            .number()
            .nonnegative('Discounted price must be non-negative'),
        }),
      )
      .min(1, 'Add at-least one invoice item'),
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
            .number()
            .positive(
              `Select a ${
                invoiceType === InvoiceType.Sale ? 'customer' : 'vendor'
              }`,
            ),
        )
        .optional(),
    }),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultFormValues,
  });

  const watchedInvoiceItems = useWatch({
    control: form.control,
    name: 'invoiceItems',
  });

  // Add validation for accountMapping based on useSingleAccount
  useEffect(() => {
    const subscription = form.watch(() => {
      // Validate that the appropriate account mapping is provided
      if (useSingleAccount) {
        const singleAccountId = form.getValues(
          'accountMapping.singleAccountId',
        );
        if (!singleAccountId) {
          form.setError('accountMapping.singleAccountId', {
            type: 'manual',
            message: `Select a ${
              invoiceType === InvoiceType.Sale ? 'customer' : 'vendor'
            }`,
          });
        } else {
          form.clearErrors('accountMapping.singleAccountId');
        }
      } else {
        const multipleAccountIds =
          form.getValues('accountMapping.multipleAccountIds') || [];
        if (
          !multipleAccountIds.length ||
          multipleAccountIds.length !== watchedInvoiceItems.length
        ) {
          form.setError('accountMapping.multipleAccountIds', {
            type: 'manual',
            message: `Select a ${
              invoiceType === InvoiceType.Sale ? 'customer' : 'vendor'
            } for each invoice item`,
          });
        } else {
          form.clearErrors('accountMapping.multipleAccountIds');
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [form, invoiceType, useSingleAccount, watchedInvoiceItems]);

  const watchedExtraDiscount = useWatch({
    control: form.control,
    name: 'extraDiscount',
  });
  const watchedTotalAmount = useWatch({
    control: form.control,
    name: 'totalAmount',
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
        const filteredInv = inv.map((item) =>
          pick(item, ['id', 'name', 'price', 'quantity', 'description']),
        );
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
  useEffect(() => {
    (async () => {
      if (isNil(parties)) {
        setRequiredAccountsExist({
          sale: false,
          purchase: false,
          loading: true,
        });

        const allAccounts: Account[] = await window.electron.getAccounts();
        const accounts = allAccounts.map((account) =>
          pick(account, ['id', 'name', 'type', 'code']),
        );

        // check for both Sale and Purchase accounts
        const saleAccount = accounts.find(
          (account) =>
            account.name.trim().toLowerCase() ===
            InvoiceType.Sale.toLowerCase(),
        );
        const purchaseAccount = accounts.find(
          (account) =>
            account.name.trim().toLowerCase() ===
            InvoiceType.Purchase.toLowerCase(),
        );
        setRequiredAccountsExist({
          sale: !!saleAccount,
          purchase: !!purchaseAccount,
          loading: false,
        });

        const partyAccounts = accounts.filter(
          (account) =>
            account.type ===
            (invoiceType === InvoiceType.Sale
              ? AccountType.Asset
              : AccountType.Liability),
        );
        setParties(partyAccounts);
      }
    })();
  }, [invoiceType, parties]);

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
    if (!hasActiveInvoiceItem) return;

    const grossTotal = sum(
      watchedInvoiceItems.map((item) =>
        enableCumulativeDiscount && cumulativeDiscount
          ? getInvoiceItemTotal(item.quantity, cumulativeDiscount, item.price)
          : item.discountedPrice,
      ),
    );
    const total = grossTotal - watchedExtraDiscount;

    form.setValue('totalAmount', getFixedNumber(total, 2), {
      shouldValidate: true,
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
      form.trigger(`invoiceItems.${rowIndex}.quantity`);
      form.setValue(`invoiceItems.${rowIndex}.price`, item?.price || 0);
      form.setValue(
        `invoiceItems.${rowIndex}.discountedPrice`,
        getInvoiceItemTotal(
          form.getValues(`invoiceItems.${rowIndex}.quantity`),
          form.getValues(`invoiceItems.${rowIndex}.discount`),
          item?.price,
        ),
        {
          shouldValidate: true,
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
      form.trigger(`invoiceItems.${rowIndex}.discount`);
      form.setValue(
        `invoiceItems.${rowIndex}.discountedPrice`,
        getInvoiceItemTotal(
          form.getValues(`invoiceItems.${rowIndex}.quantity`),
          toNumber(value),
          form.getValues(`invoiceItems.${rowIndex}.price`),
        ),
        {
          shouldValidate: true,
          shouldDirty: true,
        },
      );
    },
    [form],
  );
  const onQuantityChange = useCallback(
    (rowIndex: number, value: string, onChange: Function) => {
      onChange(toNumber(value));
      form.trigger(`invoiceItems.${rowIndex}.quantity`);
      form.setValue(
        `invoiceItems.${rowIndex}.discountedPrice`,
        getInvoiceItemTotal(
          toNumber(value),
          form.getValues(`invoiceItems.${rowIndex}.discount`),
          form.getValues(`invoiceItems.${rowIndex}.price`),
        ),
        {
          shouldValidate: true,
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

      return fieldValue ? getFormattedCurrency(fieldValue) : null;
    },
    [cumulativeDiscount, enableCumulativeDiscount, form],
  );

  const onAccountSelection = useCallback(
    async (accountId: string, onChange: Function) => {
      onChange(accountId);
      const partyLedger = await window.electron.getLedger(toNumber(accountId));
      const latestDate = partyLedger.at(0)?.date;
      // check if partyLastDateInLedger defined and is before latestDate, only then update
      if (
        latestDate &&
        (!partyLastDateInLedger || partyLastDateInLedger < new Date(latestDate))
      ) {
        setPartyLastDateInLedger(new Date(latestDate));
      } else {
        setPartyLastDateInLedger(null);
      }
    },
    [partyLastDateInLedger],
  );

  const columns: ColumnDef<InvoiceItem>[] = useMemo(() => {
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
                  options={inventory || []}
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
                    <p>
                      {field.value
                        ? getFormattedCurrency(toNumber(field.value))
                        : null}
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
                      step={0.1}
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
              header: 'Customer',
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
    form.control,
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
        shouldValidate: true,
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
        <div className="flex flex-row gap-2 items-center">
          <h1>Cumulative Discount (%)</h1>
          <Checkbox
            checked={enableCumulativeDiscount}
            onCheckedChange={(checked) =>
              setEnableCumulativeDiscount(checked === true)
            }
            className="ml-auto"
          />
          <h2 className="text-xs mr-auto">Enable</h2>
        </div>,
        null,
        null,
        <Input
          value={cumulativeDiscount}
          type="number"
          step={0.01}
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
                  step={0.0001}
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
                    watchedTotalAmount &&
                      'border-2 border-green-500 rounded-lg h-10 pl-2 pr-4 pt-2 w-fit',
                  )}
                >
                  {watchedTotalAmount
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

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    // eslint-disable-next-line no-console
    console.log('onSubmit invoice:', values);

    try {
      const invoice = {
        ...values,
        invoiceNumber: nextInvoiceNumber,
      };
      const returnedNextInvoiceNumber = (await window.electron.insertInvoice(
        invoiceType,
        invoice,
      )) as number;

      if (returnedNextInvoiceNumber > 0) {
        setNextInvoiceNumber(returnedNextInvoiceNumber);
        form.reset(defaultFormValues);
        toast({
          description: `${invoiceType} invoice saved successfully`,
          variant: 'success',
        });
        return;
      }
      throw new Error(`Failed to save ${invoiceType} invoice`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      toast({
        description: toString(error),
        variant: 'destructive',
      });
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
      if (date) {
        form.setValue('date', date.toLocaleString('en-US', dateFormatOptions));
      }
    },
    [form],
  );

  const isDateDisabled = useMemo(() => {
    if (partyLastDateInLedger === null) {
      return false; // null represents customer with no ledger entry hence no date selection restriction
    }

    const accountMapping = form.getValues('accountMapping'); // need watch
    const accountId =
      accountMapping.singleAccountId ?? accountMapping.multipleAccountIds?.[0];
    console.log('isDateDisabled', accountId, partyLastDateInLedger);
    if (
      partyLastDateInLedger === undefined || // last date hasn't been set for the selected party yet
      accountId === undefined || // no party selected yet
      accountId <= 0 // no party selected yet
    ) {
      return true;
    }

    return {
      before: partyLastDateInLedger,
    };
  }, [form, partyLastDateInLedger]);

  const onSingleAccountToggle = useCallback(
    (isChecked: boolean) => {
      setUseSingleAccount(isChecked);
      // clear the appropriate account mapping fields based on the toggle
      if (isChecked) {
        form.setValue('accountMapping.multipleAccountIds', [], {
          shouldValidate: true,
        });
      } else {
        form.setValue('accountMapping.singleAccountId', undefined, {
          shouldValidate: true,
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
    <div className="py-1 flex flex-col gap-y-4">
      <h1 className="text-xl">{`New ${invoiceType} Invoice`}</h1>

      {isNil(nextInvoiceNumber) ? (
        <AddInvoiceNumber
          invoiceType={invoiceType}
          onInvoiceNumberSet={onInvoiceNumberSet}
        />
      ) : (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            onReset={() => form.reset(defaultFormValues)}
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
                      Select a customer for each invoice item individually.
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
                          <Input {...field} placeholder="Enter bilty number" />
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
                      <FormLabel className="text-base">Date</FormLabel>
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
                              disabled={isDateDisabled}
                              selected={new Date(field.value)}
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
              {form.formState.errors && (
                <p className="text-xs text-muted-foreground">
                  Form Errors: {JSON.stringify(form.formState.errors)}
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
                    document.getElementById('uploadInvoiceItemsInput')?.click()
                  }
                >
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
                <Button type="submit" variant="default">
                  Save
                </Button>
                <Button type="reset" variant="ghost">
                  Clear
                </Button>
              </div>

              <Button
                variant="secondary"
                onClick={() => {
                  form.reset(defaultFormValues);
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
