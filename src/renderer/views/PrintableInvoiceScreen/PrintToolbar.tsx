import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  EllipsisVertical,
  FileText,
  Printer,
} from 'lucide-react';
import { Button } from 'renderer/shad/ui/button';
import { Kbd, KbdGroup, getOsModifierLabel } from 'renderer/shad/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'renderer/shad/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from 'renderer/shad/ui/dialog';
import { RadioGroup, RadioGroupItem } from 'renderer/shad/ui/radio-group';
import { Label } from 'renderer/shad/ui/label';
import { useIsMobile } from '@/renderer/hooks/useIsMobile';
import type { InvoicePrintLocale } from '@/renderer/lib/invoicePrint/locale';

/** lock controls to light surfaces so shadcn tokens (bg-background, accent) never go dark-on-dark */
const printToolbarPanelClass =
  'print:hidden mb-4 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-200 dark:bg-white dark:shadow-md';

const printToolbarOutlineBtnClass =
  'border-neutral-300 bg-white text-neutral-900 shadow-sm hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-300 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-50 dark:hover:text-neutral-900';

const printToolbarPrimaryBtnClass =
  'border border-neutral-800 bg-neutral-900 text-white shadow-sm hover:bg-neutral-800 hover:text-white dark:border-neutral-800 dark:bg-neutral-900 dark:text-white dark:hover:bg-neutral-800 dark:hover:text-neutral-900';

const printToolbarKbdClass =
  'border-neutral-200 bg-neutral-100 text-neutral-800 dark:border-neutral-200 dark:bg-neutral-100 dark:text-neutral-800';

const printToolbarKbdOnPrimaryClass =
  'border-white/30 bg-white/15 text-white dark:border-white/30 dark:bg-white/15 dark:text-white';

export interface PrintSessionOptionsState {
  locale: InvoicePrintLocale;
  showPartyBalances: boolean;
  showAgent: boolean;
  showBillBalance: boolean;
  showPrintNote: boolean;
  /** true when any of the above overrides the saved settings for this print only */
  isOverride: boolean;
}

export interface PrintToolbarProps {
  isInvoiceSynced: boolean;
  isBatchPrinting: boolean;
  isOpeningPdf: boolean;
  /** desktop only: the OS can write a PDF file, so the file buttons are real */
  canPrintToFile: boolean;
  isQuotation: boolean;
  /** there is an older invoice of the same kind to walk back to */
  canGoPrevious: boolean;
  /** there is a newer invoice of the same kind to walk forward to */
  canGoNext: boolean;
  pdfOutputDir: string | null;
  batchSavePdfAriaLabel: string;
  options: PrintSessionOptionsState;
  onPrint: () => void;
  onOpenPdf: () => void;
  onBatchPrint: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onLocaleChange: (value: InvoicePrintLocale) => void;
  onShowPartyBalancesChange: (value: boolean) => void;
  onShowAgentChange: (value: boolean) => void;
  onShowBillBalanceChange: (value: boolean) => void;
  onShowPrintNoteChange: (value: boolean) => void;
  /** the one-line platform reminder under the print button */
  printHint?: string | null;
}

interface PrintSessionChoiceRowProps {
  label: string;
  value: string;
  disabled: boolean;
  options: Array<{ id: string; value: string; caption: string }>;
  onValueChange: (value: string) => void;
}

const PrintSessionChoiceRow: React.FC<PrintSessionChoiceRowProps> = ({
  label,
  value,
  disabled,
  options,
  onValueChange,
}: PrintSessionChoiceRowProps) => (
  <div className="flex items-center gap-2">
    <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-neutral-500 shrink-0">
      {label}
    </span>
    <RadioGroup
      value={value}
      onValueChange={onValueChange}
      className="flex flex-row items-center gap-2.5"
      disabled={disabled}
    >
      {options.map((option: { id: string; value: string; caption: string }) => (
        <div className="flex items-center gap-1.5" key={option.value}>
          <RadioGroupItem value={option.value} id={option.id} />
          <Label
            htmlFor={option.id}
            className="text-xs font-normal cursor-pointer"
          >
            {option.caption}
          </Label>
        </div>
      ))}
    </RadioGroup>
  </div>
);

