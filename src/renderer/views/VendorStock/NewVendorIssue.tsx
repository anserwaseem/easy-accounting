import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { groupBy, sortBy } from 'lodash';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { Label } from '@/renderer/shad/ui/label';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { toast } from '@/renderer/shad/ui/use-toast';
import { toLocalDateInputValue } from '@/renderer/lib/localDate';
import { useCmdOrCtrlShortcut } from '@/renderer/hooks/useCmdOrCtrlShortcut';
import { useMountEffect } from '@/renderer/hooks/useMountEffect';
import type { InventoryItem } from 'types';

interface IssueLine {
  key: string;
  inventoryId: number;
  quantity: number;
}

interface FamilyHeadOption extends InventoryItem {
  variantNames: string[];
  variantSearch: string;
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
  const [expandedVariantLineKeys, setExpandedVariantLineKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const lineSequenceRef = useRef(1);
  const pendingItemFocusKeyRef = useRef<string | null>(null);
  const quantityInputRefs = useRef(new Map<string, HTMLInputElement>());

  useMountEffect(() => {
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
  });

  const vendorOptions = useMemo(
    () =>
      vendors.map((v) => ({
        id: v.id,
        name: v.code != null ? `${v.code} — ${v.name}` : v.name,
      })),
    [vendors],
  );

  const familyHeadOptions = useMemo<FamilyHeadOption[]>(() => {
    const variantsByHead = groupBy(
      inventory.filter((item) => item.parentId != null),
      (item) => String(item.parentId),
    );
    return inventory
      .filter((item) => item.parentId == null)
      .map((head) => {
        const variantNames = sortBy(
          variantsByHead[String(head.id)] ?? [],
          (variant) => variant.name.toLowerCase(),
        ).map((variant) => variant.name);
        return {
          ...head,
          variantNames,
          variantSearch: variantNames.join(' '),
        };
      });
  }, [inventory]);

  const addLine = useCallback(() => {
    const key = `new-${lineSequenceRef.current + 1}`;
    lineSequenceRef.current += 1;
    pendingItemFocusKeyRef.current = key;
    setLines((prev) => [...prev, { key, inventoryId: 0, quantity: 0 }]);
  }, []);

  useCmdOrCtrlShortcut('n', addLine);

  const removeLine = useCallback((key: string) => {
    setLines((prev) =>
      prev.length <= 1 ? prev : prev.filter((l) => l.key !== key),
    );
    setExpandedVariantLineKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const handleFamilyChange = useCallback(
    (lineKey: string, inventoryId: number) => {
      setLines((prev) =>
        prev.map((line) =>
          line.key === lineKey ? { ...line, inventoryId } : line,
        ),
      );
      setExpandedVariantLineKeys((prev) => {
        if (!prev.has(lineKey)) return prev;
        const next = new Set(prev);
        next.delete(lineKey);
        return next;
      });
      requestAnimationFrame(() => {
        quantityInputRefs.current.get(lineKey)?.focus();
      });
    },
    [],
  );

  const toggleVariantDetails = useCallback((lineKey: string) => {
    setExpandedVariantLineKeys((prev) => {
      const next = new Set(prev);
      if (!next.delete(lineKey)) next.add(lineKey);
      return next;
    });
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
          <textarea
            id="vendorIssueNotes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes"
            rows={3}
            className="flex min-h-[5rem] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">Goods sent</h2>
            <p className="text-xs text-muted-foreground">
              If one common batch can become several variants, select its
              family. Otherwise select the individual item.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus size={14} className="mr-1" />
            Add line
          </Button>
        </div>
        <div className="hidden grid-cols-[minmax(0,1fr)_120px_40px] gap-2 px-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>Family or individual item</span>
          <span>Quantity</span>
          <span />
        </div>
        {lines.map((line) => {
          const selectedHead = familyHeadOptions.find(
            (head) => head.id === line.inventoryId,
          );
          const variantsExpanded = expandedVariantLineKeys.has(line.key);
          return (
            <div
              key={line.key}
              className="grid grid-cols-[minmax(0,1fr)_120px_40px] items-center gap-2 rounded-md border bg-muted/10 p-2"
            >
              <div className="min-w-0 space-y-1">
                <VirtualSelect
                  options={familyHeadOptions}
                  searchFields={['name', 'variantSearch']}
                  groupBy={(head) =>
                    head.variantNames.length > 0
                      ? 'Families'
                      : 'Individual items'
                  }
                  value={line.inventoryId || null}
                  triggerRef={(node) => {
                    if (node && pendingItemFocusKeyRef.current === line.key) {
                      pendingItemFocusKeyRef.current = null;
                      requestAnimationFrame(() => node.focus());
                    }
                  }}
                  onChange={(value) =>
                    handleFamilyChange(line.key, Number(value))
                  }
                  placeholder="Select family or item"
                  renderSelectItem={(head) => (
                    <div className="flex min-w-0 w-full items-center justify-between gap-3">
                      <span className="truncate font-medium">{head.name}</span>
                      {head.variantNames.length > 0 ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {head.variantNames.length} variants
                        </span>
                      ) : null}
                    </div>
                  )}
                />
                {selectedHead?.variantNames.length ? (
                  <button
                    type="button"
                    className="flex items-center gap-1 px-1 text-xs font-medium text-primary hover:underline"
                    onClick={() => toggleVariantDetails(line.key)}
                    aria-expanded={variantsExpanded}
                  >
                    <ChevronDown
                      size={13}
                      className={
                        variantsExpanded
                          ? 'rotate-180 transition-transform'
                          : 'transition-transform'
                      }
                    />
                    {variantsExpanded ? 'Hide' : 'View'}{' '}
                    {selectedHead.variantNames.length} variants
                  </button>
                ) : null}
              </div>
              <Input
                ref={(node) => {
                  if (node) quantityInputRefs.current.set(line.key, node);
                  else quantityInputRefs.current.delete(line.key);
                }}
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
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  addLine();
                }}
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
              {variantsExpanded && selectedHead?.variantNames.length ? (
                <div className="col-span-full flex max-h-28 flex-wrap gap-1.5 overflow-y-auto border-t pt-2">
                  {selectedHead.variantNames.map((variantName) => (
                    <span
                      key={variantName}
                      className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {variantName}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
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
