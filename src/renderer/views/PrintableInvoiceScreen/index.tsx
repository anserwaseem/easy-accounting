/* eslint-disable no-await-in-loop */
import {
  useCompanyProfile,
  useInvoicePrintSettings,
  usePrimaryItemType,
  useTheme,
} from '@/renderer/hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { InvoiceType, type InvoiceView } from 'types';
import { Button } from 'renderer/shad/ui/button';
import { getOsModifierLabel, Kbd, KbdGroup } from 'renderer/shad/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'renderer/shad/ui/tooltip';
import { dismissAllToasts, toast } from '@/renderer/shad/ui/use-toast';
import { toWords } from 'number-to-words';
import { toNumber, truncate } from 'lodash';
import {
  computeSectionTotals,
  getPrintBillToPartyName,
  getQuotationDisplayNumber,
  groupInvoiceItemsByType,
} from '@/renderer/lib/invoiceUtils';
import { getInvoiceDocumentBaseName } from '@/lib/invoiceDocumentName';
import { amountInWordsUrdu } from '@/lib/amountInWordsUrdu';
import { getFormattedCurrency } from '@/renderer/lib/utils';
import type { InvoicePrintLocale } from '@/renderer/lib/invoicePrint/locale';
import {
  formatInvoicePrintDate,
  getInvoicePrintDateParts,
  getInvoicePrintLabels,
  pickPrintLocalizedText,
  waitForInvoicePrintFonts,
} from '@/renderer/lib/invoicePrint/locale';
import { getInvoicePrintReadinessGaps } from '@/renderer/lib/invoicePrint/readiness';
import { RadioGroup, RadioGroupItem } from 'renderer/shad/ui/radio-group';
import { Label } from 'renderer/shad/ui/label';
import nastaliqFontUrl from '../../fonts/NotoNastaliqUrdu-Regular.ttf';

/** screen preview only; print stays neutral/black ink */
const printPreviewRootClass =
  'min-h-screen bg-white p-8 text-neutral-900 [color-scheme:light] antialiased print:bg-white print:ps-8 print:pe-0 print:pt-0 print:pb-0 print:text-black';

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

/** Nastaliq only on Urdu chrome — never on SKUs/numbers (EN visual parity) */
const urduChromeClass = "font-['Noto_Nastaliq_Urdu',serif]";
/** force latin metrics so table data matches EN print */
const printLatinClass = 'font-sans';

/** sticky batch toasts clear on navigation/print; this caps lifetime if user stays idle */
const BATCH_TOAST_FALLBACK_MS = 45_000;

const normalizePdfOutputDir = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const fetchPdfOutputDir = (): Promise<string | null> =>
  window.electron
    .getOutputDir()
    .then(normalizePdfOutputDir)
    .catch(() => null);

