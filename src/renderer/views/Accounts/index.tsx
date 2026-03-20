import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Settings2 } from 'lucide-react';
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
import {
  AccountType,
  type Account,
  type Chart,
  type DiscountProfile,
  type HasMiniView,
} from 'types';
import type { CellContext, Row } from '@tanstack/react-table';
import { cn, defaultSortingFunctions } from 'renderer/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'renderer/shad/ui/popover';
import { EditAccount } from './editAccount';
import { AddAccount } from './addAccount';
import { AddCustomHead } from './addCustomHead';
import { AccountPricingSheet } from './AccountPricing';

type AccountTypeFilter = 'All' | AccountType;
type OptionalAccountColumnId =
  | 'code'
  | 'address'
  | 'phone1'
  | 'phone2'
  | 'goodsName'
  | 'policy'
  | 'headName'
  | 'type'
  | 'updatedAt'
  | 'createdAt';

type AccountColumnOption = {
  id: OptionalAccountColumnId;
  label: string;
};

type AccountPageProps = {
  onRowClick?: (id?: number) => void;
} & HasMiniView;

const getStoredAccountType = (): AccountTypeFilter =>
  (window.electron.store.get('accountTypeSelected') as AccountTypeFilter) ||
  AccountType.Asset;

const getColumnStorageKey = (typeSelected: AccountTypeFilter) =>
  `accountVisibleColumns:${typeSelected}`;

const getAvailableColumnOptions = (
  typeSelected: AccountTypeFilter,
): AccountColumnOption[] => {
  const options: AccountColumnOption[] = [
    { id: 'code', label: 'Code' },
    { id: 'headName', label: 'Head' },
    { id: 'updatedAt', label: 'Updated at' },
    { id: 'createdAt', label: 'Created at' },
    { id: 'address', label: 'Address' },
    { id: 'goodsName', label: 'Goods name' },
    { id: 'phone1', label: 'Phone 1' },
    { id: 'phone2', label: 'Phone 2' },
  ];

  if (typeSelected === AccountType.Asset) {
    options.splice(1, 0, { id: 'policy', label: 'Policy' });
  }

  if (typeSelected === 'All') {
    options.splice(1, 0, { id: 'type', label: 'Type' });
    options.splice(2, 0, { id: 'policy', label: 'Policy' });
  }

  return options;
};

const getDefaultVisibleColumns = (
  typeSelected: AccountTypeFilter,
): OptionalAccountColumnId[] => {
  switch (typeSelected) {
    case AccountType.Asset:
      return ['code', 'policy', 'headName', 'updatedAt'];
    case 'All':
      return ['code', 'type', 'headName', 'updatedAt'];
    default:
      return ['code', 'headName', 'updatedAt'];
  }
};

const sanitizeVisibleColumns = (
  typeSelected: AccountTypeFilter,
  columnIds?: OptionalAccountColumnId[],
): OptionalAccountColumnId[] => {
  const availableIds = new Set(
    getAvailableColumnOptions(typeSelected).map((column) => column.id),
  );

  if (!columnIds) {
    return getDefaultVisibleColumns(typeSelected);
  }

  return Array.from(new Set(columnIds)).filter((columnId) =>
    availableIds.has(columnId),
  );
};

