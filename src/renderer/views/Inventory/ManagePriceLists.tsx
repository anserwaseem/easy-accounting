import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ListPlus, Tags } from 'lucide-react';
import { Alert, AlertDescription } from '@/renderer/shad/ui/alert';
import { Button } from '@/renderer/shad/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/renderer/shad/ui/dialog';
import { Input } from '@/renderer/shad/ui/input';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Label } from '@/renderer/shad/ui/label';
import { RadioGroup, RadioGroupItem } from '@/renderer/shad/ui/radio-group';
import { toast } from '@/renderer/shad/ui/use-toast';
import type { PriceListSummary } from '@/renderer/hooks/usePublishSettings';
import type { SeedPlan, SeedSource } from '@/main/utils/priceSeeding';

interface ManagePriceListsProps {
  /** ids currently visible after the page's filters — the "current filter" scope */
  filteredInventoryIds: number[];
  /** called after any change so the inventory table can refresh */
  onUpdated?: () => void;
  initialOpen?: boolean;
}

const DEFAULT_ROUND_TO = '10';

/**
 * Create, rename, deactivate and bulk-seed named price lists.
 *
 * Lives on the Inventory page because price lists are item reference data —
 * the same reasoning that puts item types here. Publishing only decides which
 * list is public, which stays in Settings.
 *
 * There is no delete: removing a list cascades to every price recorded against
 * it, so unwanted lists are deactivated instead and keep their prices.
 */
