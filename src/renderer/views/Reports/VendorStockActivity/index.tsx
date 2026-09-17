import { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { ReportLayout } from '@/renderer/components/ReportLayout';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { DateRangePickerWithPresets } from '@/renderer/shad/ui/datePicker';
import { DataTable, type ColumnDef } from '@/renderer/shad/ui/dataTable';
import { exportReportWorkbook } from '@/renderer/lib/reportExport';
import {
  loadSavedFilters,
  makeSavedState,
  saveSavedFilters,
} from '@/renderer/lib/reportFilters';
import {
  pickTrackedVendorId,
  readStoredVendorStockVendorId,
} from '@/renderer/lib/vendorStockSelection';
import { cn } from '@/renderer/lib/utils';
import { toast } from '@/renderer/shad/ui/use-toast';
import { useMountEffect } from '@/renderer/hooks/useMountEffect';
import type {
  VendorStockActivityItem,
  VendorStockActivityResponse,
} from 'types';
import { REPORT_FILTER_KEYS } from 'types';
import { printStyles } from '../components/printStyles';
import { EmptyState, LoadingState } from '../components';
import {
  ACTIVITY_COLUMN_HEADERS,
  ACTIVITY_EQUATION,
  activityMovementLabel,
  itemHasFilterMovements,
  type ActivityMovementFilter,
} from './activityPresentation';
import { printVendorStockActivityIframe } from './printVendorStockActivity';
import { VendorStockActivitySheet } from './VendorStockActivitySheet';

interface VendorStockActivityLocationState {
  vendorAccountId?: number;
}

interface ItemNameCellProps {
  item: VendorStockActivityItem;
  onSelect: (
    item: VendorStockActivityItem,
    filter: ActivityMovementFilter,
  ) => void;
}

const clickableClassName =
  'cursor-pointer underline decoration-dotted decoration-muted-foreground/70 underline-offset-4 hover:decoration-solid hover:decoration-foreground';

const ItemNameCell: React.FC<ItemNameCellProps> = ({
  item,
  onSelect,
}: ItemNameCellProps) => (
  <button
    type="button"
    className={cn('min-w-0 truncate text-left', clickableClassName)}
    onClick={() => onSelect(item, 'all')}
    title="View movements in this range"
  >
    {item.inventoryName}
  </button>
);

interface QtyCellProps {
  quantity: number;
  onClick?: () => void;
  emphasize?: boolean;
  destructive?: boolean;
  title?: string;
}

const QtyCell: React.FC<QtyCellProps> = ({
  quantity,
  onClick,
  emphasize,
  destructive,
  title,
}: QtyCellProps) => {
  const className = cn(
    'tabular-nums',
    emphasize && 'font-medium',
    destructive && quantity < 0 && 'text-destructive',
  );
  if (!onClick) {
    return <span className={className}>{quantity.toLocaleString()}</span>;
  }
  return (
    <button
      type="button"
      className={cn(className, clickableClassName)}
      onClick={onClick}
      title={title}
    >
      {quantity.toLocaleString()}
    </button>
  );
};

const VendorStockActivityPage: React.FC = () => {
  const location = useLocation();
  const saved = useMemo(
    () => loadSavedFilters(REPORT_FILTER_KEYS.vendorStockActivity),
    [],
  );
  const defaultDateRange = useMemo<DateRange>(() => {
    if (saved.dateRange?.from && saved.dateRange?.to) {
      return {
        from: new Date(saved.dateRange.from),
        to: new Date(saved.dateRange.to),
      };
    }
    return {
      from: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      to: new Date(),
    };
  }, [saved.dateRange]);
  const [vendors, setVendors] = useState<
    Array<{ id: number; name: string; code?: number | string | null }>
  >([]);
  const [selectedVendorId, setSelectedVendorId] = useState<number | undefined>(
    () => {
      const navId = (location.state as VendorStockActivityLocationState | null)
        ?.vendorAccountId;
      if (navId != null && Number.isInteger(navId) && navId > 0) return navId;
      const savedId = saved.accountIds?.[0];
      if (savedId != null && Number.isInteger(savedId) && savedId > 0) {
        return savedId;
      }
      return undefined;
    },
  );
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    defaultDateRange,
  );
  const [presetValue, setPresetValue] = useState<string | undefined>(
    saved.presetValue ?? 'current-month',
  );
  const [response, setResponse] = useState<VendorStockActivityResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [gridViewRows, setGridViewRows] = useState<
    VendorStockActivityItem[] | null
  >(null);
  const [selectedItem, setSelectedItem] =
    useState<VendorStockActivityItem | null>(null);
  const [selectedFilter, setSelectedFilter] =
    useState<ActivityMovementFilter>('all');

  const vendorOptions = useMemo(
    () =>
      vendors.map((v) => ({
        id: v.id,
        name: v.code != null ? `${v.code} — ${v.name}` : v.name,
      })),
    [vendors],
  );

  const persistFilters = useCallback(
    (
      range: DateRange | undefined,
      vendorId: number | undefined,
      preset: string | undefined,
    ) => {
      saveSavedFilters(
        REPORT_FILTER_KEYS.vendorStockActivity,
        makeSavedState(range, undefined, {
          ...(preset ? { presetValue: preset } : {}),
          ...(vendorId != null ? { accountIds: [vendorId] } : {}),
        }),
      );
    },
    [],
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
        setSelectedItem(null);
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
        const nextVendorId = pickTrackedVendorId(
          rows.map((row) => row.id),
          [
            selectedVendorId,
            readStoredVendorStockVendorId(),
            rows.length === 1 ? rows[0].id : undefined,
          ],
        );
        if (nextVendorId !== selectedVendorId) {
          setSelectedVendorId(nextVendorId);
          persistFilters(dateRange, nextVendorId, presetValue);
          if (nextVendorId != null && dateRange?.from && dateRange.to) {
            fetchReport(nextVendorId, dateRange);
          }
          return;
        }
        if (nextVendorId != null) {
          persistFilters(dateRange, nextVendorId, presetValue);
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
      persistFilters(dateRange, vendorId, presetValue);
      if (dateRange?.from && dateRange.to) {
        fetchReport(vendorId, dateRange);
      }
    },
    [dateRange, fetchReport, persistFilters, presetValue],
  );

  const handleDateChange = useCallback(
    (range?: DateRange, selectValue?: string) => {
      if (!range) return;
      setDateRange(range);
      const nextPreset = selectValue || presetValue;
      if (selectValue) setPresetValue(selectValue);
      persistFilters(range, selectedVendorId, nextPreset);
      if (selectedVendorId && range.from && range.to) {
        fetchReport(selectedVendorId, range);
      }
    },
    [fetchReport, persistFilters, presetValue, selectedVendorId],
  );

  const openItem = useCallback(
    (item: VendorStockActivityItem, filter: ActivityMovementFilter) => {
      setSelectedFilter(filter);
      setSelectedItem(item);
    },
    [],
  );

  const columns = useMemo<ColumnDef<VendorStockActivityItem>[]>(
    () => [
      {
        accessorKey: 'inventoryName',
        header: ACTIVITY_COLUMN_HEADERS.inventoryName,
        headerTooltip:
          'Shared quantity pool at this vendor. Send or buy a variant and it still hits this row.',
        onClick: (row) => openItem(row.original, 'all'),
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <ItemNameCell item={row.original} onSelect={openItem} />
        ),
      },
      {
        accessorKey: 'opening',
        header: ACTIVITY_COLUMN_HEADERS.opening,
        headerTooltip: 'Qty already at this vendor before the start date.',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => <QtyCell quantity={row.original.opening} />,
      },
      {
        accessorKey: 'issued',
        header: ACTIVITY_COLUMN_HEADERS.issued,
        headerTooltip:
          'Goods sent to this vendor in the range. Click for send documents.',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <QtyCell
            quantity={row.original.issued}
            title="View send documents"
            onClick={
              itemHasFilterMovements(row.original, 'issue')
                ? () => openItem(row.original, 'issue')
                : undefined
            }
          />
        ),
      },
      {
        accessorKey: 'purchased',
        header: ACTIVITY_COLUMN_HEADERS.purchased,
        headerTooltip:
          'Finished goods bought back on a purchase invoice. Reduces qty at vendor. Click for invoices.',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <QtyCell
            quantity={row.original.purchased}
            title="View purchase invoices"
            onClick={
              itemHasFilterMovements(row.original, 'purchase')
                ? () => openItem(row.original, 'purchase')
                : undefined
            }
          />
        ),
      },
      {
        accessorKey: 'purchaseReturned',
        header: ACTIVITY_COLUMN_HEADERS.purchaseReturned,
        headerTooltip:
          'Purchase returns in the range. Adds qty back at vendor. Click for documents.',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <QtyCell
            quantity={row.original.purchaseReturned}
            title="View purchase returns"
            onClick={
              itemHasFilterMovements(row.original, 'purchase_return')
                ? () => openItem(row.original, 'purchase_return')
                : undefined
            }
          />
        ),
      },
      {
        accessorKey: 'adjusted',
        header: ACTIVITY_COLUMN_HEADERS.adjusted,
        headerTooltip:
          'Opening imports dated inside the range, plus corrections. Click for lines.',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <QtyCell
            quantity={row.original.adjusted}
            title="View adjustments"
            onClick={
              itemHasFilterMovements(row.original, 'adjusted')
                ? () => openItem(row.original, 'adjusted')
                : undefined
            }
          />
        ),
      },
      {
        accessorKey: 'closing',
        header: ACTIVITY_COLUMN_HEADERS.closing,
        headerTooltip: ACTIVITY_EQUATION,
        onClick: (row) => openItem(row.original, 'all'),
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <QtyCell
            quantity={row.original.closing}
            emphasize
            destructive
            title="View movements in this range"
            onClick={() => openItem(row.original, 'all')}
          />
        ),
      },
    ],
    [openItem],
  );

  const dateSubtitle = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return '';
    return `${format(dateRange.from, 'PP')} – ${format(dateRange.to, 'PP')}`;
  }, [dateRange]);

  const exportRows = gridViewRows ?? response?.items ?? [];

  const handleExport = () => {
    if (!response) return;
    const subtitle = `${response.vendorAccountName} · ${dateSubtitle}`;
    const movementRows = exportRows.flatMap((item) =>
      item.movements.map((movement) => ({
        date: movement.date,
        source: activityMovementLabel(movement),
        inventoryName: item.inventoryName,
        quantityDelta: movement.quantityDelta,
      })),
    );
    exportReportWorkbook(
      [
        {
          title: 'At-vendor activity',
          subtitle: `${subtitle} · ${ACTIVITY_EQUATION}`,
          sheetName: 'Activity',
          columns: [
            {
              key: 'inventoryName',
              header: ACTIVITY_COLUMN_HEADERS.inventoryName,
              format: 'string',
              width: 28,
            },
            {
              key: 'opening',
              header: ACTIVITY_COLUMN_HEADERS.opening,
              format: 'number',
              width: 10,
            },
            {
              key: 'issued',
              header: ACTIVITY_COLUMN_HEADERS.issued,
              format: 'number',
              width: 10,
            },
            {
              key: 'purchased',
              header: ACTIVITY_COLUMN_HEADERS.purchased,
              format: 'number',
              width: 12,
            },
            {
              key: 'purchaseReturned',
              header: ACTIVITY_COLUMN_HEADERS.purchaseReturned,
              format: 'number',
              width: 10,
            },
            {
              key: 'adjusted',
              header: ACTIVITY_COLUMN_HEADERS.adjusted,
              format: 'number',
              width: 10,
            },
            {
              key: 'closing',
              header: ACTIVITY_COLUMN_HEADERS.closing,
              format: 'number',
              width: 10,
            },
          ],
          rows: exportRows as unknown as Array<Record<string, unknown>>,
        },
        {
          title: 'At-vendor activity — Movements',
          subtitle,
          sheetName: 'Movements',
          columns: [
            { key: 'date', header: 'Date', format: 'date', width: 14 },
            { key: 'source', header: 'Source', format: 'string', width: 22 },
            {
              key: 'inventoryName',
              header: ACTIVITY_COLUMN_HEADERS.inventoryName,
              format: 'string',
              width: 28,
            },
            {
              key: 'quantityDelta',
              header: 'At vendor',
              format: 'number',
              width: 12,
            },
          ],
          rows: movementRows as unknown as Array<Record<string, unknown>>,
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
      dateSubtitle,
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
              Qty held at this vendor — not warehouse stock. Click a number to
              see the sends or purchases behind it.
            </p>
            <p className="mt-1 text-sm font-medium tabular-nums">
              {ACTIVITY_EQUATION}
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
                initialSelectValue={presetValue}
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
      <VendorStockActivitySheet
        item={selectedItem}
        filter={selectedFilter}
        vendorName={response?.vendorAccountName ?? ''}
        dateSubtitle={dateSubtitle}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
      />
      {isLoading && <LoadingState />}
      {!isLoading && !response && (
        <EmptyState message="Select a vendor to see activity." />
      )}
      {!isLoading && response && response.items.length === 0 && (
        <EmptyState message="No vendor stock activity in this range." />
      )}
      {!isLoading && response && response.items.length > 0 && (
        <DataTable
          columns={columns}
          data={response.items}
          virtual
          virtualHeightMode="fill"
          compact
          defaultSortField="inventoryName"
          defaultSortDirection="asc"
          searchFields={['inventoryName']}
          searchPlaceholder="Search items..."
          searchPersistenceKey="vendor-stock-activity-search"
          getRowKey={(row) => row.inventoryId}
          onViewModelChange={setGridViewRows}
        />
      )}
    </ReportLayout>
  );
};

export default VendorStockActivityPage;
