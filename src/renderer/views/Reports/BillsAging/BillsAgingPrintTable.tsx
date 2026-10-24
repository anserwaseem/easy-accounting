import React, { type FC, useMemo } from 'react';
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
import { formatJournalDiscountLabel } from '@/lib/journalDiscountLabel';
import { formatDisplayDate } from '@/lib/displayDate';
import type { BillsAging, BillsAgingRow } from './types';
import './PrintStyles.css';

interface BillsAgingPrintTableProps {
  billsAging: BillsAging;
  hideZeroRows?: boolean;
  hideStatus?: boolean;
  /** all-parties scope: tag each account row with its agent head */
  showHeadNames?: boolean;
  /** visible column ids; defaults to every column when omitted */
  visibleColumns?: ReadonlySet<string>;
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
    visibleColumns: visibleColumnsOption,
  }: BillsAgingPrintTableProps) => {
    const allRows = useMemo(
      () => buildBillsAgingRows(billsAging, hideZeroRows),
      [billsAging, hideZeroRows],
    );

    const visibleColumns =
      visibleColumnsOption ??
      new Set([
        'accountCode',
        'billNumber',
        'billDate',
        'billPercentage',
        'balance',
        'daysStatus',
      ]);
    const vc = (id: string): boolean => visibleColumns.has(id);
    const showDaysStatus = !hideStatus && vc('daysStatus');

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
              {vc('accountCode') && <TableCell>Account</TableCell>}
              {vc('billNumber') && <TableCell>Bill #</TableCell>}
              {vc('billDate') && <TableCell>Bill Date</TableCell>}
              {vc('billPercentage') && <TableCell>%</TableCell>}
              {vc('balance') && (
                <TableCell
                  className="text-right"
                  style={{ padding: '0.5px 4px' }}
                >
                  Balance
                </TableCell>
              )}
              {showDaysStatus && <TableCell>Days Status</TableCell>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {allRows.map((row) => (
              <TableRow key={`row-${row.sortKey}`}>
                {vc('accountCode') && (
                  <TableCell>
                    {row.accountCode}
                    {showHeadNames && row.headName ? ` — ${row.headName}` : ''}
                  </TableCell>
                )}
                {vc('billNumber') && <TableCell>{row.billNumber}</TableCell>}
                {vc('billDate') && (
                  <TableCell>{formatDisplayDate(row.billDate)}</TableCell>
                )}
                {vc('billPercentage') && (
                  <TableCell>
                    {formatJournalDiscountLabel(row.billPercentage)}
                  </TableCell>
                )}
                {vc('balance') && (
                  <TableCell
                    className="text-right"
                    style={{ padding: '0.5px 4px' }}
                  >
                    {getFormattedCurrencyInt(row.balance, {
                      withoutCurrency: true,
                    })}
                  </TableCell>
                )}
                {showDaysStatus && (
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
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell
                colSpan={Math.max(
                  1,
                  (vc('accountCode') ? 1 : 0) +
                    (vc('billNumber') ? 1 : 0) +
                    (vc('billDate') ? 1 : 0) +
                    (vc('billPercentage') ? 1 : 0),
                )}
                className="text-right"
              >
                Total Balance:
              </TableCell>
              {vc('balance') && (
                <TableCell className="text-right">
                  {getFormattedCurrencyInt(totalBalance, {
                    withoutCurrency: true,
                  })}
                </TableCell>
              )}
              {showDaysStatus && <TableCell />}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    );
  },
);

export default BillsAgingPrintTable;