const PrintToolbar: React.FC<PrintToolbarProps> = ({
  isInvoiceSynced,
  isBatchPrinting,
  isOpeningPdf,
  canPrintToFile,
  isQuotation,
  canGoPrevious,
  canGoNext,
  pdfOutputDir,
  batchSavePdfAriaLabel,
  options,
  onPrint,
  onOpenPdf,
  onBatchPrint,
  onPrevious,
  onNext,
  onClose,
  onLocaleChange,
  onShowPartyBalancesChange,
  onShowAgentChange,
  onShowBillBalanceChange,
  onShowPrintNoteChange,
  printHint,
}: PrintToolbarProps) => {
  const isMobile = useIsMobile();
  const [moreOpen, setMoreOpen] = useState(false);

  const hasPrevious = isInvoiceSynced && canGoPrevious && !isBatchPrinting;
  const hasNext = isInvoiceSynced && canGoNext && !isBatchPrinting;

  // the option groups, shared by the desktop toolbar row and the phone sheet
  const sessionOptionRows = (
    <>
      <PrintSessionChoiceRow
        label="Language"
        value={options.locale}
        disabled={isBatchPrinting}
        onValueChange={(v) => onLocaleChange(v as InvoicePrintLocale)}
        options={[
          {
            id: 'printSessionLocaleEn',
            value: 'en',
            caption: 'EN',
          },
          {
            id: 'printSessionLocaleUr',
            value: 'ur',
            caption: 'اردو',
          },
        ]}
      />
      <PrintSessionChoiceRow
        label="Balances"
        value={options.showPartyBalances ? 'on' : 'off'}
        disabled={isBatchPrinting}
        onValueChange={(v) => onShowPartyBalancesChange(v === 'on')}
        options={[
          {
            id: 'printSessionBalancesOn',
            value: 'on',
            caption: 'Show',
          },
          {
            id: 'printSessionBalancesOff',
            value: 'off',
            caption: 'Hide',
          },
        ]}
      />
      <PrintSessionChoiceRow
        label="Agent"
        value={options.showAgent ? 'on' : 'off'}
        disabled={isBatchPrinting}
        onValueChange={(v) => onShowAgentChange(v === 'on')}
        options={[
          {
            id: 'printSessionAgentOn',
            value: 'on',
            caption: 'Show',
          },
          {
            id: 'printSessionAgentOff',
            value: 'off',
            caption: 'Hide',
          },
        ]}
      />
      <PrintSessionChoiceRow
        label="Credit"
        value={options.showBillBalance ? 'on' : 'off'}
        disabled={isBatchPrinting}
        onValueChange={(v) => onShowBillBalanceChange(v === 'on')}
        options={[
          {
            id: 'printSessionBillBalanceOn',
            value: 'on',
            caption: 'Show',
          },
          {
            id: 'printSessionBillBalanceOff',
            value: 'off',
            caption: 'Hide',
          },
        ]}
      />
      <PrintSessionChoiceRow
        label="Note"
        value={options.showPrintNote ? 'on' : 'off'}
        disabled={isBatchPrinting}
        onValueChange={(v) => onShowPrintNoteChange(v === 'on')}
        options={[
          {
            id: 'printSessionNoteOn',
            value: 'on',
            caption: 'Show',
          },
          {
            id: 'printSessionNoteOff',
            value: 'off',
            caption: 'Hide',
          },
        ]}
      />
      {options.isOverride ? (
        <span className="text-[0.6875rem] text-muted-foreground whitespace-nowrap">
          This print only
        </span>
      ) : null}
    </>
  );

  // ─── phone ───────────────────────────────────────────────────────────────
  // The desktop toolbar is a row of wide buttons: back, print, open PDF,
  // batch save, previous, next, plus five option groups. On a 390px screen
  // that row is a wall of text. The phone gets one primary action (print),
  // one way back, and everything else behind a sheet.
  if (isMobile) {
    return (
      <div dir="ltr" className={printToolbarPanelClass}>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button
              onClick={onClose}
              variant="outline"
              size="icon"
              className="shrink-0"
              disabled={isBatchPrinting || !isInvoiceSynced}
              aria-label="Back"
              title="Back"
            >
              <ChevronLeft size={18} aria-hidden />
            </Button>
            <Button
              type="button"
              onClick={onPrint}
              variant="default"
              className={`flex-1 gap-2 px-3 ${printToolbarPrimaryBtnClass}`}
              disabled={isBatchPrinting || isOpeningPdf || !isInvoiceSynced}
            >
              <Printer size={16} className="shrink-0" aria-hidden />
              Print
            </Button>
            <Button
              type="button"
              onClick={() => setMoreOpen(true)}
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label="More print options"
              title="More print options"
            >
              <EllipsisVertical size={18} aria-hidden />
            </Button>
          </div>
          {printHint ? (
            <p className="text-xs leading-snug text-neutral-600">{printHint}</p>
          ) : null}
        </div>
        <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Print options</DialogTitle>
              <DialogDescription>
                These apply to this print only.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onPrevious();
                  }}
                  variant="outline"
                  className={`flex-1 gap-1.5 px-2 ${printToolbarOutlineBtnClass}`}
                  disabled={!hasPrevious}
                >
                  <ChevronLeft size={16} aria-hidden />
                  Previous
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onNext();
                  }}
                  variant="outline"
                  className={`flex-1 gap-1.5 px-2 ${printToolbarOutlineBtnClass}`}
                  disabled={!hasNext}
                >
                  Next
                  <ChevronRight size={16} aria-hidden />
                </Button>
              </div>
              <div className="flex flex-col gap-3">{sessionOptionRows}</div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ─── desktop ─────────────────────────────────────────────────────────────
  return (
    <div dir="ltr" className={printToolbarPanelClass}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={onClose}
            variant="outline"
            className={`min-w-[7.5rem] gap-1.5 px-2 ${printToolbarOutlineBtnClass}`}
            disabled={isBatchPrinting || !isInvoiceSynced}
          >
            Back
            <Kbd className={`hidden sm:inline-flex ${printToolbarKbdClass}`}>
              Esc
            </Kbd>
          </Button>
          <div className="flex items-center gap-1.5">
            <Button
              onClick={onPrint}
              variant="default"
              className={`min-w-[10.5rem] gap-1.5 px-2 ${printToolbarPrimaryBtnClass}`}
              disabled={isBatchPrinting || isOpeningPdf || !isInvoiceSynced}
              title="No page numbers (1/N). Use Open PDF for stamped pages."
            >
              Print
              <KbdGroup className="hidden sm:inline-flex">
                <Kbd className={printToolbarKbdOnPrimaryClass}>
                  {getOsModifierLabel()}
                </Kbd>
                <Kbd className={printToolbarKbdOnPrimaryClass}>P</Kbd>
              </KbdGroup>
            </Button>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-neutral-400"
              aria-hidden
            />
            {canPrintToFile ? (
              <Button
                type="button"
                onClick={onOpenPdf}
                variant="outline"
                className={`min-w-[9rem] gap-1.5 px-2 ${printToolbarOutlineBtnClass}`}
                disabled={isBatchPrinting || isOpeningPdf || !isInvoiceSynced}
                aria-label="Open page-stamped PDF"
                title="Opens a page-stamped PDF (1/N) in Preview. Print from
                      there."
              >
                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {isOpeningPdf ? 'Opening…' : 'Open PDF'}
              </Button>
            ) : null}
          </div>
          {canPrintToFile ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    onClick={onBatchPrint}
                    variant="default"
                    className={`min-w-[9.5rem] gap-1.5 px-2 ${printToolbarPrimaryBtnClass}`}
                    disabled={isBatchPrinting || !isInvoiceSynced}
                    aria-label={batchSavePdfAriaLabel}
                  >
                    {isBatchPrinting ? 'Saving PDFs…' : 'Batch save PDFs'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-[min(22rem,calc(100vw-2rem))] space-y-2 px-3 py-2.5 text-pretty"
                >
                  <p className="text-sm leading-snug text-popover-foreground">
                    {isQuotation
                      ? 'Saves PDFs for this quotation and every newer quotation.'
                      : 'Saves PDFs for this invoice and every newer invoice.'}
                  </p>
                  <div className="border-t border-border pt-2">
                    <p className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                      Output folder
                    </p>
                    {pdfOutputDir ? (
                      <code className="block w-full max-w-full break-all rounded-md border border-neutral-200 bg-neutral-100 px-2 py-1.5 font-mono text-[0.75rem] leading-relaxed text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100">
                        {pdfOutputDir}
                      </code>
                    ) : (
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          {isBatchPrinting ? (
            <p className="text-sm font-semibold text-red-600">
              Please wait until saving finishes.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 ms-auto">
            <Button
              onClick={onPrevious}
              variant="outline"
              disabled={!hasPrevious}
              className={`min-w-[7.5rem] gap-1.5 px-2 ${printToolbarOutlineBtnClass}`}
            >
              Previous
              <Kbd className={`hidden sm:inline-flex ${printToolbarKbdClass}`}>
                ←
              </Kbd>
            </Button>
            <Button
              onClick={onNext}
              variant="outline"
              disabled={!hasNext}
              className={`min-w-[7.5rem] gap-1.5 px-2 ${printToolbarOutlineBtnClass}`}
            >
              Next
              <Kbd className={`hidden sm:inline-flex ${printToolbarKbdClass}`}>
                →
              </Kbd>
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-neutral-200 pt-2">
          {sessionOptionRows}
        </div>
      </div>
    </div>
  );
};

export default PrintToolbar;
