import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from 'renderer/shad/ui/dialog';
import type { PrintHelp } from '@/renderer/lib/invoicePrint/mobilePrint';

interface PrintHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  help: PrintHelp;
}

/**
 * Shown when the browser will not print the page for us. Chrome on iOS is
 * the case that matters: it accepts `window.print()` and prints nothing, so
 * the only way out is the browser's own share sheet, and the app cannot open
 * that sheet either. The steps are all the user can do, so they are spelled
 * out.
 */
const PrintHelpDialog: React.FC<PrintHelpDialogProps> = ({
  open,
  onOpenChange,
  help,
}: PrintHelpDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle>{help.title}</DialogTitle>
        <DialogDescription>{help.intro}</DialogDescription>
      </DialogHeader>
      <ol className="list-decimal space-y-2 ps-5 text-sm leading-snug text-foreground">
        {help.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </DialogContent>
  </Dialog>
);

export default PrintHelpDialog;
