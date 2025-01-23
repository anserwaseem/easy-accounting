/* eslint-disable no-continue */
/* eslint-disable no-await-in-loop */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, isValid } from 'date-fns';
import { InvoiceView } from 'types';
import { Button } from 'renderer/shad/ui/button';
import { toast } from '@/renderer/shad/ui/use-toast';
import { toWords } from 'number-to-words';
import { toNumber, toString } from 'lodash';
import { INVOICE_DISCOUNT_PERCENTAGE } from '@/renderer/lib/constants';

const PrintableInvoiceScreen = () => {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [doesInvoiceExists, setDoesInvoiceExists] = useState<{
    next: boolean;
    previous: boolean;
  }>({ next: false, previous: false });
  const [isBatchPrinting, setIsBatchPrinting] = useState(false);
  const navigate = useNavigate();

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

  if (!invoice) {
    return <div>Loading...</div>;
  }

  const totalQuantity = invoice.invoiceItems.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const totalAmount = invoice.totalAmount || 0;
  const discountedTotal =
    totalAmount * ((100 - INVOICE_DISCOUNT_PERCENTAGE) / 100);

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
          <div className="w-full">
            <p className="text-sm text-center font-mono">SALES TAX INVOICE</p>
            <h1 className="text-3xl font-bold text-center font-mono">
              ALIF ZAFAR SONS
            </h1>
            <p className="text-sm text-center font-mono">
              Head Office: Iqra Center, Ghazni Street, Urdu Bazar, Lahore Phone:
              37120115, 37245149
            </p>
            <p className="text-sm text-center font-mono">
              Manufacturing Unit: &nbsp;T.No.4, Bund Road, Sanda Kalan, Lahore
            </p>
            <p className="text-sm text-center font-mono">
              NTN No.: 1406678-5&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;STRN:
              3277876185527
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
            {/* <div className="flex gap-4">
              <p>BILTY&nbsp;</p>
              <p>()&nbsp;CARTONS</p>
            </div> */}
          </div>
          <div className="flex gap-12">
            <p>BILL TO:</p>
            <p>Walk In Customer</p>
            <p>Lahore</p>
            <p className="pl-48">NTN/CNIC No.</p>
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
              <th className="text-right py-2 pr-4">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.invoiceItems.map((item, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={index} className="border-b border-gray-300">
                <td>{index + 1}</td>
                <td className="text-center">{item.inventoryItemName}</td>
                <td>{item.inventoryItemDescription}</td>
                <td className="text-right">{item.quantity}</td>
                <td className="text-right">{item.price.toFixed(0)}</td>
                <td className="text-right pr-4">
                  {(item.quantity * item.price).toFixed(0)}
                </td>
              </tr>
            ))}
            <tr>
              <td />
              <td />
              <td className="py-2 flex justify-end">
                <p className="underline">Total No. of Quran Sold:</p>
                &nbsp;&nbsp;
              </td>
              <td className="py-2">{totalQuantity}</td>
              <td />
              <td className="py-2 pr-4 text-right">{totalAmount}</td>
            </tr>
            <tr>
              <td />
              <td />
              <td className="py-2 text-right">
                Total After {INVOICE_DISCOUNT_PERCENTAGE}% Discount:&nbsp;&nbsp;
              </td>
              <td />
              <td />
              <td className="py-2 pr-4 font-bold text-right">
                {discountedTotal.toFixed(0)}
              </td>
            </tr>
          </tbody>
        </table>

        <div>
          <div className="flex flex-col gap-2">
            <h3>
              Total Rs.{' '}
              {toWords(discountedTotal)
                .split(' ')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ')}
            </h3>
            {/* <div className="flex border-b-2 border-gray-300">
              <h2 className="text-lg font-bold border-2 border-gray-300 border-r-0 border-b-0 py-1 px-4">
                Total:
              </h2>
              <h2 className="text-lg font-bold text-center border-2 border-gray-300 border-b-0 py-1 px-12">
                {discountedTotal.toFixed(0)}
              </h2>
            </div> */}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintableInvoiceScreen;
