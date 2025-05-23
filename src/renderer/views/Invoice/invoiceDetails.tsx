import { isNil, toNumber } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import {
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { InvoiceItemView, InvoiceView } from 'types';
import { InvoiceType } from 'types';
import { Button } from '@/renderer/shad/ui/button';
import { useNavigate } from 'react-router-dom';

interface InvoiceDetailsProps {
  invoiceType: InvoiceType;
  invoiceId: number;
  invoice?: InvoiceView;
}

export const InvoiceDetails: React.FC<InvoiceDetailsProps> = ({
  invoiceType,
  invoiceId,
  invoice: propInvoice,
}: InvoiceDetailsProps) => {
  const [invoice, setInvoice] = useState<InvoiceView>();
  const navigate = useNavigate();
  // eslint-disable-next-line no-console
  console.log('InvoiceDetails', invoiceId, propInvoice, invoice);

  useEffect(() => {
    const fetchInvoice = async () => {
      if (isNil(propInvoice))
        setInvoice(await window.electron.getInvoice(invoiceId));
      else setInvoice(propInvoice);
    };
    fetchInvoice();
  }, [invoiceId, propInvoice]);

  const columns: ColumnDef<InvoiceItemView>[] = useMemo(() => {
    return [
      {
        accessorKey: 'inventoryItemName',
        header: 'Item',
      },
      {
        accessorKey: 'quantity',
        header: 'Quantity',
      },
      ...(invoiceType === InvoiceType.Sale
        ? ([
            {
              accessorKey: 'price',
              header: 'Price',
              cell: ({ getValue }) =>
                getFormattedCurrency(toNumber(getValue())),
            },
            {
              accessorKey: 'discount',
              header: 'Discount',
              cell: ({ getValue }) => `${getValue()}%`,
            },
            {
              accessorKey: 'discountedPrice',
              header: 'Discounted Price',
              cell: ({ getValue }) =>
                getFormattedCurrency(toNumber(getValue())),
            },
          ] as ColumnDef<InvoiceItemView>[])
        : []),
      ...(isNil(invoice?.accountName)
        ? [
            {
              accessorKey: 'accountName',
              header: 'Customer',
            },
          ]
        : []),
    ];
  }, [invoiceType, invoice?.accountName]);

  const handlePrintClick = () => {
    navigate(`/invoices/${invoice!.id}/print`);
  };

  return (
    <div>
      <div className="w-full">
        <h1 className="text-4xl font-light">{`${invoiceType.toUpperCase()} INVOICE`}</h1>
        <div className="grid grid-cols-2">
          <div className="flex flex-col gap-2 mt-8">
            <div className="flex gap-8">
              <p className="font-extrabold text-md w-[160px]">Invoice #:</p>
              <p>{invoice?.invoiceNumber}</p>
            </div>
            {isNil(invoice?.accountName) ? null : (
              <div className="flex gap-8">
                <p className="font-medium text-md w-[160px]">{`${
                  invoiceType === InvoiceType.Sale ? 'Customer' : 'Vendor'
                }:`}</p>
                <p>{invoice?.accountName}</p>
              </div>
            )}
            <div className="flex gap-8">
              <p className="font-medium text-md w-[160px]">Date:</p>
              <p>{invoice?.date}</p>
            </div>
            {invoiceType === InvoiceType.Sale ? (
              <>
                <div className="flex gap-8">
                  <p className="font-medium text-md w-[160px]">Bilty #:</p>
                  <p>{invoice?.biltyNumber}</p>
                </div>
                <div className="flex gap-8">
                  <p className="font-medium text-md w-[160px]">Cartons:</p>
                  <p>{invoice?.cartons}</p>
                </div>
              </>
            ) : null}
            {invoiceType === InvoiceType.Sale ? (
              <>
                <div className="flex gap-8">
                  <p className="font-medium text-md w-[160px]">
                    Extra Discount:
                  </p>
                  <p>
                    {getFormattedCurrency(toNumber(invoice?.extraDiscount))}
                  </p>
                </div>
                <div className="flex gap-8">
                  <p className="font-medium text-md w-[160px] self-center">
                    Amount:
                  </p>
                  <p className="border-2 border-green-500 rounded-lg -ml-2 p-2">
                    {getFormattedCurrency(toNumber(invoice?.totalAmount))}
                  </p>
                </div>
              </>
            ) : null}
          </div>

          {propInvoice || invoiceType === InvoiceType.Purchase ? null : (
            <div className="flex flex-col justify-end gap-4 w-32 ml-auto">
              <Button onClick={handlePrintClick} className="px-4 py-8">
                View Printable Invoice
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="py-10">
        <DataTable
          columns={columns}
          data={invoice?.invoiceItems || []}
          sortingFns={defaultSortingFunctions}
        />
      </div>
    </div>
  );
};
