import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { sumBy } from 'lodash';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { ReportLayout } from '@/renderer/components/ReportLayout';
import VirtualMultiSelect from '@/renderer/components/VirtualMultiSelect';
import { DateRangePickerWithPresets } from '@/renderer/shad/ui/datePicker';
import { DataTable, type ColumnDef } from '@/renderer/shad/ui/dataTable';
import { cn } from '@/renderer/lib/utils';
import { exportReportWorkbook } from '@/renderer/lib/reportExport';
import { toast } from '@/renderer/shad/ui/use-toast';
import type { SalesByCustomerItem } from 'types';
import { printStyles } from '../components/printStyles';
import { EmptyState, LoadingState } from '../components';
import {
  SALES_BY_CUSTOMER_EMPTY_SELECTION_MESSAGE,
  useSalesByCustomer,
} from './useSalesByCustomer';
import { printSalesByCustomerIframe } from './printSalesByCustomer';
import { SalesByCustomerInvoiceSheet } from './SalesByCustomerInvoiceSheet';

const sanitizeFilePart = (value: string): string =>
  value.replace(/\s+/g, '_').replace(/[^\w.-]/g, '');

interface SelectableItemCellProps {
  item: SalesByCustomerItem;
  onSelect: (item: SalesByCustomerItem) => void;
}

const ItemNameCell: React.FC<SelectableItemCellProps> = ({
  item,
  onSelect,
}: SelectableItemCellProps) => {
  return (
    <button
      type="button"
      className="flex min-w-0 cursor-pointer flex-col items-start text-left"
      onClick={() => onSelect(item)}
    >
      <span className="truncate">{item.itemName}</span>
    </button>
  );
};

interface QtyCellProps {
  quantity: number;
}

const QtyCell: React.FC<QtyCellProps> = ({ quantity }: QtyCellProps) => (
  <span className="block tabular-nums">{quantity.toLocaleString()}</span>
);

const InvoicesHeader: React.FC = () => (
  <span className="font-normal text-muted-foreground">Invoices</span>
);

const InvoiceCountCell: React.FC<SelectableItemCellProps> = ({
  item,
  onSelect,
}: SelectableItemCellProps) => (
  <Button
    variant="link"
    className="ml-auto h-auto p-0 text-xs font-normal tabular-nums text-muted-foreground hover:text-foreground"
    onClick={() => onSelect(item)}
    title={`View sale invoices for ${item.itemName}`}
    aria-label={`View ${item.invoiceCount} sale invoices for ${item.itemName}`}
  >
    {item.invoiceCount} {item.invoiceCount === 1 ? 'invoice' : 'invoices'}
  </Button>
);

