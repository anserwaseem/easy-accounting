import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  defaultSortingFunctions,
  getFormattedCurrency,
  getFormattedDebitCreditWithoutCurrency,
} from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { Journal, JournalEntry, UpdateJournalFields } from 'types';
import { EditJournalFieldsDialog } from 'renderer/components/EditJournalFieldsDialog';
import { formatJournalDiscountLabel } from '@/lib/journalDiscountLabel';
import { Button } from '@/renderer/shad/ui/button';
import { ReverseJournalDialog } from '@/renderer/components/ReverseJournalDialog';
import { DeleteJournalDialog } from '@/renderer/components/DeleteJournalDialog';
import { AdvancedControl } from '@/renderer/components/AdvancedControl';
import { RowMenu } from '@/renderer/components/RowMenu';
import { DropdownMenuItem } from '@/renderer/shad/ui/dropdown-menu';
import { RotateCcw, Trash2 } from 'lucide-react';
import { ADVANCED_CAPABILITIES } from '@/core/advancedCapabilities';
import { toast } from '@/renderer/shad/ui/use-toast';
import { ipcErrorMessage } from '@/renderer/lib/ipcUserMessage';
import { formatDisplayDateTime } from '@/lib/displayDate';
import { DateCell } from '@/renderer/components/common/DateCell';

interface JournalTableProps {
  journalId: number;
}

