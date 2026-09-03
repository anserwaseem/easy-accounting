import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { ReportLayout } from '@/renderer/components/ReportLayout';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { DateRangePickerWithPresets } from '@/renderer/shad/ui/datePicker';
import { DataTable, type ColumnDef } from '@/renderer/shad/ui/dataTable';
import { exportReportWorkbook } from '@/renderer/lib/reportExport';
import { toast } from '@/renderer/shad/ui/use-toast';
import type {
  VendorStockActivityItem,
  VendorStockActivityResponse,
} from 'types';
import { printStyles } from '../components/printStyles';
import { EmptyState, LoadingState } from '../components';

const VendorStockActivityPage: React.FC = () => {
  const [vendors, setVendors] = useState<
    Array<{ id: number; name: string; code?: number | string | null }>
  >([]);
  const [selectedVendorId, setSelectedVendorId] = useState<
    number | undefined
  >();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    to: new Date(),
  });
  const [response, setResponse] = useState<VendorStockActivityResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [gridViewRows, setGridViewRows] = useState<
    VendorStockActivityItem[] | null
  >(null);

  useEffect(() => {
    window.electron.getTrackedVendorAccounts().then((rows) => {
      setVendors(rows);
      if (rows.length === 1) {
        setSelectedVendorId(rows[0].id);
      }
    });
  }, []);

  const vendorOptions = useMemo(
    () =>
      vendors.map((v) => ({
        id: v.id,
        name: v.code != null ? `${v.code} — ${v.name}` : v.name,
      })),
    [vendors],
  );

  const fetchReport = useCallback(async () => {
    if (!selectedVendorId || !dateRange?.from || !dateRange?.to) {
      toast({
        description: 'Select a vendor and date range',
        variant: 'destructive',
      });
      return;
    }
    setIsLoading(true);
    try {
      const result = await window.electron.getVendorStockActivity({
        vendorAccountId: selectedVendorId,
        startDate: format(dateRange.from, 'yyyy-MM-dd'),
        endDate: format(dateRange.to, 'yyyy-MM-dd'),
      });
      setResponse(result);
      setGridViewRows(null);
    } catch (error) {
      toast({
        description: String(error),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [selectedVendorId, dateRange]);

  const columns: ColumnDef<VendorStockActivityItem>[] = useMemo(
    () => [
      { accessorKey: 'inventoryName', header: 'Item' },
      {
        accessorKey: 'opening',
        header: 'Opening',
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.opening}</span>
        ),
      },
      {
        accessorKey: 'issued',
        header: 'Issued',
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.issued}</span>
        ),
      },
      {
        accessorKey: 'purchased',
        header: 'Purchased',
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.purchased}</span>
        ),
      },
      {
        accessorKey: 'purchaseReturned',
        header: 'Purchase returns',
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.purchaseReturned}
          </span>
        ),
      },
      {
        accessorKey: 'adjusted',
        header: 'Adjusted',
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.adjusted}</span>
        ),
      },
      {
        accessorKey: 'closing',
        header: 'Closing',
        cell: ({ row }) => (
          <span className="tabular-nums font-medium">
            {row.original.closing}
          </span>
        ),
      },
    ],
    [],
  );

  const exportRows = gridViewRows ?? response?.items ?? [];

  const handleExport = () => {
    if (!response) return;
    exportReportWorkbook(
      [
        {
          title: 'Vendor stock activity',
          subtitle: `${response.vendorAccountName} · ${response.startDate} to ${response.endDate}`,
          sheetName: 'Activity',
          columns: [
            {
              key: 'inventoryName',
              header: 'Item',
              format: 'string',
              width: 28,
            },
            { key: 'opening', header: 'Opening', format: 'number', width: 10 },
            { key: 'issued', header: 'Issued', format: 'number', width: 10 },
            {
              key: 'purchased',
              header: 'Purchased',
              format: 'number',
              width: 10,
            },
            {
              key: 'purchaseReturned',
              header: 'Purchase returns',
              format: 'number',
              width: 14,
            },
            {
              key: 'adjusted',
              header: 'Adjusted',
              format: 'number',
              width: 10,
            },
            { key: 'closing', header: 'Closing', format: 'number', width: 10 },
          ],
          rows: exportRows as unknown as Array<Record<string, unknown>>,
        },
      ],
      `vendor-stock-activity-${response.vendorAccountName}`,
    );
  };

  const handlePrint = () => {
    if (!response) return;
    const w = window.open('', '_blank');
    if (!w) return;
    const rowsHtml = exportRows
      .map(
        (r) =>
          `<tr><td>${r.inventoryName}</td><td>${r.opening}</td><td>${r.issued}</td><td>${r.purchased}</td><td>${r.purchaseReturned}</td><td>${r.adjusted}</td><td>${r.closing}</td></tr>`,
      )
      .join('');
    w.document.write(`
      <html><head><title>Vendor stock activity</title>
      <style>table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f5f5f5}</style>
      </head><body>
      <h1>Vendor stock activity — ${response.vendorAccountName}</h1>
      <p>${response.startDate} to ${response.endDate}</p>
      <table><thead><tr><th>Item</th><th>Opening</th><th>Issued</th><th>Purchased</th><th>Purchase returns</th><th>Adjusted</th><th>Closing</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <ReportLayout
      printStyles={printStyles}
      header={
        <div className="flex flex-col gap-2 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="title-new">Vendor Stock Activity</h1>
              <p className="text-sm text-muted-foreground">
                Opening, issued, purchased, and closing qty at a tracked vendor.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={!response?.items.length}
              >
                <Download size={16} className="mr-1.5" />
                Excel
              </Button>
              <Button
                variant="outline"
                onClick={handlePrint}
                disabled={!response?.items.length}
              >
                <Printer size={16} className="mr-1.5" />
                Print
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <div className="w-[220px]">
              <VirtualSelect
                options={vendorOptions}
                value={selectedVendorId}
                onChange={(value) => setSelectedVendorId(Number(value))}
                placeholder="Select vendor"
                searchPlaceholder="Search vendors..."
              />
            </div>
            <DateRangePickerWithPresets
              $onSelect={(range) => setDateRange(range)}
              initialRange={dateRange}
            />
            <Button onClick={fetchReport} disabled={isLoading}>
              <RefreshCw size={16} className="mr-1.5" />
              Run
            </Button>
          </div>
        </div>
      }
    >
      {isLoading && <LoadingState />}
      {!isLoading && !response && (
        <EmptyState message="Run the report to see activity." />
      )}
      {!isLoading && response && response.items.length === 0 && (
        <EmptyState message="No vendor stock activity in this range." />
      )}
      {!isLoading && response && response.items.length > 0 && (
        <DataTable
          columns={columns}
          data={response.items}
          onViewModelChange={setGridViewRows}
        />
      )}
    </ReportLayout>
  );
};

export default VendorStockActivityPage;
