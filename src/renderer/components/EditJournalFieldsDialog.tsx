import { useState } from 'react';
import { EditActionButton } from '@/renderer/components/EditActionButton';
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
import type { UpdateJournalFields } from '@/types';
import { parseJournalDiscountInput } from '@/lib/journalDiscountLabel';
import { handleAsync } from '../lib/utils';

interface EditJournalFieldsDialogProps {
  journalId: number;
  narration: string;
  billNumber?: number;
  discountPercentage?: number | string;
  onSave: (journalId: number, fields: UpdateJournalFields) => Promise<void>;
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

export const EditJournalFieldsDialog: React.FC<
  EditJournalFieldsDialogProps
> = ({
  journalId,
  narration,
  billNumber,
  discountPercentage,
  onSave,
  trigger,
  open: openProp,
  onOpenChange,
}: EditJournalFieldsDialogProps) => {
  const [openState, setOpenState] = useState(false);
  // controlled when the caller passes `open`, so a menu item can open a
  // dialog that is mounted outside the menu
  const open = openProp ?? openState;
  // a dialog that a menu opens has no trigger of its own: the menu item
  // is the trigger, and a pencil left on the card would be a second,
  // unexplained control next to the ⋮ that opened the menu
  const showTrigger = trigger !== null && openProp === undefined;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [editedNarration, setEditedNarration] = useState(narration);
  const [editedBillNumber, setEditedBillNumber] = useState<string>(
    billNumber?.toString() ?? '',
  );
  const [editedDiscount, setEditedDiscount] = useState<string>(
    discountPercentage?.toString() ?? '',
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setEditedNarration(narration);
      setEditedBillNumber(billNumber?.toString() ?? '');
      setEditedDiscount(discountPercentage?.toString() ?? '');
    }
    setOpen(newOpen);
  };

  const handleReset = () => {
    setEditedNarration(narration);
    setEditedBillNumber(billNumber?.toString() ?? '');
    setEditedDiscount(discountPercentage?.toString() ?? '');
  };

  const handleSave = async () => {
    if (
      editedNarration === narration &&
      editedBillNumber === (billNumber?.toString() ?? '') &&
      editedDiscount === (discountPercentage?.toString() ?? '')
    ) {
      setOpen(false);
      return;
    }

    setIsLoading(true);
    handleAsync(
      () =>
        onSave(journalId, {
          narration: editedNarration,
          billNumber:
            editedBillNumber === ''
              ? undefined
              : Number.parseInt(editedBillNumber, 10),
          discountPercentage: parseJournalDiscountInput(editedDiscount),
        }),
      {
        successMessage: 'Journal updated successfully',
        errorMessage: 'Failed to update journal',
        onFinally: () => setIsLoading(false),
        onSuccess: () => setOpen(false),
        shouldExpectResult: false,
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && editedNarration !== narration) {
        handleSave();
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {showTrigger ? (
        <DialogTrigger asChild>
          {trigger ?? <EditActionButton aria-label="Edit journal fields" />}
        </DialogTrigger>
      ) : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Journal</DialogTitle>
          <DialogDescription>
            these fields are optional and only for reference. they do not affect
            any calculation.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="narration" className="text-right">
              Narration
            </Label>
            <Input
              id="narration"
              value={editedNarration}
              onChange={(e) => setEditedNarration(e.target.value)}
              onKeyDown={handleKeyDown}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="billNumber" className="text-right">
              Bill#
            </Label>
            <Input
              id="billNumber"
              type="number"
              value={editedBillNumber}
              onChange={(e) => setEditedBillNumber(e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="discountPercentage" className="text-right">
              Discount%
            </Label>
            <Input
              id="discountPercentage"
              value={editedDiscount}
              onChange={(e) => setEditedDiscount(e.target.value)}
              className="col-span-3"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleReset} disabled={isLoading}>
            Reset
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
