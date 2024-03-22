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
  const [typeSelected, setTypeSelected] = useState<
    'All' | 'Asset' | 'Liability' | 'Equity'
  >(window.electron.store.get('accountTypeSelected') || 'All');

  const columns: ColumnDef<Account>[] = [
    {
      accessorKey: 'name',
      header: 'Account Name',
    },
    {
      accessorKey: 'headName',
      header: 'Head Name',
    },
    {
      accessorKey: 'type',
      header: 'Type',
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
          await window.electron.getAccounts(
            window.electron.store.get('username'),
          ),
        ))(),
    [],
  );

  useEffect(() => {
    window.electron.store.set('accountTypeSelected', typeSelected);
  }, [typeSelected]);

  const getAccounts = () => {
    switch (typeSelected) {
      case 'Asset':
        return accounts.filter((account) => account.type === 'Asset');
      case 'Liability':
        return accounts.filter((account) => account.type === 'Liability');
      case 'Equity':
        return accounts.filter((account) => account.type === 'Equity');
      default:
        return accounts;
    }
  };

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="lg">
            <span className="mr-2">{typeSelected} Accounts</span>
            <ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="px-4">
          <DropdownMenuItem onClick={() => setTypeSelected('All')}>
            All Accounts
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTypeSelected('Asset')}>
            Asset Accounts
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTypeSelected('Liability')}>
            Liability Accounts
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTypeSelected('Equity')}>
            Equity Accounts
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="py-10 pr-4">
        <DataTable columns={columns} data={getAccounts()} />
      </div>
    </div>
  );
};

export default AccountPage;