export const ManagePriceLists: React.FC<ManagePriceListsProps> = ({
  filteredInventoryIds,
  onUpdated,
  initialOpen = false,
}: ManagePriceListsProps) => {
  const [open, setOpen] = useState(initialOpen);
  const [priceLists, setPriceLists] = useState<PriceListSummary[]>([]);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

  // seeding state
  const [seedListId, setSeedListId] = useState<number | null>(null);
  const [source, setSource] = useState<SeedSource>('base');
  const [multiplier, setMultiplier] = useState('1.2');
  const [roundTo, setRoundTo] = useState(DEFAULT_ROUND_TO);
  const [overwrite, setOverwrite] = useState(false);
  const [scopeFiltered, setScopeFiltered] = useState(true);
  const [plan, setPlan] = useState<SeedPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPriceLists(await window.electron.getPriceLists());
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const seedList = useMemo(
    () => priceLists.find((l) => l.id === seedListId) ?? null,
    [priceLists, seedListId],
  );

  const resetSeed = useCallback(() => {
    setSeedListId(null);
    setPlan(null);
    setSource('base');
    setMultiplier('1.2');
    setRoundTo(DEFAULT_ROUND_TO);
    setOverwrite(false);
    setScopeFiltered(true);
  }, []);

  const seedOptions = useMemo(
    () => ({
      source,
      multiplier: Number(multiplier),
      roundTo: Number(roundTo),
      overwriteExisting: overwrite,
    }),
    [source, multiplier, roundTo, overwrite],
  );

  const optionsValid =
    Number.isFinite(seedOptions.multiplier) &&
    seedOptions.multiplier > 0 &&
    Number.isInteger(seedOptions.roundTo) &&
    seedOptions.roundTo > 0;

  const scopeIds = scopeFiltered ? filteredInventoryIds : undefined;

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    const ok = await window.electron.createPriceList(name);
    toast({
      description: ok
        ? `Price list "${name}" created`
        : `A price list named "${name}" already exists`,
      variant: ok ? 'success' : 'destructive',
    });
    if (ok) {
      setNewName('');
      await load();
      onUpdated?.();
    }
  }, [newName, load, onUpdated]);

  const handleRename = useCallback(async () => {
    if (editingId === null) return;
    const name = editingName.trim();
    if (!name) return;
    const ok = await window.electron.renamePriceList(editingId, name);
    if (!ok) {
      toast({
        description: `Could not rename — "${name}" may already be in use`,
        variant: 'destructive',
      });
      return;
    }
    setEditingId(null);
    await load();
    onUpdated?.();
  }, [editingId, editingName, load, onUpdated]);

  const handleToggle = useCallback(
    async (list: PriceListSummary) => {
      await window.electron.setPriceListActive(list.id, !list.isActive);
      await load();
      onUpdated?.();
    },
    [load, onUpdated],
  );

  const handlePreview = useCallback(async () => {
    if (seedListId === null || !optionsValid) return;
    setBusy(true);
    try {
      setPlan(
        await window.electron.previewPriceListSeed(
          seedListId,
          seedOptions,
          scopeIds,
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [seedListId, optionsValid, seedOptions, scopeIds]);

  const handleApply = useCallback(async () => {
    if (seedListId === null || !optionsValid) return;
    setBusy(true);
    try {
      const { applied } = await window.electron.applyPriceListSeed(
        seedListId,
        seedOptions,
        scopeIds,
      );
      toast({
        description: `${applied} price${applied === 1 ? '' : 's'} updated`,
        variant: 'success',
      });
      resetSeed();
      await load();
      onUpdated?.();
    } finally {
      setBusy(false);
    }
  }, [
    seedListId,
    optionsValid,
    seedOptions,
    scopeIds,
    resetSeed,
    load,
    onUpdated,
  ]);

  // re-applying a factor to a list compounds it; worth saying out loud
  const compounding = source === 'list' && overwrite;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetSeed();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Tags size={16} />
          Price lists
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Price lists</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          A price list holds an alternative price per item alongside the base
          price. Deactivating a list hides it without losing its prices.
        </p>

        <div className="flex flex-col gap-2">
          {priceLists.map((list) => (
            <div key={list.id} className="flex items-center gap-2 text-sm">
              {editingId === list.id ? (
                <>
                  <Input
                    className="max-w-48"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    aria-label={`New name for ${list.name}`}
                  />
                  <Button size="sm" onClick={handleRename}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-32 font-medium">{list.name}</span>
                  <span className="min-w-32 text-muted-foreground">
                    {list.itemCount} priced
                    {list.isActive ? '' : ' · inactive'}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingId(list.id);
                      setEditingName(list.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleToggle(list)}
                  >
                    {list.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1"
                    onClick={() => {
                      setSeedListId(list.id);
                      setPlan(null);
                    }}
                  >
                    <ListPlus size={14} />
                    Set prices
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-end gap-2 border-t pt-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-price-list">New price list</Label>
            <Input
              id="new-price-list"
              className="max-w-48"
              placeholder="e.g. Retail"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            onClick={handleCreate}
            disabled={!newName.trim()}
          >
            Add
          </Button>
        </div>

        {seedList && (
          <div className="flex flex-col gap-3 border-t pt-3">
            <h4 className="font-medium">Set prices on “{seedList.name}”</h4>

            <div className="flex flex-col gap-2">
              <Label>Start from</Label>
              <RadioGroup
                value={source}
                onValueChange={(v) => {
                  setSource(v as SeedSource);
                  setPlan(null);
                }}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="base" id="seed-source-base" />
                  <Label htmlFor="seed-source-base">Base item price</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="list" id="seed-source-list" />
                  <Label htmlFor="seed-source-list">
                    This list&apos;s current price
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="seed-multiplier">Multiply by</Label>
                <Input
                  id="seed-multiplier"
                  className="w-24"
                  value={multiplier}
                  onChange={(e) => {
                    setMultiplier(e.target.value);
                    setPlan(null);
                  }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="seed-round">Round to nearest</Label>
                <Input
                  id="seed-round"
                  className="w-24"
                  value={roundTo}
                  onChange={(e) => {
                    setRoundTo(e.target.value);
                    setPlan(null);
                  }}
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox
                  id="seed-overwrite"
                  checked={overwrite}
                  onCheckedChange={(c) => {
                    setOverwrite(c === true);
                    setPlan(null);
                  }}
                />
                <Label htmlFor="seed-overwrite">
                  Overwrite prices already set
                </Label>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="seed-scope"
                checked={scopeFiltered}
                onCheckedChange={(c) => {
                  setScopeFiltered(c === true);
                  setPlan(null);
                }}
              />
              <Label htmlFor="seed-scope">
                Only the {filteredInventoryIds.length} item
                {filteredInventoryIds.length === 1 ? '' : 's'} currently shown
              </Label>
            </div>

            {!optionsValid && (
              <p className="text-sm text-destructive">
                Multiply by must be greater than 0, and round to nearest must be
                a whole number greater than 0.
              </p>
            )}

            {compounding && (
              <Alert>
                <AlertTriangle size={16} />
                <AlertDescription className="text-xs">
                  This multiplies the list&apos;s existing prices, so running it
                  twice applies the increase twice.
                </AlertDescription>
              </Alert>
            )}

            {plan && (
              <div className="text-sm">
                <p>
                  Would set {plan.changes.length} price
                  {plan.changes.length === 1 ? '' : 's'}.
                </p>
                <p className="text-muted-foreground text-xs">
                  {plan.unchanged} already correct · {plan.skippedExisting}{' '}
                  skipped (already priced) · {plan.skippedNoSource} skipped (no
                  price to start from)
                </p>
                {plan.changes.length > 0 && (
                  <p className="text-muted-foreground text-xs">
                    e.g.{' '}
                    {plan.changes
                      .slice(0, 3)
                      .map((c) => `${c.name}: ${c.from ?? '—'} → ${c.to}`)
                      .join(' · ')}
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handlePreview}
                disabled={busy || !optionsValid}
              >
                {busy ? 'Checking…' : 'Preview'}
              </Button>
              <Button
                onClick={handleApply}
                disabled={busy || !plan || plan.changes.length === 0}
                title={!plan ? 'Preview first' : undefined}
              >
                Apply
              </Button>
              <Button variant="ghost" onClick={resetSeed}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ManagePriceLists;
