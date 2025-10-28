import React, { type FC } from 'react';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from 'renderer/shad/ui/table';
import { getFormattedCurrencyInt, getFixedNumber } from 'renderer/lib/utils';
import type { BillsAging, BillsAgingAccount } from './types';

interface BillsAgingTablesProps {
  billsAging: BillsAging;
  hideZeroRows?: boolean;
  hideStatus?: boolean;
}

export const BillsAgingTables: FC<BillsAgingTablesProps> = ({
  billsAging,
  hideZeroRows = false,
  hideStatus = false,
}) => {
  const { accounts } = billsAging;

  // calculate max receipts per account to determine column count
  const getMaxReceiptsForAccount = (account: BillsAgingAccount) => {
    return Math.max(...account.bills.map((bill) => bill.receipts.length), 0);
  };

  // sort accounts by code (handle both number and string codes)
  const sortedAccounts = [...accounts].sort((a, b) => {
    const codeA = a.accountCode?.toString()?.trim() || '';
    const codeB = b.accountCode?.toString()?.trim() || '';
    return codeA.localeCompare(codeB, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });

  return (
    <div className="space-y-8 max-w-full">
      {sortedAccounts.map((account) => {
        const visibleBills = hideZeroRows
          ? account.bills.filter((b) => getFixedNumber(b.finalBalance, 0) !== 0)
          : account.bills;

        // when filters are applied, only show receipt/balance columns that have data
        const hasActiveFilters = hideZeroRows || hideStatus;
        const activeReceiptIndexes = (() => {
          if (!hasActiveFilters) {
            return Array.from(
              { length: getMaxReceiptsForAccount(account) },
              (_, i) => i,
            );
          }
          const set = new Set<number>();
          visibleBills.forEach((bill) => {
            bill.receipts.forEach((receipt, idx) => {
              if (receipt && receipt.receivedAmount > 0) set.add(idx);
            });
          });
          return Array.from(set).sort((a, b) => a - b);
        })();
        return (
          <div
            key={account.accountId}
            className="border rounded-lg p-4 max-w-full overflow-hidden"
          >
            <div className="mb-4">
              <h3 className="text-lg font-semibold">
                {account.accountCode} ({account.accountName})
              </h3>
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
                    getFixedNumber(
                      account.totalOutstanding - account.totalUnallocated,
                      0,
                    ) <= 0
                      ? 'text-green-600'
                      : 'text-red-600'
                  }`}
                >
                  {getFormattedCurrencyInt(
                    account.totalOutstanding - account.totalUnallocated,
                    { withoutCurrency: true },
                  )}
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
                        <React.Fragment key={i}>
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
                            <React.Fragment key={i}>
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
                                ? `Cleared in\n${bill.daysStatus.days} days`
                                : `Overdue by\n${bill.daysStatus.days} days`}
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
                <h4 className="font-medium text-sm mb-2">
                  Unallocated Receipts
                </h4>
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
      })}
    </div>
  );
};
