import React, { type FC, useMemo } from 'react';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  TableFooter,
} from 'renderer/shad/ui/table';
import {
  getFormattedCurrencyInt,
  getFixedNumber,
  formatDaysDuration,
} from 'renderer/lib/utils';
import type { BillsAging, BillsAgingRow } from './types';
import './PrintStyles.css';

interface BillsAgingPrintTableProps {
  billsAging: BillsAging;
  hideZeroRows?: boolean;
  hideStatus?: boolean;
  /** all-parties scope: tag each account row with its agent head */
  showHeadNames?: boolean;
}

export const buildBillsAgingRows = (
  billsAging: BillsAging,
  hideZeroRows = false,
): BillsAgingRow[] => {
  const { accounts } = billsAging;

  // create flat array of all rows (bills + unallocated receipts) for print
  const allRows: BillsAgingRow[] = [];

  accounts.forEach((account) => {
    const visibleBills = hideZeroRows
      ? account.bills.filter((b) => getFixedNumber(b.finalBalance, 0) !== 0)
      : account.bills;

    // add bill rows
    visibleBills.forEach((bill) => {
      allRows.push({
        accountCode: account.accountCode,
        accountName: account.accountName,
        headName: account.headName,
        billNumber: bill.billNumber,
        billDate: bill.billDate,
        billPercentage: bill.billPercentage,
        balance: bill.finalBalance,
        daysStatus: bill.daysStatus,
        sortKey: `${account.accountCode?.toString()?.trim() || ''}-${
          bill.billDate
        }-${bill.billNumber}`,
      });
    });

    // add unallocated receipts
    account.unallocatedReceipts.forEach((receipt) => {
      allRows.push({
        accountCode: account.accountCode,
        accountName: account.accountName,
        headName: account.headName,
        billNumber: 'Unallocated Receipt',
        billDate: receipt.receivedDate,
        billPercentage: '-',
        balance: -receipt.receivedAmount,
        sortKey: `${
          account.accountCode?.toString()?.trim() || ''
        }-unallocated-${receipt.receivedDate}`,
      });
    });
  });

  return allRows;
};

export const BillsAgingPrintTable: FC<BillsAgingPrintTableProps> = React.memo(
  ({
    billsAging,
    hideZeroRows = false,
    hideStatus = false,
    showHeadNames = false,
  }: BillsAgingPrintTableProps) => {
    const allRows = useMemo(
      () => buildBillsAgingRows(billsAging, hideZeroRows),
      [billsAging, hideZeroRows],
    );

    // calculate total balance (rounded)
    const totalBalance = useMemo(
      () =>
        getFixedNumber(
          allRows.reduce((sum, row) => sum + row.balance, 0),
          0,
        ),
      [allRows],
    );

    return (
      <div className="overflow-x-auto">
        <Table
          className="border-collapse bills-aging-print-table"
          style={{ width: 'auto', maxWidth: '100%' }}
        >
          <TableHeader>
            <TableRow>
              <TableCell>Account</TableCell>
              <TableCell>Bill #</TableCell>
              <TableCell>Bill Date</TableCell>
              <TableCell>%</TableCell>
              <TableCell
                className="text-right"
                style={{ padding: '0.5px 4px' }}
              >
                Balance
              </TableCell>
              {!hideStatus && <TableCell>Days Status</TableCell>}
              <TableCell className="extra-col ">{/* Extra column */}</TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allRows.map((row) => (
              <TableRow key={`row-${row.sortKey}`}>
                <TableCell>
                  {row.accountCode}
                  {showHeadNames && row.headName ? ` — ${row.headName}` : ''}
                </TableCell>
                <TableCell>{row.billNumber}</TableCell>
                <TableCell>
                  {format(new Date(row.billDate), 'dd/MM/yy')}
                </TableCell>
                <TableCell>{row.billPercentage}</TableCell>
                <TableCell
                  className="text-right"
                  style={{ padding: '0.5px 4px' }}
                >
                  {getFormattedCurrencyInt(row.balance, {
                    withoutCurrency: true,
                  })}
                </TableCell>
                {!hideStatus && (
                  <TableCell>
                    {row.daysStatus ? (
                      <span>
                        {row.daysStatus.isFullyPaid
                          ? `Cleared in ${formatDaysDuration(
                              row.daysStatus.months,
                              row.daysStatus.remainingDays,
                            )}`
                          : `Overdue by ${formatDaysDuration(
                              row.daysStatus.months,
                              row.daysStatus.remainingDays,
                            )}`}
                      </span>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                )}
                <TableCell className="extra-col ">
                  {/* Extra column */}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="text-right">
                Total Balance:
              </TableCell>
              <TableCell className="text-right">
                {getFormattedCurrencyInt(totalBalance, {
                  withoutCurrency: true,
                })}
              </TableCell>
              {!hideStatus && <TableCell />}
              <TableCell className="extra-col" />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    );
  },
);

export default BillsAgingPrintTable;
