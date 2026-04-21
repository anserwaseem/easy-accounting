import { Plus, X, RefreshCw, Upload, Equal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'renderer/shad/ui/button';
import { getOsModifierLabel } from '@/renderer/shad/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from 'renderer/shad/ui/tooltip';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import { Input } from 'renderer/shad/ui/input';
import { get, toNumber, toString } from 'lodash';
import { Table, TableBody, TableCell, TableRow } from 'renderer/shad/ui/table';
import { format } from 'date-fns';
import {
  cn,
  defaultSortingFunctions,
  getFixedNumber,
  raise,
  getFormattedCurrency,
  getFormattedCurrencyInt,
} from 'renderer/lib/utils';
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
import { FormDateSelector } from '@/renderer/components/FormDateSelector';
import { handleFormEnterKeyDown } from '@/renderer/lib/formUtils';
import {
  BalanceType,
  type Account,
  type Journal,
  type JournalEntry,
} from 'types';
import { useCmdOrCtrlShortcut } from '@/renderer/hooks/useCmdOrCtrlShortcut';
import { FileUploadTooltip } from '@/renderer/components/FileUploadTooltip';
import { FILE_UPLOAD_HINT_JOURNAL_ENTRIES } from '@/renderer/lib/fileUploadTooltips';
import { convertFileToJson } from 'renderer/lib/lib';
import { parseJournalImportSheet } from 'renderer/lib/parser';
import { toLocalNoonIsoString } from '@/renderer/lib/localDate';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'renderer/shad/ui/dialog';

import { formSchema } from './schema';
import { AccountCell, CreditCell, DebitCell } from './cells';

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
  const [shouldShowFractions, setShouldShowFractions] =
    useState<boolean>(false);
  const navigate = useNavigate();
  const importInputRef = useRef<HTMLInputElement>(null);

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
    // use local noon to avoid timezone "previous day" shifts when serializing to ISO
    date: toLocalNoonIsoString(new Date()),
    narration: '',
    isPosted: true, // FUTURE: support draft journals
    journalEntries: [{ ...getInitialEntry() }, { ...getInitialEntry() }],
  };

  const [journal, setJournal] = useState<Journal>(defaultFormValues);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultFormValues,
    values: journal,
  });

  const { fields, append } = useFieldArray({
    control: form.control,
    name: 'journalEntries',
  });

  // calculate totals via subscription
  useEffect(() => {
    const subscription = form.watch((value) => {
      const entries = value.journalEntries || [];
      let newTotalDebits = 0;
      let newTotalCredits = 0;
      let hasFraction = false;

      for (const entry of entries) {
        if (!entry) continue;
        const d = toNumber(entry.debitAmount) || 0;
        const c = toNumber(entry.creditAmount) || 0;
        newTotalDebits += d;
        newTotalCredits += c;
        if (!Number.isInteger(d) || !Number.isInteger(c)) {
          hasFraction = true;
        }
      }

      newTotalDebits = getFixedNumber(newTotalDebits, 2);
      newTotalCredits = getFixedNumber(newTotalCredits, 2);

      setTotalDebits((prev) =>
        prev !== newTotalDebits ? newTotalDebits : prev,
      );
      setTotalCredits((prev) =>
        prev !== newTotalCredits ? newTotalCredits : prev,
      );
      setShouldShowFractions((prev) =>
        prev !== hasFraction ? hasFraction : prev,
      );
    });
    return () => subscription.unsubscribe();
  }, [form]);

  // fetch data for this page
  useEffect(() => {
    (async () => {
      setNextId(await window.electron.getNextJournalId());
      const allAccounts = await window.electron.getAccounts();
      setAccounts(allAccounts.filter((account: Account) => account.isActive));
    })();
  }, []);

  // focus the first account selector once account list has loaded so the user can start entry immediately
  useEffect(() => {
    if (accounts === undefined) return undefined;
    const id = requestAnimationFrame(() => {
      const cell = document.getElementById('account-cell-0');
      const input = cell?.querySelector('input');
      if (input) {
        input.focus();
      } else {
        const button = cell?.querySelector('button');
        button?.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [accounts]);

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

  // update the journal id when nextId is received
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

  // calculate the difference credits and debits
  useEffect(() => {
    setDifferenceCredit(
      Math.max(getFixedNumber(totalDebits - totalCredits), 0),
    );
    setDifferenceDebit(Math.max(getFixedNumber(totalCredits - totalDebits), 0));
  }, [totalCredits, totalDebits]);

  const handleRemoveRow = useCallback(
    (rowIndex: number) => {
      const latestJournal = form.getValues();
      if (fields.length > 0) {
        form.setValue(
          'journalEntries',
          latestJournal.journalEntries.filter((_, index) => index !== rowIndex),
        );
        form.clearErrors(`journalEntries.${rowIndex}` as const);
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

  const removeDefaultLabel = useCallback((value: string) => {
    const defaultLabel = toString(
      window.electron.store.get('debitCreditDefaultLabel'),
    );
    const withoutLabel = value.includes(defaultLabel)
      ? value.replace(defaultLabel, '')
      : value;
    // keep only digits and a single dot for decimal values
    const cleaned = toString(withoutLabel).replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const normalized =
      parts.length > 1
        ? `${parts[0]}.${parts.slice(1).join('').replace(/\./g, '')}`
        : cleaned;
    return normalized || '0';
  }, []);

  const intFormatter = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        useGrouping: true,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
    [],
  );

  const floatFormatter = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        useGrouping: true,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    [],
  );

  const formatAmountForDisplay = useCallback(
    (value: number | string) => {
      const numericValue = toNumber(value);
      if (!Number.isFinite(numericValue) || numericValue === 0)
        return toString(value);
      return floatFormatter.format(numericValue);
    },
    [floatFormatter],
  );

  const formatStringWithGrouping = useCallback(
    (value: string) => {
      if (!value) return '';
      const hasDot = value.includes('.');
      const [intPartRaw, decimalPartRaw = ''] = value.split('.');
      const intPartNumber = toNumber(intPartRaw);
      const groupedInt = Number.isFinite(intPartNumber)
        ? intFormatter.format(intPartNumber)
        : intPartRaw;
      if (hasDot) return `${groupedInt}.${decimalPartRaw}`;
      return groupedInt;
    },
    [intFormatter],
  );

  const handleBalanceRow = useCallback(
    (rowIndex: number) => {
      const latestJournal = form.getValues();
      let currentTotalDebits = 0;
      let currentTotalCredits = 0;

      latestJournal.journalEntries.forEach((entry, i) => {
        if (i === rowIndex) return;
        currentTotalDebits += entry.debitAmount || 0;
        currentTotalCredits += entry.creditAmount || 0;
      });

      currentTotalDebits = getFixedNumber(currentTotalDebits, 2);
      currentTotalCredits = getFixedNumber(currentTotalCredits, 2);

      if (currentTotalDebits > currentTotalCredits) {
        const diff = getFixedNumber(
          currentTotalDebits - currentTotalCredits,
          2,
        );
        form.setValue(`journalEntries.${rowIndex}.debitAmount` as const, 0);
        form.setValue(`journalEntries.${rowIndex}.creditAmount` as const, diff);
      } else if (currentTotalCredits > currentTotalDebits) {
        const diff = getFixedNumber(
          currentTotalCredits - currentTotalDebits,
          2,
        );
        form.setValue(`journalEntries.${rowIndex}.creditAmount` as const, 0);
        form.setValue(`journalEntries.${rowIndex}.debitAmount` as const, diff);
      } else {
        form.setValue(`journalEntries.${rowIndex}.creditAmount` as const, 0);
        form.setValue(`journalEntries.${rowIndex}.debitAmount` as const, 0);
      }
    },
    [form],
  );

  const columns: ColumnDef<JournalEntry>[] = useMemo(
    () => [
      {
        header: 'Account',
        size: 420,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <AccountCell form={form} rowIndex={row.index} accounts={accounts} />
        ),
      },
      {
        header: 'Debit',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <DebitCell
            form={form}
            rowIndex={row.index}
            removeDefaultLabel={removeDefaultLabel}
            getAmountDefaultLabel={getAmountDefaultLabel}
            formatAmountForDisplay={formatAmountForDisplay}
            formatStringWithGrouping={formatStringWithGrouping}
          />
        ),
      },
      {
        header: 'Credit',
        size: 160,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <CreditCell
            form={form}
            rowIndex={row.index}
            removeDefaultLabel={removeDefaultLabel}
            getAmountDefaultLabel={getAmountDefaultLabel}
            formatAmountForDisplay={formatAmountForDisplay}
            formatStringWithGrouping={formatStringWithGrouping}
          />
        ),
      },
      {
        id: 'remove',
        header: 'Action',
        size: 80,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <div className="flex items-center gap-4">
            <button
              type="button"
              title="Fill balancing amount"
              aria-label="Fill balancing amount"
              onClick={() => handleBalanceRow(row.index)}
              className="outline-none"
            >
              <Equal
                size={16}
                className="text-indigo-500 hover:text-indigo-600 cursor-pointer"
              />
            </button>
            <button
              type="button"
              title="Remove row"
              aria-label="Remove row"
              onClick={() => handleRemoveRow(row.index)}
              className="outline-none"
            >
              <X color="red" size={16} cursor="pointer" />
            </button>
          </div>
        ),
      },
    ],
    [
      accounts,
      form,
      handleRemoveRow,
      handleBalanceRow,
      removeDefaultLabel,
      getAmountDefaultLabel,
      formatAmountForDisplay,
      formatStringWithGrouping,
    ],
  );

  const handleAddNewRow = useCallback(() => {
    const newIndex = form.getValues('journalEntries').length;
    append({ ...getInitialEntry() });
    setTimeout(() => {
      const cell = document.getElementById(`account-cell-${newIndex}`);
      const input = cell?.querySelector('input');
      if (input) {
        input.focus();
      } else {
        const button = cell?.querySelector('button');
        button?.focus();
      }
    }, 50);
  }, [append, getInitialEntry, form]);

  useCmdOrCtrlShortcut('n', handleAddNewRow);

  const normalizeAccountCode = useCallback(
    (value: unknown) => toString(value).trim().toLowerCase(),
    [],
  );
  const normalizeAccountName = useCallback(
    (value: unknown) => toString(value).trim().toLowerCase(),
    [],
  );

  const handleImportJournalEntries = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      try {
        const json = await convertFileToJson(file, {
          preferDisplayText: true,
        });
        const parsed = parseJournalImportSheet(json);
        const accountsByCode = new Map<string, Account[]>();
        const accountsByName = new Map<string, Account[]>();

        (accounts || []).forEach((account) => {
          const normalizedCode = normalizeAccountCode(account.code);
          const normalizedName = normalizeAccountName(account.name);
          if (normalizedCode) {
            const existingByCode = accountsByCode.get(normalizedCode) || [];
            existingByCode.push(account);
            accountsByCode.set(normalizedCode, existingByCode);
          }
          if (normalizedName) {
            const existingByName = accountsByName.get(normalizedName) || [];
            existingByName.push(account);
            accountsByName.set(normalizedName, existingByName);
          }
        });

        const unmatchedRows: string[] = [];
        const importedEntries: JournalEntry[] = parsed.entries
          .map((entry, index) => {
            const normalizedRowCode = normalizeAccountCode(entry.accountCode);
            const normalizedRowName = normalizeAccountName(entry.accountName);

            let candidates: Account[] = [];
            if (normalizedRowCode) {
              candidates = accountsByCode.get(normalizedRowCode) || [];
              if (normalizedRowName) {
                candidates = candidates.filter(
                  (candidate) =>
                    normalizeAccountName(candidate.name) === normalizedRowName,
                );
              }
            } else {
              candidates = accountsByName.get(normalizedRowName) || [];
              // support files where Account column contains account codes instead of names
              if (candidates.length === 0 && normalizedRowName) {
                candidates = accountsByCode.get(normalizedRowName) || [];
              }
            }

            if (candidates.length !== 1) {
              const identifier = normalizedRowCode
                ? `${entry.accountCode} / ${entry.accountName}`
                : entry.accountName;
              unmatchedRows.push(identifier || `row ${entry.rowNumber}`);
              return null;
            }
            const matchedAccount = candidates[0];

            const isCreditSide = parsed.entrySide === BalanceType.Cr;
            return {
              id: Date.now() + index,
              journalId: nextId,
              accountId: matchedAccount.id,
              debitAmount: isCreditSide ? 0 : entry.amount,
              creditAmount: isCreditSide ? entry.amount : 0,
            };
          })
          .filter((entry): entry is JournalEntry => entry !== null);

        if (importedEntries.length === 0) {
          raise(
            'No rows were imported. Make sure account identifiers (code/name) exist in Accounts and amounts are greater than zero.',
          );
        }

        const totalImportedAmount = getFixedNumber(
          importedEntries.reduce(
            (sum, row) => sum + row.creditAmount + row.debitAmount,
            0,
          ),
          2,
        );

        const balancingEntry: JournalEntry =
          parsed.entrySide === BalanceType.Cr
            ? {
                id: Date.now() + importedEntries.length + 1,
                journalId: nextId,
                accountId: 0,
                debitAmount: totalImportedAmount,
                creditAmount: 0,
              }
            : {
                id: Date.now() + importedEntries.length + 1,
                journalId: nextId,
                accountId: 0,
                debitAmount: 0,
                creditAmount: totalImportedAmount,
              };

        setJournal((prev) => ({
          ...prev,
          journalEntries: [...importedEntries, balancingEntry],
        }));

        const sideLabel =
          parsed.entrySide === BalanceType.Cr ? 'credit' : 'debit';
        const balanceLabel =
          parsed.entrySide === BalanceType.Cr ? 'debit' : 'credit';
        const hasUnmatched = unmatchedRows.length > 0;

        toast({
          description: `Imported ${
            importedEntries.length
          } ${sideLabel} entries. Skipped ${parsed.skippedRows} rows. ${
            hasUnmatched
              ? `Unmatched/ambiguous rows: ${unmatchedRows.join(', ')}.`
              : `Please select the ${balanceLabel} account next.`
          }`,
          variant: hasUnmatched ? 'warning' : 'success',
          duration: hasUnmatched ? 10000 : 7000,
        });
      } catch (error) {
        toast({
          description: toString(error),
          variant: 'destructive',
        });
      } finally {
        event.target.value = '';
      }
    },
    [accounts, nextId, normalizeAccountCode, normalizeAccountName],
  );

  const submitJournal = async (values: z.infer<typeof formSchema>) => {
    try {
      const isInserted = await window.electron.insertJournal(values);

      if (!!isInserted) {
        form.reset(defaultFormValues);
        setNextId((prev) => prev + 1);
        setIsDateExplicitlySet(false);

        toast({
          description: 'Journal saved successfully',
          variant: 'success',
        });
        return;
      }
      raise('Failed to save journal');
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

  const isPublishDisabled = useMemo(
    () =>
      form.formState.isSubmitting ||
      totalCredits !== totalDebits ||
      totalCredits === 0 ||
      totalDebits === 0,
    [form.formState.isSubmitting, totalCredits, totalDebits],
  );

  useCmdOrCtrlShortcut('s', () => {
    if (!isPublishDisabled) {
      form.handleSubmit(onSubmit)();
    }
  });

  const memoizedDataTable = useMemo(
    () => (
      <DataTable
        columns={columns}
        data={fields}
        sortingFns={defaultSortingFunctions}
      />
    ),
    [columns, fields],
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
                form.setValue('date', toLocalNoonIsoString(new Date()));
                setIsDateExplicitlySet(true);
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
            onKeyDown={handleFormEnterKeyDown}
            role="presentation"
          >
            <div>
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormDateSelector
                    field={field}
                    onDateSelection={(date) => {
                      if (!date) return;
                      form.setValue('date', toLocalNoonIsoString(date));
                      setIsDateExplicitlySet(true);
                    }}
                    required={false}
                    buttonClassName={cn(
                      'w-[280px] justify-start text-left font-normal w-100',
                      !field.value && 'text-muted-foreground',
                    )}
                  />
                )}
              />

              <div className="gap-8 grid grid-cols-[50%_auto_auto] pr-4">
                <FormField
                  control={form.control}
                  name="narration"
                  render={({ field }) => (
                    <FormItem labelPosition="start" className="space-y-0">
                      <FormLabel className="text-base">Narration</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="billNumber"
                  render={({ field }) => (
                    <FormItem
                      labelPosition="start"
                      className="space-y-0 grid-cols-[auto_1fr] gap-x-3"
                    >
                      <FormLabel className="text-base">Bill#</FormLabel>
                      <FormControl className="w-full">
                        <Input
                          {...field}
                          type="number"
                          value={field.value || ''}
                          onChange={(e) => {
                            const { value } = e.target;
                            field.onChange(
                              value ? parseInt(value, 10) : undefined,
                            );
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="discountPercentage"
                  render={({ field }) => (
                    <FormItem
                      labelPosition="start"
                      className="space-y-0 grid-cols-[auto_1fr] gap-x-3"
                    >
                      <FormLabel className="text-base">Discount%</FormLabel>
                      <FormControl className="w-full">
                        <Input
                          {...field}
                          type="number"
                          step={0.1}
                          min={0}
                          max={100}
                          value={field.value || ''}
                          onChange={(e) => {
                            const { value } = e.target;
                            field.onChange(
                              value ? parseFloat(value) : undefined,
                            );
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="pt-4 pb-8 pr-4 flex flex-col gap-3">
              {memoizedDataTable}
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
              <div className="flex flex-col gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      className="dark:bg-gray-200 bg-gray-800 gap-2 px-16 py-4 rounded-3xl"
                      aria-label={`Add new row, shortcut ${getOsModifierLabel()}+N`}
                      onClick={() => handleAddNewRow()}
                    >
                      <Plus size={20} />
                      <span className="w-max">Add New Row</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p className="text-sm">
                      Add new row{' '}
                      <span className="text-muted-foreground">
                        ({getOsModifierLabel()}+N)
                      </span>
                    </p>
                  </TooltipContent>
                </Tooltip>
                <FileUploadTooltip
                  content={FILE_UPLOAD_HINT_JOURNAL_ENTRIES}
                  side="bottom"
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => importInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" />
                    Import Entries
                  </Button>
                </FileUploadTooltip>
                <Input
                  ref={importInputRef}
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  className="hidden"
                  onChange={handleImportJournalEntries}
                />
              </div>

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
                    <TableCell>
                      {shouldShowFractions
                        ? getFormattedCurrency(totalDebits)
                        : getFormattedCurrencyInt(totalDebits)}
                    </TableCell>
                    <TableCell>
                      {shouldShowFractions
                        ? getFormattedCurrency(totalCredits)
                        : getFormattedCurrencyInt(totalCredits)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-red-500">
                      Difference
                    </TableCell>
                    <TableCell className="text-red-500">
                      {shouldShowFractions
                        ? getFormattedCurrency(differenceDebit)
                        : getFormattedCurrencyInt(differenceDebit)}
                    </TableCell>
                    <TableCell className="text-red-500">
                      {shouldShowFractions
                        ? getFormattedCurrency(differenceCredit)
                        : getFormattedCurrencyInt(differenceCredit)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between fixed bottom-6">
              <div className="flex gap-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="submit"
                      variant="default"
                      disabled={isPublishDisabled}
                    >
                      Save and Publish
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-sm">
                      Save and Publish{' '}
                      <span className="text-muted-foreground">
                        ({getOsModifierLabel()}+S)
                      </span>
                    </p>
                  </TooltipContent>
                </Tooltip>
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
