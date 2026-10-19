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
import { getFormattedCurrency } from 'renderer/lib/utils';

export interface DeleteJournalDialogProps {
  journalId: number;
  narration?: string;
  totalAmount?: number;
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

export const DeleteJournalDialog: React.FC<DeleteJournalDialogProps> = ({
  journalId,
  narration = '',
  totalAmount,
  onSuccess,
  trigger,
}: DeleteJournalDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await window.electron.deleteManualJournal(journalId);
      toast({
        title: 'Journal Deleted',
        description: `Manual Journal #${journalId} was permanently deleted.`,
      });
      setOpen(false);
      onSuccess?.();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete journal';
      toast({
        title: 'Delete Failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="destructive" size="sm">
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Journal
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Delete Manual Journal #{journalId}</DialogTitle>
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
