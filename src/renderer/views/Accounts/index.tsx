import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Button } from 'renderer/shad/ui/button';
import { Checkbox } from 'renderer/shad/ui/checkbox';
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
import { cn, defaultSortingFunctions } from 'renderer/lib/utils';
import { EditAccount } from './editAccount';
import { AddAccount } from './addAccount';
import { AddCustomHead } from './addCustomHead';

type AccountPageProps = {
  onRowClick?: (id?: number) => void;
} & HasMiniView;

const AccountCell: React.FC<CellContext<Account, unknown>> = ({
  row,
}: CellContext<Account, unknown>) => (
  <div
    className={cn(
      'flex justify-between',
      !row.original.isActive && 'opacity-50',
    )}
  >
    <div>
      <h2 className="font-normal">{row.original.name}</h2>
      <h6 className="font-extralight">{row.original.code}</h6>
    </div>
    <div className="flex items-center">
      <p className="text-xs text-slate-400">&nbsp;&nbsp;{row.original.type}</p>
      {!row.original.isActive && (
        <span className="ml-2 text-xs px-2 py-0.5 bg-red-100 text-red-800 rounded">
          Inactive
        </span>
      )}
    </div>
  </div>
);

const AccountNameCell: React.FC<CellContext<Account, unknown>> = ({
  row,
}: CellContext<Account, unknown>) => (
  <div className={cn(!row.original.isActive && 'opacity-60')}>
    {row.original.name}
    {!row.original.isActive && (
      <span className="ml-2 text-xs px-2 py-0.5 bg-red-100 text-red-800 rounded">
        Inactive
      </span>
    )}
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
  const [showInactive, setShowInactive] = useState<boolean>(
    window.electron.store.get('showInactiveAccounts') || false,
  );
  const [charts, setCharts] = useState<Chart[]>([]);
  const clearRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  const refetchAccounts = useCallback(async () => {
    const [fetchedAccounts, fetchedCharts] = await Promise.all([
      window.electron.getAccounts(),
      window.electron.getCharts(),
    ]);
    setAccounts(fetchedAccounts);
    setCharts(fetchedCharts);
  }, []);

  const columns: ColumnDef<Account>[] = useMemo(
    () =>
      isMini
        ? [
            {
              accessorKey: 'name',
              header: 'Accounts',
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
              header: 'Account',
              onClick: (row) => navigate(`/accounts/${row.original.id}`),
              cell: AccountNameCell,
            },
            {
              accessorKey: 'code',
              header: 'Code',
              onClick: (row) => navigate(`/accounts/${row.original.id}`),
            },
            {
              accessorKey: 'address',
              header: 'Address',
              onClick: (row) => navigate(`/accounts/${row.original.id}`),
            },
            {
              accessorKey: 'phone1',
              header: 'Phone 1',
              onClick: (row) => navigate(`/accounts/${row.original.id}`),
            },
            {
              accessorKey: 'phone2',
              header: 'Phone 2',
              onClick: (row) => navigate(`/accounts/${row.original.id}`),
            },
            {
              accessorKey: 'goodsName',
              header: 'Goods Name',
              onClick: (row) => navigate(`/accounts/${row.original.id}`),
            },
            {
              accessorKey: 'headName',
              header: 'Head',
              onClick: (row) => navigate(`/accounts/${row.original.id}`),
              size: 1,
            },
            {
              accessorKey: 'type',
              header: 'Type',
              onClick: (row) => navigate(`/accounts/${row.original.id}`),
              size: 1,
            },
            {
              accessorKey: 'updatedAt',
              header: 'Updated At',
              cell: ({ row }) =>
                new Date(row.original.updatedAt || '').toLocaleString(
                  'en-US',
                  dateFormatOptions,
                ),
              onClick: (row) => navigate(`/accounts/${row.original.id}`),
              size: 1,
            },
            {
              accessorKey: 'createdAt',
              header: 'Created At',
              cell: ({ row }) =>
                new Date(row.original.createdAt || '').toLocaleString(
                  'en-US',
                  dateFormatOptions,
                ),
              onClick: (row) => navigate(`/accounts/${row.original.id}`),
              size: 1,
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
              size: 1,
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

  useEffect(
    () => window.electron.store.set('showInactiveAccounts', showInactive),
    [showInactive],
  );

  const getAccounts = useCallback(() => {
    let filteredAccounts = accounts;

    if (!showInactive) {
      filteredAccounts = filteredAccounts.filter((account) => account.isActive);
    }
    if (!typeSelected || typeSelected === 'All') {
      return filteredAccounts;
    }

    return filteredAccounts.filter((account) => account.type === typeSelected);
  }, [accounts, typeSelected, showInactive]);

  return (
    <div>
      <div className="grid grid-cols-3 justify-between items-center py-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className={isMini ? 'max-w-min py-6' : 'w-fit'}
            >
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

        <h1 className={cn('title', isMini && 'hidden')}>Accounts</h1>

        <div className={cn('flex w-fit ml-auto', isMini ? 'gap-0.5' : 'gap-2')}>
          {!isMini && (
            <div className="flex items-center mr-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  checked={showInactive}
                  onCheckedChange={() => setShowInactive(!showInactive)}
                />
                <h2 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                  Show inactive accounts
                </h2>
              </div>
            </div>
          )}
          <AddCustomHead
            charts={charts}
            onHeadAdded={refetchAccounts}
            btnClassName={isMini ? 'max-w-min py-6' : 'min-w-max'}
          />
          <AddAccount
            charts={charts}
            clearRef={clearRef}
            refetchAccounts={refetchAccounts}
            btnClassName={isMini ? 'min-w-20 max-w-min py-6' : 'min-w-max'}
          />
        </div>
      </div>
      <div className="py-8">
        <DataTable
          columns={columns}
          data={getAccounts()}
          defaultSortField="id"
          sortingFns={defaultSortingFunctions}
          virtual
          isMini={isMini}
          searchPlaceholder="Search accounts..."
          searchFields={['name', 'code', 'headName']}
        />
      </div>
    </div>
  );
};

export default AccountsPage;
