import { Plus, Calendar as CalendarIcon, X, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import { Input } from 'renderer/shad/ui/input';
import { get, toNumber, toString } from 'lodash';
import { Table, TableBody, TableCell, TableRow } from 'renderer/shad/ui/table';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'renderer/shad/ui/popover';
import { format } from 'date-fns';
import {
  cn,
  defaultSortingFunctions,
  getFixedNumber,
} from 'renderer/lib/utils';
import { Calendar } from 'renderer/shad/ui/calendar';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm } from 'react-hook-form';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from 'renderer/shad/ui/form';
import { toast } from 'renderer/shad/ui/use-toast';
import { useNavigate } from 'react-router-dom';
import type { Account, Journal, JournalEntry } from 'types';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'renderer/shad/ui/dialog';

const NewJournalPage: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[] | undefined>(undefined);
  const [nextId, setNextId] = useState<number>(-1);
  const [totalCredits, setTotalCredits] = useState<number>(0);
  const [totalDebits, setTotalDebits] = useState<number>(0);
  const [differenceCredit, setDifferenceCredit] = useState<number>(0);
  const [differenceDebit, setDifferenceDebit] = useState<number>(0);
  const [isDateExplicitlySet, setIsDateExplicitlySet] =
    useState<boolean>(false);
  const [showDateConfirmation, setShowDateConfirmation] =
    useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const navigate = useNavigate();

  const getInitialEntry = useCallback(
    () => ({
      id: Date.now(), // generates a unique ID for each new entry. not used to insert into db
      journalId: nextId,
      debitAmount: 0,
      accountId: 0,
      creditAmount: 0,
    }),
    [nextId],
  );

  const defaultFormValues: Journal = {
    id: nextId, // using journal id as journal number as well (uneditable from UI)
    date: new Date().toISOString(),
    narration: '',
    isPosted: true, // FUTURE: support draft journals
    journalEntries: [{ ...getInitialEntry() }, { ...getInitialEntry() }],
  };

  const [journal, setJournal] = useState<Journal>(defaultFormValues);

  const formSchema = z.object({
    id: z.number(),
    date: z.string().datetime({ local: true, message: 'Select a valid date' }),
    narration: z.string().optional(),
    isPosted: z.boolean(),
    journalEntries: z.array(
      z
        .object({
          id: z.number(),
          journalId: z.number(),
          debitAmount: z.number(),
          accountId: z.coerce.number().gt(0, 'Select an account'),
          creditAmount: z.number(),
        })
        .refine(
          (data) => !(data.debitAmount === 0 && data.creditAmount === 0),
          {
            message:
              'Debit amount and credit amount cannot be zero at the same time',
          },
        ),
    ),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultFormValues,
    values: journal,
  });

  const { fields, append } = useFieldArray({
    control: form.control,
    name: 'journalEntries',
  });

  // Fetch data for this page
  useEffect(() => {
    (async () => {
      setNextId(await window.electron.getNextJournalId());
      setAccounts(await window.electron.getAccounts());
    })();
  }, []);

  // Refresh accounts
  const refreshAccounts = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const freshAccounts = await window.electron.getAccounts();
      setAccounts(freshAccounts);
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
      setIsRefreshing(false);
    }
  }, []);

  // Update the journal id when nextId is received
  useEffect(
    () =>
      setJournal((prev) => {
        const newJournal = { ...prev };
        newJournal.id = nextId;
        newJournal.journalEntries = newJournal.journalEntries.map((entry) => ({
          ...entry,
          journalId: nextId,
        }));
        return newJournal;
      }),
    [nextId],
  );

  // Calculate the total credits and debits
  useEffect(() => {
    setDifferenceCredit(
      Math.max(getFixedNumber(totalDebits - totalCredits), 0),
    );
    setDifferenceDebit(Math.max(getFixedNumber(totalCredits - totalDebits), 0));
  }, [totalCredits, totalDebits]);

  const handleDebitBlur = useCallback(
    (value: string, rowIndex: number) => {
      const val = toNumber(value);

      const latestJournal = form.getValues();

      setTotalDebits(
        latestJournal.journalEntries
          .map((entry) => entry.debitAmount)
          .reduce((acc, curr) => getFixedNumber(acc + curr)),
      );

      if (
        val > 0 &&
        latestJournal.journalEntries[rowIndex]?.creditAmount !== 0
      ) {
        const newCreditsTotal =
          latestJournal.journalEntries
            .map((entry) => entry.creditAmount)
            .reduce((acc, curr) => getFixedNumber(acc + curr)) -
          latestJournal.journalEntries[rowIndex].creditAmount;
        setTotalCredits(newCreditsTotal);

        form.setValue(`journalEntries.${rowIndex}.creditAmount` as const, 0);

        form.setValue(`journalEntries.${rowIndex}.debitAmount` as const, val);
      }
    },
    [form],
  );

  const handleCreditBlur = useCallback(
    (value: string, rowIndex: number) => {
      const val = toNumber(value);

      const latestJournal = form.getValues();

      setTotalCredits(
        latestJournal.journalEntries
          .map((entry) => entry.creditAmount)
          .reduce((acc, curr) => getFixedNumber(acc + curr)),
      );

      if (
        val > 0 &&
        latestJournal.journalEntries[rowIndex]?.debitAmount !== 0
      ) {
        const newDebitsTotal =
          latestJournal.journalEntries
            .map((entry) => entry.debitAmount)
            .reduce((acc, curr) => getFixedNumber(acc + curr)) -
          latestJournal.journalEntries[rowIndex].debitAmount;
        setTotalDebits(newDebitsTotal);

        form.setValue(`journalEntries.${rowIndex}.debitAmount` as const, 0);
        form.setValue(`journalEntries.${rowIndex}.creditAmount` as const, val);
      }
    },
    [form],
  );

  const handleCreditChange = useCallback(
    (value: string, rowIndex: number) =>
      form.setValue(
        `journalEntries.${rowIndex}.creditAmount` as const,
        toNumber(value),
      ),
    [form],
  );

  const handleDebitChange = useCallback(
    (value: string, rowIndex: number) =>
      form.setValue(
        `journalEntries.${rowIndex}.debitAmount` as const,
        toNumber(value),
      ),
    [form],
  );

  const handleRemoveRow = useCallback(
    (rowIndex: number) => {
      const latestJournal = form.getValues();
      const removedRow = latestJournal.journalEntries[rowIndex];

      if (fields.length > 0) {
        form.setValue(
          'journalEntries',
          latestJournal.journalEntries.filter((_, index) => index !== rowIndex),
        );
        form.clearErrors(`journalEntries.${rowIndex}` as const);

        setTotalCredits((prev) => prev - removedRow.creditAmount);
        setTotalDebits((prev) => prev - removedRow.debitAmount);
      } else {
        setTotalCredits(0);
        setTotalDebits(0);
      }
    },
    [fields.length, form],
  );

  const getAmountDefaultLabel = useCallback(
    (value: number) =>
      value === 0
        ? toString(window.electron.store.get('debitCreditDefaultLabel'))
        : value,
    [],
  );

  const removeDefaultLabel = useCallback(
    (value: string) =>
      toString(
        toNumber(
          value.includes(window.electron.store.get('debitCreditDefaultLabel'))
            ? value.replace(
                window.electron.store.get('debitCreditDefaultLabel'),
                '',
              )
            : value,
        ) || 0,
      ),
    [],
  );

  const columns: ColumnDef<JournalEntry>[] = useMemo(
    () => [
      {
        header: 'Account',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`journalEntries.${row.index}.accountId` as const}
            render={({ field }) => (
              <FormItem className="w-max min-w-[200px] space-y-0">
                <VirtualSelect
                  options={accounts || []}
                  value={field.value?.toString()}
                  onChange={(val) => field.onChange(toString(val))}
                  placeholder="Select account"
                  searchPlaceholder="Search accounts..."
                />
                <FormMessage />
              </FormItem>
            )}
          />
        ),
      },
      {
        header: 'Debit',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`journalEntries.${row.index}.debitAmount` as const}
            render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <Input
                    {...field}
                    value={getAmountDefaultLabel(field.value)}
                    type={field.value === 0 ? 'text' : 'number'}
                    onChange={(e) =>
                      handleDebitChange(
                        removeDefaultLabel(e.target.value),
                        row.index,
                      )
                    }
                    onBlur={(e) =>
                      handleDebitBlur(
                        removeDefaultLabel(e.target.value),
                        row.index,
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
        header: 'Credit',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`journalEntries.${row.index}.creditAmount` as const}
            render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <Input
                    {...field}
                    value={getAmountDefaultLabel(field.value)}
                    type={field.value === 0 ? 'text' : 'number'}
                    onBlur={(e) =>
                      handleCreditBlur(
                        removeDefaultLabel(e.target.value),
                        row.index,
                      )
                    }
                    onChange={(e) =>
                      handleCreditChange(
                        removeDefaultLabel(e.target.value),
                        row.index,
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
    [
      accounts,
      form.control,
      getAmountDefaultLabel,
      handleCreditBlur,
      handleCreditChange,
      handleDebitBlur,
      handleDebitChange,
      handleRemoveRow,
      removeDefaultLabel,
    ],
  );

  const handleAddNewRow = useCallback(
    () => append({ ...getInitialEntry() }),
    [append, getInitialEntry],
  );

  const submitJournal = async (values: z.infer<typeof formSchema>) => {
    try {
      const isInserted = await window.electron.insertJournal(values);

      if (!!isInserted) {
        form.reset(defaultFormValues);
        setTotalCredits(0);
        setTotalDebits(0);
        setNextId((prev) => prev + 1);
        setIsDateExplicitlySet(false);

        toast({
          description: 'Journal saved successfully',
          variant: 'success',
        });
        return;
      }
      throw new Error('Failed to save journal');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      toast({
        description: toString(error),
        variant: 'destructive',
      });
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    // eslint-disable-next-line no-console
    console.log('onSubmit journal:', values);

    const numberOfCredits = values.journalEntries.filter(
      (entry) => entry.creditAmount > 0,
    ).length;
    const numberOfDebits = values.journalEntries.filter(
      (entry) => entry.debitAmount > 0,
    ).length;

    if (numberOfCredits > 1 && numberOfDebits > 1) {
      toast({
        description:
          'Only one debit for corresponding credit amounts is allowed OR vice versa.',
        variant: 'destructive',
      });
      return;
    }

    // check if date was explicitly set by user
    if (!isDateExplicitlySet) {
      setShowDateConfirmation(true);
      return;
    }

    await submitJournal(values);
  };

  const checkKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLFormElement> | undefined) =>
      e?.key === 'Enter' && e.preventDefault(),
    [],
  );

  const isPublishDisabled = useMemo(
    () =>
      form.formState.isSubmitting ||
      totalCredits !== totalDebits ||
      totalCredits === 0 ||
      totalDebits === 0,
    [form.formState.isSubmitting, totalCredits, totalDebits],
  );

  return (
    <>
      <Dialog
        open={showDateConfirmation}
        onOpenChange={setShowDateConfirmation}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Date</DialogTitle>
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
              Change Date
            </Button>
            <Button
              onClick={async () => {
                setShowDateConfirmation(false);
                await submitJournal(form.getValues());
              }}
            >
              Use Current Date
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        className={
          !accounts || accounts.length
            ? 'hidden'
            : 'block fixed z-10 bg-green-400 text-center text-xl bg-opacity-60 w-full left-0 top-[50%] py-4 px-8'
        }
      >
        Looks like you&apos;re ready to start journaling! But first, let&apos;s
        set up an account. Head over to the Accounts section to get started.
      </div>
      <div className="py-1 flex flex-col gap-y-4">
        <div className="flex justify-between items-center">
          <h1 className="title-new">New Journal</h1>
          <Button
            variant="outline"
            size="icon"
            onClick={refreshAccounts}
            title="Refresh Accounts"
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </Button>
        </div>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            onReset={() => {
              form.reset(defaultFormValues);
              setIsDateExplicitlySet(false);
            }}
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
                              if (!date) return;
                              form.setValue('date', date.toISOString());
                              setIsDateExplicitlySet(true);
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

              {/* <FormField
                control={form.control}
                name="id"
                render={({ field }) => (
                  <FormItem labelPosition="start" className="w-1/2 space-y-0">
                    <FormLabel className="text-base">Journal#</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        disabled
                        type={field.value === -1 ? 'text' : 'number'}
                        value={field.value === -1 ? '' : field.value}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              /> */}

              <FormField
                control={form.control}
                name="narration"
                render={({ field }) => (
                  <FormItem labelPosition="start" className="w-1/2 space-y-0">
                    <FormLabel className="text-base">Narration</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="pt-4 pb-8 pr-4 flex flex-col gap-3">
              <DataTable
                columns={columns}
                data={fields}
                sortingFns={defaultSortingFunctions}
              />
              {form.formState.errors.journalEntries && (
                <p className="text-sm font-medium text-destructive">
                  {get(
                    form.formState.errors.journalEntries?.find?.((je) => !!je),
                    ['root', 'message'],
                  )}
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
                <span className="w-max">Add New Row</span>
              </Button>

              <Table className="dark:bg-gray-900 bg-gray-100 rounded-xl">
                <TableBody>
                  <TableRow>
                    <TableCell />
                    <TableCell className="font-medium w-1/3">Debit</TableCell>
                    <TableCell className="font-medium w-1/3">Credit</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-xl w-1/3">
                      Total
                    </TableCell>
                    <TableCell>{totalDebits}</TableCell>
                    <TableCell>{totalCredits}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-red-500">
                      Difference
                    </TableCell>
                    <TableCell className="text-red-500">
                      {differenceDebit}
                    </TableCell>
                    <TableCell className="text-red-500">
                      {differenceCredit}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between fixed bottom-6">
              <div className="flex gap-4">
                <Button
                  type="submit"
                  variant="default"
                  disabled={isPublishDisabled}
                >
                  Save and Publish
                </Button>
                {/* <Button type="button" variant={'secondary'} onClick={handleSaveDraft}>Save as Draft</Button> */}
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
      </div>
    </>
  );
};

export default NewJournalPage;
