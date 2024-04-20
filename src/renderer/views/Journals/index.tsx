import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import { dateFormatOptions } from 'renderer/lib/constants';
import { Plus } from 'lucide-react';

const JournalsPage = () => {
  console.log('JournalsPage');
  const [journals, setJounrals] = useState<(Journal & { amount: number })[]>(
    [],
  );

  const navigate = useNavigate();

  const columns: ColumnDef<Journal>[] = useMemo(
    () => [
      {
        accessorKey: 'id',
        header: 'Journal #',
        onClick: (row) => navigate(`/journal/${row.original.id}`),
      },
      {
        accessorKey: 'date',
        header: 'Date',
        onClick: (row) => navigate(`/journal/${row.original.id}`),
      },
      {
        accessorKey: 'narration',
        header: 'Narration',
        onClick: (row) => navigate(`/journal/${row.original.id}`),
      },
      {
        accessorKey: 'isPublished',
        header: 'Status',
        onClick: (row) => navigate(`/journal/${row.original.id}`),
        cell: ({ row }) => (row.original.isPosted ? 'Posted' : 'Draft'),
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        onClick: (row) => navigate(`/journal/${row.original.id}`),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created At',
        cell: ({ row }) =>
          new Date(row.original.createdAt || '').toLocaleString(
            'en-US',
            dateFormatOptions,
          ),
        onClick: (row) => navigate(`/journal/${row.original.id}`),
      },
    ],
    [journals],
  );

  useEffect(
    () =>
      void (async () =>
        setJounrals(
          ((await window.electron.getJournals()) as Journal[]).map(
            (journal) => ({
              ...journal,
              amount: journal.journalEntries.reduce(
                (acc, entry) => acc + entry.debitAmount,
                0,
              ),
            }),
          ),
        ))(),
    [],
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
          <Plus />
          <span>New Journal</span>
        </Button>
      </div>
      <div className="py-10 pr-4">
        <DataTable columns={columns} data={journals} />
      </div>
    </div>
  );
};

export default JournalsPage;
