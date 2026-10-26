import React, { useState } from 'react';
import { Button } from 'renderer/shad/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'renderer/shad/ui/dialog';
import { Trash2 } from 'lucide-react';
import { toast } from '@/renderer/shad/ui/use-toast';
import { ipcErrorMessage } from '@/renderer/lib/ipcUserMessage';
import { getFormattedCurrency } from 'renderer/lib/utils';

export interface DeleteJournalDialogProps {
  journalId: number;
  narration?: string;
  totalAmount?: number;
  onSuccess?: () => void;
  /**
   * What opens the dialog. `null` means "nothing opens it from here" —
   * a menu item opens it instead.
   */
  trigger?: React.ReactNode | null;
  /**
   * Controlled open state, for a menu item that opens this dialog: the
   * dialog lives outside the menu, so the item cannot use a trigger.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const DeleteJournalDialog: React.FC<DeleteJournalDialogProps> = ({
  journalId,
  narration = '',
  totalAmount,
  onSuccess,
  trigger,
  open: openProp,
  onOpenChange,
}: DeleteJournalDialogProps) => {
  const [openState, setOpenState] = useState(false);
  // controlled when the caller passes `open`, so a menu item can
  // open a dialog that is mounted outside the menu
  const open = openProp ?? openState;
  // a dialog that a menu opens has no trigger of its own: the menu item
  // is the trigger, and a button left on the card would be a second,
  // unexplained control next to the ⋮ that opened the menu
  const showTrigger = trigger !== null && openProp === undefined;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await window.electron.deleteManualJournal(journalId);
      toast({
        title: 'Journal Deleted',
        description: 'Manual journal deleted.',
      });
      setOpen(false);
      onSuccess?.();
    } catch (error: unknown) {
      // the toast layer swaps in the "turned off on this device" wording
      // when the refusal is an advanced control, so the raw message is
      // only used for the other failures
      toast({
        title: 'Delete Failed',
        description: ipcErrorMessage(error) || 'Failed to delete journal',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button type="button" variant="destructive" size="sm">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Journal
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Delete manual journal</DialogTitle>
          <DialogDescription>
            Are you sure you want to permanently delete this manual journal? All
            associated journal entries and ledger effects will be removed. This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2 text-sm">
          {totalAmount != null && totalAmount > 0 && (
            <div className="flex justify-between rounded-md bg-muted p-2.5">
              <span className="text-muted-foreground">Amount:</span>
              <span className="font-semibold text-foreground">
                {getFormattedCurrency(totalAmount)}
              </span>
            </div>
          )}
          {narration && (
            <div className="flex justify-between rounded-md bg-muted p-2.5">
              <span className="text-muted-foreground">Narration:</span>
              <span className="font-medium text-foreground">{narration}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Deleting...' : 'Delete Journal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
