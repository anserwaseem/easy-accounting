/* eslint-disable no-await-in-loop */
import {
  useCompanyProfile,
  useInvoicePrintSettings,
  usePrimaryItemType,
  useTheme,
} from '@/renderer/hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, isValid } from 'date-fns';
import { InvoiceType, type InvoiceView } from 'types';
import { Button } from 'renderer/shad/ui/button';
import { Kbd, KbdGroup } from 'renderer/shad/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'renderer/shad/ui/tooltip';
import { dismissAllToasts, toast } from '@/renderer/shad/ui/use-toast';
import { toWords } from 'number-to-words';
import { toNumber, toString, truncate } from 'lodash';
import {
  computeSectionTotals,
  getPrintBillToPartyName,
  groupInvoiceItemsByType,
} from '@/renderer/lib/invoiceUtils';
import { getFormattedCurrency } from '@/renderer/lib/utils';

const isAppleLikePlatform = () =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** screen preview only; print stays neutral/black ink */
const printPreviewRootClass =
  'min-h-screen bg-white p-8 text-neutral-900 [color-scheme:light] antialiased print:bg-white print:p-0 print:text-black';

/** lock controls to light surfaces so shadcn tokens (bg-background, accent) never go dark-on-dark */
const printToolbarPanelClass =
  'print:hidden mb-4 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-200 dark:bg-white dark:shadow-md';

const printToolbarOutlineBtnClass =
  'border-neutral-300 bg-white text-neutral-900 shadow-sm hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-300 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-50 dark:hover:text-neutral-900';

const printToolbarPrimaryBtnClass =
  'border border-neutral-800 bg-neutral-900 text-white shadow-sm hover:bg-neutral-800 hover:text-white dark:border-neutral-800 dark:bg-neutral-900 dark:text-white dark:hover:bg-neutral-800 dark:hover:text-white';

const printToolbarKbdClass =
  'border-neutral-200 bg-neutral-100 text-neutral-800 dark:border-neutral-200 dark:bg-neutral-100 dark:text-neutral-800';

const printToolbarKbdOnPrimaryClass =
  'border-white/30 bg-white/15 text-white dark:border-white/30 dark:bg-white/15 dark:text-white';

/** sticky batch toasts clear on navigation/print; this caps lifetime if user stays idle */
const BATCH_TOAST_FALLBACK_MS = 45_000;

