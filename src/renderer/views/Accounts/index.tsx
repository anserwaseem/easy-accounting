import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { toString } from 'lodash';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'renderer/shad/ui/dropdown-menu';
import { dateFormatOptions } from 'renderer/lib/constants';
import { AccountType, type Account, type Chart, type HasMiniView } from 'types';
import type { CellContext } from '@tanstack/react-table';
import { defaultSortingFunctions } from 'renderer/lib/utils';
import { EditAccount } from './editAccount';
import { AddAccount } from './addAccount';

type AccountPageProps = {
  onRowClick?: (id?: number) => void;
} & HasMiniView;

const AccountCell: React.FC<CellContext<Account, unknown>> = ({
  row,
}: CellContext<Account, unknown>) => (
  <div className="flex justify-between">
    <h2>{row.original.name}</h2>
    <p className="text-xs text-slate-400">{row.original.type}</p>
  </div>
);

const AccountsPage: React.FC<AccountPageProps> = ({
  isMini = false,
  onRowClick,
}: AccountPageProps) => {
  // eslint-disable-next-line no-console
  console.log('AccountsPage');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [typeSelected, setTypeSelected] = useState<'All' | AccountType>(
    window.electron.store.get('accountTypeSelected') || 'All',
  );
  const [charts, setCharts] = useState<Chart[]>([]);
  const clearRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  const refetchAccounts = useCallback(async () => {
    setAccounts(await window.electron.getAccounts());
    setCharts(await window.electron.getCharts());
  }, []);

  const columns: ColumnDef<Account>[] = useMemo(
    () =>
      isMini
        ? [
            {
              accessorKey: 'name',
              header: 'Account Name',
              cell: AccountCell,
              onClick: (row) => {
                onRowClick?.(row.original.id);
                navigate(`/accounts/${row.original.id}`);
              },
            },
          ]
        : [
            {
              accessorKey: 'name',
              header: 'Account Name',
              onClick: (row) => navigate(toString(row.original.id)),
            },
            {
              accessorKey: 'headName',
              header: 'Head Name',
              onClick: (row) => navigate(toString(row.original.id)),
            },
            {
              accessorKey: 'type',
              header: 'Type',
              onClick: (row) => navigate(toString(row.original.id)),
            },
            {
              accessorKey: 'code',
              header: 'Account Code',
              onClick: (row) => navigate(toString(row.original.id)),
            },
            {
              accessorKey: 'updatedAt',
              header: 'Updated At',
              cell: ({ row }) =>
                new Date(row.original.updatedAt || '').toLocaleString(
                  'en-US',
                  dateFormatOptions,
                ),
              onClick: (row) => navigate(toString(row.original.id)),
            },
            {
              accessorKey: 'createdAt',
              header: 'Created At',
              cell: ({ row }) =>
                new Date(row.original.createdAt || '').toLocaleString(
                  'en-US',
                  dateFormatOptions,
                ),
              onClick: (row) => navigate(toString(row.original.id)),
            },
            {
              header: 'Edit',
              // eslint-disable-next-line react/no-unstable-nested-components
              cell: ({ row }) => (
                <EditAccount
                  row={row}
                  refetchAccounts={refetchAccounts}
                  charts={charts}
                  clearRef={clearRef}
                />
              ),
            },
          ],
    [charts, isMini, navigate, onRowClick, refetchAccounts],
  );

  useEffect(() => {
    refetchAccounts();
    onRowClick?.();
  }, [onRowClick, refetchAccounts]);

  useEffect(
    () => window.electron.store.set('accountTypeSelected', typeSelected),
    [typeSelected],
  );

  const getAccounts = useCallback(() => {
    if (!typeSelected || typeSelected === 'All') {
      return accounts;
    }

    return accounts.filter((account) => account.type === typeSelected);
  }, [accounts, typeSelected]);

  return (
    <div>
      <div className="flex justify-between items-center py-4 pr-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <span className="mr-2">{typeSelected} Accounts</span>
              <ChevronDown size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="px-4">
            <DropdownMenuItem onClick={() => setTypeSelected('All')}>
              All Accounts
            </DropdownMenuItem>
            {Object.keys(AccountType).map((type) => (
              <DropdownMenuItem
                onClick={() =>
                  setTypeSelected(AccountType[type as keyof typeof AccountType])
                }
              >
                {type} Accounts
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <h1 className={isMini ? 'hidden' : 'text-2xl'}>Accounts</h1>

        <AddAccount
          charts={charts}
          clearRef={clearRef}
          refetchAccounts={refetchAccounts}
        />
      </div>
      <div className="py-8 pr-4">
        <DataTable
          columns={columns}
          data={getAccounts()}
          defaultSortField="id"
          sortingFns={defaultSortingFunctions}
        />
      </div>
    </div>
  );
};

export default AccountsPage;
