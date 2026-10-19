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
import type { Journal } from '@/types';
import { getFormattedCurrency } from 'renderer/lib/utils';

export interface ReverseJournalDialogProps {
  journalId: number;
  originalNarration?: string;
  totalAmount?: number;
  onSuccess?: (reversalJournal: Journal) => void;
  trigger?: React.ReactNode;
}

export const ReverseJournalDialog: React.FC<ReverseJournalDialogProps> = ({
  journalId,
  originalNarration = '',
  totalAmount,
  onSuccess,
  trigger,
}: ReverseJournalDialogProps) => {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState(
    () =>
      `Reversal of Journal #${journalId}${
        originalNarration ? `: ${originalNarration}` : ''
      }`,
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setDate(new Date().toISOString().slice(0, 10));
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
      const isoDate = new Date(`${date}T12:00:00.000Z`).toISOString();
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
      const message =
        error instanceof Error ? error.message : 'Failed to reverse journal';
      toast({
        title: 'Reversal Failed',
        description: message,
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
            <Input
              id={`reversal-date-${journalId}`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={isLoading}
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
