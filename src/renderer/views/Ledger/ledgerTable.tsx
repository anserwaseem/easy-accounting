import { useState, useEffect, useMemo } from 'react';
import { currency, dateFormatOptions } from 'renderer/lib/constants';
import {
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { LedgerView, Journal } from '@/types';
import { Link } from 'react-router-dom';

interface LedgerTableProps {
  ledger: LedgerView[];
}

const extractJournalId = (particulars: string): number | null => {
  const match = particulars.match(/Journal #(\d+)/);
  return match ? parseInt(match[1], 10) : null;
};

const NarrationCell = ({ particulars }: { particulars: string }) => {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [loading, setLoading] = useState(false);
  const journalId = extractJournalId(particulars);

  useEffect(() => {
    const fetchJournal = async () => {
      if (!journalId) return;

      setLoading(true);
      try {
        const journalData = await window.electron.getJournal(journalId);
        setJournal(journalData);
      } catch (error) {
        console.error('Error fetching journal:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchJournal();
  }, [journalId]);

  if (!journalId) return null;

  if (loading) return <span>Loading...</span>;

  return (
    <Link
      to={`/journals/${journalId}`}
      className="text-blue-600 hover:underline"
    >
      {journal?.narration ? journal.narration : `View Journal #${journalId}`}
    </Link>
  );
};

const renderJournalCell = (info: { row: { original: LedgerView } }) => (
  <NarrationCell particulars={info.row.original.particulars} />
);

export const LedgerTable: React.FC<LedgerTableProps> = ({
  ledger,
}: LedgerTableProps) => {
  // eslint-disable-next-line no-console
  console.log('LedgerTable', ledger);

  const columns: ColumnDef<LedgerView>[] = useMemo(
    () => [
      {
        accessorKey: 'date',
        header: 'Date (MM/DD/YYYY)',
        cell: ({ row }) =>
          new Date(row.original.date).toLocaleString(
            'en-US',
            dateFormatOptions,
          ),
      },
      {
        header: 'Particulars',
        cell: ({ row }) =>
          row.original.linkedAccountName ?? row.original.particulars,
      },
      {
        header: 'Narration',
        cell: renderJournalCell,
      },
      {
        accessorKey: 'debit',
        header: 'Debit',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.debit).replace(currency, '').trim(),
      },
      {
        accessorKey: 'credit',
        header: 'Credit',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.credit)
            .replace(currency, '')
            .trim(),
      },
      {
        accessorKey: 'balance',
        header: 'Balance',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.balance)
            .replace(currency, '')
            .trim(),
      },
      {
        accessorKey: 'balanceType',
        header: 'Balance Type',
      },
      // {
      //   accessorKey: 'updatedAt',
      //   header: 'Updated At',
      //   cell: ({ row }) =>
      //     new Date(row.original.updatedAt || '').toLocaleString(
      //       'en-US',
      //       dateFormatOptions,
      //     ),
      // },
      // {
      //   accessorKey: 'createdAt',
      //   header: 'Created At',
      //   cell: ({ row }) =>
      //     new Date(row.original.createdAt || '').toLocaleString(
      //       'en-US',
      //       dateFormatOptions,
      //     ),
      // },
    ],
    [],
  );

  return (
    <div className="py-8">
      <DataTable
        columns={columns}
        data={ledger}
        sortingFns={defaultSortingFunctions}
      />
    </div>
  );
};