/** print dialog's suggested filename; same stem the batch PDF save writes */
const getPrintDocumentTitleBase = (inv: InvoiceView): string =>
  getInvoiceDocumentBaseName({
    invoiceType: inv.invoiceType,
    invoiceNumber: inv.invoiceNumber,
    isQuotation: Boolean(inv.isQuotation),
  });

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
  const { settings: invoicePrintSettings } = useInvoicePrintSettings();
  // null = follow Settings; set to override for this print session only
  const [sessionLocale, setSessionLocale] = useState<InvoicePrintLocale | null>(
    null,
  );
  const effectiveLocale = sessionLocale ?? invoicePrintSettings.locale;
  const isUrdu = effectiveLocale === 'ur';
  const labels = useMemo(
    () =>
      getInvoicePrintLabels(
        effectiveLocale,
        invoicePrintSettings.urduLabelOverrides,
      ),
    [effectiveLocale, invoicePrintSettings.urduLabelOverrides],
  );
  const { theme } = useTheme();
  const isDarkAppChrome =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark'));

  const biltyGoods = useMemo(() => {
    if (!invoice) return { bilty: '', goodsShort: '' };
    const bilty = invoice.biltyNumber ?? '';
    const goods = pickPrintLocalizedText(
      invoice.accountGoodsName,
      invoice.accountGoodsNameUrdu,
      effectiveLocale,
    );
    const goodsShort = goods ? truncate(goods, { length: 30 }).trim() : '';
    return { bilty, goodsShort };
  }, [invoice, effectiveLocale]);

  const biltyGoodsText = biltyGoods.goodsShort
    ? `${biltyGoods.bilty} (${biltyGoods.goodsShort})`
    : biltyGoods.bilty;

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

      const adjacentScope = fetchedInvoice?.isQuotation
        ? 'quotation'
        : 'posted';

      const nextId = await window.electron.getAdjacentInvoiceId(
        numericId,
        invoiceType,
        'next',
        adjacentScope,
      );
      if (cancelled) {
        return;
      }
      const previousId = await window.electron.getAdjacentInvoiceId(
        numericId,
        invoiceType,
        'previous',
        adjacentScope,
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
    fetchPdfOutputDir()
      .then((dir) => {
        if (!cancelled && dir != null) {
          setPdfOutputDir(dir);
        }
      })
      .catch(() => {});
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
    if (!invoice) {
      return;
    }

    const titleBase = getPrintDocumentTitleBase(invoice);

    if (!titleBase) {
      return;
    }

    window.onbeforeprint = () => {
      document.title = titleBase;
    };

    window.onafterprint = () => {
      document.title = 'Easy Invoicing';
    };
  }, [invoice]);

  const handlePrint = async () => {
    dismissAllToasts();
    await waitForInvoicePrintFonts(effectiveLocale);
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

      const batchScope = invoice?.isQuotation ? 'quotation' : 'posted';

      const rowIds = await window.electron.getInvoiceIdsFromMinId(
        invoiceType,
        startId,
        batchScope,
      );

      if (rowIds.length === 0) {
        toast({
          title: 'No PDFs to save',
          description:
            batchScope === 'quotation'
              ? 'No quotations of this type from this row onward.'
              : 'No invoices of this type from this row onward.',
          variant: 'destructive',
          duration: BATCH_TOAST_FALLBACK_MS,
        });
        return;
      }

      console.log(
        `Starting batch PDF for ${rowIds.length} row(s) from id ${startId} (${invoiceType}, ${batchScope})…`,
      );

      let successCount = 0;
      let failCount = 0;

      // clear any prior toasts; per-invoice navigation also runs dismiss via useEffect([id])
      dismissAllToasts();

      // short settle for React paint after navigate; fonts awaited separately
      const settleMs = 75;

      for (const rowId of rowIds) {
        let label: string | number = rowId;
        try {
          const pdfBase = await window.electron.getInvoicePdfOutputBaseName(
            rowId,
            invoiceType,
          );

          if (!pdfBase) {
            continue;
          }
          label = pdfBase;

          navigate(`/invoices/${rowId}/print`);
          // eslint-disable-next-line no-promise-executor-return
          await new Promise((resolve) => setTimeout(resolve, settleMs));
          await waitForInvoicePrintFonts(effectiveLocale);

          const result = await window.electron.printToPdf(pdfBase);

          if (result.success) {
            successCount++;
          } else {
            failCount++;
            console.error(
              `Failed to generate PDF for ${pdfBase}:`,
              result.error,
            );
          }
        } catch (err) {
          failCount++;
          console.error(`Error processing invoice ${label}:`, err);
        }
      }

      const folderForToast =
        pdfOutputDir ?? (await fetchPdfOutputDir()) ?? 'NO OUTPUT FOLDER';

      toast({
        title: 'Batch processing complete',
        description: `Saved ${successCount} PDF${
          successCount === 1 ? '' : 's'
        }${
          failCount > 0 ? ` (${failCount} failed)` : ''
        }. Folder: ${folderForToast}`,
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
  const isPurchase = invoice?.invoiceType === InvoiceType.Purchase;

  // purchases name the supplier the goods came from, not a bill-to customer
  const partyLabel = isPurchase ? labels.vendor : labels.billTo;

  const billToName = useMemo(() => {
    const name = getPrintBillToPartyName(
      invoice?.accountName,
      itemTypeNames,
      invoice?.invoiceItems,
      {
        preferUrdu: isUrdu,
        headerAccountNameUrdu: invoice?.accountNameUrdu,
      },
    );
    // an unnamed sale is a counter sale; a purchase always has a selected vendor,
    // so leave its placeholder alone rather than calling the vendor a customer
    if (name !== '—') return name;
    return isPurchase ? name : labels.walkInCustomer;
  }, [
    invoice?.accountName,
    invoice?.accountNameUrdu,
    invoice?.invoiceItems,
    isPurchase,
    isUrdu,
    itemTypeNames,
    labels.walkInCustomer,
  ]);
  // consignment fields are optional on a purchase — set when it books a sale return an
  // agent collected, empty on a direct purchase, where the labels would dangle unfilled
  const showBiltyField = !isPurchase || biltyGoodsText.trim().length > 0;
  const showCartonsField = !isPurchase || toNumber(invoice?.cartons) > 0;
  // two remaining fields spread to the page edges under justify-between, which reads
  // as a layout gap rather than a deliberately shorter header
  const headerFieldsRowClass =
    showBiltyField || showCartonsField
      ? 'flex justify-between gap-4'
      : 'flex justify-start gap-10';

  const billToAddress = useMemo(() => {
    return pickPrintLocalizedText(
      invoice?.accountAddress,
      invoice?.accountAddressUrdu,
      effectiveLocale,
    );
  }, [invoice?.accountAddress, invoice?.accountAddressUrdu, effectiveLocale]);

  const printCompanyHeading = useMemo(() => {
    const name = pickPrintLocalizedText(
      companyProfile.name,
      companyProfile.nameUrdu,
      effectiveLocale,
    );
    if (name.length > 0) {
      return name;
    }
    if (invoice?.isQuotation) {
      return labels.quotationFallbackTitle;
    }
    return labels.invoiceFallbackTitle;
  }, [
    companyProfile.name,
    companyProfile.nameUrdu,
    invoice?.isQuotation,
    effectiveLocale,
    labels.invoiceFallbackTitle,
    labels.quotationFallbackTitle,
  ]);

  // split contact so phone/email stay LTR inside an RTL company line
  const companyContactParts = useMemo(() => {
    const address = pickPrintLocalizedText(
      companyProfile.address,
      companyProfile.addressUrdu,
      effectiveLocale,
    );
    const phone = companyProfile.phone.trim();
    const email = companyProfile.email.trim();
    const parts: Array<{ text: string; ltr?: boolean }> = [];
    if (address) parts.push({ text: address });
    if (phone) parts.push({ text: phone, ltr: true });
    if (email) parts.push({ text: email, ltr: true });
    return parts;
  }, [
    companyProfile.address,
    companyProfile.addressUrdu,
    companyProfile.email,
    companyProfile.phone,
    effectiveLocale,
  ]);

  const totalQuantity = invoiceItems.reduce(
    (sum, item) => sum + toNumber(item.quantity),
    0,
  );

  // same amount col width as EN so SKU/number columns stay ditto; footer total nowraps
  const amountColClass = 'pe-2 w-[7.25rem] tabular-nums';
  const priceColClass = 'text-end w-[4.75rem] tabular-nums';
  const qtyColClass = 'text-end tabular-nums';
  const discountColClass = 'text-end tabular-nums';
  // Urdu headings: start edge (visual right); EN keeps end-align over numbers
  const numHeadAlignClass = isUrdu ? 'text-start' : 'text-end';
  const chromeClass = isUrdu ? urduChromeClass : '';
  const dataClass = printLatinClass;
  // Nastaliq footer labels need forced padding — table [&_td]:py-0 otherwise wins
  const footerChromeClass = isUrdu
    ? `${chromeClass} !py-1.5 !leading-relaxed not-italic`
    : chromeClass;

  /** split digits (latin) from روپے (Nastaliq) so footer amount matches EN number metrics */
  const renderPrintAmount = (amount: number) => {
    if (!isUrdu) {
      return getFormattedCurrency(amount);
    }
    const formatted = new Intl.NumberFormat('en-PK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
    return (
      <span dir="ltr">
        <span className={dataClass}>{formatted}</span>{' '}
        <span className={chromeClass}>{labels.currencyWordsPrefix}</span>
      </span>
    );
  };

  const totalAmountInWords = useMemo(() => {
    const amount = toNumber(invoice?.totalAmount || 0);
    if (isUrdu) {
      return `${labels.total} ${amountInWordsUrdu(amount)} ${
        labels.currencyWordsPrefix
      }`;
    }
    const words = toWords(amount)
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    return `${labels.total} ${labels.currencyWordsPrefix} ${words}`;
  }, [invoice?.totalAmount, isUrdu, labels.currencyWordsPrefix, labels.total]);

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

  // english party name before walk-in substitution (readiness / gap detection)
  const partyNameEnglishForReadiness = useMemo(
    () =>
      getPrintBillToPartyName(
        invoice?.accountName,
        itemTypeNames,
        invoice?.invoiceItems,
      ),
    [invoice?.accountName, invoice?.invoiceItems, itemTypeNames],
  );

  const readinessGaps = useMemo(() => {
    if (!isUrdu || !invoice) return [];
    return getInvoicePrintReadinessGaps({
      locale: effectiveLocale,
      companyName: companyProfile.name,
      companyNameUrdu: companyProfile.nameUrdu,
      companyAddress: companyProfile.address,
      companyAddressUrdu: companyProfile.addressUrdu,
      partyNameEnglish: partyNameEnglishForReadiness,
      partyNameUrdu: invoice.accountNameUrdu ?? '',
      partyAddressEnglish: invoice.accountAddress ?? '',
      partyAddressUrdu: invoice.accountAddressUrdu ?? '',
      goodsNameEnglish: invoice.accountGoodsName ?? '',
      goodsNameUrdu: invoice.accountGoodsNameUrdu ?? '',
      showGoodsField: Boolean(String(invoice.accountGoodsName ?? '').trim()),
      missingItemDescriptionUrduCount: (invoice.invoiceItems ?? []).filter(
        (item) =>
          String(item.inventoryItemDescription ?? '').trim().length > 0 &&
          String(item.inventoryItemDescriptionUrdu ?? '').trim().length === 0,
      ).length,
    });
  }, [
    companyProfile.address,
    companyProfile.addressUrdu,
    companyProfile.name,
    companyProfile.nameUrdu,
    effectiveLocale,
    invoice,
    isUrdu,
    partyNameEnglishForReadiness,
  ]);

  const batchSavePdfAriaLabel = useMemo(() => {
    if (isBatchPrinting) {
      return 'Saving PDFs';
    }
    if (invoice?.isQuotation) {
      return 'Save PDFs for this quotation and every newer quotation of the same type';
    }
    return 'Save PDFs for this invoice and every newer invoice';
  }, [invoice?.isQuotation, isBatchPrinting]);

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
    <div
      className={printPreviewRootClass}
      dir={isUrdu ? 'rtl' : 'ltr'}
      lang={isUrdu ? 'ur' : 'en'}
    >
      {isUrdu ? (
        <style>{`
          @font-face {
            font-family: 'Noto Nastaliq Urdu';
            src: url(${nastaliqFontUrl}) format('truetype');
            font-weight: 400 700;
            font-display: block;
          }
        `}</style>
      ) : null}
      {isDarkAppChrome ? (
        <div
          dir="ltr"
          lang="en"
          className="print:hidden mb-3 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-sm text-amber-950 shadow-sm dark:border-amber-300/50 dark:bg-amber-950/30 dark:text-amber-50"
          role="status"
        >
          Preview uses light paper colors so it matches print. You can keep dark
          theme for the rest of the app.
        </div>
      ) : null}
      {readinessGaps.length > 0 ? (
        <div
          dir="ltr"
          lang="en"
          className="print:hidden mb-3 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-sm text-amber-950 shadow-sm"
          role="status"
        >
          <p className="font-medium">
            Missing Urdu fields — print will fall back to English:
          </p>
          <ul className="mt-1 list-disc ps-5 text-xs">
            {readinessGaps.map((gap) => (
              <li key={gap.key}>{gap.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div dir="ltr" className={printToolbarPanelClass}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
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
                  {getOsModifierLabel()}
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
                    {invoice.isQuotation
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
            <div className="flex items-center gap-2 ms-auto">
              <RadioGroup
                value={effectiveLocale}
                onValueChange={(v) => setSessionLocale(v as InvoicePrintLocale)}
                className="flex flex-row items-center gap-3"
                disabled={isBatchPrinting}
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="en" id="printSessionLocaleEn" />
                  <Label
                    htmlFor="printSessionLocaleEn"
                    className="text-xs font-normal cursor-pointer"
                  >
                    EN
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="ur" id="printSessionLocaleUr" />
                  <Label
                    htmlFor="printSessionLocaleUr"
                    className="text-xs font-normal cursor-pointer"
                  >
                    اردو
                  </Label>
                </div>
              </RadioGroup>
              {sessionLocale != null &&
              sessionLocale !== invoicePrintSettings.locale ? (
                <span className="text-[0.6875rem] text-muted-foreground whitespace-nowrap">
                  This print only
                </span>
              ) : null}
            </div>
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
        {invoice.isReturned ? (
          <div
            className="mb-4 rounded-md border-2 border-red-600 bg-red-50 px-4 py-3 text-center print:border-gray-400 print:bg-white print:text-black"
            role="status"
          >
            <p className="text-lg font-bold uppercase tracking-wide text-red-800 print:text-black">
              {labels.returnedBanner}
            </p>
            {invoice.returnedAt ? (
              <p className="mt-1 text-sm text-red-900/80 print:text-neutral-800">
                {labels.returnedOn}{' '}
                {formatInvoicePrintDate(invoice.returnedAt, effectiveLocale)}
              </p>
            ) : null}
          </div>
        ) : null}
        {invoice.isQuotation ? (
          <div
            className="mb-4 rounded-md border-2 border-amber-600 bg-amber-50 px-4 py-3 text-center print:border-gray-400 print:bg-white print:text-black"
            role="status"
          >
            <p className="text-lg font-bold uppercase tracking-wide text-amber-950 print:text-black">
              {labels.quotationBanner}
            </p>
          </div>
        ) : null}
        <div className="flex justify-between items-center">
          <div className="w-full">
            <h1
              className={`text-[26px] font-bold text-center${
                isUrdu
                  ? ` ${urduChromeClass} leading-[1.7] mb-1`
                  : ' font-mono leading-6'
              }`}
            >
              {printCompanyHeading}
            </h1>
            {companyContactParts.length > 0 ? (
              <p
                className={`text-center text-sm${
                  isUrdu ? ` ${urduChromeClass} leading-normal` : ' font-mono'
                }`}
              >
                {companyContactParts.map((part, index) => (
                  <span
                    key={part.ltr ? `ltr:${part.text}` : `rtl:${part.text}`}
                  >
                    {index > 0 ? ' · ' : null}
                    <span
                      dir={part.ltr ? 'ltr' : undefined}
                      className={part.ltr ? printLatinClass : undefined}
                    >
                      {part.text}
                    </span>
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        </div>

        <div
          className={`flex flex-col text-base gap-2 my-1 ${
            isUrdu ? 'leading-normal' : 'leading-none'
          }`}
        >
          <div className={headerFieldsRowClass}>
            <div className="flex gap-1 whitespace-nowrap items-baseline">
              <p className={chromeClass}>
                {invoice.isQuotation
                  ? labels.quotationNumber
                  : labels.invoiceNumber}
              </p>
              <p dir="ltr" className={dataClass}>
                {invoice.isQuotation
                  ? getQuotationDisplayNumber(toNumber(invoice.invoiceNumber))
                  : invoice.invoiceNumber}
              </p>
            </div>
            <div className="flex gap-1 whitespace-nowrap items-baseline">
              <p className={chromeClass}>{labels.date}</p>
              {(() => {
                const dateParts = getInvoicePrintDateParts(
                  invoice.date,
                  effectiveLocale,
                );
                if (!dateParts) {
                  return (
                    <p className={`whitespace-nowrap ${dataClass}`} dir="ltr">
                      {invoice.date}
                    </p>
                  );
                }
                if (!isUrdu) {
                  return (
                    <p className={`whitespace-nowrap ${dataClass}`} dir="ltr">
                      {dateParts.formatted}
                    </p>
                  );
                }
                // isolate day/year so "3 ستمبر 2026" does not bidi-flip to "ستمبر 2026 3"
                return (
                  <p className="whitespace-nowrap">
                    <span dir="ltr" className={dataClass}>
                      {dateParts.day}
                    </span>{' '}
                    <span className={chromeClass}>{dateParts.month}</span>{' '}
                    <span dir="ltr" className={dataClass}>
                      {dateParts.year}
                    </span>
                  </p>
                );
              })()}
            </div>
            {showBiltyField ? (
              <div className="flex gap-1 whitespace-nowrap items-baseline">
                <p className={chromeClass}>{labels.bilty}</p>
                <p>
                  <span dir="ltr" className={dataClass}>
                    {biltyGoods.bilty}
                  </span>
                  {biltyGoods.goodsShort ? (
                    <>
                      {' '}
                      <span className={chromeClass}>
                        ({biltyGoods.goodsShort})
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}
            {showCartonsField ? (
              <div className="flex gap-1 whitespace-nowrap items-baseline">
                <p className={chromeClass}>{labels.cartons}</p>
                <p dir="ltr" className={dataClass}>
                  {invoice.cartons ?? ''}
                </p>
              </div>
            ) : null}
          </div>
          {/* EN keeps -mt-1 compact; Urdu needs descender clearance above table */}
          <div
            className={`flex gap-1 items-baseline ${
              isUrdu ? 'pb-2 leading-[1.85]' : '-mt-1'
            }`}
          >
            <p className={`whitespace-nowrap ${chromeClass}`}>{partyLabel}</p>
            <p className={`whitespace-nowrap ${isUrdu ? chromeClass : ''}`}>
              {billToName}
            </p>
            <p className={`ps-2 ${isUrdu ? chromeClass : ''}`}>
              {billToAddress}
            </p>
          </div>
        </div>

        <table
          className={`w-full text-base border-[0.5px] border-gray-400 border-collapse [&_th]:px-1 [&_td]:px-1 [&_th]:border-[0.5px] [&_th]:border-gray-400 [&_td]:border-[0.5px] [&_td]:border-gray-400 ${
            isUrdu
              ? '[&_th]:py-1.5 [&_th]:leading-normal [&_td]:py-0 [&_td]:leading-tight'
              : 'leading-tight [&_td]:py-0 [&_th]:py-0'
          }`}
        >
          <thead>
            <tr className="[&_th]:font-semibold">
              <th className={`text-start ${chromeClass}`}>{labels.serial}</th>
              <th className={`text-center ${chromeClass}`}>{labels.item}</th>
              <th className={`text-start ${chromeClass}`}>
                {labels.itemDescription}
              </th>
              <th
                className={`${numHeadAlignClass} tabular-nums ${chromeClass}`}
              >
                {labels.qty}
              </th>
              <th
                className={`${numHeadAlignClass} w-[4.75rem] tabular-nums ${chromeClass}`}
              >
                {labels.price}
              </th>
              <th
                className={`${numHeadAlignClass} tabular-nums ${chromeClass}`}
              >
                {labels.discount}
              </th>
              <th
                className={`${numHeadAlignClass} ${amountColClass} ${chromeClass}`}
              >
                {labels.amount}
              </th>
            </tr>
          </thead>
          <tbody>
            {sectionedRows.map((row) => {
              if (row.kind === 'header') {
                return (
                  <tr key={row.key} className="bg-gray-100">
                    <td className={`font-semibold ${dataClass}`} colSpan={7}>
                      {row.sectionName}
                    </td>
                  </tr>
                );
              }

              if (row.kind === 'subtotal') {
                return (
                  <tr key={row.key} className="bg-gray-50">
                    <td colSpan={3} />
                    <td
                      className={`${qtyColClass} ${dataClass} font-semibold`}
                      dir="ltr"
                    >
                      {row.totalQuantity}
                    </td>
                    <td />
                    <td />
                    <td
                      className={`text-end ${amountColClass} ${dataClass} font-semibold`}
                      dir="ltr"
                    >
                      {toNumber(row.totalAmount).toFixed(2)}
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={row.key}>
                  <td
                    dir="ltr"
                    className={`${dataClass}${isUrdu ? ' text-right' : ''}`}
                  >
                    {row.serialNumber}
                  </td>
                  <td className={`text-center ${dataClass}`} dir="ltr">
                    {row.item.inventoryItemName}
                  </td>
                  {/* Urdu desc → Nastaliq + air; English fallback stays latin + pack to SKU */}
                  {(() => {
                    const descriptionText = pickPrintLocalizedText(
                      row.item.inventoryItemDescription,
                      row.item.inventoryItemDescriptionUrdu,
                      effectiveLocale,
                    );
                    const descriptionIsUrdu =
                      isUrdu &&
                      String(row.item.inventoryItemDescriptionUrdu ?? '').trim()
                        .length > 0;
                    return (
                      <td
                        dir={descriptionIsUrdu ? 'rtl' : 'ltr'}
                        className={
                          descriptionIsUrdu
                            ? `${chromeClass} !px-1.5 !py-1 !leading-[1.85]`
                            : `${dataClass}${isUrdu ? ' text-right' : ''}`
                        }
                      >
                        {descriptionText}
                      </td>
                    );
                  })()}
                  <td className={`${qtyColClass} ${dataClass}`} dir="ltr">
                    {row.item.quantity}
                  </td>
                  <td className={`${priceColClass} ${dataClass}`} dir="ltr">
                    {toNumber(row.item.price).toFixed(0)}
                  </td>
                  <td className={`${discountColClass} ${dataClass}`} dir="ltr">
                    {row.item.discount.toFixed(2)}
                  </td>
                  <td
                    className={`text-end ${amountColClass} ${dataClass}`}
                    dir="ltr"
                  >
                    {toNumber(row.item.discountedPrice).toFixed(2)}
                  </td>
                </tr>
              );
            })}

            {/* total quantity */}
            <tr className="[&_td]:border-0">
              <td
                colSpan={3}
                className={`${
                  isUrdu ? '' : 'italic '
                }!border-y-[0.5px] !border-gray-400 ${footerChromeClass}`}
              >
                {labels.totalQuantity}
              </td>
              <td
                className={`${qtyColClass} ${dataClass} !border-[0.5px] !border-gray-400${
                  isUrdu ? ' !py-1.5' : ''
                }`}
                dir="ltr"
              >
                {totalQuantity}
              </td>
              <td colSpan={3} />
            </tr>
            {/* extra discount */}
            {invoice.extraDiscount ? (
              <tr className="[&_td]:border-0">
                <td
                  colSpan={6}
                  className={`!border-y-[0.5px] !border-gray-400 ${footerChromeClass}`}
                >
                  {labels.extraDiscount}
                </td>
                <td
                  className={`text-end ${amountColClass} whitespace-nowrap !border-[0.5px] !border-gray-400${
                    isUrdu ? ' !py-1.5' : ''
                  }`}
                >
                  {renderPrintAmount(toNumber(invoice.extraDiscount))}
                </td>
              </tr>
            ) : null}
            {/* total amount */}
            <tr className="[&_td]:border-0">
              <td
                colSpan={6}
                className={`${
                  isUrdu ? '' : 'italic '
                }!border-y-[0.5px] !border-gray-400 ${footerChromeClass}`}
              >
                {totalAmountInWords}
              </td>
              <td
                className={`text-end ${amountColClass} font-bold whitespace-nowrap !border-[0.5px] !border-gray-400${
                  isUrdu ? ' !py-1.5' : ''
                }`}
              >
                {renderPrintAmount(toNumber(invoice?.totalAmount))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PrintableInvoiceScreen;
