import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import { dateFormatOptions } from 'renderer/lib/constants';
import { Plus } from 'lucide-react';
import {
  type DateRange,
  DateRangePickerWithPresets,
} from 'renderer/shad/ui/datePicker';
import { Table, TableBody, TableCell, TableRow } from 'renderer/shad/ui/table';
import {
  cn,
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import type { HasMiniView, Journal, JournalEntry } from 'types';
import { toNumber, toString } from 'lodash';
import { EditNarrationDialog } from 'renderer/components/EditNarrationDialog';
import { toast } from '@/renderer/shad/ui/use-toast';

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

  const handleUpdateNarration = useCallback(
    async (id: number, newNarration: string) => {
      try {
        await window.electron.updateJournalNarration(id, newNarration);
        // Refresh journals data
        const updatedJournals = await window.electron.getJournals();
        // Calculate amounts for each journal
        const journalsWithAmounts = mapToJournalView(updatedJournals);
        setJounrals(journalsWithAmounts);
        setFilteredJournals(journalsWithAmounts);
        toast({
          title: 'Success',
          description: 'Journal narration updated successfully',
        });
      } catch (error) {
        console.error('Error updating journal narration:', error);
        toast({
          title: 'Error',
          description: 'Failed to update journal narration',
          variant: 'destructive',
        });
        throw error;
      }
    },
    [],
  );

  const columns: ColumnDef<JournalView>[] = useMemo(
    () => [
      // {
      //   accessorKey: 'id',
      //   header: 'Journal #',
      //   onClick: (row) => navigate(toString(row.original.id)),
      // },
      {
        accessorKey: 'date',
        header: 'Date (MM/DD/YYYY)',
        onClick: (row) => navigate(toString(row.original.id)),
        cell: ({ row }) =>
          new Date(row.original.date).toLocaleString(
            'en-US',
            dateFormatOptions,
          ),
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
        cell: ({ getValue }) => getFormattedCurrency(toNumber(getValue())),
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
      {
        header: 'Edit',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <EditNarrationDialog
              journalId={row.original.id}
              narration={row.original.narration || ''}
              onSave={handleUpdateNarration}
            />
          </div>
        ),
      },
    ],
    [navigate, handleUpdateNarration],
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
          const journalDate = new Date(journal.date);
          return journalDate >= from && journalDate <= to;
        }),
      );
    },
    [journals],
  );

  useEffect(() => {
    const fetchJournals = async () => {
      const rawJournals = (await window.electron.getJournals()) as Journal[];
      const updatedJournals = mapToJournalView(rawJournals);
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
      <div
        className={cn(
          'grid py-4',
          isMini ? 'grid-cols-2 grid-rows-2 gap-4' : 'grid-cols-3 items-center',
        )}
      >
        <div
          className={cn(
            'flex gap-4 items-center',
            isMini && 'col-span-2 row-span-1 order-1',
          )}
        >
          <p className="text-muted-foreground font-bold text-sm">VIEW BY:</p>
          <DateRangePickerWithPresets
            $onSelect={handleFilterDateSelect}
            presets={[{ label: 'All', value: 'all' }]}
            initialRange={journalFilterDate}
            initialSelectValue={journalFilterSelectValue}
          />
        </div>

        <h1 className="title">Journals</h1>

        <Button
          variant="outline"
          onClick={() => navigate('/journals/new')}
          className="col-span-1 row-span-1 w-fit ml-auto"
        >
          <Plus size={16} className="mr-2" />
          New Journal
        </Button>
      </div>

      <div className="py-8 flex flex-col gap-6">
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
                          {getFormattedCurrency(
                            calculateJournalAmount(journal),
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
            defaultSortField="date"
            defaultSortDirection="desc"
            virtual
            searchPlaceholder="Search journals..."
            searchFields={['narration', 'date', 'amount']}
          />
        )}
      </div>
    </div>
  );
};

function mapToJournalView(journals: Journal[]): JournalView[] {
  return journals.map((journal: Journal) => ({
    ...journal,
    amount: calculateJournalAmount(journal),
  }));
}

function calculateJournalAmount(journal: Journal): number {
  return journal.journalEntries.reduce(
    (sum: number, entry: JournalEntry) => sum + (entry.debitAmount || 0),
    0,
  );
}

export default JournalsPage;
