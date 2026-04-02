/* eslint-disable no-await-in-loop */
import {
  useCompanyProfile,
  useInvoicePrintSettings,
  usePrimaryItemType,
} from '@/renderer/hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, isValid } from 'date-fns';
import { InvoiceType, type InvoiceView } from 'types';
import { Button } from 'renderer/shad/ui/button';
import { Kbd, KbdGroup } from 'renderer/shad/ui/kbd';
import { toast } from '@/renderer/shad/ui/use-toast';
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

const PrintableInvoiceScreen = () => {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const { primaryItemTypeName, itemTypeNames } = usePrimaryItemType();
  const [adjacentInvoiceIds, setAdjacentInvoiceIds] = useState<{
    next: number;
    previous: number;
  }>({ next: 0, previous: 0 });
  const [isBatchPrinting, setIsBatchPrinting] = useState(false);
  const navigate = useNavigate();
  const { profile: companyProfile } = useCompanyProfile();
  const { settings: invoicePrintSettings, defaults } =
    useInvoicePrintSettings();

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
    if (invoice && localStorage.getItem('ui-theme') === 'dark') {
      toast({
        title: 'Info',
        description: 'Please switch to light mode in order to view the invoice',
      });
    }
  }, [invoice]);

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
    window.print();
  };

  const handleBatchPrint = async () => {
    try {
      setIsBatchPrinting(true);

      const startInvoice = toNumber(id);
      const endInvoice = await window.electron.getLastInvoiceNumber(
        invoice?.invoiceType!,
      );
      const outputDir = await window.electron.getOutputDir();

      if (!endInvoice) {
        console.error('Could not determine last invoice number');
        return;
      }

      console.log(
        `Starting batch PDF generation for invoices ${invoice?.invoiceNumber} to ${endInvoice}...`,
      );

      let successCount = 0;
      let failCount = 0;

      for (let currentId = startInvoice; currentId <= endInvoice; currentId++) {
        if (!invoice?.invoiceNumber) continue;
        let currentInvoiceNumber = currentId;

        try {
          const invoiceNumber = await window.electron.doesInvoiceExists(
            currentId,
            invoice?.invoiceType!,
          );

          if (!invoiceNumber) continue;
          currentInvoiceNumber = invoiceNumber;

          // Navigate to invoice
          navigate(`/invoices/${currentId}/print`);

          // Wait for page to load
          // eslint-disable-next-line no-promise-executor-return
          await new Promise((resolve) => setTimeout(resolve, 10));

          // Generate PDF
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
          console.error(
            `Error processing invoice ${currentInvoiceNumber}:`,
            err,
          );
        }
      }

      toast({
        title: 'Batch Processing Complete',
        description: `Successfully generated ${successCount} PDFs${
          failCount > 0 ? `, Failed: ${failCount}` : ''
        }. Files saved to: ${outputDir}`,
        variant: failCount > 0 ? 'destructive' : 'success',
      });
    } catch (error: unknown) {
      console.error('Batch processing error:', error);
      toast({
        title: 'Error',
        description: `Failed to process batch: ${
          error instanceof Error ? error.message : error
        }`,
        variant: 'destructive',
      });
    } finally {
      setIsBatchPrinting(false);
    }
  };

  const routeInvoiceId = toNumber(id);
  const isInvoiceSynced = invoice != null && invoice.id === routeInvoiceId;

  const handleClose = () => {
    if (!invoice || !isInvoiceSynced) {
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
    return <div>Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-white p-8 print:p-0">
      <div className="print:hidden mb-4">
        <div className="flex flex-col gap-2">
          <div className="flex gap-1">
            <Button
              onClick={handleClose}
              variant="outline"
              className="min-w-[7.5rem] gap-1.5 px-2"
              disabled={isBatchPrinting || !isInvoiceSynced}
            >
              Back
              <Kbd className="hidden sm:inline-flex">Esc</Kbd>
            </Button>
            <Button
              onClick={handlePrint}
              className="min-w-[10.5rem] gap-1.5 px-2"
              disabled={isBatchPrinting || !isInvoiceSynced}
            >
              Print
              <KbdGroup className="hidden sm:inline-flex">
                <Kbd>{showAppleKbdHints ? '⌘' : 'Ctrl'}</Kbd>
                <Kbd>P</Kbd>
              </KbdGroup>
            </Button>
            <Button
              onClick={handleBatchPrint}
              className="w-[250px]"
              disabled={isBatchPrinting || !isInvoiceSynced}
            >
              {isBatchPrinting ? 'Generating PDFs...' : 'Batch Generate PDFs'}
            </Button>
            {isBatchPrinting ? (
              <h1 className="text-red-500 text-xl font-extrabold">
                PLEASE WAIT TILL THE PROCESS FINISHES.
              </h1>
            ) : null}
          </div>
          <div className="flex gap-1">
            <Button
              onClick={handlePrevious}
              variant="outline"
              disabled={
                !isInvoiceSynced ||
                adjacentInvoiceIds.previous <= 0 ||
                isBatchPrinting
              }
              className="min-w-[7.5rem] gap-1.5 px-2"
            >
              Previous
              <Kbd className="hidden sm:inline-flex">←</Kbd>
            </Button>
            <Button
              onClick={handleNext}
              variant="outline"
              disabled={
                !isInvoiceSynced ||
                adjacentInvoiceIds.next <= 0 ||
                isBatchPrinting
              }
              className="min-w-[7.5rem] gap-1.5 px-2"
            >
              Next
              <Kbd className="hidden sm:inline-flex">→</Kbd>
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
          <div className="print:hidden absolute inset-0 z-10 flex items-start justify-center pt-24 bg-white/40 pointer-events-none">
            <span className="text-sm font-medium text-neutral-600">
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
