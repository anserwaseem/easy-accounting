import type { Row } from '@tanstack/react-table';
import { FileText, Info } from 'lucide-react';
import { toNumber } from 'lodash';
import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import {
  dateFormatOptions,
  datetimeFormatOptions,
} from 'renderer/lib/constants';
import {
  cn,
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import {
  getQuotationDisplayNumber,
  showInvoiceEditedIndicator,
} from '@/renderer/lib/invoiceUtils';
import { EditActionButton } from '@/renderer/components/EditActionButton';
import { Badge } from 'renderer/shad/ui/badge';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import { DateHeader } from 'renderer/components/common/DateHeader';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'renderer/shad/ui/tooltip';
import type { InvoicesView } from 'types';
import { InvoiceType } from 'types';

interface QuotationsPageProps {
  invoiceType: InvoiceType;
  isMini?: boolean;
}

const QUOTATIONS_INFO_TOOLTIP =
  'Draft quotes without posted invoice numbers. Stock and ledgers apply only after you convert to an invoice.';

interface QuotationEditActionCellProps {
  row: Row<InvoicesView>;
  invoiceType: InvoiceType;
  navigate: NavigateFunction;
}

const QuotationEditActionCell: FC<QuotationEditActionCellProps> = ({
  row,
  invoiceType,
  navigate,
}) => {
  if (row.original.isReturned) return null;

  return (
    <EditActionButton
      title="Edit quotation"
      aria-label="Edit quotation"
      onClick={(e) => {
        e.stopPropagation();
        navigate(
          `/${invoiceType.toLowerCase()}/invoices/${row.original.id}/edit`,
        );
      }}
    />
  );
};

const createQuotationEditColumn = (
  invoiceType: InvoiceType,
  navigate: NavigateFunction,
): ColumnDef<InvoicesView> => ({
  id: 'edit',
  header: 'Edit',
  size: 56,
  onClick: () => undefined,
  cell({ row }) {
    return (
      <QuotationEditActionCell
        row={row}
        invoiceType={invoiceType}
        navigate={navigate}
      />
    );
  },
});

const QuotationsPage: FC<QuotationsPageProps> = ({
  invoiceType,
  isMini = false,
}: QuotationsPageProps) => {
  const [rows, setRows] = useState<InvoicesView[]>();
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  const listTitle = `${
    invoiceType === InvoiceType.Sale ? 'Sale' : 'Purchase'
  } Quotations`;
  const partyLabel = invoiceType === InvoiceType.Sale ? 'Customer' : 'Vendor';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const list = (await window.electron.getQuotations(
          invoiceType,
        )) as InvoicesView[];
        if (!cancelled) setRows(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceType]);

  const navigateToRow = useCallback(
    (id: number) => navigate(`/${invoiceType.toLowerCase()}/invoices/${id}`),
    [invoiceType, navigate],
  );

  const columns: ColumnDef<InvoicesView>[] = useMemo(
    () =>
      isMini
        ? [
            /* eslint-disable react/no-unstable-nested-components -- tanstack column cell factories */
            {
              accessorKey: 'invoiceNumber',
              header: `${listTitle}`,
              cell: ({ row }) => {
                const inv = row.original;
                return (
                  <div className="flex justify-between items-start w-full">
                    <div className="flex flex-col">
                      <p>
                        {new Date(inv.date).toLocaleString(
                          'en-US',
                          dateFormatOptions,
                        )}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-extrabold">
                          {getQuotationDisplayNumber(
                            toNumber(inv.invoiceNumber),
                          )}
                        </p>
                        {showInvoiceEditedIndicator(inv) ? (
                          <Badge
                            variant="amber"
                            className="text-[10px] font-normal"
                            title={
                              inv.updatedAt
                                ? new Date(inv.updatedAt).toLocaleString(
                                    'en-US',
                                    datetimeFormatOptions,
                                  )
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
                          {inv.accountName}
                        </span>
                        {inv.accountCode != null ? (
                          <Badge
                            variant="secondary"
                            className="shrink-0 px-1.5 py-0 text-[10px] font-mono font-normal tabular-nums"
                            title={`Account code ${inv.accountCode}`}
                          >
                            {inv.accountCode}
                          </Badge>
                        ) : null}
                      </div>
                      {invoiceType === InvoiceType.Sale ? (
                        <p className="tabular-nums font-semibold">
                          {getFormattedCurrency(Number(inv.totalAmount))}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              },
              onClick: (r) => navigateToRow(r.original.id),
            },
            /* eslint-enable react/no-unstable-nested-components */
          ]
        : [
            /* eslint-disable react/no-unstable-nested-components -- tanstack column cell factories */
            {
              accessorKey: 'invoiceNumber',
              header: () => (
                <span className="whitespace-nowrap">Quotation #</span>
              ),
              cell: ({ row }) => (
                <span className="inline-flex max-w-full flex-wrap items-center gap-1.5 whitespace-nowrap tabular-nums font-medium">
                  {getQuotationDisplayNumber(
                    toNumber(row.original.invoiceNumber),
                  )}
                  {showInvoiceEditedIndicator(row.original) ? (
                    <Badge
                      variant="amber"
                      className="px-1.5 py-0 text-[10px] font-normal"
                      title={
                        row.original.updatedAt
                          ? new Date(row.original.updatedAt).toLocaleString(
                              'en-US',
                              datetimeFormatOptions,
                            )
                          : undefined
                      }
                    >
                      Edited
                    </Badge>
                  ) : null}
                </span>
              ),
              onClick: (r) => navigateToRow(r.original.id),
              size: 120,
            },
            {
              accessorKey: 'date',
              header: DateHeader,
              cell: ({ row }) =>
                new Date(row.original.date).toLocaleString(
                  'en-US',
                  dateFormatOptions,
                ),
              onClick: (r) => navigateToRow(r.original.id),
              size: 108,
            },
            {
              accessorKey: 'accountName',
              header: partyLabel,
              onClick: (r) => navigateToRow(r.original.id),
            },
            {
              accessorKey: 'accountCode',
              header: 'Code',
              onClick: (r) => navigateToRow(r.original.id),
              size: 100,
            },
            ...(invoiceType === InvoiceType.Sale
              ? ([
                  {
                    accessorKey: 'totalAmount',
                    header: 'Total Amount',
                    onClick: (r) => navigateToRow(r.original.id),
                    cell: ({ getValue }) =>
                      getFormattedCurrency(toNumber(getValue())),
                    size: 128,
                  },
                ] as ColumnDef<InvoicesView>[])
              : []),
            {
              id: 'updated',
              header: 'Updated',
              cell: ({ row }) =>
                row.original.updatedAt
                  ? new Date(row.original.updatedAt).toLocaleString(
                      'en-US',
                      datetimeFormatOptions,
                    )
                  : '—',
              onClick: (r) => navigateToRow(r.original.id),
              size: 140,
            },
            createQuotationEditColumn(invoiceType, navigate),
            /* eslint-enable react/no-unstable-nested-components */
          ],
    [invoiceType, isMini, listTitle, navigate, navigateToRow, partyLabel],
  );

  const quotationsBody = (() => {
    if (isLoading) {
      return <p className="text-muted-foreground">Loading quotations…</p>;
    }
    if (rows != null && rows.length === 0) {
      return (
        <div
          className={cn(
            'flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-muted/20 px-6 py-16 text-center',
          )}
          role="status"
        >
          <FileText className="h-10 w-10 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <p className="text-base font-medium">No quotations yet</p>
            <p className="text-sm text-muted-foreground">
              Open {invoiceType === InvoiceType.Sale ? 'sale' : 'purchase'}{' '}
              invoices, choose Save as quotation, then return here to review.
            </p>
          </div>
        </div>
      );
    }
    return (
      <DataTable
        columns={columns}
        data={rows ?? []}
        sortingFns={defaultSortingFunctions}
        defaultSortField="invoiceNumber"
        defaultSortDirection="desc"
        virtual
        searchPlaceholder={`Search ${invoiceType.toLowerCase()} quotations...`}
        searchFields={[
          'invoiceNumber',
          'accountName',
          'accountCode',
          'date',
          'totalAmount',
        ]}
        searchPersistenceKey={`datatable:${invoiceType.toLowerCase()}:quotations:search`}
      />
    );
  })();

  if (isMini) {
    const miniInner = (() => {
      if (isLoading) {
        return (
          <div className="flex justify-center py-6">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        );
      }
      if (rows != null && rows.length === 0) {
        return (
          <p className="text-sm text-muted-foreground px-2">No quotations.</p>
        );
      }
      return (
        <DataTable
          columns={columns}
          data={rows ?? []}
          sortingFns={defaultSortingFunctions}
          defaultSortField="invoiceNumber"
          defaultSortDirection="desc"
          virtual
          isMini
          searchPlaceholder={`Search ${invoiceType.toLowerCase()} quotations...`}
          searchFields={[
            'invoiceNumber',
            'accountName',
            'accountCode',
            'date',
            'totalAmount',
          ]}
          searchPersistenceKey={`datatable:${invoiceType.toLowerCase()}:quotations:mini:search`}
        />
      );
    })();

    return <div className="py-4 flex flex-col gap-4">{miniInner}</div>;
  }

  return (
    <div className="flex flex-col px-1">
      <div className="py-4 flex justify-center items-center gap-2">
        <h1 className="title">{listTitle}</h1>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 text-muted-foreground"
                aria-label="About quotations"
              >
                <Info className="h-5 w-5" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-left">
              {QUOTATIONS_INFO_TOOLTIP}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="py-6 flex flex-col gap-6">{quotationsBody}</div>
    </div>
  );
};

export default QuotationsPage;
