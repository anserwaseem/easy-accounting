import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import {
  currencyFormatOptions,
  dateFormatOptions,
} from 'renderer/lib/constants';
import { Plus } from 'lucide-react';
import {
  type DateRange,
  DateRangePickerWithPresets,
} from 'renderer/shad/ui/datePicker';
import { Separator } from 'renderer/shad/ui/separator';
import { Table, TableBody, TableCell, TableRow } from 'renderer/shad/ui/table';
import { defaultSortingFunctions } from 'renderer/lib/utils';
import type { HasMiniView, Journal } from 'types';
import { toString } from 'lodash';

export type JournalView = Journal & { amount: number };

const JournalsPage: React.FC<HasMiniView> = ({
  isMini = false,
}: HasMiniView) => {
  // eslint-disable-next-line no-console
  console.log('JournalsPage', isMini);
  const [journals, setJounrals] = useState<JournalView[]>([]);
  const [filteredJournals, setFilteredJournals] = useState<JournalView[]>(
    window.electron.store.get('filteredJournals') || [],
  );
  const [journalFilterDate, setJournalFilterDate] = useState<
    DateRange | undefined
  >(window.electron.store.get('journalFilterDate') || undefined);
  const [journalFilterSelectValue, setJournalFilterSelectValue] = useState<
    string | undefined
  >(window.electron.store.get('journalFilterSelectValue') || undefined);

  const navigate = useNavigate();

  const columns: ColumnDef<JournalView>[] = useMemo(
    () => [
      {
        accessorKey: 'id',
        header: 'Journal #',
        onClick: (row) => navigate(toString(row.original.id)),
      },
      {
        accessorKey: 'date',
        header: 'Date',
        onClick: (row) => navigate(toString(row.original.id)),
      },
      {
        accessorKey: 'narration',
        header: 'Narration',
        onClick: (row) => navigate(toString(row.original.id)),
      },
      {
        accessorKey: 'isPublished',
        header: 'Status',
        onClick: (row) => navigate(toString(row.original.id)),
        cell: ({ row }) => (row.original.isPosted ? 'Posted' : 'Draft'),
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        onClick: (row) => navigate(toString(row.original.id)),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created At',
        cell: ({ row }) =>
          new Date(row.original.createdAt || '').toLocaleString(
            'en-US',
            dateFormatOptions,
          ),
        onClick: (row) => navigate(toString(row.original.id)),
      },
    ],
    [navigate],
  );

  const handleFilterDateSelect = useCallback(
    (dateRange?: DateRange, selectValue?: string) => {
      if (selectValue) setJournalFilterSelectValue(selectValue);
      if (selectValue === 'all') return setFilteredJournals(journals);

      if (!dateRange) return;

      const { from, to } = dateRange;
      if (!from || !to) return;

      setJournalFilterDate(dateRange);
      setFilteredJournals(
        journals.filter((journal) => {
          // only compare the date part
          const journalDate = new Date(journal.date).setHours(0, 0, 0, 0);
          const fromDate = new Date(from).setHours(0, 0, 0, 0);
          const toDate = new Date(to).setHours(0, 0, 0, 0);

          return journalDate >= fromDate && journalDate <= toDate;
        }),
      );
    },
    [journals],
  );

  useEffect(() => {
    const fetchJournals = async () => {
      const rawJournals = (await window.electron.getJournals()) as Journal[];
      const updatedJournals = rawJournals.map((journal) => ({
        ...journal,
        amount: journal.journalEntries.reduce(
          (acc, entry) => acc + entry.debitAmount,
          0,
        ),
      }));
      setJounrals(updatedJournals);
    };

    fetchJournals();
  }, []);

  useEffect(
    () =>
      journalFilterDate || journalFilterSelectValue
        ? handleFilterDateSelect(journalFilterDate, journalFilterSelectValue)
        : setFilteredJournals(journals),
    [
      handleFilterDateSelect,
      journalFilterDate,
      journalFilterSelectValue,
      journals,
    ],
  );

  useEffect(
    () => window.electron.store.set('filteredJournals', filteredJournals),
    [filteredJournals],
  );

  useEffect(
    () => window.electron.store.set('journalFilterDate', journalFilterDate),
    [journalFilterDate],
  );

  useEffect(
    () =>
      window.electron.store.set(
        'journalFilterSelectValue',
        journalFilterSelectValue,
      ),
    [journalFilterSelectValue],
  );

  return (
    <div>
      <div className="flex justify-between items-center py-4 pr-4">
        <h1 className="text-xl">Journals</h1>

        <Button
          variant="outline"
          onClick={() => navigate('/journals/new')}
          className="flex items-center"
        >
          <Plus size={16} />
          <span className="ml-3 mr-1">New Journal</span>
        </Button>
      </div>

      <Separator />

      <div className="py-4 pr-4 flex flex-col gap-6">
        <div
          className={`flex gap-4 items-center ${
            isMini ? 'justify-between' : ''
          }`}
        >
          <p className="text-muted-foreground font-bold text-sm">VIEW BY:</p>
          <DateRangePickerWithPresets
            $onSelect={handleFilterDateSelect}
            presets={[{ label: 'All', value: 'all' }]}
            initialRange={journalFilterDate}
            initialSelectValue={journalFilterSelectValue}
          />
        </div>

        {isMini ? (
          <Table>
            <TableBody>
              {filteredJournals.map((journal) => (
                <TableRow
                  key={journal.id}
                  onClick={() => navigate(`/journals/${journal.id}`)}
                >
                  <TableCell>
                    <div className="flex justify-between">
                      <div className="flex flex-col">
                        <p>
                          {new Date(journal.date || '').toLocaleString(
                            'en-US',
                            dateFormatOptions,
                          )}
                        </p>
                        <p>{journal.id}</p>
                      </div>
                      <div className="flex flex-col">
                        <p>
                          {Intl.NumberFormat(
                            'en-US',
                            currencyFormatOptions,
                          ).format(
                            journal?.journalEntries.reduce(
                              (acc, entry) => acc + entry.debitAmount,
                              0,
                            ) || 0,
                          )}
                        </p>
                        <p className="text-end text-green-600">
                          {journal.isPosted ? 'Posted' : 'Draft'}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <DataTable
            columns={columns}
            data={filteredJournals}
            sortingFns={defaultSortingFunctions}
          />
        )}
      </div>
    </div>
  );
};

export default JournalsPage;
