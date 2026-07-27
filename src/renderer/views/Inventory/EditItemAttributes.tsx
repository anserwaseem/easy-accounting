import { useCallback, useEffect, useMemo, useState } from 'react';
import { Tag, Undo2 } from 'lucide-react';
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
import { toast } from '@/renderer/shad/ui/use-toast';
import type { AttributeDefinition, InventoryItem } from 'types';
import {
  CopyAttributesPanel,
  CopyAttributesTrigger,
} from './CopyAttributesPanel';

interface EditItemAttributesProps {
  item: InventoryItem;
  onUpdated?: () => void;
}

/** attribute values are stored as JSON, so normalise everything to a string for editing */
const toInputValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : '';
  return String(value);
};

/** converts an edited string back to the type the definition declares */
export const coerceAttributeValue = (
  raw: string,
  valueType: AttributeDefinition['valueType'],
): unknown => {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (valueType === 'number') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  if (valueType === 'bool') return true;
  return trimmed;
};

/**
 * Per-item editor for the custom attributes defined by the business.
 *
 * Fields are generated from attribute_definitions, so a business sees exactly
 * the attributes it declared — nothing here is product-specific. Attributes
 * matter beyond display: an item with none is not publishable.
 */
export const EditItemAttributes: React.FC<EditItemAttributesProps> = ({
  item,
  onUpdated,
}: EditItemAttributesProps) => {
  const [open, setOpen] = useState(false);
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // null = the copy panel has never been opened; [] = opened, nothing to offer
  const [candidates, setCandidates] = useState<InventoryItem[] | null>(null);
  const [copying, setCopying] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  // snapshot taken before a copy, so one wrong source is one click to undo
  const [beforeCopy, setBeforeCopy] = useState<Record<string, string> | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    window.electron
      .getAttributeDefinitions()
      .then((defs) => {
        if (cancelled) return defs;
        const active = defs.filter((d) => d.isActive);
        setDefinitions(active);
        setValues(
          active.reduce<Record<string, string>>(
            (acc, def) => ({
              ...acc,
              [def.key]: toInputValue(item.attributes?.[def.key]),
            }),
            {},
          ),
        );
        return defs;
      })
      .catch(() => {
        if (!cancelled) setDefinitions([]);
      });
    return () => {
      cancelled = true;
    };
    // Deps are the dialog opening and which item is being edited — deliberately
    // not `item.attributes`. That is a fresh object on every parent re-parse, so
    // depending on it re-seeds the form mid-edit and silently discards whatever
    // the user typed or copied in. Content changes arriving while the dialog is
    // open are not a reason to throw away their work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id]);

  // keys present on the item but no longer defined — surfaced so data is not
  // silently lost when a definition is removed or renamed
  const undefinedKeys = useMemo(() => {
    const known = new Set(definitions.map((d) => d.key));
    return Object.keys(item.attributes ?? {}).filter((k) => !known.has(k));
  }, [definitions, item.attributes]);

  // Fetched on the click that opens the panel — no request unless asked for —
  // and awaited *before* opening. Opening first meant the panel rendered with an
  // empty list for one frame, flashing "nothing to copy" every single time.
  const openCopy = useCallback(async () => {
    if (candidates !== null) {
      setCopying(true);
      return;
    }
    setLoadingCandidates(true);
    try {
      setCandidates(await window.electron.getInventory());
      setCopying(true);
    } catch (error) {
      toast({
        description: `Could not load items to copy from: ${
          (error as Error)?.message ?? 'unknown error'
        }`,
        variant: 'destructive',
      });
    } finally {
      setLoadingCandidates(false);
    }
  }, [candidates]);

  const handlePrefill = useCallback(
    (next: Record<string, string>, sourceName: string) => {
      setBeforeCopy(values);
      setValues(next);
      setCopiedFrom(sourceName);
    },
    [values],
  );

  const undoCopy = useCallback(() => {
    if (!beforeCopy) return;
    setValues(beforeCopy);
    setBeforeCopy(null);
    setCopiedFrom(null);
  }, [beforeCopy]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const def of definitions) {
        const coerced = coerceAttributeValue(
          values[def.key] ?? '',
          def.valueType,
        );
        if (coerced !== '') payload[def.key] = coerced;
      }
      // preserve values whose definition is gone rather than dropping them
      for (const key of undefinedKeys) {
        payload[key] = item.attributes?.[key];
      }
      await window.electron.updateInventoryAttributes(item.id, payload);
      toast({ description: 'Attributes saved', variant: 'success' });
      setCopiedFrom(null);
      setBeforeCopy(null);
      setCopying(false);
      setOpen(false);
      onUpdated?.();
    } catch (error) {
      toast({
        description: `Could not save attributes: ${
          (error as Error)?.message ?? 'unknown error'
        }`,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [definitions, values, undefinedKeys, item, onUpdated]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          title="Edit attributes"
          aria-label="Edit attributes"
        >
          <Tag size={16} />
        </Button>
      </DialogTrigger>
      {/* fixed height: the body swaps between the form and the copy picker, so
          the dialog never grows past the viewport */}
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>
            {copying ? 'Copy attributes into' : 'Attributes'} — {item.name}
          </DialogTitle>
        </DialogHeader>

        {copying && candidates ? (
          <CopyAttributesPanel
            item={item}
            definitions={definitions}
            values={values}
            candidates={candidates}
            onPrefill={handlePrefill}
            onClose={() => setCopying(false)}
          />
        ) : (
          <>
            {definitions.length > 0 ? (
              <div className="flex items-center gap-3">
                <CopyAttributesTrigger
                  onClick={openCopy}
                  loading={loadingCandidates}
                />
                {copiedFrom ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    Copied from <strong>{copiedFrom}</strong> — not saved yet
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={undoCopy}
                    >
                      <Undo2 size={14} className="mr-1" />
                      Undo
                    </Button>
                  </span>
                ) : null}
              </div>
            ) : null}

            {definitions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No attributes defined yet. Add them from Inventory → Attributes.
              </p>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                {definitions.map((def) => (
                  <div key={def.key} className="flex flex-col gap-1">
                    <Label htmlFor={`attr-${def.key}`}>
                      {def.label}
                      {def.unit ? (
                        <span className="text-muted-foreground">
                          {' '}
                          ({def.unit})
                        </span>
                      ) : null}
                    </Label>
                    {def.valueType === 'bool' ? (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`attr-${def.key}`}
                          checked={!!values[def.key]}
                          onCheckedChange={(c) =>
                            setValues((prev) => ({
                              ...prev,
                              [def.key]: c === true ? 'true' : '',
                            }))
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          {values[def.key] ? 'Yes' : 'No'}
                        </span>
                      </div>
                    ) : (
                      <Input
                        id={`attr-${def.key}`}
                        inputMode={
                          def.valueType === 'number' ? 'decimal' : 'text'
                        }
                        value={values[def.key] ?? ''}
                        onChange={(e) =>
                          setValues((prev) => ({
                            ...prev,
                            [def.key]: e.target.value,
                          }))
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {undefinedKeys.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Kept as-is (no matching definition): {undefinedKeys.join(', ')}
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button
                onClick={handleSave}
                disabled={saving || !definitions.length}
              >
                {saving ? 'Saving…' : 'Save attributes'}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default EditItemAttributes;
