import { Plus, Calendar as CalendarIcon, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import { Input } from 'renderer/shad/ui/input';
import { toNumber, toString } from 'lodash';
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
import { useToast } from 'renderer/shad/ui/use-toast';
import { useNavigate } from 'react-router-dom';
import { dateFormatOptions } from 'renderer/lib/constants';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/shad/ui/select';
import { Separator } from 'renderer/shad/ui/separator';

const NewJournalPage = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [nextId, setNextId] = useState<number>(-1);
  const [totalCredits, setTotalCredits] = useState<number>(0);
  const [totalDebits, setTotalDebits] = useState<number>(0);
  const [differenceCredit, setDifferenceCredit] = useState<number>(0);
  const [differenceDebit, setDifferenceDebit] = useState<number>(0);
  const { toast } = useToast();
  const navigate = useNavigate();

  const getInitialEntry = () => ({
    id: Date.now(), // Will generate a unique ID for each new entry. Will not be used to insert into db
    journalId: nextId,
    debitAmount: 0,
    accountId: 0,
    creditAmount: 0,
  });

  const defaultFormValues: Journal = {
    id: nextId, // using journal id as journal number as well (uneditable from UI)
    date: new Date().toLocaleString('en-US', dateFormatOptions),
    narration: '',
    isPosted: true, // FUTURE: support draft journals
    journalEntries: [{ ...getInitialEntry() }, { ...getInitialEntry() }],
  };

  const [journal, setJournal] = useState<Journal>(defaultFormValues);

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
    narration: z.string().optional(),
    isPosted: z.boolean(),
    journalEntries: z.array(
      z.object({
        id: z.number(),
        journalId: z.number(),
        debitAmount: z.number(),
        accountId: z.coerce.number().gt(0, 'Select an account'),
        creditAmount: z.number(),
      }),
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
  useEffect(
    () =>
      void (async () => {
        setNextId(await window.electron.getNextJournalId());
        setAccounts(await window.electron.getAccounts());
      })(),
    [],
  );

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
    [journal],
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
    [journal],
  );

  const handleCreditChange = useCallback(
    (value: string, rowIndex: number) =>
      form.setValue(
        `journalEntries.${rowIndex}.creditAmount` as const,
        toNumber(value),
      ),
    [],
  );

  const handleDebitChange = useCallback(
    (value: string, rowIndex: number) =>
      form.setValue(
        `journalEntries.${rowIndex}.debitAmount` as const,
        toNumber(value),
      ),
    [],
  );

  const handleRemoveRow = useCallback((rowIndex: number) => {
    const latestJournal = form.getValues();
    const removedRow = latestJournal.journalEntries[rowIndex];

    if (fields.length > 0) {
      form.setValue(
        'journalEntries',
        latestJournal.journalEntries.filter((_, index) => index !== rowIndex),
      );

      setTotalCredits((prev) => prev - removedRow.creditAmount);
      setTotalDebits((prev) => prev - removedRow.debitAmount);
    } else {
      setTotalCredits(0);
      setTotalDebits(0);
    }
  }, []);

  const getAmountDefaultLabel = useCallback(
    (value: number) =>
      value === 0
        ? toString(window.electron.store.get('debitCreditDefaultLabel'))
        : value,
    [window.electron.store],
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
    [window.electron.store],
  );

  const columns: ColumnDef<JournalEntry>[] = useMemo(
    () => [
      {
        header: 'Account',
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`journalEntries.${row.index}.accountId` as const}
            render={({ field }) => (
              <FormItem>
                <Select
                  defaultValue={field.value.toString()}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger className="min-w-[150px]">
                      <SelectValue
                        placeholder={
                          accounts.find(
                            (acc) => acc.id === toNumber(field.value),
                          )?.name
                        }
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent align="center">
                    {accounts.map((account) => (
                      <SelectItem
                        value={account.id.toString()}
                        className="text-muted-foreground"
                        key={account.id}
                      >
                        {account.name}
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
        header: 'Debit',
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`journalEntries.${row.index}.debitAmount` as const}
            render={({ field }) => (
              <FormItem>
                <FormControl className="w-1/2">
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
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`journalEntries.${row.index}.creditAmount` as const}
            render={({ field }) => (
              <FormItem>
                <FormControl className="w-1/2">
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
        header: '',
        cell: ({ row }) => (
          <X color="red" size={16} onClick={() => handleRemoveRow(row.index)} />
        ),
      },
    ],
    [accounts, journal],
  );

  const handleAddNewRow = useCallback(
    () => append({ ...getInitialEntry() }),
    [],
  );

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
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

    try {
      const isInserted = await window.electron.insertJournal(values);

      if (!!isInserted) {
        form.reset(defaultFormValues);
        setTotalCredits(0);
        setTotalDebits(0);
        setNextId((prev) => prev + 1);

        toast({
          description: 'Journal saved successfully',
          variant: 'success',
        });
        return;
      }
      throw new Error('Failed to save journal');
    } catch (error) {
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

  const isPublishDisabled = useMemo(
    () =>
      form.formState.isSubmitting ||
      totalCredits !== totalDebits ||
      totalCredits === 0 ||
      totalDebits === 0,
    [form.formState.isSubmitting, totalCredits, totalDebits],
  );

  return (
    <div className="py-4 flex flex-col gap-y-4">
      <h1 className="text-xl py-2">New Journal</h1>
      <Separator />

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          onReset={() => form.reset(defaultFormValues)}
          onKeyDown={checkKeyDown}
        >
          <div>
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem labelPosition="start" className="w-1/2">
                  <FormLabel className="text-lg">Date</FormLabel>
                  <FormControl>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant={'outline'}
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
                                date.toLocaleString('en-US', dateFormatOptions),
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
              name="id"
              render={({ field }) => (
                <FormItem labelPosition="start" className="w-1/2">
                  <FormLabel className="text-lg">Journal#</FormLabel>
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
            />

            <FormField
              control={form.control}
              name="narration"
              render={({ field }) => (
                <FormItem labelPosition="start" className="w-1/2">
                  <FormLabel className="text-lg">Narration</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="py-10 pr-4">
            <DataTable
              columns={columns}
              data={fields}
              sortingFns={defaultSortingFunctions}
            />
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
                variant={'default'}
                disabled={isPublishDisabled}
              >
                Save and Publish
              </Button>
              {/* <Button type="button" variant={'secondary'} onClick={handleSaveDraft}>Save as Draft</Button> */}
              <Button type="reset" variant={'ghost'}>
                Clear
              </Button>
            </div>

            <Button
              className="fixed right-9"
              variant={'secondary'}
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
  );
};

export default NewJournalPage;
