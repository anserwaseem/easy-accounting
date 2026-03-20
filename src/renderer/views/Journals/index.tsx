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
import {
  cn,
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import type {
  HasMiniView,
  Journal,
  JournalEntry,
  UpdateJournalFields,
} from 'types';
import { toNumber } from 'lodash';
import { EditJournalFieldsDialog } from 'renderer/components/EditJournalFieldsDialog';
import { toast } from '@/renderer/shad/ui/use-toast';
import { DateHeader } from '@/renderer/components/common/DateHeader';

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

  const handleUpdateJournal = useCallback(
    async (id: number, fields: UpdateJournalFields) => {
      try {
        await window.electron.updateJournalInfo(id, fields);
        // Refresh journals data
        const updatedJournals = await window.electron.getJournals();
        // Calculate amounts for each journal
        const journalsWithAmounts = mapToJournalView(updatedJournals);
        setJounrals(journalsWithAmounts);
        setFilteredJournals(journalsWithAmounts);
        toast({
          title: 'Success',
          description: 'Journal updated successfully',
        });
      } catch (error) {
        console.error('Error updating journal:', error);
        toast({
          title: 'Error',
          description: 'Failed to update journal',
          variant: 'destructive',
        });
        throw error;
      }
    },
    [],
  );

  const columns: ColumnDef<JournalView>[] = useMemo(
    () =>
      (isMini
        ? [
            {
              accessorKey: 'date',
              header: 'Journals',
              // eslint-disable-next-line react/no-unstable-nested-components
              cell: ({ row }) => (
                <div className="flex justify-between items-start w-full">
                  <div className="flex flex-col min-w-0">
                    <p>
                      {new Date(row.original.date || '').toLocaleString(
                        'en-US',
                        dateFormatOptions,
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-auto break-words">
                      {row.original.narration}
                    </p>
                  </div>
                  <div className="flex flex-col text-end">
                    <p>{getFormattedCurrency(row.original.amount)}</p>
                    <p className="text-green-600">
                      {row.original.isPosted ? 'Posted' : 'Draft'}
                    </p>
                  </div>
                </div>
              ),
              onClick: (row) => navigate(`/journals/${row.original.id}`),
            },
          ]
        : [
            {
              accessorKey: 'date',
              header: DateHeader,
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              cell: ({ row }) =>
                new Date(row.original.date).toLocaleString(
                  'en-US',
                  dateFormatOptions,
                ),
              size: 40,
            },
            {
              accessorKey: 'narration',
              header: 'Narration',
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              size: 800,
            },
            {
              accessorKey: 'billNumber',
              header: 'Bill#',
              cell: ({ row }) => row.original.billNumber || '-',
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              size: 80,
            },
            {
              accessorKey: 'discountPercentage',
              header: 'Discount%',
              cell: ({ row }) =>
                row.original.discountPercentage
                  ? `${row.original.discountPercentage}%`
                  : '-',
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              size: 100,
            },
            {
              accessorKey: 'amount',
              header: 'Amount',
              cell: ({ getValue }) =>
                getFormattedCurrency(toNumber(getValue())),
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              size: 150,
            },
            {
              accessorKey: 'createdAt',
              header: 'Created At',
              cell: ({ row }) =>
                new Date(row.original.createdAt || '').toLocaleString(
                  'en-US',
                  dateFormatOptions,
                ),
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              size: 40,
            },
            {
              header: 'Edit',
              // eslint-disable-next-line react/no-unstable-nested-components
              cell: ({ row }) => (
                <div className="flex items-center gap-2">
                  <EditJournalFieldsDialog
                    journalId={row.original.id}
                    narration={row.original.narration || ''}
                    billNumber={row.original.billNumber}
                    discountPercentage={row.original.discountPercentage}
                    onSave={handleUpdateJournal}
                  />
                </div>
              ),
              size: 10,
            },
          ]) as ColumnDef<JournalView>[],
    [isMini, navigate, handleUpdateJournal],
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
        <DataTable
          columns={columns}
          data={filteredJournals}
          sortingFns={defaultSortingFunctions}
          defaultSortField="date"
          defaultSortDirection="desc"
          virtual
          isMini={isMini}
          searchPlaceholder="Search journals…"
          searchFields={['narration', 'date', 'amount', 'billNumber']}
        />
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
