import { useCallback, useMemo, useState } from 'react';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { ReportLayout } from '@/renderer/components/ReportLayout';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { DateRangePickerWithPresets } from '@/renderer/shad/ui/datePicker';
import { DataTable, type ColumnDef } from '@/renderer/shad/ui/dataTable';
import { exportReportWorkbook } from '@/renderer/lib/reportExport';
import { cn } from '@/renderer/lib/utils';
import { toast } from '@/renderer/shad/ui/use-toast';
import { useMountEffect } from '@/renderer/hooks/useMountEffect';
import type {
  VendorStockActivityItem,
  VendorStockActivityResponse,
} from 'types';
import { printStyles } from '../components/printStyles';
import { EmptyState, LoadingState } from '../components';
import { printVendorStockActivityIframe } from './printVendorStockActivity';

const COLUMNS: ColumnDef<VendorStockActivityItem>[] = [
  {
    accessorKey: 'inventoryName',
    header: 'Family',
    headerTooltip:
      'Shared quantity pool at this vendor. Purchases of the head or any linked variant affect this row.',
  },
  {
    accessorKey: 'opening',
    header: 'Opening',
    headerTooltip: 'Quantity held before the selected start date.',
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.opening}</span>
    ),
  },
  {
    accessorKey: 'issued',
    header: 'Issued',
    headerTooltip: 'Quantity sent to this vendor during the selected range.',
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.issued}</span>
    ),
  },
  {
    accessorKey: 'purchased',
    header: 'Received via purchase',
    headerTooltip:
      'Finished quantity bought back during the selected range, including linked variants.',
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.purchased}</span>
    ),
  },
  {
    accessorKey: 'purchaseReturned',
    header: 'Purchase returns',
    headerTooltip:
      'Purchase quantity returned during the selected range; added back to quantity at vendor.',
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.purchaseReturned}</span>
    ),
  },
  {
    accessorKey: 'adjusted',
    header: 'Adjusted',
    headerTooltip:
      'Corrections and starting-quantity imports dated inside the selected range.',
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.adjusted}</span>
    ),
  },
  {
    accessorKey: 'closing',
    header: 'Closing',
    headerTooltip:
      'Opening + issued − received via purchase + purchase returns + adjusted.',
    cell: ({ row }) => (
      <span
        className={cn(
          'tabular-nums font-medium',
          row.original.closing < 0 && 'text-destructive',
        )}
      >
        {row.original.closing}
      </span>
    ),
  },
];

const VendorStockActivityPage: React.FC = () => {
  const defaultDateRange = useMemo<DateRange>(
    () => ({
      from: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      to: new Date(),
    }),
    [],
  );
  const [vendors, setVendors] = useState<
    Array<{ id: number; name: string; code?: number | string | null }>
  >([]);
  const [selectedVendorId, setSelectedVendorId] = useState<
    number | undefined
  >();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    defaultDateRange,
  );
  const [response, setResponse] = useState<VendorStockActivityResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [gridViewRows, setGridViewRows] = useState<
    VendorStockActivityItem[] | null
  >(null);

  const vendorOptions = useMemo(
    () =>
      vendors.map((v) => ({
        id: v.id,
        name: v.code != null ? `${v.code} — ${v.name}` : v.name,
      })),
    [vendors],
  );

  const fetchReport = useCallback(
    async (vendorId: number, range: DateRange) => {
      if (!range.from || !range.to) return;
      setIsLoading(true);
      try {
        const result = await window.electron.getVendorStockActivity({
          vendorAccountId: vendorId,
          startDate: format(range.from, 'yyyy-MM-dd'),
          endDate: format(range.to, 'yyyy-MM-dd'),
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
    },
    [],
  );

  useMountEffect(() => {
    let active = true;
    window.electron
      .getTrackedVendorAccounts()
      .then((rows) => {
        if (!active) return;
        setVendors(rows);
        if (rows.length === 1) {
          setSelectedVendorId(rows[0].id);
          fetchReport(rows[0].id, defaultDateRange);
        }
      })
      .catch((error) => {
        if (!active) return;
        toast({ description: String(error), variant: 'destructive' });
      });
    return () => {
      active = false;
    };
  });

  const handleVendorChange = useCallback(
    (value: string | number) => {
      const vendorId = Number(value);
      setSelectedVendorId(vendorId);
      if (dateRange?.from && dateRange.to) {
        fetchReport(vendorId, dateRange);
      }
    },
    [dateRange, fetchReport],
  );

  const handleDateChange = useCallback(
    (range?: DateRange) => {
      setDateRange(range);
      if (selectedVendorId && range?.from && range.to) {
        fetchReport(selectedVendorId, range);
      }
    },
    [fetchReport, selectedVendorId],
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
              header: 'Family',
              format: 'string',
              width: 28,
            },
            { key: 'opening', header: 'Opening', format: 'number', width: 10 },
            { key: 'issued', header: 'Issued', format: 'number', width: 10 },
            {
              key: 'purchased',
              header: 'Received via purchase',
              format: 'number',
              width: 14,
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
    printVendorStockActivityIframe({
      rows: exportRows,
      vendorName: response.vendorAccountName,
      startDate: response.startDate,
      endDate: response.endDate,
    });
  };

  return (
    <ReportLayout
      printStyles={printStyles}
      header={
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
          <div>
            <h1 className="title-new">At-vendor activity</h1>
            <p className="text-sm text-muted-foreground">
              Use this to reconcile a vendor&apos;s physical count, investigate
              a negative balance, or explain how current quantity changed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Vendor:</span>
              <div className="w-[220px]">
                <VirtualSelect
                  options={vendorOptions}
                  value={selectedVendorId}
                  onChange={handleVendorChange}
                  placeholder="Select vendor"
                  searchPlaceholder="Search vendors..."
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Range:</span>
              <DateRangePickerWithPresets
                $onSelect={handleDateChange}
                initialRange={defaultDateRange}
                initialSelectValue="current-month"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handleExport}
              disabled={!response?.items.length}
              title="Export to Excel"
              aria-label="Export to Excel"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrint}
              disabled={!response?.items.length}
              title="Print report"
              aria-label="Print report"
            >
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        </div>
      }
    >
      {isLoading && <LoadingState />}
      {!isLoading && !response && (
        <EmptyState message="Select a vendor to see activity." />
      )}
      {!isLoading && response && response.items.length === 0 && (
        <EmptyState message="No vendor stock activity in this range." />
      )}
      {!isLoading && response && response.items.length > 0 && (
        <DataTable
          columns={COLUMNS}
          data={response.items}
          onViewModelChange={setGridViewRows}
        />
      )}
    </ReportLayout>
  );
};

export default VendorStockActivityPage;