const PrintableInvoiceScreen = () => {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const { primaryItemTypeName, itemTypeNames } = usePrimaryItemType();
  const [adjacentInvoiceIds, setAdjacentInvoiceIds] = useState<{
    next: number;
    previous: number;
  }>({ next: 0, previous: 0 });
  const [isBatchPrinting, setIsBatchPrinting] = useState(false);
  const [pdfOutputDir, setPdfOutputDir] = useState<string | null>(null);
  const navigate = useNavigate();
  const { profile: companyProfile } = useCompanyProfile();
  const { settings: invoicePrintSettings, defaults } =
    useInvoicePrintSettings();
  const { theme } = useTheme();
  const isDarkAppChrome =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark'));

  const showAppleKbdHints = useMemo(() => isAppleLikePlatform(), []);

  const biltyGoodsText = useMemo(() => {
    if (!invoice) return '';
    const bilty = invoice.biltyNumber ?? '';
    const goods = invoice.accountGoodsName?.trim();
    const goodsShort = goods ? truncate(goods, { length: 30 }).trim() : '';
    return goodsShort ? `${bilty} (${goodsShort})` : `${bilty}`;
  }, [invoice]);

  useEffect(() => {
    let cancelled = false;
    const numericId = toNumber(id);

    const fetchInvoice = async () => {
      const fetchedInvoice = await window.electron.getInvoice(numericId);
      if (cancelled) {
        return;
      }
      setInvoice(fetchedInvoice);

      const invoiceType = fetchedInvoice?.invoiceType;
      if (invoiceType == null) {
        setAdjacentInvoiceIds({ next: 0, previous: 0 });
        return;
      }

      const nextId = await window.electron.getAdjacentInvoiceId(
        numericId,
        invoiceType,
        'next',
      );
      if (cancelled) {
        return;
      }
      const previousId = await window.electron.getAdjacentInvoiceId(
        numericId,
        invoiceType,
        'previous',
      );
      if (cancelled) {
        return;
      }
      setAdjacentInvoiceIds({
        next: toNumber(nextId),
        previous: toNumber(previousId),
      });
    };

    fetchInvoice();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .getOutputDir()
      .then((dir) => {
        if (!cancelled && typeof dir === 'string' && dir.trim().length > 0) {
          setPdfOutputDir(dir.trim());
        }
      })
      .catch(() => {
        /* keep tooltip without path if ipc fails */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // one dismiss per id change (not cleanup+setup, which would duplicate)
  useEffect(() => {
    dismissAllToasts();
  }, [id]);

  // leaving print view does not change `id` again — only unmount runs
  useEffect(() => {
    return () => {
      dismissAllToasts();
    };
  }, []);

  useEffect(() => {
    if (!invoice?.invoiceNumber) {
      return;
    }

    window.onbeforeprint = () => {
      document.title = toString(invoice?.invoiceNumber);
    };

    window.onafterprint = () => {
      document.title = 'Easy Invoicing';
    };
  }, [invoice?.invoiceNumber]);

  const handlePrint = () => {
    dismissAllToasts();
    window.print();
  };

  const handleBatchPrint = async () => {
    try {
      setIsBatchPrinting(true);

      const startId = toNumber(id);
      const invoiceType = invoice?.invoiceType;
      if (invoiceType == null) {
        return;
      }

      const rowIds = await window.electron.getInvoiceIdsFromMinId(
        invoiceType,
        startId,
      );
      const outputDir = await window.electron.getOutputDir();

      if (rowIds.length === 0) {
        toast({
          title: 'No PDFs to save',
          description: 'No invoices of this type from this row onward.',
          variant: 'destructive',
          duration: BATCH_TOAST_FALLBACK_MS,
        });
        return;
      }

      console.log(
        `Starting batch PDF for ${rowIds.length} invoice row(s) from id ${startId} (${invoiceType})…`,
      );

      let successCount = 0;
      let failCount = 0;

      // clear any prior toasts; per-invoice navigation also runs dismiss via useEffect([id])
      dismissAllToasts();

      // allow renderer to fetch invoice before printToPDF snapshots the webview
      const settleMs = 100;

      for (const rowId of rowIds) {
        let label = rowId;
        try {
          const invoiceNumber = await window.electron.doesInvoiceExists(
            rowId,
            invoiceType,
          );

          if (!invoiceNumber) {
            continue;
          }
          label = invoiceNumber;

          navigate(`/invoices/${rowId}/print`);
          // eslint-disable-next-line no-promise-executor-return
          await new Promise((resolve) => setTimeout(resolve, settleMs));

          const result = await window.electron.printToPdf(invoiceNumber);

          if (result.success) {
            successCount++;
          } else {
            failCount++;
            console.error(
              `Failed to generate PDF for invoice ${invoiceNumber}:`,
              result.error,
            );
          }
        } catch (err) {
          failCount++;
          console.error(`Error processing invoice ${label}:`, err);
        }
      }

      toast({
        title: 'Batch processing complete',
        description: `Saved ${successCount} PDF${
          successCount === 1 ? '' : 's'
        }${
          failCount > 0 ? ` (${failCount} failed)` : ''
        }. Folder: ${outputDir}`,
        variant: failCount > 0 ? 'destructive' : 'success',
        duration: BATCH_TOAST_FALLBACK_MS,
      });
    } catch (error: unknown) {
      console.error('Batch processing error:', error);
      toast({
        title: 'Batch PDF failed',
        description: `Failed to process batch: ${
          error instanceof Error ? error.message : error
        }`,
        variant: 'destructive',
        duration: BATCH_TOAST_FALLBACK_MS,
      });
    } finally {
      setIsBatchPrinting(false);
    }
  };

  const routeInvoiceId = toNumber(id);
  const isInvoiceSynced = invoice != null && invoice.id === routeInvoiceId;

  const handleClose = () => {
    if (!invoice || !isInvoiceSynced) {
      dismissAllToasts();
      return;
    }
    const { invoiceType } = invoice;
    const numericId = routeInvoiceId;
    if (invoiceType === InvoiceType.Purchase) {
      navigate(`/purchase/invoices/${numericId}`);
      return;
    }
    if (invoiceType === InvoiceType.Sale) {
      navigate(`/sale/invoices/${numericId}`);
      return;
    }
    navigate('/');
  };

  const handleNext = () => {
    if (adjacentInvoiceIds.next <= 0) {
      return;
    }
    navigate(`/invoices/${adjacentInvoiceIds.next}/print`);
  };

  const handlePrevious = () => {
    if (adjacentInvoiceIds.previous <= 0) {
      return;
    }
    navigate(`/invoices/${adjacentInvoiceIds.previous}/print`);
  };

  const keyboardActionsRef = useRef({
    handlePrint,
    handleClose,
    handleNext,
    handlePrevious,
  });
  keyboardActionsRef.current = {
    handlePrint,
    handleClose,
    handleNext,
    handlePrevious,
  };

  const keyboardGateRef = useRef({
    isBatchPrinting,
    isInvoiceSynced,
    nextId: adjacentInvoiceIds.next,
    previousId: adjacentInvoiceIds.previous,
  });
  keyboardGateRef.current = {
    isBatchPrinting,
    isInvoiceSynced,
    nextId: adjacentInvoiceIds.next,
    previousId: adjacentInvoiceIds.previous,
  };

  // arrow keys, escape (back to invoice), and cmd/ctrl+p — refs keep the listener stable
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const g = keyboardGateRef.current;
      if (g.isBatchPrinting) {
        return;
      }

      const target = e.target as HTMLElement | undefined;
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) {
        return;
      }

      const a = keyboardActionsRef.current;

      if (e.key === 'Escape') {
        if (!g.isInvoiceSynced) {
          return;
        }
        e.preventDefault();
        a.handleClose();
        return;
      }

      if (e.key === 'p' && (e.metaKey || e.ctrlKey)) {
        if (!g.isInvoiceSynced) {
          return;
        }
        e.preventDefault();
        a.handlePrint();
        return;
      }

      if (e.key === 'ArrowRight') {
        if (!g.isInvoiceSynced || g.nextId <= 0) {
          return;
        }
        e.preventDefault();
        a.handleNext();
        return;
      }

      if (e.key === 'ArrowLeft') {
        if (!g.isInvoiceSynced || g.previousId <= 0) {
          return;
        }
        e.preventDefault();
        a.handlePrevious();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const invoiceItems = useMemo(
    () => invoice?.invoiceItems ?? [],
    [invoice?.invoiceItems],
  );
  const billToName = useMemo(() => {
    const name = getPrintBillToPartyName(
      invoice?.accountName,
      itemTypeNames,
      invoice?.invoiceItems,
    );
    return name === '—' ? 'WALK IN CUSTOMER' : name;
  }, [invoice?.accountName, invoice?.invoiceItems, itemTypeNames]);
  const billToAddress = useMemo(() => {
    const raw = invoice?.accountAddress ?? '';
    const address = String(raw).trim();
    return address.length > 0 ? address : '';
  }, [invoice?.accountAddress]);
  const totalQuantity = invoiceItems.reduce(
    (sum, item) => sum + toNumber(item.quantity),
    0,
  );

  const groupedInvoiceItems = useMemo(
    () => groupInvoiceItemsByType(invoiceItems, primaryItemTypeName),
    [invoiceItems, primaryItemTypeName],
  );

  const sectionedRows = useMemo(() => {
    let serialNumber = 0;
    const shouldShowSectionHeaders = groupedInvoiceItems.length > 1;
    return groupedInvoiceItems.flatMap((section) => {
      const itemRows = section.items.map((item) => {
        serialNumber += 1;
        return {
          kind: 'item' as const,
          key: `${section.sectionName}-${item.inventoryId}-${serialNumber}`,
          serialNumber,
          item,
        };
      });

      const {
        totalQuantity: sectionTotalQuantity,
        totalAmount: sectionTotalAmount,
      } = computeSectionTotals(section.items);

      return [
        ...(shouldShowSectionHeaders
          ? [
              {
                kind: 'header' as const,
                key: `${section.sectionName}-header`,
                sectionName: section.sectionName,
              },
            ]
          : []),
        ...itemRows,
        ...(section.items.length > 1
          ? [
              {
                kind: 'subtotal' as const,
                key: `${section.sectionName}-subtotal`,
                totalQuantity: sectionTotalQuantity,
                totalAmount: sectionTotalAmount,
              },
            ]
          : []),
      ];
    });
  }, [groupedInvoiceItems]);

  if (!invoice) {
    return (
      <div
        className={`${printPreviewRootClass} flex items-center justify-center`}
      >
        <p className="text-sm text-neutral-600">Loading…</p>
      </div>
    );
  }

  return (
    <div className={printPreviewRootClass}>
      {isDarkAppChrome ? (
        <div
          className="print:hidden mb-3 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-sm text-amber-950 shadow-sm dark:border-amber-300/50 dark:bg-amber-950/30 dark:text-amber-50"
          role="status"
        >
          Preview uses light paper colors so it matches print. You can keep dark
          theme for the rest of the app.
        </div>
      ) : null}
      <div className={printToolbarPanelClass}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleClose}
              variant="outline"
              className={`min-w-[7.5rem] gap-1.5 px-2 ${printToolbarOutlineBtnClass}`}
              disabled={isBatchPrinting || !isInvoiceSynced}
            >
              Back
              <Kbd className={`hidden sm:inline-flex ${printToolbarKbdClass}`}>
                Esc
              </Kbd>
            </Button>
            <Button
              onClick={handlePrint}
              variant="default"
              className={`min-w-[10.5rem] gap-1.5 px-2 ${printToolbarPrimaryBtnClass}`}
              disabled={isBatchPrinting || !isInvoiceSynced}
            >
              Print
              <KbdGroup className="hidden sm:inline-flex">
                <Kbd className={printToolbarKbdOnPrimaryClass}>
                  {showAppleKbdHints ? '⌘' : 'Ctrl'}
                </Kbd>
                <Kbd className={printToolbarKbdOnPrimaryClass}>P</Kbd>
              </KbdGroup>
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    onClick={handleBatchPrint}
                    variant="default"
                    className={`min-w-[9.5rem] gap-1.5 px-2 ${printToolbarPrimaryBtnClass}`}
                    disabled={isBatchPrinting || !isInvoiceSynced}
                    aria-label={
                      isBatchPrinting
                        ? 'Saving PDFs'
                        : 'Save PDFs for this invoice and every newer invoice'
                    }
                  >
                    {isBatchPrinting ? 'Saving PDFs…' : 'Batch save PDFs'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-[min(22rem,calc(100vw-2rem))] space-y-2 px-3 py-2.5 text-pretty"
                >
                  <p className="text-sm leading-snug text-popover-foreground">
                    Saves PDFs for this invoice and every newer invoice.
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
                      <p className="text-xs italic text-muted-foreground">
                        Path unavailable
                      </p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {isBatchPrinting ? (
              <p className="text-2xl font-semibold text-red-600">
                Please wait until saving finishes.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handlePrevious}
              variant="outline"
              disabled={
                !isInvoiceSynced ||
                adjacentInvoiceIds.previous <= 0 ||
                isBatchPrinting
              }
              className={`min-w-[7.5rem] gap-1.5 px-2 ${printToolbarOutlineBtnClass}`}
            >
              Previous
              <Kbd className={`hidden sm:inline-flex ${printToolbarKbdClass}`}>
                ←
              </Kbd>
            </Button>
            <Button
              onClick={handleNext}
              variant="outline"
              disabled={
                !isInvoiceSynced ||
                adjacentInvoiceIds.next <= 0 ||
                isBatchPrinting
              }
              className={`min-w-[7.5rem] gap-1.5 px-2 ${printToolbarOutlineBtnClass}`}
            >
              Next
              <Kbd className={`hidden sm:inline-flex ${printToolbarKbdClass}`}>
                →
              </Kbd>
            </Button>
          </div>
        </div>
      </div>
      <div
        className={`max-w-4xl mx-auto relative transition-opacity duration-150 print:opacity-100 ${
          isInvoiceSynced ? 'opacity-100' : 'opacity-50'
        }`}
      >
        {!isInvoiceSynced ? (
          <div className="print:hidden pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-white/50 pt-24 backdrop-blur-[1px]">
            <span className="text-sm font-medium text-neutral-700">
              Loading…
            </span>
          </div>
        ) : null}
        <div className="flex justify-between items-center">
          <div className="w-full text-[13px]">
            <h1 className="text-3xl font-bold text-center font-mono">
              {companyProfile.name.trim() ? companyProfile.name : 'INVOICE'}
            </h1>
            {[
              companyProfile.address,
              companyProfile.phone,
              companyProfile.email,
            ]
              .map((v) => v.trim())
              .filter(Boolean)
              .join(' · ') ? (
              <p className="text-center font-mono text-sm">
                {[
                  companyProfile.address,
                  companyProfile.phone,
                  companyProfile.email,
                ]
                  .map((v) => v.trim())
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col">
          <div className="flex justify-between gap-4">
            <div className="flex gap-1 whitespace-nowrap">
              <p>Invoice No:</p>
              <p>{invoice.invoiceNumber}</p>
            </div>
            <div className="flex gap-1 whitespace-nowrap">
              <p>Date:</p>
              <p className="whitespace-nowrap">
                {isValid(new Date(invoice.date))
                  ? format(invoice.date, 'PP')
                  : invoice.date}
              </p>
            </div>
            <div className="flex gap-1 whitespace-nowrap">
              <p>Bilty:</p>
              <p>{biltyGoodsText}</p>
            </div>
            <div className="flex gap-1 whitespace-nowrap">
              <p>Cartons:</p>
              <p>{invoice.cartons ?? ''}</p>
            </div>
          </div>
          <div className="flex gap-1">
            <p className="whitespace-nowrap">Bill To:</p>
            <p className="whitespace-nowrap">{billToName}</p>
            <p className="pl-2">{billToAddress}</p>
          </div>
        </div>

        <table className="w-full mt-2">
          <thead>
            <tr className="border-y-2 border-black">
              <th className="text-left py-2">S.No. </th>
              <th className="py-2">Item Code</th>
              <th className="text-left py-2">Item Description</th>
              <th className="text-right py-2">Issue Qty</th>
              <th className="text-right py-2">Price</th>
              <th className="text-right py-2">Discount</th>
              <th className="text-right py-2 pr-4">Amount</th>
            </tr>
          </thead>
          <tbody>
            {sectionedRows.map((row) => {
              if (row.kind === 'header') {
                return (
                  <tr
                    key={row.key}
                    className="border-b border-gray-300 bg-gray-100"
                  >
                    <td className="py-1 font-semibold" colSpan={7}>
                      {row.sectionName}
                    </td>
                  </tr>
                );
              }

              if (row.kind === 'subtotal') {
                return (
                  <tr
                    key={row.key}
                    className="border-b border-gray-300 bg-gray-50"
                  >
                    <td colSpan={3} />
                    <td className="text-right font-semibold">
                      {row.totalQuantity}
                    </td>
                    <td />
                    <td />
                    <td className="text-right pr-4 font-semibold">
                      {toNumber(row.totalAmount).toFixed(2)}
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={row.key} className="border-b border-gray-300">
                  <td>{row.serialNumber}</td>
                  <td className="text-center">{row.item.inventoryItemName}</td>
                  <td>{row.item.inventoryItemDescription}</td>
                  <td className="text-right">{row.item.quantity}</td>
                  <td className="text-right">
                    {toNumber(row.item.price).toFixed(0)}
                  </td>
                  <td className="text-right">{row.item.discount.toFixed(2)}</td>
                  <td className="text-right pr-4">
                    {toNumber(row.item.discountedPrice).toFixed(2)}
                  </td>
                </tr>
              );
            })}
            <tr className="py-2">
              <td className="italic absolute">
                {invoicePrintSettings.totalQuantityLabel.trim() ||
                  defaults.totalQuantityLabel}
              </td>
              <td />
              <td />
              <td className="text-right">{totalQuantity}</td>
              <td />
              <td />
            </tr>
            {invoice.extraDiscount ? (
              <tr>
                <td>Extra Discount:</td>
                <td />
                <td />
                <td />
                <td />
                <td />
                <td className="pr-4 text-right">
                  {getFormattedCurrency(toNumber(invoice.extraDiscount))}
                </td>
              </tr>
            ) : null}
            <tr>
              <td />
              <td />
              <td />
              <td />
              <td />
              <td />
              <td className="pr-4 font-bold text-right">
                {getFormattedCurrency(toNumber(invoice?.totalAmount))}
              </td>
            </tr>
          </tbody>
        </table>

        <div>
          <div className="flex flex-col w-[75%] -mt-8">
            <h3 className="italic">
              Total: Rs.{' '}
              {toWords(invoice.totalAmount || 0)
                .split(' ')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ')}
            </h3>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintableInvoiceScreen;
