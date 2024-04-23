import { useState, useEffect, useMemo } from 'react';
import { dateFormatOptions } from 'renderer/lib/constants';
import { defaultSortingFunctions } from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';

interface LedgerTableProps {
  accountId: number;
}

export const LedgerTable: React.FC<LedgerTableProps> = ({ accountId }) => {
  console.log('LedgerTable', accountId);
  const [ledger, setLedger] = useState<Ledger[]>([]);

  useEffect(
    () =>
      void (async () =>
        setLedger(await window.electron.getLedger(accountId)))(),
    [accountId],
  );

  const columns: ColumnDef<Ledger>[] = useMemo(() => {
    return [
      {
        accessorKey: 'date',
        header: 'Date',
        cell: ({ row }) =>
          new Date(row.original.date).toLocaleString(
            'en-US',
            dateFormatOptions,
          ),
      },
      {
        accessorKey: 'particulars',
        header: 'Particulars',
      },
      {
        accessorKey: 'debit',
        header: 'Debit',
      },
      {
        accessorKey: 'credit',
        header: 'Credit',
      },
      {
        accessorKey: 'balance',
        header: 'Balance',
      },
      {
        accessorKey: 'balanceType',
        header: 'Balance Type',
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated At',
        cell: ({ row }) =>
          new Date(row.original.updatedAt || '').toLocaleString(
            'en-US',
            dateFormatOptions,
          ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created At',
        cell: ({ row }) =>
          new Date(row.original.createdAt || '').toLocaleString(
            'en-US',
            dateFormatOptions,
          ),
      },
    ];
  }, []);

  return (
    <div className="py-10">
      <DataTable
        columns={columns}
        data={ledger}
        sortingFns={defaultSortingFunctions}
      />
    </div>
  );
};
