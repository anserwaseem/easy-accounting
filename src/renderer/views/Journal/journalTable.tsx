import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  dateFormatOptions,
  datetimeFormatOptions,
} from 'renderer/lib/constants';
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
import { ADVANCED_CAPABILITIES } from '@/core/advancedCapabilities';
import { toast } from '@/renderer/shad/ui/use-toast';
import { ipcErrorMessage } from '@/renderer/lib/ipcUserMessage';

interface JournalTableProps {
  journalId: number;
}

export const JournalTable: React.FC<JournalTableProps> = ({
  journalId,
}: JournalTableProps) => {
  // eslint-disable-next-line no-console
  console.log('JournalTable', journalId);
  const [journal, setJournal] = useState<Journal>();
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
      },
      {
        accessorKey: 'creditAmount',
        header: 'Credit',
        onClick: (row) => navigate(`/accounts/${row.original.accountId}`),
        cell: ({ row }) =>
          getFormattedDebitCreditWithoutCurrency(row.original.creditAmount),
      },
    ];
  }, [navigate]);

  return (
    <div>
      <div className="flex">
        <div className="w-3/4">
          <div className="flex items-center justify-between">
            <h1 className="min-w-0 shrink text-4xl font-light">JOURNAL</h1>
            {journal?.id &&
            (journal.invoiceId == null || journal.invoiceId <= 0) ? (
              <div className="flex items-center gap-2">
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
                  />
                </AdvancedControl>
                <AdvancedControl
                  capability={ADVANCED_CAPABILITIES.journalDelete}
                >
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
                  />
                </AdvancedControl>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 mt-8">
            <div className="flex gap-8 items-center">
              <p className="font-extrabold text-md w-[160px]">Journal #:</p>
              <p className="tabular-nums">{journal?.id ?? journalId}</p>
            </div>
            {journal?.invoiceId != null && journal.invoiceId > 0 ? (
              <div className="flex gap-8">
                <p className="font-medium text-md w-[160px]">Invoice:</p>
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
            <div className="flex gap-8">
              <p className="font-medium text-md w-[160px]">Date:</p>
              <p>
                {new Date(journal?.date || '').toLocaleString(
                  'en-US',
                  dateFormatOptions,
                )}
              </p>
            </div>
            <div className="flex gap-8">
              <p className="font-medium text-md w-[160px]">Amount:</p>
              <p>
                {getFormattedCurrency(
                  journal?.journalEntries.reduce(
                    (acc, entry) => acc + entry.debitAmount,
                    0,
                  ) ?? 0,
                )}
              </p>
            </div>

            <div className="flex gap-8">
              <p className="font-medium text-md w-[160px]">Narration:</p>
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
                    {new Date(journal?.updatedAt || '').toLocaleString(
                      'en-US',
                      datetimeFormatOptions,
                    )}
                  </p>
                )}
              </div>
            </div>

            {journal?.billNumber && (
              <div className="flex gap-8">
                <p className="font-medium text-md w-[160px]">Bill#:</p>
                <p>{journal.billNumber}</p>
              </div>
            )}

            {formatJournalDiscountLabel(journal?.discountPercentage) !==
              '-' && (
              <div className="flex gap-8">
                <p className="font-medium text-md w-[160px]">Discount%:</p>
                <p>{formatJournalDiscountLabel(journal?.discountPercentage)}</p>
              </div>
            )}
          </div>
        </div>

        <div className="w-1/4 flex items-center justify-center relative overflow-hidden">
          <div className="absolute right-0 top-0 w-40">
            <div className="w-40 bg-green-600 text-center rounded-xl rotate-45 py-1 translate-x-1/4 translate-y-3/4">
              Posted
            </div>
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
