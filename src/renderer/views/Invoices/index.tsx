import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/renderer/shad/ui/dialog';
import { isNil, toNumber } from 'lodash';
import { File, Loader2, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  cn,
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import {
  DateRangePickerWithPresets,
  type DateRange,
} from 'renderer/shad/ui/datePicker';
import type { HasMiniView, InvoicesView, InvoiceView } from 'types';
import { InvoiceType } from 'types';
// eslint-disable-next-line import/no-cycle
import InvoicePage from '../Invoice';
import { ExportInvoices } from './exportInvoices';

interface InvoicesProps extends HasMiniView {
  invoiceType: InvoiceType;
  invoices?: InvoiceView[];
}

const InvoicesPage: React.FC<InvoicesProps> = ({
  invoiceType,
  isMini = false,
  invoices: propInvoices,
}: InvoicesProps) => {
  const [invoices, setInvoices] = useState<InvoicesView[]>();
  console.log('InvoicesPage', invoices);
  const [isLoading, setIsLoading] = useState(true);
  const [filteredInvoices, setFilteredInvoices] = useState<InvoicesView[]>();
  const [invoiceFilterDate, setInvoiceFilterDate] = useState<
    DateRange | undefined
  >(window.electron.store.get('invoiceFilterDate') || undefined);
  const [invoiceFilterSelectValue, setInvoiceFilterSelectValue] = useState<
    string | undefined
  >(window.electron.store.get('invoiceFilterSelectValue') || undefined);
  const [previewInvoiceId, setPreviewInvoiceId] = useState<number>();

  const navigate = useNavigate();

  const navigateToInvoice = useCallback(
    (id: number) => navigate(`/${invoiceType.toLowerCase()}/invoices/${id}`),
    [invoiceType, navigate],
  );

  const columns: ColumnDef<InvoicesView>[] = useMemo(
    () => [
      ...((isMini
        ? [
            {
              id: 'miniView',
              header: `${invoiceType} Invoices`,
              accessorFn: (row) => row,
              accessorKey: 'invoices',
              // eslint-disable-next-line react/no-unstable-nested-components
              cell: ({ getValue }) => {
                const invoice = getValue() as InvoicesView;
                return (
                  <div className="flex justify-between items-start w-full">
                    <div className="flex flex-col">
                      <p>{invoice.date}</p>
                      <p className="font-extrabold">{invoice.invoiceNumber}</p>
                    </div>
                    <div className="flex flex-col text-end">
                      <p className="text-muted-foreground">
                        {invoice.accountName}
                      </p>
                      {invoiceType === InvoiceType.Sale && (
                        <p>
                          {getFormattedCurrency(toNumber(invoice.totalAmount))}
                        </p>
                      )}
                    </div>
                  </div>
                );
              },
              onClick: (row) =>
                propInvoices
                  ? setPreviewInvoiceId(row.original.invoiceNumber)
                  : navigateToInvoice(row.original.id),
            },
          ]
        : [
            {
              accessorKey: 'invoiceNumber',
              header: 'Invoice #',
              onClick: (row) =>
                propInvoices
                  ? setPreviewInvoiceId(row.original.invoiceNumber)
                  : navigateToInvoice(row.original.id),
            },
            {
              accessorKey: 'date',
              header: 'Date (MM/DD/YYYY)',
              onClick: (row) =>
                propInvoices
                  ? setPreviewInvoiceId(row.original.invoiceNumber)
                  : navigateToInvoice(row.original.id),
            },
            {
              accessorKey: 'accountName',
              header: invoiceType === InvoiceType.Sale ? 'Customer' : 'Vendor',
              onClick: (row) =>
                propInvoices
                  ? setPreviewInvoiceId(row.original.invoiceNumber)
                  : navigateToInvoice(row.original.id),
            },
            ...(invoiceType === InvoiceType.Sale
              ? ([
                  {
                    accessorKey: 'totalAmount',
                    header: 'Total Amount',
                    onClick: (row) =>
                      propInvoices
                        ? setPreviewInvoiceId(row.original.invoiceNumber)
                        : navigateToInvoice(row.original.id),
                    cell: ({ getValue }) =>
                      getFormattedCurrency(toNumber(getValue())),
                  },
                  {
                    accessorKey: 'biltyNumber',
                    header: 'Bilty #',
                    onClick: (row) =>
                      propInvoices
                        ? setPreviewInvoiceId(row.original.invoiceNumber)
                        : navigateToInvoice(row.original.id),
                  },
                  {
                    accessorKey: 'cartons',
                    header: 'Cartons',
                    onClick: (row) =>
                      propInvoices
                        ? setPreviewInvoiceId(row.original.invoiceNumber)
                        : navigateToInvoice(row.original.id),
                  },
                ] as ColumnDef<InvoicesView>[])
              : []),
          ]) as ColumnDef<InvoicesView>[]),
    ],
    [invoiceType, navigateToInvoice, propInvoices, isMini],
  );

  const handleFilterDateSelect = useCallback(
    (dateRange?: DateRange, selectValue?: string) => {
      if (selectValue) setInvoiceFilterSelectValue(selectValue);
      if (selectValue === 'all') return setFilteredInvoices(invoices);

      if (!dateRange) return;

      const { from, to } = dateRange;
      if (!from || !to) return;

      setInvoiceFilterDate(dateRange);
      setFilteredInvoices(
        invoices?.filter((invoice) => {
          // parse the DD/MM/YYYY format to a Date object
          const [month, day, year] = invoice.date.split('/');
          const invoiceDate = new Date(+year, +month - 1, +day).setHours(
            0,
            0,
            0,
            0,
          );
          const fromDate = new Date(from).setHours(0, 0, 0, 0);
          const toDate = new Date(to).setHours(0, 0, 0, 0);

          return invoiceDate >= fromDate && invoiceDate <= toDate;
        }),
      );
    },
    [invoices],
  );

  // fetch invoices
  useEffect(() => {
    const fetchInvoices = async () => {
      const fetchedInvoices: InvoicesView[] = isNil(propInvoices)
        ? await window.electron.getInvoices(invoiceType)
        : propInvoices;
      setInvoices(fetchedInvoices);
      setIsLoading(false);
    };
    fetchInvoices();
  }, [invoiceType, propInvoices]);

  // handle filter invoices
  useEffect(
    () =>
      invoiceFilterDate || invoiceFilterSelectValue
        ? handleFilterDateSelect(invoiceFilterDate, invoiceFilterSelectValue)
        : setFilteredInvoices(invoices),
    [
      handleFilterDateSelect,
      invoiceFilterDate,
      invoiceFilterSelectValue,
      invoices,
    ],
  );

  // save filtered invoices to store
  useEffect(
    () => window.electron.store.set('filteredInvoices', filteredInvoices),
    [filteredInvoices],
  );

  // save invoice filter date to store
  useEffect(
    () => window.electron.store.set('invoiceFilterDate', invoiceFilterDate),
    [invoiceFilterDate],
  );

  // save invoice filter selected value to store
  useEffect(
    () =>
      window.electron.store.set(
        'invoiceFilterSelectValue',
        invoiceFilterSelectValue,
      ),
    [invoiceFilterSelectValue],
  );

  // TODO: fix scrollbar when isMini is true
  return (
    <div>
      <div
        className={cn(
          'grid py-4',
          isMini ? 'grid-cols-2 grid-rows-2 gap-4' : 'grid-cols-3 items-center',
        )}
      >
        <div
          className={cn(
            'flex gap-4 items-center',
            isMini && 'col-span-2 row-span-1 order-1',
          )}
        >
          <p className="text-muted-foreground font-bold text-sm">VIEW BY:</p>
          <DateRangePickerWithPresets
            $onSelect={handleFilterDateSelect}
            presets={[{ label: 'All', value: 'all' }]}
            initialRange={invoiceFilterDate}
            initialSelectValue={invoiceFilterSelectValue}
          />
        </div>

        <h1 className={cn('title', isMini && 'hidden')}>
          {invoiceType} Invoices
        </h1>

        <div className="flex items-center gap-2 w-fit ml-auto">
          {invoiceType === InvoiceType.Sale && filteredInvoices?.length ? (
            <Dialog>
              <DialogTrigger>
                <Button variant="secondary">
                  <File size={16} className="mr-2" />
                  Export Sale Invoices
                </Button>
              </DialogTrigger>
              <DialogContent>
                <ExportInvoices />
              </DialogContent>
            </Dialog>
          ) : null}
          <Button
            variant="outline"
            onClick={() =>
              navigate(`/${invoiceType.toLowerCase()}/invoices/new`)
            }
            className="col-span-1 row-span-1"
          >
            <Plus size={16} className="mr-2" />
            New Invoice
          </Button>
        </div>
      </div>

      <div className="py-8 flex flex-col gap-6">
        {isLoading ? (
          <div className="flex justify-center items-center h-full">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filteredInvoices || []}
            sortingFns={defaultSortingFunctions}
            defaultSortField="invoiceNumber" // FIXME: for mini view, nested field sorting is not working
            defaultSortDirection="desc"
            virtual
            isMini={isMini}
            searchPlaceholder={`Search ${invoiceType.toLowerCase()} invoices...`}
            searchFields={[
              'invoiceNumber',
              'accountName',
              'date',
              'totalAmount',
            ]}
          />
        )}
      </div>
      <Dialog
        open={!isNil(previewInvoiceId)}
        onOpenChange={() => setPreviewInvoiceId(undefined)}
      >
        <DialogContent className="max-h-[90%] overflow-hidden max-w-[60%]">
          <InvoicePage invoiceType={invoiceType} previewId={previewInvoiceId} />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InvoicesPage;
