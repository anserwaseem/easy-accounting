import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'renderer/shad/ui/dialog';
import { Button } from 'renderer/shad/ui/button';
import { RadioGroup, RadioGroupItem } from 'renderer/shad/ui/radio-group';
import { Label } from 'renderer/shad/ui/label';
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
          <div className="flex flex-col gap-3">
            <span className="text-sm text-muted-foreground">
              Choose how to order accounts in the exported file.
            </span>
            <RadioGroup
              value={sortOrder}
              onValueChange={(v) =>
                setSortOrder(v as DebitCreditExportSortOrder)
              }
              className="gap-3"
            >
              <div className="flex items-center space-x-3">
                <RadioGroupItem
                  value="unsorted"
                  id="export-order-unsorted"
                  aria-label="By account type"
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="export-order-unsorted"
                    className="text-sm font-medium cursor-pointer flex flex-col gap-1"
                  >
                    By Account Type
                    <p className="text-xs text-muted-foreground">
                      Groups accounts by type (A-Z), then by code and name.
                    </p>
                  </Label>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <RadioGroupItem
                  value="amount"
                  id="export-order-amount"
                  aria-label="By amount"
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="export-order-amount"
                    className="text-sm font-medium cursor-pointer flex flex-col gap-1"
                  >
                    By Amount (Debits then Credits)
                    <p className="text-xs text-muted-foreground">
                      Lists all debit balances from largest to smallest, then
                      all credit balances from largest to smallest.
                    </p>
                  </Label>
                </div>
              </div>
            </RadioGroup>
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
