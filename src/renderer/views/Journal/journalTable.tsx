import { useState, useEffect, useMemo } from 'react';
import {
  currencyFormatOptions,
  dateFormatOptions,
} from 'renderer/lib/constants';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';

interface JournalTableProps {
  journalId: number;
}

export const JournalTable: React.FC<JournalTableProps> = ({ journalId }) => {
  console.log('JournalTable', journalId);
  const [journal, setJournal] = useState<Journal>();

  useEffect(
    () =>
      void (async () =>
        setJournal(await window.electron.getJournal(journalId)))(),
    [journalId],
  );

  const columns: ColumnDef<JournalEntry>[] = useMemo(() => {
    return [
      {
        accessorKey: 'accountName',
        header: 'Account',
      },
      {
        accessorKey: 'debitAmount',
        header: 'Debit',
      },
      {
        accessorKey: 'creditAmount',
        header: 'Credit',
      },
    ];
  }, []);

  return (
    <div>
      <div className="flex">
        <div className="w-3/4">
          <h1 className="text-4xl font-light">JOURNAL</h1>
          <p className="font-extrabold">#{journal?.id}</p>

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
                {Intl.NumberFormat('en-US', currencyFormatOptions).format(
                  journal?.journalEntries.reduce(
                    (acc, entry) => acc + entry.debitAmount,
                    0,
                  ) || 0,
                )}
              </p>
            </div>

            <div className="flex gap-8">
              <p className="font-medium text-md w-[160px]">Narration:</p>
              <p>{journal?.narration}</p>
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
        <DataTable columns={columns} data={journal?.journalEntries || []} />
      </div>
    </div>
  );
};
