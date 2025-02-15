import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { get, isNaN, isNil, set, toNumber, toString } from 'lodash';
import { Calendar as CalendarIcon, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { dateFormatOptions } from 'renderer/lib/constants';
import { cn, defaultSortingFunctions } from 'renderer/lib/utils';
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
  const [invoiceTypeAccountExists, setInvoiceTypeAccountExists] =
    useState<Boolean>();

  const navigate = useNavigate();

  const getInitialEntry = useCallback(
    () => ({
      id: Date.now(), // generates a unique ID for each new entry. not used to insert into db
      inventoryId: 0,
      quantity: 0,
    }),
    [],
  );

  const defaultFormValues: Invoice = {
    id: -1,
    date: new Date().toLocaleString('en-US', dateFormatOptions),
    invoiceNumber: -1,
    accountId: -1,
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
        message: 'Invalid date',
      }),
    accountId: z.coerce
      .number()
      .gt(
        0,
        `Select a ${invoiceType === InvoiceType.Sale ? 'customer' : 'vendor'}`,
      ),
    invoiceItems: z
      .array(
        z.object({
          id: z.number(),
          inventoryId: z.coerce.number().gt(0, 'Select an item'),
          quantity: z.coerce.number().gt(0, 'Select quantity greater than 0'),
        }),
      )
      .min(1, 'Add atleast one invoice item'),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultFormValues,
  });

  const { fields, append } = useFieldArray({
    control: form.control,
    name: 'invoiceItems',
  });

  // Clear form errors when invoiceType changes
  useEffect(() => {
    form.clearErrors();
  }, [invoiceType, form]);

  // Fetch data for this page
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

  const columns: ColumnDef<InvoiceItem>[] = useMemo(
    () => [
      {
        header: 'Item',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`invoiceItems.${row.index}.inventoryId` as const}
            render={({ field }) => (
              <FormItem className="w-auto min-w-[250px] space-y-0">
                <Select
                  onValueChange={field.onChange}
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
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`invoiceItems.${row.index}.quantity` as const}
            render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <Input
                    {...field}
                    value={field.value}
                    type="number"
                    onChange={(e) => field.onChange(toNumber(e.target.value))}
                    onBlur={(e) => field.onChange(toNumber(e.target.value))}
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
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <X
            color="red"
            size={16}
            onClick={() => handleRemoveRow(row.index)}
            cursor="pointer"
          />
        ),
      },
    ],
    [form.control, handleRemoveRow, inventory],
  );

  const handleAddNewRow = useCallback(
    () => append({ ...getInitialEntry() }),
    [append, getInitialEntry],
  );

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
            'Some items are not available. Please recheck and try again.',
          variant: 'destructive',
        });
      }

      parsedItems.forEach((pItem) => {
        const inventoryItem = items.find((i) => i.name === pItem.name);
        set(pItem, 'inventoryId', inventoryItem?.id);
        set(pItem, 'id', Date.now());

        append(pItem as unknown as InvoiceItem);
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
            <div>
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
                            selected={new Date(field.value)}
                            onSelect={(date) => {
                              if (date) {
                                form.setValue(
                                  'date',
                                  date.toLocaleString(
                                    'en-US',
                                    dateFormatOptions,
                                  ),
                                );
                              }
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem labelPosition="start" className="w-1/2 space-y-0">
                    <FormLabel className="text-base">
                      {invoiceType === InvoiceType.Sale ? 'Customer' : 'Vendor'}
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
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
            </div>

            <div className="py-8 pr-4 flex flex-col gap-3">
              <DataTable
                columns={columns}
                data={fields}
                sortingFns={defaultSortingFunctions}
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
              <div className="flex flex-row gap-4">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    document.getElementById('uploadInvoiceItemsInput')?.click()
                  }
                >
                  Upload Items
                </Button>
                <Input
                  id="uploadInvoiceItemsInput"
                  type="file"
                  accept=".xlsx, .xls"
                  className="hidden"
                  onChange={uploadInvoiceItems}
                />
                <div>
                  <p className="text-xs">Select all inventory</p>
                  <Checkbox checked />
                </div>
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
