import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { Label } from '@/renderer/shad/ui/label';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { toast } from '@/renderer/shad/ui/use-toast';
import { toLocalDateInputValue } from '@/renderer/lib/localDate';
import type { InventoryItem } from 'types';

interface IssueLine {
  key: string;
  inventoryId: number;
  quantity: number;
}

const NewVendorIssuePage: React.FC = () => {
  const navigate = useNavigate();
  const { id: editIdParam } = useParams<{ id?: string }>();
  const editIssueId =
    editIdParam != null && Number(editIdParam) > 0
      ? Number(editIdParam)
      : undefined;
  const isEdit = editIssueId != null;

  const [vendors, setVendors] = useState<
    Array<{ id: number; name: string; code?: number | string | null }>
  >([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [vendorAccountId, setVendorAccountId] = useState<number | undefined>();
  const [date, setDate] = useState(toLocalDateInputValue(new Date()));
  const [notes, setNotes] = useState('');
  const [issueNumber, setIssueNumber] = useState<number>(1);
  const [lines, setLines] = useState<IssueLine[]>([
    { key: '1', inventoryId: 0, quantity: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [tracked, items] = await Promise.all([
          window.electron.getTrackedVendorAccounts(),
          window.electron.getInventory(),
        ]);
        setVendors(tracked);
        setInventory(items ?? []);

        if (isEdit && editIssueId != null) {
          const issue = await window.electron.getVendorIssue(editIssueId);
          if (!issue) {
            toast({
              description: 'Send not found',
              variant: 'destructive',
            });
            navigate('/vendor-stock');
            return;
          }
          setIssueNumber(issue.issueNumber);
          setVendorAccountId(issue.vendorAccountId);
          // prefer stored date text; avoid UTC shift from Date parsing
          const dateText = issue.date?.slice(0, 10);
          setDate(
            dateText && /^\d{4}-\d{2}-\d{2}$/.test(dateText)
              ? dateText
              : toLocalDateInputValue(new Date(issue.date)),
          );
          setNotes(issue.notes ?? '');
          setLines(
            issue.items.length
              ? issue.items.map((item) => ({
                  key: String(item.id),
                  inventoryId: item.inventoryId,
                  quantity: item.quantity,
                }))
              : [{ key: '1', inventoryId: 0, quantity: 0 }],
          );
        } else {
          const nextNumber = await window.electron.getNextVendorIssueNumber();
          setIssueNumber(nextNumber);
        }
      } catch (error) {
        toast({
          description: String(error),
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [editIssueId, isEdit, navigate]);

  const vendorOptions = useMemo(
    () =>
      vendors.map((v) => ({
        id: v.id,
        name: v.code != null ? `${v.code} — ${v.name}` : v.name,
      })),
    [vendors],
  );

  const familyHeadOptions = useMemo(
    () =>
      // send picker: family heads only (parentId null). orphans count as heads
      // until linked via Edit inventory → Family head.
      inventory.filter((item) => item.parentId == null),
    [inventory],
  );

  const addLine = useCallback(() => {
    setLines((prev) => [
      ...prev,
      { key: String(Date.now()), inventoryId: 0, quantity: 0 },
    ]);
  }, []);

  const removeLine = useCallback((key: string) => {
    setLines((prev) =>
      prev.length <= 1 ? prev : prev.filter((l) => l.key !== key),
    );
  }, []);

  const handleSave = async () => {
    if (!vendorAccountId) {
      toast({
        description: 'Select a tracked vendor',
        variant: 'destructive',
      });
      return;
    }
    const items = lines
      .filter((l) => l.inventoryId > 0 && l.quantity > 0)
      .map((l) => ({ inventoryId: l.inventoryId, quantity: l.quantity }));
    if (!items.length) {
      toast({
        description: 'Add at least one item with quantity > 0',
        variant: 'destructive',
      });
      return;
    }

    const payload = {
      vendorAccountId,
      date,
      notes: notes.trim() || undefined,
      items,
    };

    setSaving(true);
    try {
      const result =
        isEdit && editIssueId != null
          ? await window.electron.updateVendorIssue(editIssueId, payload)
          : await window.electron.createVendorIssue(payload);
      if (result.success) {
        toast({
          description: isEdit
            ? `Send #${result.issueNumber} updated`
            : `Send #${result.issueNumber} created`,
          variant: 'success',
        });
        navigate('/vendor-stock');
      } else {
        toast({
          description:
            result.error ??
            (isEdit ? 'Failed to update send' : 'Failed to create send'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        description: String(error),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="title-new">
          {isEdit ? 'Edit send to vendor' : 'Send to vendor'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isEdit
            ? 'Updates family qty at the vendor to match this send. Warehouse inventory is unchanged.'
            : 'Increases family qty at the vendor (pick the family head). Warehouse inventory is unchanged. Purchases of any variant later reduce the same pool.'}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Send #</Label>
          <Input value={issueNumber} disabled />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vendorIssueDate">Date</Label>
          <Input
            id="vendorIssueDate"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Vendor</Label>
          {vendors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tracked vendors. Enable &quot;Track stock at this vendor&quot;
              on an account first.
            </p>
          ) : (
            <VirtualSelect
              options={vendorOptions}
              value={vendorAccountId}
              onChange={(value) => setVendorAccountId(Number(value))}
              placeholder="Select vendor"
              searchPlaceholder="Search vendors..."
            />
          )}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="vendorIssueNotes">Notes</Label>
          <Input
            id="vendorIssueNotes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Items</h2>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus size={14} className="mr-1" />
            Add line
          </Button>
        </div>
        {lines.map((line) => (
          <div
            key={line.key}
            className="grid grid-cols-[1fr_120px_40px] items-center gap-2"
          >
            <VirtualSelect
              options={familyHeadOptions}
              value={line.inventoryId || null}
              onChange={(value) =>
                setLines((prev) =>
                  prev.map((l) =>
                    l.key === line.key
                      ? { ...l, inventoryId: Number(value) }
                      : l,
                  ),
                )
              }
              placeholder="Family head"
              searchPlaceholder="Search family heads..."
            />
            <Input
              type="number"
              min={1}
              value={line.quantity || ''}
              onChange={(e) =>
                setLines((prev) =>
                  prev.map((l) =>
                    l.key === line.key
                      ? { ...l, quantity: Number(e.target.value) || 0 }
                      : l,
                  ),
                )
              }
              placeholder="Qty"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeLine(line.key)}
              aria-label="Remove line"
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving || vendors.length === 0}>
          {isEdit ? 'Save changes' : 'Save send'}
        </Button>
        <Button variant="ghost" onClick={() => navigate('/vendor-stock')}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default NewVendorIssuePage;
