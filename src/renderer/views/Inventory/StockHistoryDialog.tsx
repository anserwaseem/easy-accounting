import { useEffect, useMemo, useState } from 'react';
import { isEmpty, orderBy, toString } from 'lodash';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/renderer/shad/ui/dialog';
import { toast } from '@/renderer/shad/ui/use-toast';
import type {
  InventoryItem,
  InventoryOpeningStock,
  StockAdjustment,
} from '@/types';

type StockHistoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItem | null;
};

export const StockHistoryDialog: React.FC<StockHistoryDialogProps> = ({
  open,
  onOpenChange,
  item,
}: StockHistoryDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [openingStockRow, setOpeningStockRow] =
    useState<InventoryOpeningStock | null>(null);

  useEffect(() => {
    if (!open || !item) return;

    const run = async () => {
      try {
        setLoading(true);
        const [rows, openingRows] = await Promise.all([
          window.electron.getStockAdjustments(item.id),
          window.electron.getOpeningStock(),
        ]);

        setAdjustments(orderBy(rows, ['date', 'id'], ['desc', 'desc']));

        const opening =
          openingRows.find((r) => r.inventoryId === item.id) ?? null;
        setOpeningStockRow(opening);
      } catch (e) {
        toast({
          description: toString(e),
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [open, item]);

  const rows = useMemo(() => {
    if (!item) return [];

    const mapped = adjustments.map((a) => ({
      key: `adj-${a.id}`,
      type: 'adjustment' as const,
      date: a.date,
      delta: a.quantityDelta,
      reason: a.reason ?? '',
    }));

    const opening =
      openingStockRow == null
        ? []
        : [
            {
              key: `opening-${openingStockRow.inventoryId}`,
              type: 'opening' as const,
              date: openingStockRow.asOfDate ?? '',
              quantity: openingStockRow.quantity,
              oldQuantity: openingStockRow.old_quantity ?? null,
            },
          ];

    return orderBy([...opening, ...mapped], [(r) => r.date || ''], ['desc']);
  }, [adjustments, openingStockRow, item]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Stock history{item ? `: ${item.name}` : ''}</DialogTitle>
        </DialogHeader>

        {loading && (
          <p className="text-sm text-muted-foreground">Loading history...</p>
        )}

        {!loading && !item && (
          <p className="text-sm text-muted-foreground">No item selected.</p>
        )}

        {!loading && item && isEmpty(rows) && (
          <p className="text-sm text-muted-foreground">
            No opening stock or adjustments found for this item yet.
          </p>
        )}

        {!loading && item && !isEmpty(rows) && (
          <div className="mt-2 max-h-[80vh] space-y-2 overflow-y-auto">
            {rows.map((r) => {
              if (r.type === 'opening') {
                return (
                  <div
                    key={r.key}
                    className="rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Opening stock</span>
                      <span className="text-muted-foreground">
                        {r.date || '—'}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-muted-foreground">Quantity</span>
                      <span className="font-medium">{r.quantity}</span>
                    </div>
                    {r.oldQuantity != null && (
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Previous quantity
                        </span>
                        <span>{r.oldQuantity}</span>
                      </div>
                    )}
                  </div>
                );
              }

              const deltaText = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
              const deltaClass =
                r.delta > 0 ? 'text-emerald-600' : 'text-rose-600';

              return (
                <div
                  key={r.key}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Adjustment</span>
                    <span className="text-muted-foreground">
                      {r.date || '—'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Delta</span>
                    <span className={`font-medium ${deltaClass}`}>
                      {deltaText}
                    </span>
                  </div>
                  {r.reason?.trim() && (
                    <div className="mt-1 flex items-start justify-between gap-4">
                      <span className="text-muted-foreground">Reason</span>
                      <span className="text-right">{r.reason}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
