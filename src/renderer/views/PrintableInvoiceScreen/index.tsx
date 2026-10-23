/* eslint-disable no-await-in-loop */
import {
  useCompanyProfile,
  useInvoicePrintSettings,
  usePrimaryItemType,
  useTheme,
} from '@/renderer/hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { InvoiceType, type Account, type InvoiceView } from 'types';
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
import { chargedUnitPrice, lineHasNetPrice } from '@/lib/invoiceLineAmount';
import { amountInWordsUrdu } from '@/lib/amountInWordsUrdu';
import type { InvoicePrintLocale } from '@/renderer/lib/invoicePrint/locale';
import {
  formatInvoicePrintDate,
  getInvoicePrintDateParts,
  getInvoicePrintLabels,
  pickPrintLocalizedText,
  waitForInvoicePrintFonts,
} from '@/renderer/lib/invoicePrint/locale';
import { getInvoicePrintReadinessGaps } from '@/renderer/lib/invoicePrint/readiness';
import { INVOICE_PRINT_PAGE_CSS } from '@/renderer/lib/invoicePrint/printCss';
import {
  computeInvoicePrintRunningBalances,
  toInvoicePrintAsOfDate,
  type InvoicePrintRunningBalances,
} from '@/renderer/lib/invoicePrint/partyBalances';
import {
  getPartyFamilyAccountIds,
  sumLedgerBalances,
} from '@/renderer/views/NewInvoice/lib/partyFamilyBalance';
import {
  ensureUrduInvoiceFonts,
  getUrduFontClass,
  getUrduFontFaceCss,
  isJameelPrintFace,
} from '@/renderer/lib/invoicePrint/urduFont';
import {
  getPrintEnvironment,
  getPrintHelp,
  getPrintHint,
  type PrintHelp,
} from '@/renderer/lib/invoicePrint/mobilePrint';
import PrintToolbar from './PrintToolbar';
import PrintHelpDialog from './PrintHelpDialog';
import { usePrintPreviewScale } from './usePrintPreviewScale';

/**
 * Nastaliq only on Urdu chrome — never on SKUs/numbers (EN visual parity).
 * Jameel reads optically smaller than latin — bump only on that face.
 * Noto already fills the em-box; 1.3em made it look huge.
 */
const urduJameelEmphClass = 'text-[1.1em]';
/** company name + address only — Jameel ink sits small in the em-box */
const urduJameelCompanyNameClass = 'text-[36px]';
const urduJameelCompanyAddressClass = 'text-[1.3em]';

const pickPrintSpacingClass = (
  isJameel: boolean,
  isUrduLocale: boolean,
  jameelClass: string,
  notoClass: string,
  englishClass: string,
): string => {
  if (isJameel) {
    return jameelClass;
  }
  if (isUrduLocale) {
    return notoClass;
  }
  return englishClass;
};

/** screen preview only; print stays neutral/black ink */
const printPreviewRootClass =
  'invoice-print-root min-h-screen bg-white p-3 sm:p-8 text-neutral-900 [color-scheme:light] antialiased print:bg-white print:p-0 print:text-black';

/** force latin metrics so table data matches EN print */
const printLatinClass = 'font-sans';

/** sticky batch toasts clear on navigation/print; this caps lifetime if user stays idle */
const BATCH_TOAST_FALLBACK_MS = 45_000;

/**
 * How long to wait for the browser to start printing before assuming it
 * will not. Chrome opens its print screen almost immediately; a browser
 * that is going to refuse takes about this long to do nothing.
 */
