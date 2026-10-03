/* eslint-disable react/prop-types -- props fully typed via TypeScript interfaces */
import React, { type FC, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { Virtuoso } from 'react-virtuoso';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from 'renderer/shad/ui/table';
import {
  getFormattedCurrencyInt,
  getFixedNumber,
  formatDaysDuration,
} from 'renderer/lib/utils';
import type { BillsAging, BillsAgingAccount } from './types';

interface BillsAgingTablesProps {
  billsAging: BillsAging;
  hideZeroRows?: boolean;
  hideStatus?: boolean;
  /** all-parties scope: tag each account section with its agent head */
  showHeadNames?: boolean;
}

interface AccountCardProps {
  account: BillsAgingAccount;
  hideZeroRows?: boolean;
  hideStatus?: boolean;
  showHeadNames?: boolean;
}

const AccountCard: FC<AccountCardProps> = React.memo(
  ({
    account,
    hideZeroRows = false,
    hideStatus = false,
    showHeadNames = false,
  }: AccountCardProps) => {
    const visibleBills = useMemo(() => {
      return hideZeroRows
        ? account.bills.filter((b) => getFixedNumber(b.finalBalance, 0) !== 0)
        : account.bills;
    }, [account.bills, hideZeroRows]);

    const activeReceiptIndexes = useMemo(() => {
      const hasActiveFilters = hideZeroRows || hideStatus;
      if (!hasActiveFilters) {
        const maxReceipts = Math.max(
          ...account.bills.map((bill) => bill.receipts.length),
          0,
        );
        return Array.from({ length: maxReceipts }, (_, i) => i);
      }
      const set = new Set<number>();
      visibleBills.forEach((bill) => {
        bill.receipts.forEach((receipt, idx) => {
          if (receipt && receipt.receivedAmount > 0) set.add(idx);
        });
      });
      return Array.from(set).sort((a, b) => a - b);
    }, [account.bills, hideZeroRows, hideStatus, visibleBills]);

    const outstanding =
      account.totalOutstanding - (account.totalUnallocated || 0);
    const isPositive = getFixedNumber(outstanding, 0) > 0;

    return (
      <div className="border rounded-lg p-4 max-w-full overflow-hidden bg-card shadow-xs">
        <div className="mb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold">
              {account.accountCode} ({account.accountName})
              {showHeadNames && account.headName && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  — {account.headName}
                </span>
              )}
            </h3>
            {(account.phone1 || account.phone2) && (
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-400 dark:text-slate-500">
                <span className="text-slate-400">📞</span>
                <span>
                  {[account.phone1, account.phone2].filter(Boolean).join(' / ')}
                </span>
              </div>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            Total Bills:{' '}
            {getFormattedCurrencyInt(account.totalBillAmount, {
              withoutCurrency: true,
            })}{' '}
            | Received:{' '}
            {getFormattedCurrencyInt(account.totalReceived, {
              withoutCurrency: true,
            })}{' '}
            | Outstanding:{' '}
            <span
              className={`font-medium ${
                isPositive ? 'text-red-600' : 'text-green-600'
              }`}
            >
              {getFormattedCurrencyInt(outstanding, {
                withoutCurrency: true,
              })}
            </span>
          </div>
        </div>

        {visibleBills.length > 0 && (
          <div className="overflow-x-auto shadow-md">
            <Table className="border-collapse w-full">
              <TableHeader>
                <TableRow className="bg-gray-200 dark:bg-gray-900 whitespace-nowrap">
                  <TableCell className="w-[120px] align-bottom">
                    Bill #
                  </TableCell>
                  <TableCell className="w-[100px] align-bottom">
                    Bill %
                  </TableCell>
                  <TableCell className="w-[120px] align-bottom">
                    Bill Date
                  </TableCell>
                  <TableCell className="w-[120px] text-right align-bottom">
                    Bill Amount
                  </TableCell>
                  {activeReceiptIndexes.map((i) => (
                    <React.Fragment key={`receipt-head-${i}`}>
                      <TableCell className="w-[120px] text-right align-bottom">
                        Received {i + 1}
                      </TableCell>
                      <TableCell className="w-[120px] text-right align-bottom">
                        Balance {i + 1}
                      </TableCell>
                    </React.Fragment>
                  ))}
                  {!hideStatus && (
                    <TableCell className="w-[120px] text-center align-bottom">
                      Days Status
                    </TableCell>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleBills.map((bill) => (
                  <TableRow
                    key={`${account.accountId}-${bill.billNumber}-${bill.billDate}`}
                  >
                    <TableCell className="font-medium align-bottom">
                      {bill.billNumber}
                    </TableCell>
                    <TableCell className="align-bottom">
                      {typeof bill.billPercentage === 'number'
                        ? `${bill.billPercentage}%`
                        : bill.billPercentage}
                    </TableCell>
                    <TableCell className="align-bottom">
                      {format(new Date(bill.billDate), 'MMM dd, yyyy')}
                    </TableCell>
                    <TableCell className="text-right align-bottom">
                      {getFormattedCurrencyInt(bill.billAmount, {
                        withoutCurrency: true,
                      })}
                    </TableCell>
                    {activeReceiptIndexes.map((i) => {
                      const receipt = bill.receipts[i];
                      return (
                        <React.Fragment key={`receipt-cell-${i}`}>
                          <TableCell className="text-right align-bottom">
                            {receipt ? (
                              <>
                                <div className="text-xs text-muted-foreground">
                                  {format(
                                    new Date(receipt.receivedDate),
                                    'MMM dd',
                                  )}
                                </div>
                                <div>
                                  {getFormattedCurrencyInt(
                                    receipt.receivedAmount,
                                    { withoutCurrency: true },
                                  )}
                                </div>
                              </>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                          <TableCell className="text-right align-bottom">
                            {receipt
                              ? getFormattedCurrencyInt(receipt.balance, {
                                  withoutCurrency: true,
                                })
                              : '-'}
                          </TableCell>
                        </React.Fragment>
                      );
                    })}
                    {!hideStatus && (
                      <TableCell className="text-center align-bottom">
                        <span
                          className={`text-sm font-medium whitespace-pre-line leading-tight ${
                            bill.daysStatus.isFullyPaid
                              ? 'text-green-600'
                              : 'text-red-600'
                          }`}
                        >
                          {bill.daysStatus.isFullyPaid
                            ? `Cleared in\n${formatDaysDuration(
                                bill.daysStatus.months,
                                bill.daysStatus.remainingDays,
                              )}`
                            : `Overdue by\n${formatDaysDuration(
                                bill.daysStatus.months,
                                bill.daysStatus.remainingDays,
                              )}`}
                        </span>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {account.unallocatedReceipts.length > 0 && (
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <h4 className="font-medium text-sm mb-2">Unallocated Receipts</h4>
            <div className="space-y-1">
              {account.unallocatedReceipts.map((receipt) => (
                <div
                  key={`${account.accountId}-unallocated-${receipt.receivedDate}-${receipt.receivedAmount}`}
                  className="flex justify-between text-sm"
                >
                  <span>
                    {format(new Date(receipt.receivedDate), 'MMM dd, yyyy')}
                  </span>
                  <span>
                    {getFormattedCurrencyInt(receipt.receivedAmount, {
                      withoutCurrency: true,
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
);
AccountCard.displayName = 'AccountCard';

export const BillsAgingTables: FC<BillsAgingTablesProps> = React.memo(
  ({
    billsAging,
    hideZeroRows = false,
    hideStatus = false,
    showHeadNames = false,
  }: BillsAgingTablesProps) => {
    const { accounts } = billsAging;

    const renderItem = useCallback(
      (_index: number, account: BillsAgingAccount) => (
        <div className="pb-8">
          <AccountCard
            key={account.accountId}
            account={account}
            hideZeroRows={hideZeroRows}
            hideStatus={hideStatus}
            showHeadNames={showHeadNames}
          />
        </div>
      ),
      [hideZeroRows, hideStatus, showHeadNames],
    );

    if (accounts.length <= 10) {
      return (
        <div className="space-y-8 max-w-full">
          {accounts.map((account) => (
            <AccountCard
              key={account.accountId}
              account={account}
              hideZeroRows={hideZeroRows}
              hideStatus={hideStatus}
              showHeadNames={showHeadNames}
            />
          ))}
        </div>
      );
    }

    return (
      <div className="h-full w-full min-h-[600px]">
        <Virtuoso
          style={{ height: '100%' }}
          data={accounts}
          initialItemCount={Math.min(accounts.length, 10)}
          itemContent={renderItem}
        />
      </div>
    );
  },
);
BillsAgingTables.displayName = 'BillsAgingTables';
