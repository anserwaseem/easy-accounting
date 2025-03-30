import { ArrowDown, ArrowUp } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { TableHead } from 'renderer/shad/ui/table';
import type { SortDirection } from './useSorting';

interface SortableHeaderProps
  extends ComponentPropsWithoutRef<typeof TableHead> {
  currentSortField: string;
  sortField: string;
  sortDirection: SortDirection;
  onSort: () => void;
  children: ReactNode;
}

export const SortableHeader = ({
  currentSortField,
  sortField,
  sortDirection,
  onSort,
  children,
  className,
  ...rest
}: SortableHeaderProps) => {
  const isCurrentlySorted = currentSortField === sortField;

  const renderSortIcon = () => {
    if (!isCurrentlySorted) return null;

    return sortDirection === 'asc' ? (
      <ArrowUp className="h-4 w-4 inline ml-1" />
    ) : (
      <ArrowDown className="h-4 w-4 inline ml-1" />
    );
  };

  return (
    <TableHead
      className={`cursor-pointer hover:bg-muted/70 ${className || ''}`}
      onClick={onSort}
      {...rest}
    >
      {children} {renderSortIcon()}
    </TableHead>
  );
};
