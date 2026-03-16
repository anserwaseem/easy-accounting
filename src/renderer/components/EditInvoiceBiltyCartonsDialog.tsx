import { useState } from 'react';
import { PenBox } from 'lucide-react';
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
import { handleAsync } from '../lib/utils';

interface EditInvoiceBiltyCartonsDialogProps {
  invoiceId: number;
  biltyNumber: string | undefined;
  cartons: number | undefined;
  onSave: (
    invoiceId: number,
    biltyNumber: string | undefined,
    cartons: number | undefined,
  ) => Promise<void>;
}

export const EditInvoiceBiltyCartonsDialog: React.FC<
  EditInvoiceBiltyCartonsDialogProps
> = ({
  invoiceId,
  biltyNumber,
  cartons,
  onSave,
}: EditInvoiceBiltyCartonsDialogProps) => {
  const [open, setOpen] = useState(false);
  const [editedBiltyNumber, setEditedBiltyNumber] = useState(
    biltyNumber ?? '',
  );
  const [editedCartons, setEditedCartons] = useState(
    cartons != null ? String(cartons) : '',
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setEditedBiltyNumber(biltyNumber ?? '');
      setEditedCartons(cartons != null ? String(cartons) : '');
    }
    setOpen(newOpen);
  };

  const handleReset = () => {
    setEditedBiltyNumber(biltyNumber ?? '');
    setEditedCartons(cartons != null ? String(cartons) : '');
  };

  const parsedCartons =
    editedCartons.trim() === ''
      ? undefined
      : Number.parseInt(editedCartons, 10);
  const isCartonsValid =
    editedCartons.trim() === '' ||
    (Number.isInteger(parsedCartons) && parsedCartons >= 0);

  const handleSave = async () => {
    const bilty =
      editedBiltyNumber.trim() === '' ? undefined : editedBiltyNumber.trim();
    const cartonsNum =
      editedCartons.trim() === ''
        ? undefined
        : Number.parseInt(editedCartons, 10);
    if (!Number.isInteger(cartonsNum) || cartonsNum < 0) return;
    if (
      bilty === (biltyNumber ?? undefined) &&
      cartonsNum === (cartons ?? undefined)
    ) {
      setOpen(false);
      return;
    }

    setIsLoading(true);
    handleAsync(
      () => onSave(invoiceId, bilty, cartonsNum),
      {
        successMessage: 'Invoice updated successfully',
        errorMessage: 'Failed to update invoice',
        onFinally: () => setIsLoading(false),
        onSuccess: () => setOpen(false),
        shouldExpectResult: false,
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <PenBox size={16} cursor="pointer" className="py-0" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Bilty &amp; Cartons</DialogTitle>
          <DialogDescription>
            these fields are for reference only. they do not affect totals or
            journals.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="biltyNumber" className="text-right">
              Bilty #
            </Label>
            <Input
              id="biltyNumber"
              value={editedBiltyNumber}
              onChange={(e) => setEditedBiltyNumber(e.target.value)}
              className="col-span-3"
              placeholder="Enter bilty number"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="cartons" className="text-right">
              Cartons
            </Label>
            <Input
              id="cartons"
              type="number"
              min={0}
              value={editedCartons}
              onChange={(e) => setEditedCartons(e.target.value)}
              className="col-span-3"
            />
            {!isCartonsValid && editedCartons.trim() !== '' && (
              <p className="col-span-4 text-sm text-destructive">
                Enter a non-negative whole number
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleReset} disabled={isLoading}>
            Reset
          </Button>
          <Button
            onClick={handleSave}
            disabled={isLoading || !isCartonsValid}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
