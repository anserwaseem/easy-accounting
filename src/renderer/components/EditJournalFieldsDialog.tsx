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
import { handleAsync } from '../lib/utils';

interface EditJournalFieldsDialogProps {
  journalId: number;
  narration: string;
  billNumber?: number;
  discountPercentage?: number;
  onSave: (journalId: number, fields: UpdateJournalFields) => Promise<void>;
}

export const EditJournalFieldsDialog: React.FC<
  EditJournalFieldsDialogProps
> = ({
  journalId,
  narration,
  billNumber,
  discountPercentage,
  onSave,
}: EditJournalFieldsDialogProps) => {
  const [open, setOpen] = useState(false);
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
          discountPercentage:
            editedDiscount === ''
              ? undefined
              : Number.parseFloat(editedDiscount),
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
      <DialogTrigger asChild>
        <EditActionButton aria-label="Edit journal fields" />
      </DialogTrigger>
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
              type="number"
              step={0.1}
              min={0}
              max={100}
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
