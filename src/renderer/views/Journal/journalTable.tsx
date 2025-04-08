import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  currency,
  dateFormatOptions,
  datetimeFormatOptions,
} from 'renderer/lib/constants';
import {
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { Journal, JournalEntry } from 'types';
import { EditNarrationDialog } from 'renderer/components/EditNarrationDialog';

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

  const handleUpdateNarration = async (id: number, newNarration: string) => {
    try {
      await window.electron.updateJournalNarration(id, newNarration);
      setJournal(await window.electron.getJournal(journalId));
    } catch (error) {
      console.error('Error updating journal narration:', error);
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
          getFormattedCurrency(row.original.debitAmount)
            .replace(currency, '')
            .trim(),
      },
      {
        accessorKey: 'creditAmount',
        header: 'Credit',
        onClick: (row) => navigate(`/accounts/${row.original.accountId}`),
        cell: ({ row }) =>
          getFormattedCurrency(row.original.creditAmount)
            .replace(currency, '')
            .trim(),
      },
    ];
  }, [navigate]);

  return (
    <div>
      <div className="flex">
        <div className="w-3/4">
          <h1 className="text-4xl font-light">JOURNAL</h1>
          {/* <p className="font-extrabold">#{journal?.id}</p> */}

          <div className="flex flex-col gap-2 mt-8">
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
                    <EditNarrationDialog
                      journalId={journal.id}
                      narration={journal.narration || ''}
                      onSave={handleUpdateNarration}
                    />
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
