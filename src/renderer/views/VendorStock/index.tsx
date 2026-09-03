import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PackageOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { DataTable, type ColumnDef } from '@/renderer/shad/ui/dataTable';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { EditActionButton } from '@/renderer/components/EditActionButton';
import { toast } from '@/renderer/shad/ui/use-toast';
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

const VendorStockPage: React.FC = () => {
  const navigate = useNavigate();
  const [vendors, setVendors] = useState<
    Array<{ id: number; name: string; code?: number | string | null }>
  >([]);
  const [selectedVendorId, setSelectedVendorId] = useState<
    number | undefined
  >();
  const [onHand, setOnHand] = useState<VendorStockRow[]>([]);
  const [issues, setIssues] = useState<VendorIssueListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [issueToDelete, setIssueToDelete] = useState<VendorIssueListItem | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [tracked, stock, issueRows] = await Promise.all([
        window.electron.getTrackedVendorAccounts(),
        window.electron.getVendorStockOnHand(selectedVendorId),
        window.electron.getVendorIssues(),
      ]);
      setVendors(tracked);
      setOnHand(stock);
      setIssues(
        selectedVendorId
          ? issueRows.filter((i) => i.vendorAccountId === selectedVendorId)
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
  }, [selectedVendorId]);

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
          description: `Vendor issue #${issueToDelete.issueNumber} deleted`,
          variant: 'success',
        });
        setIssueToDelete(null);
        load();
      } else {
        toast({
          description: result.error ?? 'Failed to delete vendor issue',
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
      {
        accessorKey: 'vendorAccountName',
        header: 'Vendor',
      },
      {
        accessorKey: 'inventoryName',
        header: 'Item',
      },
      {
        accessorKey: 'quantity',
        header: 'Qty',
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.quantity.toLocaleString()}
          </span>
        ),
      },
    ],
    [],
  );

  const issueColumns: ColumnDef<VendorIssueListItem>[] = useMemo(
    () => [
      {
        accessorKey: 'issueNumber',
        header: '#',
      },
      {
        accessorKey: 'date',
        header: 'Date',
        cell: ({ row }) => row.original.date?.slice(0, 10) ?? '',
      },
      {
        accessorKey: 'vendorAccountName',
        header: 'Vendor',
      },
      {
        accessorKey: 'totalQuantity',
        header: 'Qty',
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
    [navigate],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="title-new">Vendor Stock</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Shadow qty at tracked vendors. Does not change warehouse inventory.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={isLoading}
          >
            <RefreshCw size={16} className="mr-1.5" />
            Refresh
          </Button>
          <ImportVendorOpeningStock onImported={load} />
          <Button asChild size="sm">
            <Link to="/vendor-stock/issues/new">
              <Plus size={16} className="mr-1.5" />
              New vendor issue
            </Link>
          </Button>
        </div>
      </header>

      {vendors.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          <PackageOpen className="mb-2 h-5 w-5" />
          No accounts track vendor stock yet. Edit an account and enable
          &quot;Track vendor stock&quot;, then import opening balances or create
          an issue.
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Vendor</span>
          <div className="min-w-[240px]">
            <VirtualSelect
              options={vendorFilterOptions}
              value={selectedVendorId ?? 'all'}
              onChange={(value) => {
                if (value === 'all') {
                  setSelectedVendorId(undefined);
                } else {
                  setSelectedVendorId(Number(value));
                }
              }}
              placeholder="Filter vendor"
              searchPlaceholder="Search vendors..."
            />
          </div>
          <Button variant="link" className="px-0" asChild>
            <Link to="/reports/vendor-stock-activity">Activity report</Link>
          </Button>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">On hand</h2>
        <DataTable columns={onHandColumns} data={onHand} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Issues</h2>
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
            <DialogTitle>Delete vendor issue?</DialogTitle>
            <DialogDescription>
              {issueToDelete
                ? `Issue #${issueToDelete.issueNumber} will be removed and its qty reversed from ${issueToDelete.vendorAccountName}. This cannot be undone.`
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