const SalesByCustomerPage: React.FC = () => {
  const {
    customers,
    selectedCustomerIds,
    selectedCustomerLabel,
    handleCustomerChange,
    dateRange,
    handleDateChange,
    presetValue,
    isLoading,
    response,
    refreshData,
    dateSubtitle,
  } = useSalesByCustomer();

  const [gridViewRows, setGridViewRows] = useState<
    SalesByCustomerItem[] | null
  >(null);
  const [selectedItem, setSelectedItem] = useState<SalesByCustomerItem | null>(
    null,
  );

  const sourceRows = response?.items ?? [];
  const exportPrintRows = gridViewRows ?? sourceRows;
  const hasSelection = selectedCustomerIds.length > 0;
  const showCustomerOnLines = selectedCustomerIds.length > 1;

  useEffect(() => {
    setGridViewRows(null);
  }, [response]);

  const handleGridViewModelChange = useCallback(
    (next: SalesByCustomerItem[]) => {
      setGridViewRows((prev) => {
        if (
          prev &&
          prev.length === next.length &&
          prev.every((row, index) => row === next[index])
        ) {
          return prev;
        }
        return next;
      });
    },
    [],
  );

  const itemCount = exportPrintRows.length;
  const totalQty = useMemo(
    () => sumBy(exportPrintRows, 'quantity'),
    [exportPrintRows],
  );

  const columns = useMemo<ColumnDef<SalesByCustomerItem>[]>(
    () => [
      {
        accessorKey: 'itemName',
        header: 'Item',
        size: 200,
        onClick: (row) => setSelectedItem(row.original),
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <ItemNameCell item={row.original} onSelect={setSelectedItem} />
        ),
      },
      {
        accessorKey: 'quantity',
        header: 'Qty',
        size: 100,
        onClick: (row) => setSelectedItem(row.original),
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => <QtyCell quantity={row.original.quantity} />,
      },
      {
        accessorKey: 'invoiceCount',
        header: InvoicesHeader,
        size: 110,
        onClick: (row) => setSelectedItem(row.original),
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <InvoiceCountCell item={row.original} onSelect={setSelectedItem} />
        ),
      },
    ],
    [],
  );

  const stickyFooterRow = useMemo(
    () => [
      null,
      <span
        key="qty-total"
        className="block font-semibold tabular-nums whitespace-nowrap"
      >
        {totalQty.toLocaleString()}
      </span>,
      null,
    ],
    [totalQty],
  );

  const canExport = !isLoading && hasSelection && itemCount > 0;

  const handleExport = useCallback(() => {
    if (!canExport || !dateRange?.from || !dateRange?.to) return;
    try {
      const customerPart = sanitizeFilePart(
        selectedCustomerLabel || 'customers',
      );
      const from = format(dateRange.from, 'yyyy-MM-dd');
      const to = format(dateRange.to, 'yyyy-MM-dd');
      const subtitle = `${selectedCustomerLabel} — ${dateSubtitle}`;

      const lineRows = exportPrintRows.flatMap((item) =>
        item.invoices.map((line) => ({
          date: line.date,
          invoiceNumber: line.invoiceNumber,
          customerName:
            line.customerCode == null || line.customerCode === ''
              ? line.customerName
              : `${line.customerName} (${line.customerCode})`,
          itemName: item.itemName,
          quantity: line.quantity,
        })),
      );

      const invoiceLineColumns = [
        { key: 'date', header: 'Date', format: 'date' as const, width: 14 },
        {
          key: 'invoiceNumber',
          header: 'Sale #',
          format: 'number' as const,
          width: 12,
        },
        ...(showCustomerOnLines
          ? [
              {
                key: 'customerName',
                header: 'Customer',
                format: 'string' as const,
                width: 24,
              },
            ]
          : []),
        {
          key: 'itemName',
          header: 'Item',
          format: 'string' as const,
          width: 28,
        },
        {
          key: 'quantity',
          header: 'Qty',
          format: 'number' as const,
          width: 10,
        },
      ];

      exportReportWorkbook(
        [
          {
            title: 'Sales by Customer',
            subtitle,
            sheetName: 'Items',
            columns: [
              { key: 'itemName', header: 'Item', format: 'string', width: 28 },
              { key: 'quantity', header: 'Qty', format: 'number', width: 10 },
            ],
            rows: exportPrintRows as unknown as Array<Record<string, unknown>>,
            footerRow: { quantity: totalQty },
          },
          {
            title: 'Sales by Customer — Invoice lines',
            subtitle,
            sheetName: 'Invoice lines',
            columns: invoiceLineColumns,
            rows: lineRows as unknown as Array<Record<string, unknown>>,
          },
        ],
        `Sales_by_Customer_${customerPart}_${from}_${to}.xlsx`,
      );
      toast({
        title: 'Success',
        description: 'Sales by customer exported to Excel.',
        variant: 'success',
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Error',
        description: 'Failed to export sales by customer.',
        variant: 'destructive',
      });
    }
  }, [
    canExport,
    dateRange,
    dateSubtitle,
    exportPrintRows,
    selectedCustomerLabel,
    showCustomerOnLines,
    totalQty,
  ]);

  const handlePrint = useCallback(() => {
    if (!canExport) return;
    printSalesByCustomerIframe({
      rows: exportPrintRows,
      customerLabel: selectedCustomerLabel,
      dateSubtitle,
      totalQty,
    });
  }, [
    canExport,
    dateSubtitle,
    exportPrintRows,
    selectedCustomerLabel,
    totalQty,
  ]);

  return (
    <ReportLayout
      printStyles={printStyles}
      header={
        <div className="print-header flex flex-col gap-2 pb-2">
          <div className="flex items-center justify-between pb-2">
            <h1 className="title-new">Sales by Customer</h1>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Customers:
                </span>
                <VirtualMultiSelect
                  options={customers}
                  value={selectedCustomerIds}
                  onChange={handleCustomerChange}
                  placeholder="Select customers"
                  searchPlaceholder="Search customers..."
                  disabled={!customers.length}
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm text-muted-foreground">Range:</span>
                <DateRangePickerWithPresets
                  $onSelect={handleDateChange}
                  presets={[{ label: 'All', value: 'all' }]}
                  initialRange={dateRange ?? undefined}
                  initialSelectValue={presetValue}
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={refreshData}
                title="Refresh Data"
                disabled={isLoading}
              >
                <RefreshCw
                  className={cn('h-4 w-4', isLoading && 'animate-spin')}
                />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleExport}
                title="Export to Excel"
                disabled={!canExport}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrint}
                title="Print report"
                disabled={!canExport}
              >
                <Printer className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {hasSelection && !isLoading && sourceRows.length > 0 && (
            <div className="print:hidden text-right text-sm text-muted-foreground">
              {totalQty.toLocaleString()} items sold
            </div>
          )}
        </div>
      }
    >
      <SalesByCustomerInvoiceSheet
        item={selectedItem}
        customerLabel={selectedCustomerLabel}
        dateSubtitle={dateSubtitle}
        showCustomerColumn={showCustomerOnLines}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
      />
      {!hasSelection && !isLoading && (
        <EmptyState message={SALES_BY_CUSTOMER_EMPTY_SELECTION_MESSAGE} />
      )}
      {isLoading && <LoadingState message="Loading sales..." />}
      {hasSelection && !isLoading && sourceRows.length === 0 && (
        <EmptyState
          message={`No posted sales to ${
            selectedCustomerLabel || 'these customers'
          } in this range.`}
        />
      )}
      {hasSelection && !isLoading && sourceRows.length > 0 && (
        <DataTable<SalesByCustomerItem, unknown>
          columns={columns}
          data={sourceRows}
          virtual
          virtualHeightMode="fill"
          compact
          defaultSortField="itemName"
          defaultSortDirection="asc"
          searchFields={['itemName']}
          searchPlaceholder="Search items..."
          searchPersistenceKey="sales-by-customer-search"
          getRowKey={(row) => row.inventoryId}
          stickyFooterRow={stickyFooterRow}
          onViewModelChange={handleGridViewModelChange}
        />
      )}
    </ReportLayout>
  );
};

export default SalesByCustomerPage;
