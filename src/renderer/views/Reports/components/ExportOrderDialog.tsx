import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'renderer/shad/ui/dialog';
import { Button } from 'renderer/shad/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/shad/ui/select';
import type { DebitCreditExportSortOrder } from 'renderer/lib/reportExport';

interface ExportOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (order: DebitCreditExportSortOrder) => void;
  title?: string;
}

export const ExportOrderDialog = ({
  open,
  onOpenChange,
  onConfirm,
  title = 'Export to Excel',
}: ExportOrderDialogProps) => {
  const [sortOrder, setSortOrder] =
    useState<DebitCreditExportSortOrder>('unsorted');

  useEffect(() => {
    if (open) setSortOrder('unsorted');
  }, [open]);

  const handleConfirm = () => {
    onConfirm(sortOrder);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              Export order:
            </span>
            <Select
              value={sortOrder}
              onValueChange={(v) =>
                setSortOrder(v as DebitCreditExportSortOrder)
              }
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unsorted">Unsorted</SelectItem>
                <SelectItem value="debit">Debit first</SelectItem>
                <SelectItem value="credit">Credit first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>Export</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
