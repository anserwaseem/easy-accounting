import { Dialog, DialogContent } from '@/renderer/shad/ui/dialog';
import { isNil, toNumber } from 'lodash';
import {
  Copy,
  File,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
} from 'lucide-react';
import type { Row } from '@tanstack/react-table';
import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import {
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import { showInvoiceEditedIndicator } from '@/renderer/lib/invoiceUtils';
import { Badge } from 'renderer/shad/ui/badge';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import {
  DateRangePickerWithPresets,
  type DateRange,
} from 'renderer/shad/ui/datePicker';
import { EditActionButton } from '@/renderer/components/EditActionButton';
import { RowMenu } from '@/renderer/components/RowMenu';
import type { HasMiniView, InvoicesView, InvoiceView } from 'types';
import { InvoiceType } from 'types';
import { formatDisplayDateTime } from '@/lib/displayDate';
import { DateCell } from '@/renderer/components/common/DateCell';
import { FilterGroup, PageHeader } from '@/renderer/components/PageHeader';
// eslint-disable-next-line import/no-cycle
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'renderer/shad/ui/dropdown-menu';
// eslint-disable-next-line import/no-cycle
import InvoicePage from '../Invoice';
import { ExportInvoices } from './exportInvoices';

interface InvoicesProps extends HasMiniView {
  invoiceType: InvoiceType;
  invoices?: InvoiceView[];
  /** list sale-return documents instead of posted sales */
  saleReturns?: boolean;
}

interface InvoiceEditActionCellProps {
  row: Row<InvoicesView>;
  invoiceType: InvoiceType;
  navigate: NavigateFunction;
  isPreviewMode: boolean;
}

const InvoiceEditActionCell: FC<InvoiceEditActionCellProps> = ({
  row,
  invoiceType,
  navigate,
  isPreviewMode,
}) => {
  const canEdit =
    toNumber(row.original.linkedJournalCount) > 0 && !row.original.isReturned;
  if (!canEdit) return null;

  return (
    <EditActionButton
      title="Edit invoice"
      aria-label="Edit invoice"
      disabled={isPreviewMode}
      onClick={(e) => {
        e.stopPropagation();
        if (isPreviewMode) return;
        navigate(
          `/${invoiceType.toLowerCase()}/invoices/${row.original.id}/edit`,
        );
      }}
    />
  );
};

const InvoiceDuplicateActionCell: FC<InvoiceEditActionCellProps> = ({
  row,
  invoiceType,
  navigate,
  isPreviewMode,
}) => (
  <EditActionButton
    title="Duplicate invoice"
    aria-label="Duplicate invoice"
    disabled={isPreviewMode}
    onClick={(e) => {
      e.stopPropagation();
      if (isPreviewMode) return;
      // prefills New Invoice with this invoice's customer + items at current prices
      navigate(`/${invoiceType.toLowerCase()}/invoices/new`, {
        state: { duplicateFromId: row.original.id },
      });
    }}
  >
    <Copy className="h-4 w-4" />
  </EditActionButton>
);

/**
 * The card's row control: one ⋮ at the end of the name, with the
 * row's actions behind it. The table keeps the two icon buttons.
 */
const InvoiceRowMenu: FC<InvoiceEditActionCellProps> = ({
  row,
  invoiceType,
  navigate,
  isPreviewMode,
}: InvoiceEditActionCellProps) => {
  const canEdit =
    toNumber(row.original.linkedJournalCount) > 0 && !row.original.isReturned;
  return (
    <RowMenu label="Invoice actions">
      {canEdit ? (
        <DropdownMenuItem
          disabled={isPreviewMode}
          onSelect={() => {
            if (isPreviewMode) return;
            navigate(
              `/${invoiceType.toLowerCase()}/invoices/${row.original.id}/edit`,
            );
          }}
        >
          <Pencil className="mr-2 h-4 w-4" />
          Edit invoice
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        disabled={isPreviewMode}
        onSelect={() => {
          if (isPreviewMode) return;
          // prefills New Invoice with this invoice's customer + items at
          // current prices
          navigate(`/${invoiceType.toLowerCase()}/invoices/new`, {
            state: { duplicateFromId: row.original.id },
          });
        }}
      >
        <Copy className="mr-2 h-4 w-4" />
        Duplicate invoice
      </DropdownMenuItem>
    </RowMenu>
  );
};

const createInvoiceActionsColumn = (
  invoiceType: InvoiceType,
  navigate: NavigateFunction,
  isPreviewMode: boolean,
): ColumnDef<InvoicesView> => ({
  id: 'actions',
  header: 'Actions',
  // Two icon buttons. At the 44px mobile touch target that needs
  // ~100px, not the 80px the 32px desktop buttons needed.
  size: 100,
  // The row's buttons get their own row in the card layout, without a
  // redundant "Actions" label.
  cardActions: true,
  // On a card there is room for one control, so both actions sit
  // behind a single ⋮ at the end of the name.
  // eslint-disable-next-line react/no-unstable-nested-components
  cardMenu: ({ row }) => (
    <InvoiceRowMenu
      row={row}
      invoiceType={invoiceType}
      navigate={navigate}
      isPreviewMode={isPreviewMode}
    />
  ),
  onClick: () => undefined,
  cell({ row }) {
    return (
      <div className="flex items-center gap-1">
        <InvoiceEditActionCell
          row={row}
          invoiceType={invoiceType}
          navigate={navigate}
          isPreviewMode={isPreviewMode}
        />
        <InvoiceDuplicateActionCell
          row={row}
          invoiceType={invoiceType}
          navigate={navigate}
          isPreviewMode={isPreviewMode}
        />
      </div>
    );
  },
});

const InvoicesPage: FC<InvoicesProps> = ({
  invoiceType,
  isMini = false,
  invoices: propInvoices,
  saleReturns = false,
}: InvoicesProps) => {
  const [invoices, setInvoices] = useState<InvoicesView[]>();
  const [isLoading, setIsLoading] = useState(true);
  const [filteredInvoices, setFilteredInvoices] = useState<InvoicesView[]>();
  const [invoiceFilterDate, setInvoiceFilterDate] = useState<
    DateRange | undefined
  >(window.electron.store.get('invoiceFilterDate') || undefined);
  const [invoiceFilterSelectValue, setInvoiceFilterSelectValue] = useState<
    string | undefined
  >(window.electron.store.get('invoiceFilterSelectValue') || undefined);
  const [previewInvoiceId, setPreviewInvoiceId] = useState<number>();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

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
              accessorKey: 'invoiceNumber',
              header: saleReturns ? 'Sale returns' : `${invoiceType} Invoices`,
              // eslint-disable-next-line react/no-unstable-nested-components
              cell: ({ row }) => {
                const invoice = row.original;
                return (
                  <div className="flex justify-between items-start w-full">
                    <div className="flex flex-col">
                      <p>
                        <DateCell value={invoice.date} />
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-extrabold">
                          {invoice.invoiceNumber}
                        </p>
                        {invoice.isReturned ? (
                          <Badge
                            variant="destructive"
                            className="text-[11px] font-normal"
                            title={
                              invoice.returnedAt
                                ? formatDisplayDateTime(invoice.returnedAt)
                                : undefined
                            }
                          >
                            {saleReturns ? 'Cancelled' : 'Returned'}
                          </Badge>
                        ) : null}
                        {showInvoiceEditedIndicator(invoice) ? (
                          <Badge
                            variant="amber"
                            className="text-[11px] font-normal"
                            title={
                              invoice.updatedAt
                                ? formatDisplayDateTime(invoice.updatedAt)
                                : undefined
                            }
                          >
                            Edited
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-col items-end gap-1.5 text-end">
                      <div className="flex max-w-full flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
                        <span className="font-medium leading-snug text-foreground">
                          {invoice.accountName}
                        </span>
                        {invoice.accountCode != null ? (
                          <Badge
                            variant="secondary"
                            className="shrink-0 px-1.5 py-0 text-[11px] font-mono font-normal tabular-nums"
                            title={`Account code ${invoice.accountCode}`}
                          >
                            {invoice.accountCode}
                          </Badge>
                        ) : null}
                      </div>
                      {invoiceType === InvoiceType.Sale && (
                        <p className="tabular-nums font-semibold">
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
            /* eslint-disable react/no-unstable-nested-components -- tanstack column cell factories */
            {
              accessorKey: 'invoiceNumber',
              header: <span className="whitespace-nowrap">Invoice #</span>,
              cardLabel: 'Invoice #',
              // the number and the date identify the invoice, so they
              // ride the muted line under the customer's name
              cardMeta: true,
              cell: ({ row }) => (
                <span className="inline-flex max-w-full flex-wrap items-center gap-1.5 whitespace-nowrap tabular-nums font-medium">
                  {row.original.invoiceNumber}
                  {row.original.isReturned ? (
                    <Badge
                      variant="destructive"
                      className="px-1.5 py-0 text-[11px] font-normal"
                      title={
                        row.original.returnedAt
                          ? formatDisplayDateTime(row.original.returnedAt)
                          : undefined
                      }
                    >
                      {saleReturns ? 'Cancelled' : 'Returned'}
                    </Badge>
                  ) : null}
                  {showInvoiceEditedIndicator(row.original) ? (
                    <Badge
                      variant="amber"
                      className="px-1.5 py-0 text-[11px] font-normal"
                      title={
                        row.original.updatedAt
                          ? formatDisplayDateTime(row.original.updatedAt)
                          : undefined
                      }
                    >
                      Edited
                    </Badge>
                  ) : null}
                </span>
              ),
              onClick: (row) =>
                propInvoices
                  ? setPreviewInvoiceId(row.original.invoiceNumber)
                  : navigateToInvoice(row.original.id),
              size: 110,
            },
            {
              accessorKey: 'date',
              header: 'Date',
              cardMeta: true,
              // eslint-disable-next-line react/no-unstable-nested-components
              cell: ({ row }) => <DateCell value={row.original.date} />,
              onClick: (row) =>
                propInvoices
                  ? setPreviewInvoiceId(row.original.invoiceNumber)
                  : navigateToInvoice(row.original.id),
              size: 110,
            },
            {
              accessorKey: 'accountName',
              header: invoiceType === InvoiceType.Sale ? 'Customer' : 'Vendor',
              // The party is what a reader scans for on an invoice
              // list, so it heads the card.
              cardHeadline: true,
              onClick: (row) =>
                propInvoices
                  ? setPreviewInvoiceId(row.original.invoiceNumber)
                  : navigateToInvoice(row.original.id),
              // 200px left the total amount cut off at the right edge on
              // a phone; 150px leaves room for it.
              size: 150,
            },
            {
              accessorKey: 'accountCode',
              header: 'Code',
              onClick: (row) =>
                propInvoices
                  ? setPreviewInvoiceId(row.original.invoiceNumber)
                  : navigateToInvoice(row.original.id),
              size: 100,
              // Low-value on a narrow screen — the account name/customer
              // column already identifies the party.
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
                    cell: ({ getValue }) => (
                      <span className="tabular">
                        {getFormattedCurrency(toNumber(getValue()))}
                      </span>
                    ),
                    size: 140,
                    cardAside: true,
                  },
                ] as ColumnDef<InvoicesView>[])
              : []),
            // consignment columns are not sale-only: a purchase booking a sale return
            // an agent collected carries the same bilty and carton count
            {
              accessorKey: 'biltyNumber',
              header: 'Bilty #',
              onClick: (row) =>
                propInvoices
                  ? setPreviewInvoiceId(row.original.invoiceNumber)
                  : navigateToInvoice(row.original.id),
              size: 90,
            },
            {
              accessorKey: 'cartons',
              header: 'Cartons',
              onClick: (row) =>
                propInvoices
                  ? setPreviewInvoiceId(row.original.invoiceNumber)
                  : navigateToInvoice(row.original.id),
              size: 56,
              // Kept visible at every width, unlike Code/Bilty# above
              // — cartons is the core figure this business's invoice
              // list workflow is read for.
            },
            createInvoiceActionsColumn(
              invoiceType,
              navigate,
              propInvoices != null,
            ),
            /* eslint-enable react/no-unstable-nested-components */
          ]) as ColumnDef<InvoicesView>[]),
    ],
    [
      invoiceType,
      navigate,
      navigateToInvoice,
      propInvoices,
      isMini,
      saleReturns,
    ],
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
      let fetchedInvoices: InvoicesView[];
      if (!isNil(propInvoices)) {
        // preview rows are invoice views; the list's journal count is absent
        fetchedInvoices = propInvoices as unknown as InvoicesView[];
      } else if (saleReturns) {
        fetchedInvoices = await window.electron.getSaleReturns();
      } else {
        fetchedInvoices = await window.electron.getInvoices(invoiceType);
      }
      setInvoices(fetchedInvoices);
      setIsLoading(false);
    };
    fetchInvoices();
  }, [invoiceType, propInvoices, saleReturns]);

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

  // save invoice filter date to store (skip mount write)
  const isInvoiceFilterDateMountedRef = useRef(false);
  useEffect(() => {
    if (!isInvoiceFilterDateMountedRef.current) {
      isInvoiceFilterDateMountedRef.current = true;
      return;
    }
    window.electron.store.set('invoiceFilterDate', invoiceFilterDate);
  }, [invoiceFilterDate]);

  // save invoice filter selected value to store (skip mount write)
  const isInvoiceFilterSelectMountedRef = useRef(false);
  useEffect(() => {
    if (!isInvoiceFilterSelectMountedRef.current) {
      isInvoiceFilterSelectMountedRef.current = true;
      return;
    }
    window.electron.store.set(
      'invoiceFilterSelectValue',
      invoiceFilterSelectValue,
    );
  }, [invoiceFilterSelectValue]);

  // TODO: fix scrollbar when isMini is true
  return (
    <div>
      <PageHeader
        title={saleReturns ? 'Sale Returns' : `${invoiceType} Invoices`}
        hideTitle={isMini}
        filtersInline
        filters={
          <FilterGroup label="VIEW BY:" hideLabelOnMobile>
            <DateRangePickerWithPresets
              $onSelect={handleFilterDateSelect}
              presets={[{ label: 'All', value: 'all' }]}
              initialRange={invoiceFilterDate}
              initialSelectValue={invoiceFilterSelectValue}
              triggerClassName="max-w-full min-w-0"
            />
          </FilterGroup>
        }
        actions={
          <>
            {/* Just a + on a phone: "New Invoice" was a word that
                pushed the view-by control off the row, and the row is
                what the list gets its height from. */}
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                navigate(
                  saleReturns
                    ? '/sale/returns/new'
                    : `/${invoiceType.toLowerCase()}/invoices/new`,
                )
              }
              className="shrink-0"
              title={saleReturns ? 'New sale return' : 'New Invoice'}
              aria-label={saleReturns ? 'New sale return' : 'New Invoice'}
            >
              <Plus size={16} />
            </Button>
            {/* Export is a once-in-a-while action, so it lives in an
                overflow menu rather than taking a full row on a phone. */}
            {invoiceType === InvoiceType.Sale && filteredInvoices?.length ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      aria-label="More actions"
                    >
                      <MoreHorizontal className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => setExportDialogOpen(true)}
                    >
                      <File className="mr-2 h-4 w-4" />
                      Export Sale Invoices
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Dialog
                  open={exportDialogOpen}
                  onOpenChange={setExportDialogOpen}
                >
                  <DialogContent>
                    <ExportInvoices />
                  </DialogContent>
                </Dialog>
              </>
            ) : null}
          </>
        }
      />

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
            defaultSortField="invoiceNumber"
            defaultSortDirection="desc"
            virtual
            virtualHeightMode={isMini ? 'content' : 'fill'}
            isMini={isMini}
            searchPlaceholder={`Search ${invoiceType.toLowerCase()} invoices...`}
            searchFields={[
              'invoiceNumber',
              'accountName',
              'accountCode',
              'date',
              'totalAmount',
              'biltyNumber',
            ]}
            searchPersistenceKey={`datatable:${invoiceType.toLowerCase()}:invoices:search`}
            autoFocusSearch
          />
        )}
      </div>
      <Dialog
        open={!isNil(previewInvoiceId)}
        onOpenChange={() => setPreviewInvoiceId(undefined)}
      >
        <DialogContent className="max-h-[90dvh] overflow-hidden sm:max-w-[60%]">
          <InvoicePage invoiceType={invoiceType} previewId={previewInvoiceId} />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InvoicesPage;
