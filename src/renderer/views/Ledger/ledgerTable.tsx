import { useState, useEffect, useMemo } from 'react';
import { dateFormatOptions } from 'renderer/lib/constants';
import { defaultSortingFunctions } from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { GetLedger } from 'types';

interface LedgerTableProps {
  accountId: number;
}

export const LedgerTable: React.FC<LedgerTableProps> = ({ accountId }) => {
  console.log('LedgerTable', accountId);
  const [ledger, setLedger] = useState<GetLedger[]>([]);

  useEffect(
    () =>
      void (async () =>
        setLedger(await window.electron.getLedger(accountId)))(),
    [accountId],
  );

  console.log('LedgerTable', ledger);

  const columns: ColumnDef<GetLedger>[] = useMemo(
    () => [
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
        header: 'Particulars',
        cell: ({ row }) =>
          row.original.linkedAccountName ?? row.original.particulars,
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
    ],
    [],
  );

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
