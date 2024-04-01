import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'renderer/shad/ui/dropdown-menu';
import { ChevronDown, Plus, Calendar as CalendarIcon, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import { Input } from 'renderer/shad/ui/input';
import { toNumber } from 'lodash';
import { Table, TableBody, TableCell, TableRow } from 'renderer/shad/ui/table';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'renderer/shad/ui/popover';
import { format } from 'date-fns';
import { cn, getFixedNumber } from 'renderer/lib/utils';
import { Calendar } from 'renderer/shad/ui/calendar';

const NewJournalPage = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [nextId, setNextId] = useState<number>(-1);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [totalCredits, setTotalCredits] = useState<number>(0);
  const [totalDebits, setTotalDebits] = useState<number>(0);
  const [differenceCredit, setDifferenceCredit] = useState<number>(0);
  const [differenceDebit, setDifferenceDebit] = useState<number>(0);

  const initialEntry = {
    id: 0, // Will not be used to insert into db
    journalId: nextId,
    debitAmount: 0,
    accountId: 0,
    creditAmount: 0,
  };

  const [journal, setJournal] = useState<Journal>({
    id: nextId,
    date: date as Date,
    narration: '',
    isPosted: false,
    JournalEntries: [{ ...initialEntry }, { ...initialEntry }],
  });
  const [tempJournalEntries, setTempJournalEntries] = useState<JournalEntry[]>(
    journal.JournalEntries,
  ); // Used to store the temporary values of the journal entries (table rows)

  useEffect(() => {
    (async () => {
      setNextId(await window.electron.getNextJournalId());
      setAccounts(await window.electron.getAccounts());
    })();
  }, []);

  useEffect(() => {
    setDifferenceCredit(
      Math.max(getFixedNumber(totalDebits - totalCredits), 0),
    );
    setDifferenceDebit(Math.max(getFixedNumber(totalCredits - totalDebits), 0));
  }, [totalCredits, totalDebits]);

  const handleDebitBlur = useCallback(
    (value: string, rowIndex: number) => {
      const val = toNumber(value);
      const fixedVal = getFixedNumber(val);

      // round the value
      if (val !== fixedVal)
        setTempJournalEntries((prev) => {
          const newJournalEntries = [...prev];
          newJournalEntries[rowIndex].debitAmount = fixedVal;
          return newJournalEntries;
        });

      setTotalDebits(
        journal.JournalEntries.map((entry) => entry.debitAmount).reduce(
          (acc, curr) => getFixedNumber(acc + curr),
        ),
      );

      if (val > 0 && journal.JournalEntries[rowIndex]?.creditAmount !== 0) {
        const newCreditsTotal =
          journal.JournalEntries.map((entry) => entry.creditAmount).reduce(
            (acc, curr) => getFixedNumber(acc + curr),
          ) - journal.JournalEntries[rowIndex].creditAmount;
        setTotalCredits(newCreditsTotal);

        setJournal((prev) => {
          const newJournal = { ...prev };
          newJournal.JournalEntries[rowIndex].creditAmount = 0;
          newJournal.JournalEntries[rowIndex].debitAmount = val;
          return newJournal;
        });
      }
    },
    [journal],
  );

  const handleDebitChange = useCallback(
    (value: string, rowIndex: number) => {
      setTempJournalEntries((prev) => {
        const newJournalEntries = [...prev];
        newJournalEntries[rowIndex].debitAmount = toNumber(value);
        return newJournalEntries;
      });
    },
    [journal],
  );

  const handleCreditBlur = useCallback(
    (value: string, rowIndex: number) => {
      const val = toNumber(value);
      const fixedVal = getFixedNumber(val);

      // round the value
      if (val !== fixedVal)
        setTempJournalEntries((prev) => {
          const newJournalEntries = [...prev];
          newJournalEntries[rowIndex].creditAmount = fixedVal;
          return newJournalEntries;
        });

      setTotalCredits(
        journal.JournalEntries.map((entry) => entry.creditAmount).reduce(
          (acc, curr) => getFixedNumber(acc + curr),
        ),
      );

      if (val > 0 && journal.JournalEntries[rowIndex]?.debitAmount !== 0) {
        const newDebitsTotal =
          journal.JournalEntries.map((entry) => entry.debitAmount).reduce(
            (acc, curr) => getFixedNumber(acc + curr),
          ) - journal.JournalEntries[rowIndex].debitAmount;
        setTotalDebits(newDebitsTotal);

        setJournal((prev) => {
          const newJournal = { ...prev };
          newJournal.JournalEntries[rowIndex].debitAmount = 0;
          newJournal.JournalEntries[rowIndex].creditAmount = val;
          return newJournal;
        });
      }
    },
    [journal],
  );

  const handleCreditChange = useCallback(
    (value: string, rowIndex: number) => {
      setTempJournalEntries((prev) => {
        const newJournalEntries = [...prev];
        newJournalEntries[rowIndex].creditAmount = toNumber(value);
        return newJournalEntries;
      });
    },
    [journal],
  );

  const handleRemoveRow = useCallback(
    (rowIndex: number) => {
      if (journal.JournalEntries.length > 1) {
        setJournal((prev) => {
          const newJournal = { ...prev };
          newJournal.JournalEntries = newJournal.JournalEntries.filter(
            (_, index) => index !== rowIndex,
          );
          return newJournal;
        });
        setTempJournalEntries((prev) => {
          const newJournalEntries = [...prev];
          newJournalEntries.splice(rowIndex, 1);
          return newJournalEntries;
        });

        setTotalCredits(
          (prev) => prev - journal.JournalEntries[rowIndex].creditAmount,
        );
        setTotalDebits(
          (prev) => prev - journal.JournalEntries[rowIndex].debitAmount,
        );
      } else {
        setJournal((prev) => {
          const newJournal = { ...prev };
          newJournal.JournalEntries = [initialEntry];
          return newJournal;
        });
        setTempJournalEntries([initialEntry]);

        setTotalCredits(0);
        setTotalDebits(0);
      }
    },
    [journal],
  );

  const columns: ColumnDef<JournalEntry>[] = useMemo(
    () => [
      {
        header: 'Account',
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="outline" className="w-full justify-between">
                <span className="mr-2 text-left text-muted-foreground min-w-[150px]">
                  {journal.JournalEntries[row.index]?.accountId !== 0
                    ? accounts.find(
                        (account) =>
                          account.id ===
                          journal.JournalEntries[row.index].accountId,
                      )?.name
                    : 'Select an account'}
                </span>
                <ChevronDown size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="px-4">
              {accounts.map((account) => (
                <DropdownMenuItem
                  onClick={() => {
                    setJournal((prev) => {
                      const newJournal = { ...prev };
                      newJournal.JournalEntries[row.index].accountId =
                        account.id;
                      return newJournal;
                    });
                  }}
                >
                  {account.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
      {
        header: 'Debit',
        cell: ({ row }) => (
          <Input
            type="number"
            value={tempJournalEntries[row.index]?.debitAmount}
            onBlur={(e) => handleDebitBlur(e.target.value, row.index)}
            onChange={(e) => handleDebitChange(e.target.value, row.index)}
          />
        ),
      },
      {
        header: 'Credit',
        cell: ({ row }) => (
          <Input
            type="number"
            value={tempJournalEntries[row.index]?.creditAmount}
            onBlur={(e) => handleCreditBlur(e.target.value, row.index)}
            onChange={(e) => handleCreditChange(e.target.value, row.index)}
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

  const handleAddNewRow = useCallback(() => {
    setJournal((prev) => {
      const newJournal = { ...prev };
      newJournal.JournalEntries = [...newJournal.JournalEntries, initialEntry];
      return newJournal;
    });
    setTempJournalEntries((prev) => {
      let newJournalEntries = [...prev];
      newJournalEntries = [...newJournalEntries, initialEntry];
      return newJournalEntries;
    });
  }, []);

  return (
    <div>
      <h1>New Journal</h1>

      <div className="py-10 pr-4">
        <DataTable columns={columns} data={journal.JournalEntries} />
      </div>

      <div className="flex flex-row justify-between pr-4 gap-10">
        <Button
          className="dark:bg-gray-200 bg-gray-800 gap-2"
          onClick={() => handleAddNewRow()}
        >
          <Plus size={20} />
          <span className="w-max">Add New Row</span>
        </Button>

        <Table className="dark:bg-gray-900 bg-gray-100 rounded-xl">
          <TableBody>
            <TableRow className="">
              <TableCell className="font-medium text-xl">Total</TableCell>
              <TableCell>{totalDebits}</TableCell>
              <TableCell>{totalCredits}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-red-500">
                Difference
              </TableCell>
              <TableCell className="text-red-500">{differenceDebit}</TableCell>
              <TableCell className="text-red-500">{differenceCredit}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default NewJournalPage;