const getStoredVisibleColumns = (
  typeSelected: AccountTypeFilter,
): OptionalAccountColumnId[] =>
  sanitizeVisibleColumns(
    typeSelected,
    window.electron.store.get(getColumnStorageKey(typeSelected)) as
      | OptionalAccountColumnId[]
      | undefined,
  );

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
  const [typeSelected, setTypeSelected] =
    useState<AccountTypeFilter>(getStoredAccountType);
  const [visibleColumnIds, setVisibleColumnIds] = useState<
    OptionalAccountColumnId[]
  >(() => getStoredVisibleColumns(getStoredAccountType()));
  const [showInactive, setShowInactive] = useState<boolean>(
    window.electron.store.get('showInactiveAccounts') || false,
  );
  const [charts, setCharts] = useState<Chart[]>([]);
  const [discountProfiles, setDiscountProfiles] = useState<DiscountProfile[]>(
    [],
  );
  const [pricingAccountId, setPricingAccountId] = useState<number | null>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  const refetchAccounts = useCallback(async () => {
    const [fetchedAccounts, fetchedCharts, fetchedDiscountProfiles] =
      await Promise.all([
        window.electron.getAccounts(),
        window.electron.getCharts(),
        window.electron.getDiscountProfiles(),
      ]);
    setAccounts(fetchedAccounts);
    setCharts(fetchedCharts);
    setDiscountProfiles(fetchedDiscountProfiles);
  }, []);

  const pricingAccount = useMemo(
    () => accounts.find((account) => account.id === pricingAccountId),
    [accounts, pricingAccountId],
  );

  const availableColumnOptions = useMemo(
    () => getAvailableColumnOptions(typeSelected),
    [typeSelected],
  );
  const visibleColumnSet = useMemo(
    () => new Set(visibleColumnIds),
    [visibleColumnIds],
  );
  const openAccount = useCallback(
    (row: Row<Account>) => navigate(`/accounts/${row.original.id}`),
    [navigate],
  );

  const handleTypeChange = useCallback((nextType: AccountTypeFilter) => {
    setTypeSelected(nextType);
    setVisibleColumnIds(getStoredVisibleColumns(nextType));
  }, []);

  const toggleVisibleColumn = useCallback(
    (columnId: OptionalAccountColumnId) => {
      setVisibleColumnIds((prev) =>
        prev.includes(columnId)
          ? prev.filter((id) => id !== columnId)
          : [...prev, columnId],
      );
    },
    [],
  );

  const shouldShowPolicyColumn =
    typeSelected === AccountType.Asset || typeSelected === 'All';

  const columns: ColumnDef<Account>[] = useMemo(
    () =>
      isMini
        ? [
            {
              accessorKey: 'name',
              header: 'Accounts',
              cell: AccountCell,
              onClick: (row: Row<Account>) => {
                onRowClick?.(row.original.id);
                openAccount(row);
              },
            },
          ]
        : [
            {
              id: 'name',
              accessorKey: 'name',
              header: 'Account',
              onClick: openAccount,
              cell: AccountNameCell,
            },
            {
              id: 'code',
              accessorKey: 'code',
              header: 'Code',
              onClick: openAccount,
            },
            {
              id: 'address',
              accessorKey: 'address',
              header: 'Address',
              onClick: openAccount,
            },
            {
              id: 'phone1',
              accessorKey: 'phone1',
              header: 'Phone 1',
              onClick: openAccount,
            },
            {
              id: 'phone2',
              accessorKey: 'phone2',
              header: 'Phone 2',
              onClick: openAccount,
            },
            {
              id: 'goodsName',
              accessorKey: 'goodsName',
              header: 'Goods Name',
              onClick: openAccount,
            },
            ...(shouldShowPolicyColumn
              ? [
                  {
                    id: 'policy',
                    accessorKey: 'discountProfileName',
                    header: 'Policy',
                    // eslint-disable-next-line react/no-unstable-nested-components
                    cell: ({ row }: CellContext<Account, unknown>) => {
                      if (row.original.type !== AccountType.Asset) {
                        return (
                          <span className="text-xs text-muted-foreground">
                            -
                          </span>
                        );
                      }

                      let pricingLabel = 'Set up';
                      if (row.original.discountProfileId) {
                        pricingLabel =
                          row.original.discountProfileIsActive === false
                            ? 'Auto off'
                            : 'Edit';
                      }

                      return (
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            row.original.discountProfileId
                              ? 'outline'
                              : 'secondary'
                          }
                          title={
                            row.original.discountProfileId
                              ? `${
                                  row.original.discountProfileName || 'Policy'
                                }`
                              : 'Set up policy'
                          }
                          className={cn(
                            'h-8 min-w-[96px] justify-center px-3',
                            row.original.discountProfileIsActive === false &&
                              'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100',
                          )}
                          onClick={() => setPricingAccountId(row.original.id)}
                        >
                          {pricingLabel}
                        </Button>
                      );
                    },
                  } as ColumnDef<Account>,
                ]
              : []),
            {
              id: 'headName',
              accessorKey: 'headName',
              header: 'Head',
              onClick: openAccount,
              size: 1,
            },
            {
              id: 'type',
              accessorKey: 'type',
              header: 'Type',
              onClick: openAccount,
              size: 1,
            },
            {
              id: 'updatedAt',
              accessorKey: 'updatedAt',
              header: 'Updated At',
              cell: ({ row }: CellContext<Account, unknown>) =>
                new Date(row.original.updatedAt || '').toLocaleString(
                  'en-US',
                  dateFormatOptions,
                ),
              onClick: openAccount,
              size: 1,
            },
            {
              id: 'createdAt',
              accessorKey: 'createdAt',
              header: 'Created At',
              cell: ({ row }: CellContext<Account, unknown>) =>
                new Date(row.original.createdAt || '').toLocaleString(
                  'en-US',
                  dateFormatOptions,
                ),
              onClick: openAccount,
              size: 1,
            },
            {
              id: 'edit',
              header: 'Edit',
              // eslint-disable-next-line react/no-unstable-nested-components
              cell: ({ row }: CellContext<Account, unknown>) => (
                <EditAccount
                  row={row}
                  refetchAccounts={refetchAccounts}
                  charts={charts}
                  clearRef={clearRef}
                />
              ),
              size: 1,
            },
          ].filter(
            (column) =>
              column.id === 'name' ||
              column.id === 'edit' ||
              visibleColumnSet.has(column.id as OptionalAccountColumnId),
          ),
    [
      charts,
      isMini,
      openAccount,
      onRowClick,
      refetchAccounts,
      shouldShowPolicyColumn,
      visibleColumnSet,
    ],
  );

  useEffect(() => {
    refetchAccounts();
    onRowClick?.();
  }, [onRowClick, refetchAccounts]);

  useEffect(
    () => window.electron.store.set('accountTypeSelected', typeSelected),
    [typeSelected],
  );

  // persist visible columns for the currently selected account view.
  useEffect(() => {
    window.electron.store.set(
      getColumnStorageKey(typeSelected),
      sanitizeVisibleColumns(typeSelected, visibleColumnIds),
    );
  }, [typeSelected, visibleColumnIds]);

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
      <div className="flex flex-col gap-3 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={isMini ? 'w-max' : 'w-fit'}
                >
                  <span className="mr-2">{typeSelected} Accounts</span>
                  <ChevronDown size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="px-4">
                <DropdownMenuItem onClick={() => handleTypeChange('All')}>
                  All Accounts
                </DropdownMenuItem>
                {Object.keys(AccountType).map((type) => (
                  <DropdownMenuItem
                    key={type}
                    onClick={() =>
                      handleTypeChange(
                        AccountType[type as keyof typeof AccountType],
                      )
                    }
                  >
                    {type} Accounts
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <h1 className={cn('title', isMini && 'hidden')}>Accounts</h1>
          </div>

          {isMini ? null : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="mr-2 flex items-center gap-2 whitespace-nowrap text-sm font-medium leading-none">
                <Checkbox
                  checked={showInactive}
                  onCheckedChange={() => setShowInactive(!showInactive)}
                />
                <button
                  type="button"
                  className="cursor-pointer"
                  onClick={() => setShowInactive(!showInactive)}
                >
                  Show inactive accounts
                </button>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="px-3"
                  >
                    <Settings2 className="mr-2 h-4 w-4" />
                    Columns
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60 p-0">
                  <div className="space-y-3 p-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold">Visible columns</h3>
                      <p className="text-xs text-muted-foreground">
                        Saved for {typeSelected} Accounts
                      </p>
                    </div>
                    <div className="space-y-1">
                      {availableColumnOptions.map((column) => (
                        <button
                          key={column.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => toggleVisibleColumn(column.id)}
                        >
                          <span>{column.label}</span>
                          <Checkbox
                            checked={visibleColumnSet.has(column.id)}
                            className="pointer-events-none"
                          />
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-end border-t pt-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setVisibleColumnIds(
                            getDefaultVisibleColumns(typeSelected),
                          )
                        }
                      >
                        Reset defaults
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <AddCustomHead
                charts={charts}
                onHeadAdded={refetchAccounts}
                btnClassName="px-3"
              />
              <AddAccount
                charts={charts}
                clearRef={clearRef}
                refetchAccounts={refetchAccounts}
                btnClassName="px-3"
              />
            </div>
          )}
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
          searchFields={[
            'name',
            'code',
            'headName',
            'address',
            'phone1',
            'phone2',
            'goodsName',
            'discountProfileName',
          ]}
          searchPersistenceKey="datatable:accounts:search"
        />
      </div>
      <AccountPricingSheet
        open={pricingAccountId !== null}
        account={pricingAccount}
        discountProfiles={discountProfiles}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPricingAccountId(null);
        }}
        onUpdated={refetchAccounts}
      />
    </div>
  );
};

export default AccountsPage;
