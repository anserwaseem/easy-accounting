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
import type {
  DebitCreditExportSortOrder,
  LedgerParticularsExportMode,
} from 'renderer/lib/reportExport';

interface LedgerParticularsExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (mode: LedgerParticularsExportMode) => void;
  title?: string;
}

export const LedgerParticularsExportDialog = ({
  open,
  onOpenChange,
  onConfirm,
  title = 'Export to Excel',
}: LedgerParticularsExportDialogProps) => {
  const [mode, setMode] = useState<LedgerParticularsExportMode>('name');

  useEffect(() => {
    if (open) setMode('name');
  }, [open]);

  const handleConfirm = () => {
    onConfirm(mode);
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
              Choose what to include in the Particulars column.
            </span>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as LedgerParticularsExportMode)}
              className="gap-3"
            >
              <div className="flex items-center space-x-3">
                <RadioGroupItem
                  value="name"
                  id="ledger-particulars-name"
                  aria-label="Account name only"
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="ledger-particulars-name"
                    className="text-sm font-medium cursor-pointer flex flex-col gap-1"
                  >
                    Account name only
                    <p className="text-xs text-muted-foreground">
                      Linked account name, or raw particulars when there is no
                      linked account.
                    </p>
                  </Label>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <RadioGroupItem
                  value="code"
                  id="ledger-particulars-code"
                  aria-label="Account code only"
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="ledger-particulars-code"
                    className="text-sm font-medium cursor-pointer flex flex-col gap-1"
                  >
                    Account code only
                    <p className="text-xs text-muted-foreground">
                      Linked account code; empty when the row has no linked
                      account.
                    </p>
                  </Label>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <RadioGroupItem
                  value="both"
                  id="ledger-particulars-both"
                  aria-label="Name and code"
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="ledger-particulars-both"
                    className="text-sm font-medium cursor-pointer flex flex-col gap-1"
                  >
                    Name and code
                    <p className="text-xs text-muted-foreground">
                      Name with code in parentheses when a code exists.
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
