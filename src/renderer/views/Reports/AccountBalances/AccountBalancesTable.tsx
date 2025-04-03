import type { FC } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from 'renderer/shad/ui/table';
import { getFormattedCurrency } from 'renderer/lib/utils';
import { currency } from 'renderer/lib/constants';
import {
  EmptyState,
  LoadingState,
  SortableHeader,
  useSorting,
} from '../components';
import type { AccountBalances, AccountBalanceItem } from './types';

interface AccountBalancesTableProps {
  accountBalances: AccountBalances;
  isLoading: boolean;
}

type SortField = 'code' | 'name' | 'debit' | 'credit';

export const AccountBalancesTable: FC<AccountBalancesTableProps> = ({
  accountBalances,
  isLoading,
}) => {
  const {
    accounts: unsortedAccounts,
    totalDebit,
    totalCredit,
  } = accountBalances;

  // Setup sorting with custom sort functions for debit and credit
  const { sortField, sortDirection, handleSort, sortItems } = useSorting<
    AccountBalanceItem,
    SortField
  >({
    initialSortField: 'code',
    customSortFunctions: {
      debit: (items, direction) => {
        return items
          .map((item) => ({
            ...item,
            // Use balance as debit when Dr, otherwise 0
            debit: item.balanceType === 'Dr' ? item.balance : 0,
          }))
          .sort((a, b) => {
            return direction === 'asc' ? a.debit - b.debit : b.debit - a.debit;
          });
      },
      credit: (items, direction) => {
        return items
          .map((item) => ({
            ...item,
            // Use balance as credit when Cr, otherwise 0
            credit: item.balanceType === 'Cr' ? item.balance : 0,
          }))
          .sort((a, b) => {
            return direction === 'asc'
              ? a.credit - b.credit
              : b.credit - a.credit;
          });
      },
    },
  });

  // Sort accounts based on current sort settings
  const accounts = sortItems(unsortedAccounts);

  if (isLoading) {
    return <LoadingState variant="skeleton" />;
  }

  if (accounts.length === 0) {
    return <EmptyState message="No accounts found for this head." />;
  }

  return (
    <Table className="border-collapse w-full print-table">
      <TableHeader>
        <TableRow className="print-row">
          <SortableHeader
            currentSortField={sortField}
            sortField="code"
            sortDirection={sortDirection}
            onSort={() => handleSort('code')}
            className="w-[150px]"
          >
            Account Code
          </SortableHeader>
          <SortableHeader
            currentSortField={sortField}
            sortField="name"
            sortDirection={sortDirection}
            onSort={() => handleSort('name')}
            className="w-[250px]"
          >
            Account Name
          </SortableHeader>
          <SortableHeader
            currentSortField={sortField}
            sortField="debit"
            sortDirection={sortDirection}
            onSort={() => handleSort('debit')}
            className="text-right print-spacing-right"
          >
            Debit
          </SortableHeader>
          <SortableHeader
            currentSortField={sortField}
            sortField="credit"
            sortDirection={sortDirection}
            onSort={() => handleSort('credit')}
            className="text-right"
          >
            Credit
          </SortableHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => (
          <TableRow key={account.id} className="print-row">
            <TableCell className="font-medium">{account.code}</TableCell>
            <TableCell>{account.name}</TableCell>
            <TableCell className="text-right print-spacing-right">
              {account.balanceType === 'Dr'
                ? getFormattedCurrency(account.balance)
                    .replace(currency, '')
                    .trim()
                : '-'}
            </TableCell>
            <TableCell className="text-right">
              {account.balanceType === 'Cr'
                ? getFormattedCurrency(account.balance)
                    .replace(currency, '')
                    .trim()
                : '-'}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="font-bold border-t-2 print-row">
          <TableCell colSpan={2} className="text-right">
            Total
          </TableCell>
          <TableCell className="text-right print-spacing-right">
            {getFormattedCurrency(totalDebit).replace(currency, '').trim()}
          </TableCell>
          <TableCell className="text-right">
            {getFormattedCurrency(totalCredit).replace(currency, '').trim()}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
};
