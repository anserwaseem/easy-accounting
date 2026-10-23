import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import { Plus, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import {
  type DateRange,
  DateRangePickerWithPresets,
} from 'renderer/shad/ui/datePicker';
import {
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import { formatJournalDiscountLabel } from '@/lib/journalDiscountLabel';
import type {
  HasMiniView,
  Journal,
  JournalEntry,
  UpdateJournalFields,
} from 'types';
import { toNumber } from 'lodash';
import { EditJournalFieldsDialog } from 'renderer/components/EditJournalFieldsDialog';
import { ReverseJournalDialog } from '@/renderer/components/ReverseJournalDialog';
import { DeleteJournalDialog } from '@/renderer/components/DeleteJournalDialog';
import { AdvancedControl } from '@/renderer/components/AdvancedControl';
import { useAnyAdvancedCapability } from '@/renderer/hooks/useAdvancedCapabilities';
import { ADVANCED_CAPABILITIES } from '@/core/advancedCapabilities';
import { toast } from '@/renderer/shad/ui/use-toast';
import { ipcErrorMessage } from '@/renderer/lib/ipcUserMessage';
import { DateCell } from '@/renderer/components/common/DateCell';
import { FilterGroup, PageHeader } from '@/renderer/components/PageHeader';
import { RowMenu } from '@/renderer/components/RowMenu';
import { DropdownMenuItem } from 'renderer/shad/ui/dropdown-menu';

export type JournalView = Journal & { amount: number };

interface JournalRowMenuProps {
  row: { original: JournalView };
  onSave: (journalId: number, fields: UpdateJournalFields) => Promise<void>;
  onSuccess: () => void;
}

/**
 * The card's row control: one ⋮ at the end of the name, with the
 * row's actions behind it. The table keeps the three icon buttons.
 *
 * The dialogs are mounted next to the menu, not inside it: a menu
 * item that opens a dialog unmounts the dialog with the menu when the
 * dialog lives inside it.
 */
const JournalRowMenu: React.FC<JournalRowMenuProps> = ({
  row,
  onSave,
  onSuccess,
}: JournalRowMenuProps) => {
  const [editOpen, setEditOpen] = useState(false);
  // the edit dialog is remounted on every open, so its fields start
  // from the journal's own values instead of the last edit
  const [editKey, setEditKey] = useState(0);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canReverse =
    row.original.invoiceId == null || row.original.invoiceId <= 0;

  return (
    <>
      <RowMenu label="Journal actions">
        <AdvancedControl capability={ADVANCED_CAPABILITIES.journalEditFields}>
          <DropdownMenuItem
            onSelect={() => {
              setEditKey((key) => key + 1);
              setEditOpen(true);
            }}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit fields
          </DropdownMenuItem>
        </AdvancedControl>
        {canReverse ? (
          <>
            <AdvancedControl capability={ADVANCED_CAPABILITIES.journalReverse}>
              <DropdownMenuItem onSelect={() => setReverseOpen(true)}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reverse journal
              </DropdownMenuItem>
            </AdvancedControl>
            <AdvancedControl capability={ADVANCED_CAPABILITIES.journalDelete}>
              <DropdownMenuItem
                onSelect={() => setDeleteOpen(true)}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete journal
              </DropdownMenuItem>
            </AdvancedControl>
          </>
        ) : null}
      </RowMenu>

      <AdvancedControl capability={ADVANCED_CAPABILITIES.journalEditFields}>
        <EditJournalFieldsDialog
          key={editKey}
          open={editOpen}
          onOpenChange={setEditOpen}
          journalId={row.original.id}
          narration={row.original.narration || ''}
          billNumber={row.original.billNumber}
          discountPercentage={row.original.discountPercentage}
          onSave={onSave}
        />
      </AdvancedControl>
      {canReverse ? (
        <>
          <AdvancedControl capability={ADVANCED_CAPABILITIES.journalReverse}>
            <ReverseJournalDialog
              open={reverseOpen}
              onOpenChange={setReverseOpen}
              journalId={row.original.id}
              originalNarration={row.original.narration || ''}
              totalAmount={row.original.amount}
              onSuccess={onSuccess}
            />
          </AdvancedControl>
          <AdvancedControl capability={ADVANCED_CAPABILITIES.journalDelete}>
            <DeleteJournalDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              journalId={row.original.id}
              narration={row.original.narration || ''}
              totalAmount={row.original.amount}
              onSuccess={onSuccess}
            />
          </AdvancedControl>
        </>
      ) : null}
    </>
  );
};

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

  const handleReloadJournals = useCallback(async () => {
    const updatedJournals = (await window.electron.getJournals()) as Journal[];
    const journalsWithAmounts = mapToJournalView(updatedJournals);
    setJounrals(journalsWithAmounts);
    setFilteredJournals(journalsWithAmounts);
  }, []);

  const handleUpdateJournal = useCallback(
    async (id: number, fields: UpdateJournalFields) => {
      try {
        await window.electron.updateJournalInfo(id, fields);
        await handleReloadJournals();
        toast({
          title: 'Success',
          description: 'Journal updated successfully',
        });
      } catch (error) {
        console.error('Error updating journal:', error);
        // the guard refuses this when "Edit a journal after posting" is
        // off; the toast layer turns that into a message the person can
        // act on
        toast({
          title: 'Error',
          description: ipcErrorMessage(error) || 'Failed to update journal',
          variant: 'destructive',
        });
        throw error;
      }
    },
    [handleReloadJournals],
  );

  // the Actions column holds nothing but advanced controls, so when they
  // are all off the column itself goes away rather than sitting there
  // empty with a header over it
  const hasJournalActions = useAnyAdvancedCapability([
    ADVANCED_CAPABILITIES.journalEditFields,
    ADVANCED_CAPABILITIES.journalReverse,
    ADVANCED_CAPABILITIES.journalDelete,
  ]);

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
                      <DateCell value={row.original.date} />
                    </p>
                    <p className="text-xs text-muted-foreground mt-auto break-words">
                      {row.original.narration}
                    </p>
                  </div>
                  <div className="flex flex-col text-end tabular-nums">
                    <p className="font-bold">{row.original.id}</p>
                    <p>{getFormattedCurrency(row.original.amount)}</p>
                  </div>
                </div>
              ),
              onClick: (row) => navigate(`/journals/${row.original.id}`),
            },
          ]
        : [
            {
              accessorKey: 'id',
              header: <span className="whitespace-nowrap">Journal #</span>,
              // The card's label comes from the header, but this
              // column's header is a node — name it explicitly.
              cardLabel: 'Journal #',
              // the number and the date identify the row, so they ride
              // the muted line under the headline instead of taking a
              // labelled cell each in the grid below it
              cardMeta: true,
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              // eslint-disable-next-line react/no-unstable-nested-components
              cell: ({ row }) => (
                <span className="whitespace-nowrap tabular-nums">
                  {row.original.id}
                </span>
              ),
              size: 90,
            },
            {
              accessorKey: 'date',
              header: 'Date',
              cardMeta: true,
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              // eslint-disable-next-line react/no-unstable-nested-components
              cell: ({ row }) => <DateCell value={row.original.date} />,
              // Was 40px, which is narrower than the "03 Feb, 2026" the
              // cell renders — the text overflowed into Narration.
              size: 110,
            },
            {
              accessorKey: 'narration',
              header: 'Narration',
              cardHeadline: true,
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              // 360px was wider than a phone on its own, which pushed the
              // Amount (the number the list is scanned for) off-screen.
              // 190px leaves room for the amount beside it.
              size: 190,
            },
            {
              accessorKey: 'billNumber',
              header: 'Bill#',
              cell: ({ row }) => row.original.billNumber || '-',
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              size: 90,
            },
            {
              accessorKey: 'discountPercentage',
              header: 'Dis',
              cell: ({ row }) =>
                formatJournalDiscountLabel(row.original.discountPercentage),
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              size: 80,
            },
            {
              accessorKey: 'amount',
              header: 'Amount',
              // eslint-disable-next-line react/no-unstable-nested-components
              cell: ({ getValue }) => (
                <span className="tabular">
                  {getFormattedCurrency(toNumber(getValue()))}
                </span>
              ),
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              size: 130,
              cardAside: true,
            },
            {
              accessorKey: 'createdAt',
              header: 'Created At',
              // eslint-disable-next-line react/no-unstable-nested-components
              cell: ({ row }) => <DateCell value={row.original.createdAt} />,
              onClick: (row) => navigate(`/journals/${row.original.id}`),
              size: 120,
            },
            {
              id: 'actions',
              header: 'Actions',
              // The row's buttons get their own row in the card layout,
              // without a redundant "Actions" label.
              cardActions: true,
              // On a card there is room for one control, so the three
              // actions sit behind a single ⋮ at the end of the name.
              // eslint-disable-next-line react/no-unstable-nested-components
              cardMenu: ({ row }) => (
                <JournalRowMenu
                  row={row}
                  onSave={handleUpdateJournal}
                  onSuccess={handleReloadJournals}
                />
              ),
              enableSorting: false,
              // eslint-disable-next-line react/no-unstable-nested-components
              cell: ({ row }) => (
                <div className="-ml-2 flex items-center gap-0.5 whitespace-nowrap">
                  <AdvancedControl
                    capability={ADVANCED_CAPABILITIES.journalEditFields}
                  >
                    <EditJournalFieldsDialog
                      journalId={row.original.id}
                      narration={row.original.narration || ''}
                      billNumber={row.original.billNumber}
                      discountPercentage={row.original.discountPercentage}
                      onSave={handleUpdateJournal}
                    />
                  </AdvancedControl>
                  {(row.original.invoiceId == null ||
                    row.original.invoiceId <= 0) && (
                    <>
                      <AdvancedControl
                        capability={ADVANCED_CAPABILITIES.journalReverse}
                      >
                        <ReverseJournalDialog
                          journalId={row.original.id}
                          originalNarration={row.original.narration || ''}
                          totalAmount={row.original.amount}
                          onSuccess={handleReloadJournals}
                          trigger={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground md:h-8 md:w-8"
                              title="Reverse Journal"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          }
                        />
                      </AdvancedControl>
                      <AdvancedControl
                        capability={ADVANCED_CAPABILITIES.journalDelete}
                      >
                        <DeleteJournalDialog
                          journalId={row.original.id}
                          narration={row.original.narration || ''}
                          totalAmount={row.original.amount}
                          onSuccess={handleReloadJournals}
                          trigger={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive md:h-8 md:w-8"
                              title="Delete Journal"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                        />
                      </AdvancedControl>
                    </>
                  )}
                </div>
              ),
              // Three buttons: edit, reverse, delete. At the 44px mobile
              // touch target that needs ~140px, not 120px.
              size: 140,
            },
          ]) as ColumnDef<JournalView>[],
    [isMini, navigate, handleUpdateJournal, handleReloadJournals],
  );

  // drop the Actions column entirely when every control in it is hidden:
  // an empty column with a header over it reads as a broken table
  const visibleColumns = useMemo(
    () =>
      hasJournalActions
        ? columns
        : columns.filter((column) => column.id !== 'actions'),
    [columns, hasJournalActions],
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
      <PageHeader
        title="Journals"
        filters={
          <FilterGroup label="VIEW BY:">
            <DateRangePickerWithPresets
              $onSelect={handleFilterDateSelect}
              presets={[{ label: 'All', value: 'all' }]}
              initialRange={journalFilterDate}
              initialSelectValue={journalFilterSelectValue}
            />
          </FilterGroup>
        }
        actions={
          <Button
            variant="outline"
            onClick={() => navigate('/journals/new')}
            className="shrink-0"
          >
            <Plus size={16} className="mr-2" />
            New Journal
          </Button>
        }
      />

      <div className="py-8 flex flex-col gap-6">
        <DataTable
          columns={visibleColumns}
          data={filteredJournals}
          sortingFns={defaultSortingFunctions}
          defaultSortField="date"
          defaultSortDirection="desc"
          virtual
          virtualHeightMode={isMini ? 'content' : 'fill'}
          isMini={isMini}
          searchPlaceholder="Search journals…"
          searchFields={['id', 'narration', 'date', 'amount', 'billNumber']}
          searchPersistenceKey="datatable:journals:search"
          autoFocusSearch
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
