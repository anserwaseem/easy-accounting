import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/renderer/shad/ui/sheet';
import { cn } from '@/renderer/lib/utils';
import type { VendorStockActivityItem } from 'types';
import {
  ACTIVITY_FILTER_LABELS,
  activityMovementHref,
  activityMovementLabel,
  filterActivityMovements,
  type ActivityMovementFilter,
} from './activityPresentation';

interface VendorStockActivitySheetProps {
  item: VendorStockActivityItem | null;
  filter: ActivityMovementFilter;
  vendorName: string;
  dateSubtitle: string;
  onOpenChange: (open: boolean) => void;
}

const formatDate = (value: string): string => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'PP');
};

export const VendorStockActivitySheet: React.FC<
  VendorStockActivitySheetProps
> = ({
  item,
  filter,
  vendorName,
  dateSubtitle,
  onOpenChange,
}: VendorStockActivitySheetProps) => {
  const movements = item ? filterActivityMovements(item.movements, filter) : [];
  const filterLabel = ACTIVITY_FILTER_LABELS[filter];

  return (
    <Sheet open={item != null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-10">
          <SheetTitle>{item?.inventoryName ?? ''}</SheetTitle>
          <SheetDescription>
            {vendorName}
            {dateSubtitle ? ` · ${dateSubtitle}` : ''}
            {` · ${filterLabel}`}
          </SheetDescription>
        </SheetHeader>
        {item && movements.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {filter === 'all'
              ? `Nothing in this range. Opening ${item.opening.toLocaleString()} was already at the vendor before the start date.`
              : `No ${filterLabel.toLowerCase()} documents in this range.`}
          </p>
        ) : null}
        {item && movements.length > 0 ? (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 text-right font-medium">At vendor</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => {
                const href = activityMovementHref(movement);
                const label = activityMovementLabel(movement);
                return (
                  <tr key={movement.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{formatDate(movement.date)}</td>
                    <td className="py-2 pr-3">
                      {href ? (
                        <Link
                          className="text-primary underline-offset-2 hover:underline"
                          to={href}
                        >
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                    </td>
                    <td
                      className={cn(
                        'py-2 text-right tabular-nums',
                        movement.quantityDelta < 0 && 'text-destructive',
                      )}
                    >
                      {movement.quantityDelta > 0
                        ? `+${movement.quantityDelta}`
                        : movement.quantityDelta}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};
