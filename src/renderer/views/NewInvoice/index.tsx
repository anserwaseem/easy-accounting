/* eslint-disable react/no-unstable-nested-components */
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { get, isNaN, isNil, sum, toNumber, toString } from 'lodash';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/shad/ui/select';
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
import { AddInvoiceNumber } from './addInvoiceNumber';

interface NewInvoiceProps {
  invoiceType: InvoiceType;
}

const NewInvoicePage: React.FC<NewInvoiceProps> = ({
  invoiceType,
}: NewInvoiceProps) => {
  console.log('NewInvoicePage', invoiceType);
  const [inventory, setInventory] = useState<InventoryItem[]>();
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState<
    number | undefined
  >(-1);
  const [parties, setParties] = useState<Account[]>();
  const [partyLastDateInLedger, setPartyLastDateInLedger] = useState<
    Date | undefined | null // default state: undefined, null represents customer with no ledger entry hence no date selection restriction
  >();
  const [invoiceTypeAccountExists, setInvoiceTypeAccountExists] =
    useState<Boolean>();
  const [enableCumulativeDiscount, setEnableCumulativeDiscount] =
    useState(false);
  const [cumulativeDiscount, setCumulativeDiscount] = useState<number>();

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
    accountId: -1,
    extraDiscount: 0,
    totalAmount: 0,
    invoiceItems: [],
    invoiceType,
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
    accountId: z.coerce
      .number()
      .positive(
        `Select a ${invoiceType === InvoiceType.Sale ? 'customer' : 'vendor'}`,
      ),
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
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultFormValues,
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
        setInventory(await window.electron.getInventory());
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
        const accounts = (await window.electron.getAccounts()) as Account[];

        const invoiceTypeAccount = accounts.find(
          (account) =>
            account.name.trim().toLowerCase() === invoiceType.toLowerCase(),
        );
        setInvoiceTypeAccountExists(!!invoiceTypeAccount);

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

  const columns: ColumnDef<InvoiceItem>[] = useMemo(() => {
    const baseColumns: ColumnDef<InvoiceItem>[] = [
      {
        header: 'Item',
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`invoiceItems.${row.index}.inventoryId` as const}
            render={({ field }) => (
              <FormItem className="w-auto min-w-[250px] space-y-0">
                <Select
                  onValueChange={(val) =>
                    onItemSelectionChange(row.index, val, field.onChange)
                  }
                  value={field.value.toString()}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue>
                        {
                          inventory?.find(
                            (item) => item.id === toNumber(field.value),
                          )?.name
                        }
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent align="center">
                    {inventory?.map((item) => (
                      <SelectItem value={item.id.toString()} key={item.id}>
                        <div>
                          <h2>{item.name}</h2>
                          <p className="text-xs text-slate-400">
                            {item.description}
                          </p>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

      // insert price columns before the remove action column
      baseColumns.splice(baseColumns.length - 1, 0, ...priceColumns);
    }

    return baseColumns;
  }, [
    enableCumulativeDiscount,
    form.control,
    getDiscountValue,
    onDiscountChange,
    onQuantityChange,
    handleRemoveRow,
    onItemSelectionChange,
    inventory,
    renderDiscountedPrice,
    invoiceType,
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
            <FormItem className="flex w-1/2 space-y-0">
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  step={0.0001}
                  disabled={!hasActiveInvoiceItem}
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
                  className={
                    watchedTotalAmount
                      ? 'border-2 border-green-500 rounded-lg h-10 pl-2 pr-4 pt-2'
                      : ''
                  }
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
    ];
  }, [
    invoiceType,
    enableCumulativeDiscount,
    cumulativeDiscount,
    form.control,
    onCumulativeDiscountChange,
    hasActiveInvoiceItem,
    watchedTotalAmount,
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

  const onAccountSelection = useCallback(
    async (accountId: string, onChange: Function) => {
      onChange(accountId);
      const partyLedger = await window.electron.getLedger(toNumber(accountId));
      const latestDate = partyLedger.at(0)?.date;
      setPartyLastDateInLedger(latestDate ? new Date(latestDate) : null);
    },
    [],
  );

  const isDateDisabled = useMemo(() => {
    if (partyLastDateInLedger === null) {
      return false; // null represents customer with no ledger entry hence no date selection restriction
    }

    if (
      partyLastDateInLedger === undefined || // last date hasn't been set for the selected party yet
      form.getValues('accountId') <= 0 // no party selected yet
    ) {
      return true;
    }

    return {
      before: partyLastDateInLedger,
    };
  }, [form, partyLastDateInLedger]);

  const onDateSelection = useCallback(
    (date?: Date) => {
      if (date) {
        form.setValue('date', date.toLocaleString('en-US', dateFormatOptions));
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

  if (!parties?.length) {
    return (
      <div className="block fixed z-10 bg-green-400 text-center text-xl bg-opacity-60 w-full left-0 top-[50%] py-4 px-8">
        {`Please add a ${
          invoiceType === InvoiceType.Sale ? 'customer' : 'vendor'
        } before creating a ${invoiceType.toLowerCase()} invoice.`}
      </div>
    );
  }

  if (invoiceTypeAccountExists !== true) {
    return (
      <div className="block fixed z-10 bg-green-400 text-center text-xl bg-opacity-60 w-full left-0 top-[50%] py-4 px-8">
        {`Please add a ${invoiceType.toLowerCase()} account before creating a ${invoiceType.toLowerCase()} invoice.`}
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
              <FormField
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem labelPosition="start" className="w-1/2 space-y-0">
                    <FormLabel className="text-base">
                      {invoiceType === InvoiceType.Sale ? 'Customer' : 'Vendor'}
                    </FormLabel>
                    <Select
                      onValueChange={(val) =>
                        onAccountSelection(val, field.onChange)
                      }
                      value={field.value.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue>
                            {
                              parties?.find(
                                (p) => p.id === toNumber(field.value),
                              )?.name
                            }
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent align="center">
                        {parties?.map((p) => (
                          <SelectItem value={p.id.toString()} key={p.id}>
                            <div>
                              <h2>{p.name}</h2>
                              <p className="text-xs text-slate-400">{p.code}</p>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem labelPosition="start" className="w-1/2 space-y-0">
                    <FormLabel className="text-base">Date</FormLabel>
                    <FormControl>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              'w-[280px] justify-start text-left font-normal w-100',
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
            </div>

            <div className="py-8 pr-4 flex flex-col gap-3">
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

            <div className="flex justify-between pr-4 gap-20 pb-20">
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

            <div className="flex justify-between fixed bottom-6">
              <div className="flex gap-4">
                <Button type="submit" variant="default">
                  Save
                </Button>
                <Button type="reset" variant="ghost">
                  Clear
                </Button>
              </div>

              <Button
                className="fixed right-9"
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
