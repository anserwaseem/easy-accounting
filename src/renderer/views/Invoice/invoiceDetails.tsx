import { usePrimaryItemType } from '@/renderer/hooks';
import { isNil, toNumber } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import {
  dateFormatOptions,
  datetimeFormatOptions,
} from 'renderer/lib/constants';
import {
  computeSectionTotals,
  groupInvoiceItemsByType,
  stripItemTypeSuffixFromAccountName,
} from '@/renderer/lib/invoiceUtils';
import {
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { InvoiceItemView, InvoiceView } from 'types';
import { InvoiceType } from 'types';
import { Button } from '@/renderer/shad/ui/button';
import { useNavigate } from 'react-router-dom';
import { EditInvoiceBiltyCartonsDialog } from './EditInvoiceBiltyCartonsDialog';

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
  const { primaryItemTypeName, itemTypeNames } = usePrimaryItemType();
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

  const customerDisplayName = useMemo(
    () =>
      stripItemTypeSuffixFromAccountName(invoice?.accountName, itemTypeNames),
    [invoice?.accountName, itemTypeNames],
  );

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
    ];
  }, [invoiceType]);

  const groupedInvoiceItems = useMemo(() => {
    const sections = groupInvoiceItemsByType(
      invoice?.invoiceItems ?? [],
      primaryItemTypeName,
    );
    return sections.map((section) => ({
      ...section,
      ...computeSectionTotals(section.items),
    }));
  }, [invoice?.invoiceItems, primaryItemTypeName]);

  const quantityColumnIndex = useMemo(
    () =>
      columns.findIndex(
        (column) =>
          (column as { accessorKey?: string }).accessorKey === 'quantity',
      ),
    [columns],
  );

  const totalColumnIndex = useMemo(
    () =>
      columns.findIndex((column) => {
        const { accessorKey } = column as { accessorKey?: string };
        if (invoiceType === InvoiceType.Sale)
          return accessorKey === 'discountedPrice';
        return accessorKey === 'price';
      }),
    [columns, invoiceType],
  );

  const handlePrintClick = () => {
    navigate(`/invoices/${invoice!.id}/print`);
  };

  return (
    <div>
      <div className="w-full">
        <h1 className="text-4xl font-light">{`${invoiceType.toUpperCase()} INVOICE`}</h1>
        <div className="grid grid-cols-2">
          <div className="flex flex-col gap-2 mt-8">
            <div className="flex gap-8 items-center">
              <p className="font-extrabold text-md w-[160px]">Invoice #:</p>
              <div className="flex items-center gap-2">
                <p>{invoice?.invoiceNumber}</p>
                {invoiceType === InvoiceType.Sale && invoice?.id != null && (
                  <EditInvoiceBiltyCartonsDialog
                    invoiceId={invoice.id}
                    biltyNumber={invoice.biltyNumber}
                    cartons={invoice.cartons}
                    onSave={async (id, bilty, cartonsCount) => {
                      await window.electron.updateInvoiceBiltyAndCartons(
                        id,
                        bilty,
                        cartonsCount,
                      );
                      const updated = await window.electron.getInvoice(id);
                      setInvoice(updated);
                    }}
                  />
                )}
              </div>
            </div>
            <div className="flex gap-8">
              <p className="font-medium text-md min-w-[160px]">{`${
                invoiceType === InvoiceType.Sale ? 'Customer' : 'Vendor'
              }:`}</p>
              <p className="whitespace-nowrap">{customerDisplayName}</p>
            </div>
            <div className="flex gap-8">
              <p className="font-medium text-md w-[160px]">Date:</p>
              <p>
                {invoice?.date
                  ? new Date(invoice.date).toLocaleString(
                      'en-US',
                      dateFormatOptions,
                    )
                  : ''}
              </p>
            </div>
            {invoiceType === InvoiceType.Sale ? (
              <>
                {invoice?.biltyNumber != null &&
                  String(invoice.biltyNumber).trim() !== '' && (
                    <div className="flex gap-8">
                      <p className="font-medium text-md w-[160px]">Bilty #:</p>
                      <p>{invoice.biltyNumber}</p>
                    </div>
                  )}
                {!!invoice?.cartons && (
                  <div className="flex gap-8">
                    <p className="font-medium text-md w-[160px]">Cartons:</p>
                    <p>{invoice.cartons}</p>
                  </div>
                )}
                {invoice?.createdAt !== invoice?.updatedAt &&
                  invoice?.updatedAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Updated: At{' '}
                      {new Date(invoice.updatedAt).toLocaleString(
                        'en-US',
                        datetimeFormatOptions,
                      )}
                    </p>
                  )}
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

      <div className="space-y-8 py-10">
        {groupedInvoiceItems.map((section) => (
          <div key={section.sectionName} className="space-y-2">
            <h2 className="text-lg font-semibold">{section.sectionName}</h2>
            {section.items.length > 1 ? (
              <DataTable
                columns={columns}
                data={section.items}
                sortingFns={defaultSortingFunctions}
                infoData={[
                  Array.from({ length: columns.length }, (_, index) => {
                    if (index === quantityColumnIndex)
                      return section.totalQuantity;
                    if (index === totalColumnIndex)
                      return getFormattedCurrency(section.totalAmount);
                    return '';
                  }),
                ]}
              />
            ) : (
              <DataTable
                columns={columns}
                data={section.items}
                sortingFns={defaultSortingFunctions}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
