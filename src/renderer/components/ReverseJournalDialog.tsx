import React, { useState } from 'react';
import { Button } from 'renderer/shad/ui/button';
import { Input } from 'renderer/shad/ui/input';
import { Label } from 'renderer/shad/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'renderer/shad/ui/dialog';
import { RotateCcw } from 'lucide-react';
import { toast } from '@/renderer/shad/ui/use-toast';
import { ipcErrorMessage } from '@/renderer/lib/ipcUserMessage';
import type { Journal } from '@/types';
import { getFormattedCurrency } from 'renderer/lib/utils';
import { AppDateInput } from '@/renderer/components/AppDateInput';
import {
  toLocalDateInputValue,
  toLocalNoonIsoStringFromStored,
} from '@/renderer/lib/localDate';

export interface ReverseJournalDialogProps {
  journalId: number;
  originalNarration?: string;
  totalAmount?: number;
  onSuccess?: (reversalJournal: Journal) => void;
  trigger?: React.ReactNode;
  /**
   * Controlled open state, for a menu item that opens this dialog: the
   * dialog lives outside the menu, so the item cannot use a trigger.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const ReverseJournalDialog: React.FC<ReverseJournalDialogProps> = ({
  journalId,
  originalNarration = '',
  totalAmount,
  onSuccess,
  trigger,
  open: openProp,
  onOpenChange,
}: ReverseJournalDialogProps) => {
  const [openState, setOpenState] = useState(false);
  // controlled when the caller passes `open`, so a menu item can
  // open a dialog that is mounted outside the menu
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [date, setDate] = useState(() => toLocalDateInputValue(new Date()));
  const [narration, setNarration] = useState(
    () =>
      `Reversal of Journal #${journalId}${
        originalNarration ? `: ${originalNarration}` : ''
      }`,
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setDate(toLocalDateInputValue(new Date()));
      setNarration(
        `Reversal of Journal #${journalId}${
          originalNarration ? `: ${originalNarration}` : ''
        }`,
      );
    }
    setOpen(newOpen);
  };

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      const isoDate = toLocalNoonIsoStringFromStored(date);
      const result = await window.electron.reverseJournal(journalId, {
        date: isoDate,
        narration: narration.trim(),
      });
      toast({
        title: 'Journal Reversed',
        description: `Reversal Journal #${result.id} created successfully.`,
      });
      setOpen(false);
      onSuccess?.(result);
    } catch (error: unknown) {
      // the toast layer swaps in the "turned off on this device" wording
      // when the refusal is an advanced control, so the raw message is
      // only used for the other failures
      toast({
        title: 'Reversal Failed',
        description: ipcErrorMessage(error) || 'Failed to reverse journal',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm">
            <RotateCcw className="mr-2 h-4 w-4" />
            Reverse Journal
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Reverse Journal #{journalId}</DialogTitle>
          <DialogDescription>
            This will create a new journal that inverts all debits and credits,
            safely offsetting account balances while preserving the audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-3">
          {totalAmount != null && totalAmount > 0 && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <span className="text-muted-foreground">Reversal Amount: </span>
              <span className="font-semibold text-foreground">
                {getFormattedCurrency(totalAmount)}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor={`reversal-date-${journalId}`}>Reversal Date</Label>
            <AppDateInput
              id={`reversal-date-${journalId}`}
              value={date}
              onChange={setDate}
              disabled={isLoading}
              aria-label="Reversal Date"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`reversal-narration-${journalId}`}>Narration</Label>
            <Input
              id={`reversal-narration-${journalId}`}
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="Reason for reversal"
              disabled={isLoading}
            />
          </div>
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
            onClick={handleConfirm}
            disabled={isLoading || !narration.trim()}
          >
            {isLoading ? 'Reversing...' : 'Confirm Reversal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
