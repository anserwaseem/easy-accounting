import React, { type FC } from 'react';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from 'renderer/shad/ui/table';
import { getFormattedCurrency } from 'renderer/lib/utils';
import { currency } from 'renderer/lib/constants';
import { EmptyState, LoadingState } from '../components';
import type { BillsAging, BillsAgingAccount } from './types';

interface BillsAgingTableProps {
  billsAging: BillsAging;
  isLoading: boolean;
}

export const BillsAgingTable: FC<BillsAgingTableProps> = ({
  billsAging,
  isLoading,
}) => {
  const { accounts } = billsAging;

  if (isLoading) {
    return <LoadingState variant="skeleton" />;
  }

  if (accounts.length === 0) {
    return <EmptyState message="No accounts found for this head." />;
  }

  // calculate max receipts per account to determine column count
  const getMaxReceiptsForAccount = (account: BillsAgingAccount) => {
    return Math.max(...account.bills.map((bill) => bill.receipts.length), 0);
  };

  return (
    <div className="space-y-8">
      {accounts.map((account) => (
        <div key={account.accountId} className="border rounded-lg p-4">
          <div className="mb-4">
            <h3 className="text-lg font-semibold">
              {account.accountName}
              {account.accountCode && ` (${account.accountCode})`}
            </h3>
            <div className="text-sm text-muted-foreground mt-1">
              Total Bills:{' '}
              {getFormattedCurrency(account.totalBillAmount)
                .replace(currency, '')
                .trim()}{' '}
              | Received:{' '}
              {getFormattedCurrency(account.totalReceived)
                .replace(currency, '')
                .trim()}{' '}
              | Outstanding:{' '}
              {getFormattedCurrency(account.totalOutstanding)
                .replace(currency, '')
                .trim()}
            </div>
          </div>

          {account.bills.length > 0 && (
            <Table className="border-collapse w-full print-table">
              <TableHeader>
                <TableRow className="print-row">
                  <TableCell className="w-[120px]">Bill #</TableCell>
                  <TableCell className="w-[100px]">Bill %</TableCell>
                  <TableCell className="w-[120px]">Bill Date</TableCell>
                  <TableCell className="w-[120px] text-right">
                    Bill Amount
                  </TableCell>
                  {Array.from(
                    { length: getMaxReceiptsForAccount(account) },
                    (_, i) => (
                      <React.Fragment key={i}>
                        <TableCell className="w-[120px] text-right">
                          Received {i + 1}
                        </TableCell>
                        <TableCell className="w-[120px] text-right">
                          Balance {i + 1}
                        </TableCell>
                      </React.Fragment>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {account.bills.map((bill) => (
                  <TableRow
                    key={`${account.accountId}-${bill.billNumber}-${bill.billDate}`}
                    className="print-row"
                  >
                    <TableCell className="font-medium">
                      {bill.billNumber}
                    </TableCell>
                    <TableCell>
                      {typeof bill.billPercentage === 'number'
                        ? `${bill.billPercentage}%`
                        : bill.billPercentage}
                    </TableCell>
                    <TableCell>
                      {format(new Date(bill.billDate), 'MMM dd, yyyy')}
                    </TableCell>
                    <TableCell className="text-right">
                      {getFormattedCurrency(bill.billAmount)
                        .replace(currency, '')
                        .trim()}
                    </TableCell>
                    {Array.from(
                      { length: getMaxReceiptsForAccount(account) },
                      (_, i) => {
                        const receipt = bill.receipts[i];
                        return (
                          <React.Fragment key={i}>
                            <TableCell className="text-right">
                              {receipt ? (
                                <>
                                  <div className="text-xs text-muted-foreground">
                                    {format(
                                      new Date(receipt.receivedDate),
                                      'MMM dd',
                                    )}
                                  </div>
                                  <div>
                                    {getFormattedCurrency(
                                      receipt.receivedAmount,
                                    )
                                      .replace(currency, '')
                                      .trim()}
                                  </div>
                                </>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {receipt
                                ? getFormattedCurrency(receipt.balance)
                                    .replace(currency, '')
                                    .trim()
                                : '-'}
                            </TableCell>
                          </React.Fragment>
                        );
                      },
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                      {getFormattedCurrency(receipt.receivedAmount)
                        .replace(currency, '')
                        .trim()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