export const JournalTable: React.FC<JournalTableProps> = ({
  journalId,
}: JournalTableProps) => {
  // eslint-disable-next-line no-console
  console.log('JournalTable', journalId);
  const [journal, setJournal] = useState<Journal>();
  // the dialogs the ⋮ menu opens live outside the menu: a menu item
  // that opens a dialog unmounts the dialog with the menu when the
  // dialog lives inside it
  const [reverseOpen, setReverseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => setJournal(await window.electron.getJournal(journalId)))();
  }, [journalId]);

  const handleUpdateJournal = async (
    id: number,
    fields: UpdateJournalFields,
  ) => {
    try {
      await window.electron.updateJournalInfo(id, fields);
      setJournal(await window.electron.getJournal(journalId));
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
    }
  };

  const columns: ColumnDef<JournalEntry>[] = useMemo(() => {
    return [
      {
        accessorKey: 'accountName',
        header: 'Account',
        onClick: (row) => navigate(`/accounts/${row.original.accountId}`),
      },
      {
        accessorKey: 'debitAmount',
        header: 'Debit',
        onClick: (row) => navigate(`/accounts/${row.original.accountId}`),
        cell: ({ row }) =>
          getFormattedDebitCreditWithoutCurrency(row.original.debitAmount),
        // a line is a debit or a credit: the empty side is left off
        // the card rather than shown as a label over a blank
        cardHideWhenZero: true,
      },
      {
        accessorKey: 'creditAmount',
        header: 'Credit',
        onClick: (row) => navigate(`/accounts/${row.original.accountId}`),
        cell: ({ row }) =>
          getFormattedDebitCreditWithoutCurrency(row.original.creditAmount),
        cardHideWhenZero: true,
      },
    ];
  }, [navigate]);

  return (
    <div>
      <div className="flex">
        <div className="min-w-0 flex-1">
          {/* The title and the actions shared a row with no wrapping, so
              on a phone the "Reverse Journal" button sat on top of the
              word "JOURNAL". The two action buttons are now one ⋮, and
              it sits at the end of the title's row, where a control
              belongs. */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <h1 className="min-w-0 shrink text-3xl font-light sm:text-4xl">
                JOURNAL
              </h1>
              {journal?.isPosted ? (
                <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                  Posted
                </span>
              ) : null}
            </div>
            {journal?.id &&
            (journal.invoiceId == null || journal.invoiceId <= 0) ? (
              // Two big buttons under the title said "this screen is
              // about reversing and deleting". They are occasional
              // actions, so they sit behind one ⋮ and the title keeps
              // the screen to itself.
              <RowMenu label="Journal actions">
                <AdvancedControl
                  capability={ADVANCED_CAPABILITIES.journalReverse}
                >
                  <DropdownMenuItem onSelect={() => setReverseOpen(true)}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reverse journal
                  </DropdownMenuItem>
                </AdvancedControl>
                <AdvancedControl
                  capability={ADVANCED_CAPABILITIES.journalDelete}
                >
                  <DropdownMenuItem
                    onSelect={() => setDeleteOpen(true)}
                    className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete journal
                  </DropdownMenuItem>
                </AdvancedControl>
              </RowMenu>
            ) : null}
          </div>

          {/* the dialogs the menu opens, mounted outside it */}
          {journal?.id &&
          (journal.invoiceId == null || journal.invoiceId <= 0) ? (
            <>
              <AdvancedControl
                capability={ADVANCED_CAPABILITIES.journalReverse}
              >
                <ReverseJournalDialog
                  journalId={journal.id}
                  originalNarration={journal.narration}
                  totalAmount={
                    journal.journalEntries?.reduce(
                      (acc, entry) => acc + (entry.debitAmount || 0),
                      0,
                    ) ?? 0
                  }
                  onSuccess={(rev) => navigate(`/journals/${rev.id}`)}
                  open={reverseOpen}
                  onOpenChange={setReverseOpen}
                  trigger={null}
                />
              </AdvancedControl>
              <AdvancedControl capability={ADVANCED_CAPABILITIES.journalDelete}>
                <DeleteJournalDialog
                  journalId={journal.id}
                  narration={journal.narration}
                  totalAmount={
                    journal.journalEntries?.reduce(
                      (acc, entry) => acc + (entry.debitAmount || 0),
                      0,
                    ) ?? 0
                  }
                  onSuccess={() => navigate('/journals')}
                  open={deleteOpen}
                  onOpenChange={setDeleteOpen}
                  trigger={null}
                />
              </AdvancedControl>
            </>
          ) : null}

          <div className="flex flex-col gap-2 mt-8">
            <div className="flex flex-col gap-0.5 items-start sm:flex-row sm:gap-8 sm:items-center">
              <p className="font-extrabold text-sm text-muted-foreground w-full sm:w-[160px] sm:shrink-0">
                Journal #:
              </p>
              <p className="tabular-nums">{journal?.id ?? journalId}</p>
            </div>
            {journal?.invoiceId != null && journal.invoiceId > 0 ? (
              <div className="flex flex-col gap-0.5 items-start sm:flex-row sm:gap-8">
                <p className="font-medium text-sm text-muted-foreground w-full sm:w-[160px] sm:shrink-0">
                  Invoice:
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const inv = await window.electron.getInvoice(
                      journal.invoiceId!,
                    );
                    if (!inv?.id) return;
                    navigate(
                      `/${inv.invoiceType?.toLowerCase()}/invoices/${inv.id}`,
                    );
                  }}
                >
                  Open invoice
                </Button>
              </div>
            ) : null}
            <div className="flex flex-col gap-0.5 items-start sm:flex-row sm:gap-8">
              <p className="font-medium text-sm text-muted-foreground w-full sm:w-[160px] sm:shrink-0">
                Date:
              </p>
              <p>
                <DateCell value={journal?.date} />
              </p>
            </div>
            <div className="flex flex-col gap-0.5 items-start sm:flex-row sm:gap-8">
              <p className="font-medium text-sm text-muted-foreground w-full sm:w-[160px] sm:shrink-0">
                Amount:
              </p>
              <p>
                {getFormattedCurrency(
                  journal?.journalEntries.reduce(
                    (acc, entry) => acc + entry.debitAmount,
                    0,
                  ) ?? 0,
                )}
              </p>
            </div>

            <div className="flex flex-col gap-0.5 items-start sm:flex-row sm:gap-8">
              <p className="font-medium text-sm text-muted-foreground w-full sm:w-[160px] sm:shrink-0">
                Narration:
              </p>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <p>{journal?.narration}</p>
                  {journal && (
                    <AdvancedControl
                      capability={ADVANCED_CAPABILITIES.journalEditFields}
                    >
                      <EditJournalFieldsDialog
                        journalId={journal.id}
                        narration={journal.narration || ''}
                        billNumber={journal.billNumber}
                        discountPercentage={journal.discountPercentage}
                        onSave={handleUpdateJournal}
                      />
                    </AdvancedControl>
                  )}
                </div>
                {journal?.createdAt !== journal?.updatedAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Updated: At{' '}
                    {formatDisplayDateTime(journal?.updatedAt || '')}
                  </p>
                )}
              </div>
            </div>

            {journal?.billNumber && (
              <div className="flex flex-col gap-0.5 items-start sm:flex-row sm:gap-8">
                <p className="font-medium text-sm text-muted-foreground w-full sm:w-[160px] sm:shrink-0">
                  Bill#:
                </p>
                <p>{journal.billNumber}</p>
              </div>
            )}

            {formatJournalDiscountLabel(journal?.discountPercentage) !==
              '-' && (
              <div className="flex flex-col gap-0.5 items-start sm:flex-row sm:gap-8">
                <p className="font-medium text-sm text-muted-foreground w-full sm:w-[160px] sm:shrink-0">
                  Discount%:
                </p>
                <p>{formatJournalDiscountLabel(journal?.discountPercentage)}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="py-10">
        <DataTable
          columns={columns}
          data={journal?.journalEntries || []}
          sortingFns={defaultSortingFunctions}
        />
      </div>
    </div>
  );
};
