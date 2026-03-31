/* eslint-disable no-await-in-loop */
import { usePrimaryItemType } from '@/renderer/hooks';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, isValid } from 'date-fns';
import { InvoiceView } from 'types';
import { Button } from 'renderer/shad/ui/button';
import { toast } from '@/renderer/shad/ui/use-toast';
import { toWords } from 'number-to-words';
import { toNumber, toString } from 'lodash';
import {
  computeSectionTotals,
  groupInvoiceItemsByType,
} from '@/renderer/lib/invoiceUtils';
import {
  getFormattedCurrency,
  stripItemTypeSuffixFromAccountName,
} from '@/renderer/lib/utils';

const PrintableInvoiceScreen = () => {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const { primaryItemTypeName, itemTypeNames } = usePrimaryItemType();
  const [doesInvoiceExists, setDoesInvoiceExists] = useState<{
    next: boolean;
    previous: boolean;
  }>({ next: false, previous: false });
  const [isBatchPrinting, setIsBatchPrinting] = useState(false);
  const navigate = useNavigate();

  const biltyGoodsText = useMemo(() => {
    if (!invoice) return '';
    const bilty = invoice.biltyNumber ?? '';
    const goods = invoice.accountGoodsName?.trim();
    return goods ? `${bilty} (${goods})` : `${bilty}`;
  }, [invoice]);

  useEffect(() => {
    const fetchInvoice = async () => {
      const fetchedInvoice = await window.electron.getInvoice(toNumber(id));
      setInvoice(fetchedInvoice);

      const next = await window.electron.doesInvoiceExists(
        toNumber(id) + 1,
        invoice?.invoiceType!,
      );
      const previous = await window.electron.doesInvoiceExists(
        toNumber(id) - 1,
        invoice?.invoiceType!,
      );
      setDoesInvoiceExists({ next, previous });
    };
    fetchInvoice();
  }, [id, invoice?.invoiceType]);

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

  const handleClose = () => {
    navigate('/');
  };

  const handleNext = () => {
    navigate(`/invoices/${toNumber(id) + 1}/print`);
  };

  const handlePrevious = () => {
    navigate(`/invoices/${toNumber(id) - 1}/print`);
  };

  const invoiceItems = useMemo(
    () => invoice?.invoiceItems ?? [],
    [invoice?.invoiceItems],
  );
  const billToName = useMemo(() => {
    const name = stripItemTypeSuffixFromAccountName(
      invoice?.accountName,
      itemTypeNames,
    );
    return name === '—' ? 'WALK IN CUSTOMER' : name;
  }, [invoice?.accountName, itemTypeNames]);
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
        {
          kind: 'header' as const,
          key: `${section.sectionName}-header`,
          sectionName: section.sectionName,
        },
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
              className="w-[100px]"
              disabled={isBatchPrinting}
            >
              Close
            </Button>
            <Button
              onClick={handlePrint}
              className="w-[150px]"
              disabled={isBatchPrinting}
            >
              Print Invoice
            </Button>
            <Button
              onClick={handleBatchPrint}
              className="w-[250px]"
              disabled={isBatchPrinting}
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
              disabled={!doesInvoiceExists.previous || isBatchPrinting}
              className="w-[100px]"
            >
              Previous
            </Button>
            <Button
              onClick={handleNext}
              variant="outline"
              disabled={!doesInvoiceExists.next || isBatchPrinting}
              className="w-[150px]"
            >
              Next
            </Button>
          </div>
        </div>
      </div>
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center">
          <div className="w-full text-[13px]">
            <h1 className="text-3xl font-bold text-center font-mono">
              ALIF ZAFAR SONS
            </h1>
            <p className="text-center font-mono text-sm">
              Iqra Center, Ghazni Street, Urdu Bazar, Lahore Phone: 37245149
            </p>
          </div>
        </div>

        <div className="grid grid-rows-2">
          <div className="flex justify-between">
            <div className="flex gap-4">
              <p>INVOICE NO.</p>
              <p>{invoice.invoiceNumber}</p>
            </div>
            <div className="flex gap-4 pr-4">
              <p>DATE</p>
              <p>
                {isValid(new Date(invoice.date))
                  ? format(invoice.date, 'PP')
                  : invoice.date}
              </p>
            </div>
            <div className="flex gap-4">
              <p>BILTY&nbsp;</p>
              <p>{biltyGoodsText}</p>
              <p>&nbsp;CARTONS&nbsp;</p>
              <p>{invoice.cartons ?? ''}</p>
            </div>
          </div>
          <div className="flex gap-12">
            <p>BILL TO:</p>
            <p>{billToName}</p>
            <p className="whitespace-pre-wrap break-words">{billToAddress}</p>
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
              <td className="italic absolute">Total No. of Quran Sold:</td>
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
