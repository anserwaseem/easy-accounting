import type { FC } from 'react';
import { getFormattedCurrency } from 'renderer/lib/utils';
import { currency } from 'renderer/lib/constants';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  TableFooter,
} from 'renderer/shad/ui/table';
import { SortableHeader, LoadingState, EmptyState } from '../components';
import type {
  AverageEquityBalancesState,
  AverageEquityBalanceItem,
  AverageEquitySortField,
} from './types';
import type { SortDirection } from '../components/useSorting';

interface Props {
  items: AverageEquityBalanceItem[];
  totalAverage?: AverageEquityBalancesState['totalAverage'];
  isLoading: boolean;
  sortField: AverageEquitySortField;
  sortDirection: SortDirection;
  onSort: (field: AverageEquitySortField) => void;
  visibleColumns?: ReadonlySet<string>;
}

export const AverageEquityBalancesTable: FC<Props> = ({
  items,
  totalAverage,
  isLoading,
  sortField,
  sortDirection,
  onSort,
  visibleColumns,
}) => {
  const visible = visibleColumns ?? new Set(['code', 'name', 'averageBalance']);
  if (isLoading) {
    return <LoadingState variant="skeleton" skeletonCount={6} />;
  }

  if (items.length === 0) {
    return (
      <EmptyState message="No equity accounts found in the selected range." />
    );
  }

  return (
    <Table className="border-collapse w-full print-table">
      <TableHeader>
        <TableRow className="print-row">
          {visible.has('code') ? (
            <SortableHeader
              currentSortField={sortField}
              sortField="code"
              sortDirection={sortDirection}
              onSort={() => onSort('code')}
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
              onSort={() => onSort('name')}
            >
              Account Name
            </SortableHeader>
          ) : null}
          {visible.has('averageBalance') ? (
            <SortableHeader
              currentSortField={sortField}
              sortField="averageBalance"
              sortDirection={sortDirection}
              onSort={() => onSort('averageBalance')}
              className="w-[320px] text-right"
            >
              Average Balance
            </SortableHeader>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id} className="print-row">
            {visible.has('code') ? (
              <TableCell className="font-mono">{item.code ?? ''}</TableCell>
            ) : null}
            {visible.has('name') ? <TableCell>{item.name}</TableCell> : null}
            {visible.has('averageBalance') ? (
              <TableCell className="text-right">
                {getFormattedCurrency(Math.abs(item.averageBalance))
                  .replace(currency, '')
                  .trim()}{' '}
                {item.averageBalance >= 0 ? 'Cr' : 'Dr'}
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
      {totalAverage != null ? (
        <TableFooter>
          <TableRow className="font-semibold print-row">
            {(() => {
              const labelSpan =
                (visible.has('code') ? 1 : 0) + (visible.has('name') ? 1 : 0);
              if (labelSpan === 0) return null;
              return <TableCell colSpan={labelSpan}>Net Average</TableCell>;
            })()}
            {visible.has('averageBalance') ? (
              <TableCell className="text-right">
                {getFormattedCurrency(Math.abs(totalAverage))
                  .replace(currency, '')
                  .trim()}{' '}
                {totalAverage >= 0 ? 'Cr' : 'Dr'}
              </TableCell>
            ) : null}
          </TableRow>
        </TableFooter>
      ) : null}
    </Table>
  );
};