const PRINT_FALLBACK_DELAY_MS = 1500;

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
  const [isOpeningPdf, setIsOpeningPdf] = useState(false);
  const [pdfOutputDir, setPdfOutputDir] = useState<string | null>(null);
  const [runningBalances, setRunningBalances] =
    useState<InvoicePrintRunningBalances | null>(null);
  const navigate = useNavigate();
  const { profile: companyProfile } = useCompanyProfile();
  const { settings: invoicePrintSettings } = useInvoicePrintSettings();
  // null = follow Settings; set to override for this print session only
  const [sessionLocale, setSessionLocale] = useState<InvoicePrintLocale | null>(
    null,
  );
  const [sessionShowPartyBalances, setSessionShowPartyBalances] = useState<
    boolean | null
  >(null);
  const [sessionShowAgent, setSessionShowAgent] = useState<boolean | null>(
    null,
  );
  const [sessionShowBillBalance, setSessionShowBillBalance] = useState<
    boolean | null
  >(null);
  const [sessionShowPrintNote, setSessionShowPrintNote] = useState<
    boolean | null
  >(null);
  const effectiveLocale = sessionLocale ?? invoicePrintSettings.locale;
  const effectiveShowPartyBalances =
    sessionShowPartyBalances ?? invoicePrintSettings.showPartyBalances;
  const effectiveShowAgent = sessionShowAgent ?? invoicePrintSettings.showAgent;
  const effectiveShowBillBalance =
    sessionShowBillBalance ?? invoicePrintSettings.showBillBalance;
  const effectiveShowPrintNote =
    sessionShowPrintNote ?? invoicePrintSettings.showPrintNote;
  const isPrintSessionOverride =
    (sessionLocale != null && sessionLocale !== invoicePrintSettings.locale) ||
    (sessionShowPartyBalances != null &&
      sessionShowPartyBalances !== invoicePrintSettings.showPartyBalances) ||
    (sessionShowAgent != null &&
      sessionShowAgent !== invoicePrintSettings.showAgent) ||
    (sessionShowBillBalance != null &&
      sessionShowBillBalance !== invoicePrintSettings.showBillBalance) ||
    (sessionShowPrintNote != null &&
      sessionShowPrintNote !== invoicePrintSettings.showPrintNote);
  const isUrdu = effectiveLocale === 'ur';
  // what the browser at hand can do with a print request; it does not change
  // while the app is open
  const printEnvironment = useMemo(() => getPrintEnvironment(), []);
  const printHint = useMemo(
    () => getPrintHint(printEnvironment),
    [printEnvironment],
  );
  const [printHelp, setPrintHelp] = useState<PrintHelp | null>(null);
  const [showPrintHelp, setShowPrintHelp] = useState(false);
  // set when the browser actually starts printing
  const printFiredRef = useRef(false);
  // desktop can write a PDF file to disk; a browser can only print
  const canPrintToFile = Boolean(window.electron.supportsPrintToFile);
  const previewScale = usePrintPreviewScale(isUrdu);
  const printSessionOptions = useMemo(
    () => ({
      locale: effectiveLocale,
      showPartyBalances: effectiveShowPartyBalances,
      showAgent: effectiveShowAgent,
      showBillBalance: effectiveShowBillBalance,
      showPrintNote: effectiveShowPrintNote,
      isOverride: isPrintSessionOverride,
    }),
    [
      effectiveLocale,
      effectiveShowPartyBalances,
      effectiveShowAgent,
      effectiveShowBillBalance,
      effectiveShowPrintNote,
      isPrintSessionOverride,
    ],
  );
  const labels = useMemo(
    () =>
      getInvoicePrintLabels(
        effectiveLocale,
        effectiveLocale === 'ur'
          ? invoicePrintSettings.urduLabelOverrides
          : invoicePrintSettings.englishLabelOverrides,
      ),
    [
      effectiveLocale,
      invoicePrintSettings.urduLabelOverrides,
      invoicePrintSettings.englishLabelOverrides,
    ],
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

  useEffect(() => {
    if (!invoice || invoice.isQuotation) {
      setRunningBalances(null);
      return undefined;
    }
    const headerId = toNumber(invoice.invoiceHeaderAccountId);
    if (!(headerId > 0)) {
      setRunningBalances(null);
      return undefined;
    }
    const asOfDate = toInvoicePrintAsOfDate(invoice.date);
    if (!asOfDate) {
      setRunningBalances(null);
      return undefined;
    }
    const invoiceType = invoice.invoiceType ?? InvoiceType.Sale;
    const invoiceTotal = toNumber(invoice.totalAmount);
    let cancelled = false;
    const loadBalances = async () => {
      const accounts = (await window.electron.getAccounts()) as Account[];
      if (cancelled) return;
      const familyIds = getPartyFamilyAccountIds(
        headerId,
        accounts,
        itemTypeNames,
      );
      const map = await window.electron.getLedgerBalancesForAccountIdsAsOfDate(
        familyIds,
        asOfDate,
      );
      if (cancelled) return;
      setRunningBalances(
        computeInvoicePrintRunningBalances(
          invoiceType,
          invoiceTotal,
          sumLedgerBalances(map),
        ),
      );
    };
    loadBalances().catch(() => {
      if (!cancelled) setRunningBalances(null);
    });
    return () => {
      cancelled = true;
    };
  }, [invoice, itemTypeNames]);

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

  // exclusive electron waits for Jameel; web still paints Noto and prefetches
  useEffect(() => {
    if (!isUrdu) {
      return;
    }
    ensureUrduInvoiceFonts('preview').catch(() => {});
  }, [isUrdu]);

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
      // the browser is actually printing; the fallback sheet is not needed
      printFiredRef.current = true;
      setShowPrintHelp(false);
    };

    window.onafterprint = () => {
      document.title = 'Easy Invoicing';
    };
  }, [invoice]);

  const handlePrint = async () => {
    dismissAllToasts();
    await waitForInvoicePrintFonts(effectiveLocale);

    // Chrome on iOS is a WKWebView wrapper: it takes the call and prints
    // nothing, so the browser's own share sheet is the only way out.
    if (!printEnvironment.hasPrintApi || printEnvironment.isIosChrome) {
      setPrintHelp(getPrintHelp(printEnvironment));
      setShowPrintHelp(true);
      return;
    }

    printFiredRef.current = false;
    window.print();

    // A browser that swallows the request (some installed PWA builds on
    // Android) never fires beforeprint. If nothing happened shortly after
    // the call, the browser cannot print this page and the user needs the
    // manual steps instead of a button that does nothing.
    window.setTimeout(() => {
      if (!printFiredRef.current) {
        setPrintHelp(getPrintHelp(printEnvironment));
        setShowPrintHelp(true);
      }
    }, PRINT_FALLBACK_DELAY_MS);
  };

  const handleOpenPdf = async () => {
    dismissAllToasts();
    setIsOpeningPdf(true);
    try {
      await waitForInvoicePrintFonts(effectiveLocale);
      // stamped printToPDF → OS viewer (Preview). Page numbers live here.
      const result = await window.electron.printWithDialog();
      if (!result.success && !result.cancelled) {
        let description = 'Could not open the stamped PDF.';
        if (typeof result.error === 'string') {
          description = result.error;
        } else if (result.error instanceof Error) {
          description = result.error.message;
        }
        toast({
          title: 'Open PDF failed',
          description,
          variant: 'destructive',
        });
      }
    } finally {
      setIsOpeningPdf(false);
    }
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
    const addr = pickPrintLocalizedText(
      invoice?.accountAddress,
      invoice?.accountAddressUrdu,
      effectiveLocale,
    );
    const city = pickPrintLocalizedText(
      invoice?.accountCity,
      invoice?.accountCityUrdu,
      effectiveLocale,
    );
    if (addr && city) {
      return effectiveLocale === 'ur' ? `${addr}، ${city}` : `${addr}, ${city}`;
    }
    return addr || city || '';
  }, [
    invoice?.accountAddress,
    invoice?.accountAddressUrdu,
    invoice?.accountCity,
    invoice?.accountCityUrdu,
    effectiveLocale,
  ]);

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

  // slots, not a flex list — 1fr/auto/1fr keeps address on the name's center axis
  const companyContact = useMemo(() => {
    const address = pickPrintLocalizedText(
      companyProfile.address,
      companyProfile.addressUrdu,
      effectiveLocale,
    );
    return {
      address,
      phone: companyProfile.phone.trim(),
      email: companyProfile.email.trim(),
    };
  }, [
    companyProfile.address,
    companyProfile.addressUrdu,
    companyProfile.email,
    companyProfile.phone,
    effectiveLocale,
  ]);
  const hasCompanyAddress = companyContact.address.length > 0;
  const hasCompanyPhone = companyContact.phone.length > 0;
  const hasCompanyEmail = companyContact.email.length > 0;
  const hasCompanyContact =
    hasCompanyAddress || hasCompanyPhone || hasCompanyEmail;

  const totalQuantity = invoiceItems.reduce(
    (sum, item) => sum + toNumber(item.quantity),
    0,
  );
  const extraDiscountAmount = toNumber(invoice?.extraDiscount);
  const hasExtraDiscount = extraDiscountAmount > 0;
  const shippingAmount = toNumber(invoice?.shippingCharges);
  const hasShipping = shippingAmount > 0;
  let quantityRowCharge: { label: string; amount: number } | null = null;
  if (hasExtraDiscount) {
    quantityRowCharge = {
      label: labels.extraDiscount,
      amount: -extraDiscountAmount,
    };
  } else if (hasShipping) {
    quantityRowCharge = { label: labels.shipping, amount: shippingAmount };
  }

  // same amount col width as EN so SKU/number columns stay ditto; footer total nowraps
  const amountColClass = 'pe-2 w-[7.25rem] tabular-nums';
  const priceColClass = 'text-end w-[4.75rem] tabular-nums';
  const qtyColClass = 'text-end tabular-nums';
  const discountColClass = 'text-end tabular-nums';
  // Urdu headings: start edge (visual right); EN keeps end-align over numbers
  const numHeadAlignClass = isUrdu ? 'text-start' : 'text-end';
  const isJameelUrdu = isUrdu && isJameelPrintFace();
  const urduFontClassName = getUrduFontClass();
  // size bump is Jameel-only — Noto chrome stays at the surrounding text size
  const urduChromeClass = isJameelUrdu
    ? `${urduFontClassName} ${urduJameelEmphClass}`
    : urduFontClassName;
  const chromeClass = isUrdu ? urduChromeClass : '';
  const dataClass = printLatinClass;
  // Noto ink overflows its CSS line box. leading < ~2.5 + items-baseline
  // clips title dots, stacks بل نمبر onto بل بنام, and bleeds table rules.
  // Jameel metrics already contain ink — leave those classes alone.
  const urduHeadingLeadClass = isJameelUrdu
    ? 'leading-[1.35] mb-0.5 pt-0.5'
    : '!text-[22px] leading-[2.7] pt-6 mb-3 overflow-visible';
  const urduContactLeadClass = isJameelUrdu
    ? 'leading-[1.25]'
    : 'leading-[2.2] mt-3 mb-2';
  const urduMetaBoxClass = pickPrintSpacingClass(
    isJameelUrdu,
    isUrdu,
    'gap-0.5 my-0 leading-[1.25]',
    'gap-6 my-3 leading-[2.5] overflow-visible',
    'gap-2 my-1 leading-none',
  );
  const urduPartyRowClass = pickPrintSpacingClass(
    isJameelUrdu,
    isUrdu,
    'leading-[1.3] pt-1 pb-0.5',
    'pt-3 pb-8 leading-[2.5]',
    '-mt-1',
  );
  const urduFieldRowAlignClass = pickPrintSpacingClass(
    isJameelUrdu,
    isUrdu,
    'items-baseline',
    'items-start',
    'items-baseline',
  );
  const urduTableClass = pickPrintSpacingClass(
    isJameelUrdu,
    isUrdu,
    '[&_th]:pt-1.5 [&_th]:pb-1 [&_th]:leading-[1.25] [&_td]:py-1 [&_td]:leading-[1.2]',
    '[&_th]:pt-4 [&_th]:pb-3 [&_th]:leading-[2.5] [&_td]:py-3 [&_td]:leading-[2.4] [&_th]:align-middle [&_td]:align-middle',
    'leading-tight [&_td]:py-0 [&_th]:py-0',
  );
  const urduDescriptionPadClass = isJameelUrdu
    ? '!px-1 !pt-1.5 !pb-1 !leading-[1.3]'
    : '!px-1.5 !py-3.5 !leading-[2.5]';
  const urduFooterNumericPadClass = pickPrintSpacingClass(
    isJameelUrdu,
    isUrdu,
    ' !pt-1.5 !pb-1',
    ' !py-1.5',
    ' !py-1',
  );
  const footerBoxClass =
    '!border-[0.5px] !border-gray-400 align-middle overflow-hidden !leading-tight';
  const footerBoxClearClass = 'align-middle !border-0';
  const footerBoxLabelClass =
    `${footerBoxClass} ${chromeClass} ${pickPrintSpacingClass(
      isJameelUrdu,
      isUrdu,
      '!px-1 !py-1 !leading-[1.25] not-italic whitespace-normal break-words',
      '!px-1 !py-1 !leading-[1.4] not-italic whitespace-normal break-words',
      '!px-1 !py-1 leading-tight not-italic whitespace-normal break-words',
    )}`.trim();
  const footerBoxAmountClass = `${footerBoxClass} text-end${urduFooterNumericPadClass}`;
  const footerTotalAmountClass = `${footerBoxClass} invoice-print-total-amount font-bold${urduFooterNumericPadClass} ${
    isUrdu ? 'text-start' : 'text-end'
  } !border-2 !border-neutral-900`;
  const printSheetTopClass = pickPrintSpacingClass(
    isJameelUrdu,
    isUrdu,
    'print:pt-0',
    'print:pt-6',
    'print:pt-0',
  );
  const printCompanyHeadingClass = pickPrintSpacingClass(
    isJameelUrdu,
    isUrdu,
    `${urduFontClassName} ${urduHeadingLeadClass} ${urduJameelCompanyNameClass}`,
    `${urduFontClassName} ${urduHeadingLeadClass}`,
    'text-[26px] font-mono leading-6',
  );
  const printCompanyAddressPartClass = isJameelUrdu
    ? urduJameelCompanyAddressClass
    : undefined;
  const printCompanyContactChromeClass = isUrdu
    ? `${urduFontClassName} ${urduContactLeadClass}`
    : 'font-mono';

  const renderCompanyContactLine = () => {
    if (!hasCompanyContact) {
      return null;
    }
    if (!hasCompanyAddress) {
      return (
        <div
          className={`flex flex-wrap items-center justify-center gap-x-16 gap-y-1 text-sm ${printCompanyContactChromeClass}`}
        >
          {hasCompanyPhone ? (
            <span dir="ltr" className={printLatinClass}>
              {companyContact.phone}
            </span>
          ) : null}
          {hasCompanyEmail ? (
            <span dir="ltr" className={printLatinClass}>
              {companyContact.email}
            </span>
          ) : null}
        </div>
      );
    }
    const addressClass = printCompanyAddressPartClass
      ? `px-2 text-center ${printCompanyAddressPartClass}`
      : 'px-2 text-center';
    return (
      <div
        dir="ltr"
        className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-x-4 text-sm ${printCompanyContactChromeClass}`}
      >
        <span
          dir="ltr"
          className={`${printLatinClass} justify-self-end whitespace-nowrap`}
        >
          {companyContact.phone}
        </span>
        <span dir={isUrdu ? 'rtl' : undefined} className={addressClass}>
          {companyContact.address}
        </span>
        <span
          dir="ltr"
          className={`${printLatinClass} justify-self-start whitespace-nowrap`}
        >
          {companyContact.email}
        </span>
      </div>
    );
  };

  /** digits only — no PKR / روپے on print amounts */
  const renderFooterAmount = (amount: number) => (
    <span dir="ltr" className={`${dataClass} whitespace-nowrap`}>
      {new Intl.NumberFormat('en-PK', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount)}
    </span>
  );

  const totalAmountInWords = useMemo(() => {
    const amount = toNumber(invoice?.totalAmount || 0);
    if (isUrdu) {
      return amountInWordsUrdu(amount);
    }
    return toWords(amount)
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }, [invoice?.totalAmount, isUrdu]);

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
      agentNameEnglish: effectiveShowAgent ? invoice.accountHeadName ?? '' : '',
      agentNameUrdu: invoice.accountHeadNameUrdu ?? '',
    });
  }, [
    companyProfile.address,
    companyProfile.addressUrdu,
    companyProfile.name,
    companyProfile.nameUrdu,
    effectiveLocale,
    effectiveShowAgent,
    invoice,
    isUrdu,
    partyNameEnglishForReadiness,
  ]);

  const printAgentName = pickPrintLocalizedText(
    invoice?.accountHeadName,
    invoice?.accountHeadNameUrdu,
    effectiveLocale,
  );
  const showAgentName = Boolean(printAgentName) && effectiveShowAgent;
  const isNamedParty =
    partyNameEnglishForReadiness !== '—' &&
    billToName !== labels.walkInCustomer;
  const showBillBalanceStamp =
    Boolean(invoice) &&
    !isPurchase &&
    !invoice?.isQuotation &&
    !invoice?.isReturned &&
    isNamedParty &&
    effectiveShowBillBalance;
  const showRunningBalances =
    Boolean(invoice) &&
    !invoice?.isQuotation &&
    isNamedParty &&
    runningBalances != null &&
    effectiveShowPartyBalances;
  const printNoteText = pickPrintLocalizedText(
    companyProfile.printNote,
    companyProfile.printNoteUrdu,
    effectiveLocale,
  );
  const showPrintNoteText =
    effectiveShowPrintNote && !isPurchase && printNoteText.length > 0;
  const showPrintNoteBlock =
    effectiveShowPrintNote &&
    (showPrintNoteText ||
      companyProfile.whatsapp.trim().length > 0 ||
      companyProfile.website.trim().length > 0);

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
        className={`${printPreviewRootClass} ${printSheetTopClass} flex items-center justify-center`}
      >
        <p className="text-sm text-neutral-600">Loading…</p>
      </div>
    );
  }

  return (
    <div
      className={`${printPreviewRootClass} ${printSheetTopClass}`}
      dir={isUrdu ? 'rtl' : 'ltr'}
      lang={isUrdu ? 'ur' : 'en'}
    >
      {isUrdu ? <style>{getUrduFontFaceCss()}</style> : null}
      <style>{INVOICE_PRINT_PAGE_CSS}</style>
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
      <PrintToolbar
        isInvoiceSynced={isInvoiceSynced}
        isBatchPrinting={isBatchPrinting}
        isOpeningPdf={isOpeningPdf}
        canPrintToFile={canPrintToFile}
        isQuotation={Boolean(invoice.isQuotation)}
        canGoPrevious={adjacentInvoiceIds.previous > 0}
        canGoNext={adjacentInvoiceIds.next > 0}
        pdfOutputDir={pdfOutputDir}
        batchSavePdfAriaLabel={batchSavePdfAriaLabel}
        options={printSessionOptions}
        onPrint={handlePrint}
        onOpenPdf={handleOpenPdf}
        onBatchPrint={handleBatchPrint}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onClose={handleClose}
        onLocaleChange={setSessionLocale}
        onShowPartyBalancesChange={setSessionShowPartyBalances}
        onShowAgentChange={setSessionShowAgent}
        onShowBillBalanceChange={setSessionShowBillBalance}
        onShowPrintNoteChange={setSessionShowPrintNote}
        printHint={printHint}
      />
      <div
        ref={previewScale.wrapperRef}
        className="invoice-print-scale-wrap mx-auto"
        style={previewScale.wrapperStyle}
      >
        <div
          ref={previewScale.sheetRef}
          className={`invoice-print-sheet max-w-4xl mx-auto relative transition-opacity duration-150 print:max-w-none print:w-full print:opacity-100 ${
            isInvoiceSynced ? 'opacity-100' : 'opacity-50'
          }`}
          style={previewScale.sheetStyle}
        >
          {!isInvoiceSynced ? (
            <div className="print:hidden pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-white/50 pt-24 backdrop-blur-[1px]">
              <span className="text-sm font-medium text-neutral-700">
                Loading…
              </span>
            </div>
          ) : null}
          <table
            className={`invoice-print-table w-full text-base border-collapse [&_th]:px-1 [&_td]:px-1 [&_th]:border-[0.5px] [&_th]:border-gray-400 [&_td]:border-[0.5px] [&_td]:border-gray-400 ${urduTableClass}`}
          >
            <colgroup>
              <col style={{ width: '6%' }} />
              <col style={{ width: '16%' }} />
              <col />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '16%' }} />
            </colgroup>
            <thead>
              <tr>
                <td colSpan={7} className="!border-0 !p-0 !pb-2 align-top">
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
                          {formatInvoicePrintDate(
                            invoice.returnedAt,
                            effectiveLocale,
                          )}
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
                  <div className="grid grid-cols-[5.75rem_1fr_5.75rem] items-start">
                    {showBillBalanceStamp ? (
                      <div className="flex items-center justify-center border-2 border-neutral-800 py-1 text-center">
                        <span
                          className={`font-bold leading-tight ${chromeClass} ${
                            isJameelUrdu ? 'text-lg' : 'text-xs'
                          }`}
                        >
                          {labels.billBalance}
                        </span>
                      </div>
                    ) : (
                      <div />
                    )}
                    <div className="w-full min-w-0">
                      <h1
                        className={`font-bold text-center ${printCompanyHeadingClass}`}
                      >
                        {printCompanyHeading}
                      </h1>
                    </div>
                    <div />
                  </div>
                  {renderCompanyContactLine()}

                  <div
                    className={`flex flex-col text-base ${urduMetaBoxClass}`}
                  >
                    {/* customer + agent share one row */}
                    <div
                      className={`flex justify-between gap-3 ${urduFieldRowAlignClass} ${urduPartyRowClass}`}
                    >
                      <div
                        className={`flex min-w-0 gap-1 ${urduFieldRowAlignClass}`}
                      >
                        <p className={`whitespace-nowrap ${chromeClass}`}>
                          {partyLabel}
                        </p>
                        <p
                          className={`whitespace-nowrap ${
                            isUrdu ? chromeClass : ''
                          }`}
                        >
                          {billToName}
                        </p>
                        <p className={`ps-2 ${isUrdu ? chromeClass : ''}`}>
                          {billToAddress}
                        </p>
                      </div>
                      {showAgentName ? (
                        <div
                          className={`flex shrink-0 gap-1 ${urduFieldRowAlignClass}`}
                        >
                          <p className={`whitespace-nowrap ${chromeClass}`}>
                            {labels.agent}
                          </p>
                          <p
                            className={`whitespace-nowrap ${
                              isUrdu &&
                              String(invoice.accountHeadNameUrdu ?? '').trim()
                                ? chromeClass
                                : dataClass
                            }`}
                            dir={
                              isUrdu &&
                              String(invoice.accountHeadNameUrdu ?? '').trim()
                                ? 'rtl'
                                : 'ltr'
                            }
                          >
                            {printAgentName}
                          </p>
                        </div>
                      ) : null}
                    </div>
                    <div
                      className={`${headerFieldsRowClass} ${urduFieldRowAlignClass}`}
                    >
                      <div
                        className={`flex gap-1 whitespace-nowrap ${urduFieldRowAlignClass}`}
                      >
                        <p className={chromeClass}>
                          {invoice.isQuotation
                            ? labels.quotationNumber
                            : labels.invoiceNumber}
                        </p>
                        <p dir="ltr" className={dataClass}>
                          {invoice.isQuotation
                            ? getQuotationDisplayNumber(
                                toNumber(invoice.invoiceNumber),
                              )
                            : invoice.invoiceNumber}
                        </p>
                      </div>
                      <div
                        className={`flex gap-1 whitespace-nowrap ${urduFieldRowAlignClass}`}
                      >
                        <p className={chromeClass}>{labels.date}</p>
                        {(() => {
                          const dateParts = getInvoicePrintDateParts(
                            invoice.date,
                            effectiveLocale,
                          );
                          if (!dateParts) {
                            return (
                              <p
                                className={`whitespace-nowrap ${dataClass}`}
                                dir="ltr"
                              >
                                {invoice.date}
                              </p>
                            );
                          }
                          if (!isUrdu) {
                            return (
                              <p
                                className={`whitespace-nowrap ${dataClass}`}
                                dir="ltr"
                              >
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
                              <span className={chromeClass}>
                                {dateParts.month}
                              </span>{' '}
                              <span dir="ltr" className={dataClass}>
                                {dateParts.year}
                              </span>
                            </p>
                          );
                        })()}
                      </div>
                      {showBiltyField ? (
                        <div
                          className={`flex gap-1 whitespace-nowrap ${urduFieldRowAlignClass}`}
                        >
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
                        <div
                          className={`flex gap-1 whitespace-nowrap ${urduFieldRowAlignClass}`}
                        >
                          <p className={chromeClass}>{labels.cartons}</p>
                          <p dir="ltr" className={dataClass}>
                            {invoice.cartons ?? ''}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </td>
              </tr>
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
                        String(
                          row.item.inventoryItemDescriptionUrdu ?? '',
                        ).trim().length > 0;
                      return (
                        <td
                          dir={descriptionIsUrdu ? 'rtl' : 'ltr'}
                          className={
                            descriptionIsUrdu
                              ? `${chromeClass} ${urduDescriptionPadClass}`
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
                      {chargedUnitPrice(row.item).toFixed(0)}
                    </td>
                    <td
                      className={`${discountColClass} ${dataClass}`}
                      dir="ltr"
                    >
                      {lineHasNetPrice(row.item.netPrice)
                        ? ''
                        : row.item.discount.toFixed(2)}
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
            </tbody>
            <tbody data-print-footer>
              {/* # empty; حوالہ = sabqa/naya label; تفصیل = amount at start, کل مقدار/کل رقم at end */}
              <tr>
                <td className={footerBoxClearClass} />
                {showRunningBalances && runningBalances ? (
                  <>
                    <td
                      className={`${footerBoxLabelClass} text-end !border-s-0`}
                    >
                      {labels.previousBalance}
                    </td>
                    <td
                      className={`${footerBoxClass}${urduFooterNumericPadClass}`}
                    >
                      <div className="flex w-full items-baseline justify-between gap-2">
                        {renderFooterAmount(
                          Math.abs(runningBalances.previousBalance),
                        )}
                        <span
                          className={`${chromeClass} shrink-0 leading-tight`}
                        >
                          {labels.totalQuantity}
                        </span>
                      </div>
                    </td>
                  </>
                ) : (
                  <td
                    colSpan={2}
                    className={`${footerBoxClass} !border-s-0${urduFooterNumericPadClass}`}
                  >
                    <div className="flex justify-end">
                      <span className={`${chromeClass} shrink-0 leading-tight`}>
                        {labels.totalQuantity}
                      </span>
                    </div>
                  </td>
                )}
                <td
                  className={`${qtyColClass} ${dataClass} ${footerBoxClass}${urduFooterNumericPadClass}`}
                  dir="ltr"
                >
                  {totalQuantity}
                </td>
                {quantityRowCharge ? (
                  <>
                    <td className="align-middle !border-x-0 !border-y-[0.5px] !border-gray-400" />
                    <td
                      className={`${footerBoxLabelClass} text-end !border-e-0`}
                    >
                      {quantityRowCharge.label}
                    </td>
                    <td className={`${footerBoxAmountClass} pe-2`} dir="ltr">
                      {renderFooterAmount(quantityRowCharge.amount)}
                    </td>
                  </>
                ) : (
                  <td
                    colSpan={3}
                    className="align-middle !border-x-0 !border-y-[0.5px] !border-gray-400"
                  />
                )}
              </tr>
              {hasShipping && hasExtraDiscount ? (
                <tr>
                  <td className={footerBoxClearClass} />
                  {showRunningBalances && runningBalances ? (
                    <>
                      <td
                        className={`${footerBoxLabelClass} text-end !border-s-0`}
                      >
                        {labels.newBalance}
                      </td>
                      <td
                        className={`${footerBoxClass}${urduFooterNumericPadClass}`}
                      >
                        {renderFooterAmount(
                          Math.abs(runningBalances.newBalance),
                        )}
                      </td>
                    </>
                  ) : (
                    <td
                      colSpan={2}
                      className="align-middle !border-x-0 !border-y-[0.5px] !border-gray-400"
                    />
                  )}
                  <td className="align-middle !border-x-0 !border-y-[0.5px] !border-gray-400" />
                  <td className="align-middle !border-x-0 !border-y-[0.5px] !border-gray-400" />
                  <td className={`${footerBoxLabelClass} text-end !border-e-0`}>
                    {labels.shipping}
                  </td>
                  <td className={`${footerBoxAmountClass} pe-2`} dir="ltr">
                    {renderFooterAmount(shippingAmount)}
                  </td>
                </tr>
              ) : null}
              <tr>
                <td className={footerBoxClearClass} />
                {showRunningBalances &&
                runningBalances &&
                !(hasShipping && hasExtraDiscount) ? (
                  <>
                    <td
                      className={`${footerBoxLabelClass} text-end !border-s-0`}
                    >
                      {labels.newBalance}
                    </td>
                    <td
                      className={`${footerBoxClass}${urduFooterNumericPadClass}`}
                    >
                      <div className="flex w-full items-baseline justify-between gap-2">
                        {renderFooterAmount(
                          Math.abs(runningBalances.newBalance),
                        )}
                        <span
                          className={`${chromeClass} shrink-0 leading-tight`}
                        >
                          {labels.total}
                        </span>
                      </div>
                    </td>
                  </>
                ) : (
                  <td
                    colSpan={2}
                    className={`${footerBoxClass} !border-s-0${urduFooterNumericPadClass}`}
                  >
                    <div className="flex justify-end">
                      <span className={`${chromeClass} shrink-0 leading-tight`}>
                        {labels.total}
                      </span>
                    </div>
                  </td>
                )}
                <td
                  colSpan={3}
                  className={`${footerBoxLabelClass} ${
                    isUrdu ? '' : `${dataClass} text-xs`
                  }`}
                >
                  {totalAmountInWords}
                </td>
                <td className={footerTotalAmountClass}>
                  {renderFooterAmount(toNumber(invoice.totalAmount))}
                </td>
              </tr>
            </tbody>
          </table>
          {showPrintNoteBlock ? (
            <div
              className={`invoice-print-note mt-3 flex justify-between gap-6 text-sm ${urduFieldRowAlignClass}`}
            >
              {showPrintNoteText ? (
                <p className={`min-w-0 ${isUrdu ? chromeClass : ''}`}>
                  <span className={chromeClass}>{labels.note}</span>{' '}
                  {printNoteText}
                </p>
              ) : (
                <div />
              )}
              <div
                className={`shrink-0 whitespace-nowrap ${
                  isUrdu ? 'flex items-baseline gap-6' : ''
                }`}
              >
                {companyProfile.whatsapp.trim() ? (
                  <p>
                    <span className={chromeClass}>{labels.whatsapp}</span>{' '}
                    <span dir="ltr" className={dataClass}>
                      {companyProfile.whatsapp.trim()}
                    </span>
                  </p>
                ) : null}
                {companyProfile.website.trim() ? (
                  <p>
                    <span className={chromeClass}>{labels.website}</span>{' '}
                    <span dir="ltr" className={dataClass}>
                      {companyProfile.website.trim()}
                    </span>
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <PrintHelpDialog
        open={showPrintHelp && printHelp != null}
        onOpenChange={setShowPrintHelp}
        help={printHelp ?? getPrintHelp(printEnvironment)}
      />
    </div>
  );
};

export default PrintableInvoiceScreen;
