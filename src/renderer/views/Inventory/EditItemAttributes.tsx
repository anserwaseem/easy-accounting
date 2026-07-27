import { useCallback, useEffect, useMemo, useState } from 'react';
import { Tag } from 'lucide-react';
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
  }, [open, item.attributes]);

  // keys present on the item but no longer defined — surfaced so data is not
  // silently lost when a definition is removed or renamed
  const undefinedKeys = useMemo(() => {
    const known = new Set(definitions.map((d) => d.key));
    return Object.keys(item.attributes ?? {}).filter((k) => !known.has(k));
  }, [definitions, item.attributes]);

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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Attributes — {item.name}</DialogTitle>
        </DialogHeader>

        {definitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No attributes defined yet. Add them from Inventory → Attributes.
          </p>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
            {definitions.map((def) => (
              <div key={def.key} className="flex flex-col gap-1">
                <Label htmlFor={`attr-${def.key}`}>
                  {def.label}
                  {def.unit ? (
                    <span className="text-muted-foreground"> ({def.unit})</span>
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
                    inputMode={def.valueType === 'number' ? 'decimal' : 'text'}
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
          <Button onClick={handleSave} disabled={saving || !definitions.length}>
            {saving ? 'Saving…' : 'Save attributes'}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditItemAttributes;
