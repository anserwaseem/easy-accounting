import type { FC } from 'react';

import { Button } from 'renderer/shad/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'renderer/shad/ui/dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** primary action (right / main CTA) */
  confirmLabel?: string;
  cancelLabel?: string;
  /** primary button style — use destructive for irreversible data loss */
  confirmVariant?: 'default' | 'destructive' | 'secondary' | 'outline';
  onConfirm: () => void;
}

/** payload for opening a confirm from parent state (no open/onOpenChange) */
export type ConfirmDialogConfig = Omit<
  ConfirmDialogProps,
  'open' | 'onOpenChange'
>;

/**
 * App-wide confirm pattern: same layout as other dialogs (e.g. date confirmation),
 * replaces native `confirm()` for consistent UX and a11y.
 */
export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  confirmVariant = 'default',
  onConfirm,
}: ConfirmDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={confirmVariant}
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
