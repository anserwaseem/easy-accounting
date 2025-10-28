import React, { type FC } from 'react';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  TableFooter,
} from 'renderer/shad/ui/table';
import { getFormattedCurrencyInt, getFixedNumber } from 'renderer/lib/utils';
import type { BillsAging } from './types';
import './PrintStyles.css';

interface BillsAgingPrintTableProps {
  billsAging: BillsAging;
  hideZeroRows?: boolean;
  hideStatus?: boolean;
}

// flat row structure for the Excel-like table
interface BillsAgingRow {
  accountCode?: number | string;
  billNumber: string;
  billDate: string;
  billPercentage: number | string;
  balance: number;
  sortKey?: string;
  daysStatus?: {
    isFullyPaid: boolean;
    days: number;
  };
}

export const BillsAgingPrintTable: FC<BillsAgingPrintTableProps> = ({
  billsAging,
  hideZeroRows = false,
  hideStatus = false,
}) => {
  const { accounts } = billsAging;

  // sort accounts by code (handle both number and string codes)
  const sortedAccounts = [...accounts].sort((a, b) => {
    const codeA = a.accountCode?.toString()?.trim() || '';
    const codeB = b.accountCode?.toString()?.trim() || '';
    return codeA.localeCompare(codeB, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });

  // create flat array of all rows (bills + unallocated receipts) for print
  const allRows: BillsAgingRow[] = [];

  sortedAccounts.forEach((account) => {
    const visibleBills = hideZeroRows
      ? account.bills.filter((b) => getFixedNumber(b.finalBalance, 0) !== 0)
      : account.bills;

    // add bill rows
    visibleBills.forEach((bill) => {
      allRows.push({
        accountCode: account.accountCode,
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
        billNumber: 'Unallocated Receipt',
        billDate: receipt.receivedDate,
        billPercentage: '-',
        balance: -receipt.receivedAmount, // negative because it's a receipt
        sortKey: `${
          account.accountCode?.toString()?.trim() || ''
        }-unallocated-${receipt.receivedDate}`,
      });
    });
  });

  // sort rows by account code, then by date, then by bill number
  allRows.sort((a, b) => {
    if (a.sortKey && b.sortKey) {
      return a.sortKey.localeCompare(b.sortKey, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    }
    return 0;
  });

  // calculate total balance (rounded)
  const totalBalance = getFixedNumber(
    allRows.reduce((sum, row) => sum + row.balance, 0),
    0,
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
            <TableCell className="text-right" style={{ padding: '0.5px 4px' }}>
              Balance
            </TableCell>
            {!hideStatus && <TableCell>Days Status</TableCell>}
            <TableCell className="extra-col ">{/* Extra column */}</TableCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {allRows.map((row) => (
            <TableRow key={`row-${row.sortKey}`}>
              <TableCell>{row.accountCode}</TableCell>
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
                        ? `Cleared in ${row.daysStatus.days} days`
                        : `Overdue by ${row.daysStatus.days} days`}
                    </span>
                  ) : (
                    '-'
                  )}
                </TableCell>
              )}
              <TableCell className="extra-col ">{/* Extra column */}</TableCell>
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
};
