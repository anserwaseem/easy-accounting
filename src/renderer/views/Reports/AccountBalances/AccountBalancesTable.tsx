import type { FC } from 'react';
import {
  TableBody,
  TableCell,
  TableFooter,
  TableHeader,
  TableRow,
} from 'renderer/shad/ui/table';
import {
  getFormattedCurrency,
  getFormattedDebitCreditWithoutCurrency,
} from 'renderer/lib/utils';
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
  visibleColumns?: ReadonlySet<string>;
}

type SortField = 'code' | 'name' | 'debit' | 'credit';

export const AccountBalancesTable: FC<AccountBalancesTableProps> = ({
  accountBalances,
  isLoading,
  visibleColumns,
}) => {
  const visible =
    visibleColumns ?? new Set(['code', 'name', 'debit', 'credit']);
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
  const labelSpan =
    (visible.has('code') ? 1 : 0) + (visible.has('name') ? 1 : 0);

  if (isLoading) {
    return <LoadingState variant="skeleton" />;
  }

  if (accounts.length === 0) {
    return <EmptyState message="No accounts found for this head." />;
  }

  // raw <table> — shadcn Table wraps in its own overflow-auto, which
  // breaks sticky footer against the report scroll pane (same as Trial Balance).
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
      <div className="relative min-h-0 w-full flex-1 overflow-auto print:overflow-visible">
        <table className="w-full border-collapse text-sm print-table print-tfoot-no-repeat">
          <TableHeader>
            <TableRow className="print-row">
              {visible.has('code') ? (
                <SortableHeader
                  currentSortField={sortField}
                  sortField="code"
                  sortDirection={sortDirection}
                  onSort={() => handleSort('code')}
                  className="w-[150px]"
                >
                  Account Code
                </SortableHeader>
              ) : null}
              {visible.has('name') ? (
                <SortableHeader
                  currentSortField={sortField}
                  sortField="name"
                  sortDirection={sortDirection}
                  onSort={() => handleSort('name')}
                  className="w-[250px]"
                >
                  Account Name
                </SortableHeader>
              ) : null}
              {visible.has('debit') ? (
                <SortableHeader
                  currentSortField={sortField}
                  sortField="debit"
                  sortDirection={sortDirection}
                  onSort={() => handleSort('debit')}
                  className="text-right print-spacing-right"
                >
                  Debit
                </SortableHeader>
              ) : null}
              {visible.has('credit') ? (
                <SortableHeader
                  currentSortField={sortField}
                  sortField="credit"
                  sortDirection={sortDirection}
                  onSort={() => handleSort('credit')}
                  className="text-right"
                >
                  Credit
                </SortableHeader>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.id} className="print-row">
                {visible.has('code') ? (
                  <TableCell className="font-medium">{account.code}</TableCell>
                ) : null}
                {visible.has('name') ? (
                  <TableCell>{account.name}</TableCell>
                ) : null}
                {visible.has('debit') ? (
                  <TableCell className="text-right print-spacing-right">
                    {account.balanceType === 'Dr'
                      ? getFormattedCurrency(account.balance)
                          .replace(currency, '')
                          .trim()
                      : '-'}
                  </TableCell>
                ) : null}
                {visible.has('credit') ? (
                  <TableCell className="text-right">
                    {account.balanceType === 'Cr'
                      ? getFormattedCurrency(account.balance)
                          .replace(currency, '')
                          .trim()
                      : '-'}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="border-t-0 print:static [&>tr]:border-t [&>tr]:border-primary">
            <TableRow className="sticky bottom-0 z-10 border-t border-primary bg-muted/95 font-semibold hover:bg-muted/95 print:static print:z-auto">
              {labelSpan > 0 ? (
                <TableCell className="bg-inherit" colSpan={labelSpan}>
                  Total
                </TableCell>
              ) : null}
              {visible.has('debit') ? (
                <TableCell className="bg-inherit text-right print-spacing-right">
                  {getFormattedDebitCreditWithoutCurrency(totalDebit)}
                </TableCell>
              ) : null}
              {visible.has('credit') ? (
                <TableCell className="bg-inherit text-right">
                  {getFormattedDebitCreditWithoutCurrency(totalCredit)}
                </TableCell>
              ) : null}
            </TableRow>
          </TableFooter>
        </table>
      </div>
    </div>
  );
};
