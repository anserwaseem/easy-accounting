import type { FC, ReactNode } from 'react';

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
  description: ReactNode;
  /** primary action (right / main CTA) */
  confirmLabel?: string;
  cancelLabel?: string;
  /** primary button style — use destructive for irreversible data loss */
  confirmVariant?: 'default' | 'destructive' | 'secondary' | 'outline';
  /** optional DialogContent className (e.g. wider save review) */
  contentClassName?: string;
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
  contentClassName,
  onConfirm,
}: ConfirmDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={contentClassName}>
      <DialogHeader className="shrink-0">
        <DialogTitle>{title}</DialogTitle>
        {typeof description === 'string' ? (
          <DialogDescription>{description}</DialogDescription>
        ) : null}
      </DialogHeader>
      {typeof description === 'string' ? null : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden text-sm text-muted-foreground">
          {description}
        </div>
      )}
      <DialogFooter className="shrink-0 gap-2 sm:gap-0">
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
