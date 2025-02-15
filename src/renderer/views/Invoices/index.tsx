import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/renderer/shad/ui/dialog';
import { isNil, toString } from 'lodash';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  currencyFormatOptions,
  dateFormatOptions,
} from 'renderer/lib/constants';
import { defaultSortingFunctions } from 'renderer/lib/utils';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import {
  DateRangePickerWithPresets,
  type DateRange,
} from 'renderer/shad/ui/datePicker';
import { Table, TableBody, TableCell, TableRow } from 'renderer/shad/ui/table';
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
  const [filteredInvoices, setFilteredInvoices] = useState<InvoicesView[]>();
  const [invoiceFilterDate, setInvoiceFilterDate] = useState<
    DateRange | undefined
  >(window.electron.store.get('invoiceFilterDate') || undefined);
  const [invoiceFilterSelectValue, setInvoiceFilterSelectValue] = useState<
    string | undefined
  >(window.electron.store.get('invoiceFilterSelectValue') || undefined);

  const navigate = useNavigate();
  const [previewInvoiceId, setPreviewInvoiceId] = useState<number>();

  const columns: ColumnDef<InvoicesView>[] = useMemo(
    () => [
      {
        accessorKey: 'invoiceNumber',
        header: 'Invoice #',
        onClick: (row) =>
          propInvoices
            ? setPreviewInvoiceId(row.original.invoiceNumber)
            : navigate(toString(row.original.id)),
      },
      {
        accessorKey: 'date',
        header: 'Date',
        onClick: (row) =>
          propInvoices
            ? setPreviewInvoiceId(row.original.invoiceNumber)
            : navigate(toString(row.original.id)),
      },
      {
        accessorKey: 'totalAmount',
        header: 'Total Amount',
        onClick: (row) =>
          propInvoices
            ? setPreviewInvoiceId(row.original.invoiceNumber)
            : navigate(toString(row.original.id)),
        cell: ({ row }) =>
          Intl.NumberFormat('en-US', currencyFormatOptions).format(
            row.original.totalAmount || 0,
          ),
      },
      {
        accessorKey: 'accountName',
        header: invoiceType === InvoiceType.Sale ? 'Customer' : 'Vendor',
        onClick: (row) =>
          propInvoices
            ? setPreviewInvoiceId(row.original.invoiceNumber)
            : navigate(toString(row.original.id)),
      },
    ],
    [invoiceType, navigate, propInvoices],
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
          const invoiceDate = new Date(invoice.date).setHours(0, 0, 0, 0);
          const fromDate = new Date(from).setHours(0, 0, 0, 0);
          const toDate = new Date(to).setHours(0, 0, 0, 0);

          return invoiceDate >= fromDate && invoiceDate <= toDate;
        }),
      );
    },
    [invoices],
  );

  useEffect(() => {
    (async function fetchInvoices() {
      if (isNil(propInvoices)) {
        const rawInvoices = (await window.electron.getInvoices(
          invoiceType,
        )) as InvoicesView[];
        setInvoices(rawInvoices);
      } else setInvoices(propInvoices);
    })();
  }, [invoiceType, propInvoices]);

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

  useEffect(
    () => window.electron.store.set('filteredInvoices', filteredInvoices),
    [filteredInvoices],
  );

  useEffect(
    () => window.electron.store.set('invoiceFilterDate', invoiceFilterDate),
    [invoiceFilterDate],
  );

  useEffect(
    () =>
      window.electron.store.set(
        'invoiceFilterSelectValue',
        invoiceFilterSelectValue,
      ),
    [invoiceFilterSelectValue],
  );

  return (
    <div>
      <div
        className={`py-4 pr-4 ${
          isMini
            ? 'grid grid-cols-2 grid-rows-2 gap-4'
            : 'flex justify-between items-center'
        }`}
      >
        <div
          className={`flex gap-4 items-center justify-between ${
            isMini ? 'col-span-2 row-span-1 order-1' : ''
          }`}
        >
          <p className="text-muted-foreground font-bold text-sm">VIEW BY:</p>
          <DateRangePickerWithPresets
            $onSelect={handleFilterDateSelect}
            presets={[{ label: 'All', value: 'all' }]}
            initialRange={invoiceFilterDate}
            initialSelectValue={invoiceFilterSelectValue}
          />
        </div>

        <h1 className="text-2xl col-span-1 row-span-1">Invoices</h1>

        <Button
          variant="outline"
          onClick={() => navigate(`/${invoiceType.toLowerCase()}/invoices/new`)}
          className="flex items-center col-span-1 row-span-1"
        >
          <Plus size={16} />
          <span className="ml-3 mr-1">New Invoice</span>
        </Button>
      </div>

      {invoiceType === InvoiceType.Sale && filteredInvoices?.length ? (
        <Dialog>
          <DialogTrigger>
            <Button>Export Sale Invoices</Button>
          </DialogTrigger>
          <DialogContent>
            <ExportInvoices />
          </DialogContent>
        </Dialog>
      ) : null}

      <div className="py-8 pr-4 flex flex-col gap-6">
        {isMini ? (
          <Table>
            <TableBody>
              {filteredInvoices?.map((invoice) => (
                <TableRow
                  key={invoice.id}
                  onClick={() =>
                    navigate(
                      `/${invoiceType.toLowerCase()}/invoices/${invoice.id}`,
                    )
                  }
                >
                  <TableCell>
                    <div className="flex justify-between items-center">
                      <div className="flex flex-col">
                        <p>
                          {new Date(invoice.date || '').toLocaleString(
                            'en-US',
                            dateFormatOptions,
                          )}
                        </p>
                        <p className="font-extrabold">
                          {invoice.invoiceNumber}
                        </p>
                      </div>
                      <div className="flex flex-col">
                        <p className="text-end text-green-600">
                          {invoice.accountName}
                        </p>
                        <p>
                          {Intl.NumberFormat(
                            'en-US',
                            currencyFormatOptions,
                          ).format(invoice.totalAmount || 0)}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <DataTable
            columns={columns}
            data={filteredInvoices || []}
            sortingFns={defaultSortingFunctions}
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
