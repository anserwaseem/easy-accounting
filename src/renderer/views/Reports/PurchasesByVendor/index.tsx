import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { sumBy } from 'lodash';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { ReportLayout } from '@/renderer/components/ReportLayout';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { DateRangePickerWithPresets } from '@/renderer/shad/ui/datePicker';
import { DataTable, type ColumnDef } from '@/renderer/shad/ui/dataTable';
import { cn } from '@/renderer/lib/utils';
import { exportReportWorkbook } from '@/renderer/lib/reportExport';
import { toast } from '@/renderer/shad/ui/use-toast';
import type { PurchasesByVendorItem } from 'types';
import { printStyles } from '../components/printStyles';
import { EmptyState, LoadingState } from '../components';
import { usePurchasesByVendor } from './usePurchasesByVendor';
import { printPurchasesByVendorIframe } from './printPurchasesByVendor';
import { PurchasesByVendorInvoiceSheet } from './PurchasesByVendorInvoiceSheet';

const sanitizeFilePart = (value: string): string =>
  value.replace(/\s+/g, '_').replace(/[^\w.-]/g, '');

interface SelectableItemCellProps {
  item: PurchasesByVendorItem;
  onSelect: (item: PurchasesByVendorItem) => void;
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

const BillsHeader: React.FC = () => (
  <span className="font-normal text-muted-foreground">Bills</span>
);

const InvoiceCountCell: React.FC<SelectableItemCellProps> = ({
  item,
  onSelect,
}: SelectableItemCellProps) => (
  <Button
    variant="link"
    className="ml-auto h-auto p-0 text-xs font-normal tabular-nums text-muted-foreground hover:text-foreground"
    onClick={() => onSelect(item)}
    title={`View purchase bills for ${item.itemName}`}
    aria-label={`View ${item.invoiceCount} purchase bills for ${item.itemName}`}
  >
    {item.invoiceCount} {item.invoiceCount === 1 ? 'bill' : 'bills'}
  </Button>
);

const PurchasesByVendorPage: React.FC = () => {
  const {
    vendors,
    selectedVendorId,
    selectedVendorName,
    handleVendorChange,
    dateRange,
    handleDateChange,
    presetValue,
    isLoading,
    response,
    refreshData,
    dateSubtitle,
  } = usePurchasesByVendor();

  const [gridViewRows, setGridViewRows] = useState<
    PurchasesByVendorItem[] | null
  >(null);
  const [selectedItem, setSelectedItem] =
    useState<PurchasesByVendorItem | null>(null);

  const sourceRows = response?.items ?? [];
  const exportPrintRows = gridViewRows ?? sourceRows;

  useEffect(() => {
    setGridViewRows(null);
  }, [response]);

  const handleGridViewModelChange = useCallback(
    (next: PurchasesByVendorItem[]) => {
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

  const columns = useMemo<ColumnDef<PurchasesByVendorItem>[]>(
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
        header: BillsHeader,
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

  const canExport = !isLoading && selectedVendorId != null && itemCount > 0;

  const handleExport = useCallback(() => {
    if (!canExport || !dateRange?.from || !dateRange?.to) return;
    try {
      const vendorPart = sanitizeFilePart(selectedVendorName || 'vendor');
      const from = format(dateRange.from, 'yyyy-MM-dd');
      const to = format(dateRange.to, 'yyyy-MM-dd');
      const subtitle = `${selectedVendorName} — ${dateSubtitle}`;

      const lineRows = exportPrintRows.flatMap((item) =>
        item.invoices.map((line) => ({
          date: line.date,
          invoiceNumber: line.invoiceNumber,
          itemName: item.itemName,
          quantity: line.quantity,
        })),
      );

      exportReportWorkbook(
        [
          {
            title: 'Purchases by Vendor',
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
            title: 'Purchases by Vendor — Invoice lines',
            subtitle,
            sheetName: 'Invoice lines',
            columns: [
              { key: 'date', header: 'Date', format: 'date', width: 14 },
              {
                key: 'invoiceNumber',
                header: 'Purchase #',
                format: 'number',
                width: 12,
              },
              { key: 'itemName', header: 'Item', format: 'string', width: 28 },
              { key: 'quantity', header: 'Qty', format: 'number', width: 10 },
            ],
            rows: lineRows as unknown as Array<Record<string, unknown>>,
          },
        ],
        `Purchases_by_Vendor_${vendorPart}_${from}_${to}.xlsx`,
      );
      toast({
        title: 'Success',
        description: 'Purchases by vendor exported to Excel.',
        variant: 'success',
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Error',
        description: 'Failed to export purchases by vendor.',
        variant: 'destructive',
      });
    }
  }, [
    canExport,
    dateRange,
    dateSubtitle,
    exportPrintRows,
    selectedVendorName,
    totalQty,
  ]);

  const handlePrint = useCallback(() => {
    if (!canExport) return;
    printPurchasesByVendorIframe({
      rows: exportPrintRows,
      vendorName: selectedVendorName,
      dateSubtitle,
      totalQty,
    });
  }, [canExport, dateSubtitle, exportPrintRows, selectedVendorName, totalQty]);

  return (
    <ReportLayout
      printStyles={printStyles}
      header={
        <div className="print-header flex flex-col gap-2 pb-2">
          <div className="flex items-center justify-between pb-2">
            <h1 className="title-new">Purchases by Vendor</h1>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Vendor:</span>
                <div className="w-[220px]">
                  <VirtualSelect
                    options={vendors}
                    value={selectedVendorId?.toString()}
                    onChange={handleVendorChange}
                    placeholder="Select vendor"
                    searchPlaceholder="Search vendors..."
                    autoFocusTrigger={selectedVendorId == null}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
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
          {selectedVendorId && !isLoading && sourceRows.length > 0 && (
            <div className="print:hidden text-right text-sm text-muted-foreground">
              {totalQty.toLocaleString()} items purchased
            </div>
          )}
        </div>
      }
    >
      <PurchasesByVendorInvoiceSheet
        item={selectedItem}
        vendorName={selectedVendorName}
        dateSubtitle={dateSubtitle}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
      />
      {!selectedVendorId && !isLoading && (
        <EmptyState message="Pick a vendor." />
      )}
      {isLoading && <LoadingState message="Loading purchases..." />}
      {selectedVendorId && !isLoading && sourceRows.length === 0 && (
        <EmptyState
          message={`No posted purchases from ${
            selectedVendorName || 'this vendor'
          } in this range.`}
        />
      )}
      {selectedVendorId && !isLoading && sourceRows.length > 0 && (
        <DataTable<PurchasesByVendorItem, unknown>
          columns={columns}
          data={sourceRows}
          virtual
          virtualHeightMode="fill"
          compact
          defaultSortField="itemName"
          defaultSortDirection="asc"
          searchFields={['itemName']}
          searchPlaceholder="Search items..."
          searchPersistenceKey="purchases-by-vendor-search"
          getRowKey={(row) => row.inventoryId}
          stickyFooterRow={stickyFooterRow}
          onViewModelChange={handleGridViewModelChange}
        />
      )}
    </ReportLayout>
  );
};

export default PurchasesByVendorPage;
