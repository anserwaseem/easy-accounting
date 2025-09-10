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
import {
  useSorting,
  SortableHeader,
  LoadingState,
  EmptyState,
} from '../components';
import type {
  AverageEquityBalancesState,
  AverageEquityBalanceItem,
} from './types';

interface Props {
  data: AverageEquityBalancesState;
  isLoading: boolean;
}

type SortField = 'name' | 'averageBalance' | 'code';

export const AverageEquityBalancesTable: FC<Props> = ({ data, isLoading }) => {
  const { items, totalAverage } = data;

  const { sortField, sortDirection, handleSort, sortItems } = useSorting<
    AverageEquityBalanceItem,
    SortField
  >({
    initialSortField: 'averageBalance',
    initialSortDirection: 'desc',
  });

  if (isLoading) {
    return <LoadingState variant="skeleton" skeletonCount={6} />;
  }

  if (items.length === 0) {
    return (
      <EmptyState message="No equity accounts found in the selected range." />
    );
  }

  const sorted = sortItems(items);

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
          >
            Account Name
          </SortableHeader>
          <SortableHeader
            currentSortField={sortField}
            sortField="averageBalance"
            sortDirection={sortDirection}
            onSort={() => handleSort('averageBalance')}
            className="w-[320px] text-right"
          >
            Average Balance
          </SortableHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((item) => (
          <TableRow key={item.id} className="print-row">
            <TableCell className="font-mono">{item.code ?? ''}</TableCell>
            <TableCell>{item.name}</TableCell>
            <TableCell className="text-right">
              {getFormattedCurrency(Math.abs(item.averageBalance))
                .replace(currency, '')
                .trim()}{' '}
              {item.averageBalance >= 0 ? 'Cr' : 'Dr'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      {totalAverage ? (
        <TableFooter>
          <TableRow className="font-bold print-row">
            <TableCell colSpan={2}>Net Average</TableCell>
            <TableCell className="text-right">
              {getFormattedCurrency(Math.abs(totalAverage))
                .replace(currency, '')
                .trim()}{' '}
              {totalAverage >= 0 ? 'Cr' : 'Dr'}
            </TableCell>
          </TableRow>
        </TableFooter>
      ) : null}
    </Table>
  );
};
