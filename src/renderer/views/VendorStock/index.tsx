import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PackageOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { DataTable, type ColumnDef } from '@/renderer/shad/ui/dataTable';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { EditActionButton } from '@/renderer/components/EditActionButton';
import { DateHeader } from '@/renderer/components/common/DateHeader';
import { Badge } from '@/renderer/shad/ui/badge';
import { toast } from '@/renderer/shad/ui/use-toast';
import { cn } from '@/renderer/lib/utils';
import {
  dateFormatOptions,
  datetimeFormatOptions,
} from '@/renderer/lib/constants';
import { isPersistedRowEdited } from '@/renderer/lib/invoiceUtils';
import type { VendorIssueListItem, VendorStockRow } from 'types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/shad/ui/dialog';
import { ImportVendorOpeningStock } from './ImportVendorOpeningStock';

const SELECTED_VENDOR_STORE_KEY = 'vendorStockSelectedVendorId';

const readStoredVendorId = (): number | undefined => {
  const stored = window.electron.store.get(SELECTED_VENDOR_STORE_KEY);
  const id = Number(stored);
  return Number.isInteger(id) && id > 0 ? id : undefined;
};

const persistVendorId = (vendorId: number | undefined): void => {
  window.electron.store.set(SELECTED_VENDOR_STORE_KEY, vendorId ?? null);
};

const VendorStockPage: React.FC = () => {
  const navigate = useNavigate();
  const [vendors, setVendors] = useState<
    Array<{ id: number; name: string; code?: number | string | null }>
  >([]);
  const [selectedVendorId, setSelectedVendorId] = useState<number | undefined>(
    readStoredVendorId,
  );
  const [onHand, setOnHand] = useState<VendorStockRow[]>([]);
  const [issues, setIssues] = useState<VendorIssueListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [issueToDelete, setIssueToDelete] =
    useState<VendorIssueListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const applyVendorId = useCallback((vendorId: number | undefined) => {
    setSelectedVendorId(vendorId);
    persistVendorId(vendorId);
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const tracked = await window.electron.getTrackedVendorAccounts();
      setVendors(tracked);
      const vendorStillTracked =
        selectedVendorId != null &&
        tracked.some((vendor) => vendor.id === selectedVendorId);
      const vendorId = vendorStillTracked ? selectedVendorId : undefined;
      if (selectedVendorId != null && !vendorStillTracked) {
        applyVendorId(undefined);
      }
      const [stock, issueRows] = await Promise.all([
        window.electron.getVendorStockOnHand(vendorId),
        window.electron.getVendorIssues(),
      ]);
      setOnHand(stock);
      setIssues(
        vendorId
          ? issueRows.filter((i) => i.vendorAccountId === vendorId)
          : issueRows,
      );
    } catch (error) {
      toast({
        description: String(error),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [applyVendorId, selectedVendorId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleConfirmDelete = async () => {
    if (!issueToDelete) return;
    setDeleting(true);
    try {
      const result = await window.electron.deleteVendorIssue(issueToDelete.id);
      if (result.success) {
        toast({
          description: `Send #${issueToDelete.issueNumber} deleted`,
          variant: 'success',
        });
        setIssueToDelete(null);
        load();
      } else {
        toast({
          description: result.error ?? 'Failed to delete send',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        description: String(error),
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const vendorFilterOptions = useMemo(
    () => [
      { id: 'all', name: 'All tracked vendors' },
      ...vendors.map((v) => ({
        id: v.id,
        name: v.code != null ? `${v.code} — ${v.name}` : v.name,
      })),
    ],
    [vendors],
  );

  const onHandColumns: ColumnDef<VendorStockRow>[] = useMemo(
    () => [
      ...(selectedVendorId
        ? []
        : [
            {
              accessorKey: 'vendorAccountName',
              header: 'Vendor',
            },
          ]),
      {
        accessorKey: 'inventoryName',
        header: 'Item',
      },
      {
        accessorKey: 'quantity',
        header: 'Qty',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <span
            className={cn(
              'tabular-nums',
              row.original.quantity < 0 && 'font-medium text-destructive',
            )}
          >
            {row.original.quantity.toLocaleString()}
          </span>
        ),
      },
    ],
    [selectedVendorId],
  );

  const issueColumns: ColumnDef<VendorIssueListItem>[] = useMemo(
    () => [
      {
        accessorKey: 'issueNumber',
        header: '#',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <span className="inline-flex max-w-full flex-wrap items-center gap-1.5 whitespace-nowrap tabular-nums font-medium">
            {row.original.issueNumber}
            {isPersistedRowEdited(row.original) ? (
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
      },
      {
        accessorKey: 'date',
        header: DateHeader,
        cell: ({ row }) =>
          row.original.date
            ? new Date(row.original.date).toLocaleString(
                'en-US',
                dateFormatOptions,
              )
            : '',
      },
      ...(selectedVendorId
        ? []
        : [
            {
              accessorKey: 'vendorAccountName',
              header: 'Vendor',
            },
          ]),
      {
        accessorKey: 'totalQuantity',
        header: 'Qty',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.totalQuantity.toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: 'lineCount',
        header: 'Lines',
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <EditActionButton
              onClick={() =>
                navigate(`/vendor-stock/issues/${row.original.id}/edit`)
              }
              aria-label={`Edit issue #${row.original.issueNumber}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
              onClick={() => setIssueToDelete(row.original)}
              aria-label={`Delete issue #${row.original.issueNumber}`}
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [navigate, selectedVendorId],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="title-new">Vendor Stock</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Qty held at tracked vendors. Does not change warehouse inventory.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImportVendorOpeningStock onImported={load} />
          <Button asChild size="sm">
            <Link to="/vendor-stock/issues/new">
              <Plus size={16} className="mr-1.5" />
              Send to vendor
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={isLoading}
          >
            <RefreshCw size={16} />
          </Button>
        </div>
      </header>

      {vendors.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          <PackageOpen className="mb-2 h-5 w-5" />
          No accounts track stock at vendors yet. Edit an account and enable
          &quot;Track stock at this vendor&quot;, then set starting qty or send
          goods.
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Vendor</span>
          <div className="min-w-[240px]">
            <VirtualSelect
              options={vendorFilterOptions}
              value={selectedVendorId ?? 'all'}
              onChange={(value) => {
                applyVendorId(value === 'all' ? undefined : Number(value));
              }}
              placeholder="Filter vendor"
              searchPlaceholder="Search vendors..."
            />
          </div>
          <Button variant="link" className="px-0" asChild>
            <Link
              to="/reports/vendor-stock-activity"
              title="Reconcile or investigate this vendor balance"
            >
              Reconcile activity
            </Link>
          </Button>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">At vendor</h2>
        <DataTable columns={onHandColumns} data={onHand} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Sends</h2>
        <DataTable columns={issueColumns} data={issues} />
      </section>

      <Dialog
        open={issueToDelete != null}
        onOpenChange={(open) => {
          if (!open) setIssueToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete send to vendor?</DialogTitle>
            <DialogDescription>
              {issueToDelete
                ? `Send #${issueToDelete.issueNumber} will be removed and its qty reversed from ${issueToDelete.vendorAccountName}. This cannot be undone.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIssueToDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VendorStockPage;
