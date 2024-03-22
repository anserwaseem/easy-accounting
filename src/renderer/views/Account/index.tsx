import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'renderer/shad/ui/dropdown-menu';

const AccountPage = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);

  const columns: ColumnDef<Account>[] = [
    {
      accessorKey: 'name',
      header: 'Account Name',
    },
    {
      accessorKey: 'code',
      header: 'Account Code',
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated At',
      cell: ({ row }) =>
        new Date(row.original.updatedAt).toLocaleString('en-US'),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created At',
      cell: ({ row }) =>
        new Date(row.original.createdAt).toLocaleString('en-US'),
    },
  ];

  useEffect(
    () =>
      void (async () =>
        setAccounts(
          await window.electron.getAccounts(localStorage.getItem('username')),
        ))(),
    [],
  );

  return (
    <div>
      <div className="py-10 pr-4">
        <DataTable columns={columns} data={accounts} />
      </div>
    </div>
  );
};

export default AccountPage;
