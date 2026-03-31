import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'renderer/shad/ui/dialog';

interface DateConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUseCurrentDate: () => void;
}

export const DateConfirmationDialog: React.FC<DateConfirmationDialogProps> = ({
  open,
  onOpenChange,
  onUseCurrentDate,
}: DateConfirmationDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Confirm date</DialogTitle>
        <DialogDescription>
          You are using today&apos;s date ({format(new Date(), 'PPP')}). Would
          you like to proceed with this date or set a different one?
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="sm:justify-between">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Change date
        </Button>
        <Button
          onClick={() => {
            onOpenChange(false);
            onUseCurrentDate();
          }}
        >
          Use current date
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
