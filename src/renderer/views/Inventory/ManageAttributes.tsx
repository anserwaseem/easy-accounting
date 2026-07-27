import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Button } from '@/renderer/shad/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/renderer/shad/ui/dialog';
import { Input } from '@/renderer/shad/ui/input';
import { Label } from '@/renderer/shad/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/shad/ui/select';
import { toast } from '@/renderer/shad/ui/use-toast';
import { ConfirmDialog } from '@/renderer/components/ConfirmDialog';
import type { AttributeDefinition } from 'types';
import { moveByOffset } from './reorder';

interface ManageAttributesProps {
  onUpdated?: () => void;
  /** controlled mode: parent owns visibility, no trigger rendered here */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type ValueType = AttributeDefinition['valueType'];

const VALUE_TYPES: ValueType[] = ['text', 'number', 'bool'];

/** derives a stable snake_case key from a label, e.g. "Paper size" -> paper_size */
export const keyFromLabel = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);

/**
 * Defines the custom attributes a business tracks per item.
 *
 * The storage key is derived from the name and never shown; it is fixed once
 * created because every item's stored attributes reference it.
 *
 * Display order comes from `sortOrder`: new attributes append last, and the
 * up/down controls rewrite the whole sequence as 1..N.
 *
 * Deactivating a definition hides its column and editor field but leaves the
 * values on items untouched; deleting removes the values too (with confirmation).
 *
 * "Public" controls whether the attribute is included when the catalog is
 * published. It is off by default: attributes often hold internal notes or
 * import flags, and the published catalog is world-readable, so an attribute
 * has to be named public rather than merely forgotten.
 */
export const ManageAttributes: React.FC<ManageAttributesProps> = ({
  onUpdated,
  open: controlledOpen,
  onOpenChange,
}: ManageAttributesProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next);
    else setUncontrolledOpen(next);
  };
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [label, setLabel] = useState('');
  const [unit, setUnit] = useState('');
  const [valueType, setValueType] = useState<ValueType>('text');
  const [isPublic, setIsPublic] = useState(false);
  // an in-use attribute needs confirmation before its values are destroyed
  const [pendingDelete, setPendingDelete] = useState<{
    def: AttributeDefinition;
    usageCount: number;
  } | null>(null);

  // the storage key is derived from the name and never shown: it is an
  // implementation detail of how attributes are stored and published
  const effectiveKey = keyFromLabel(label);

  const load = useCallback(async () => {
    setDefinitions(await window.electron.getAttributeDefinitions());
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleAdd = useCallback(async () => {
    if (!effectiveKey) return;
    const ok = await window.electron.upsertAttributeDefinition({
      key: effectiveKey,
      label: label.trim(),
      unit: unit.trim() || null,
      valueType,
      isPublic,
      // omitted so the service appends after the current highest order;
      // counting rows here would collide after a deletion
    });
    toast({
      description: ok
        ? `Attribute "${label.trim()}" added`
        : `An attribute named "${label.trim()}" already exists`,
      variant: ok ? 'success' : 'destructive',
    });
    if (ok) {
      setLabel('');
      setUnit('');
      setValueType('text');
      setIsPublic(false);
      await load();
      onUpdated?.();
    }
  }, [label, effectiveKey, unit, valueType, isPublic, load, onUpdated]);

  const handleDelete = useCallback(
    async (def: AttributeDefinition) => {
      // first attempt never forces: an in-use attribute comes back with its
      // usage so the user can decide knowingly
      const result = await window.electron.deleteAttributeDefinition(def.id);
      if (result.deleted) {
        toast({
          description: `Attribute “${def.label}” deleted`,
          variant: 'success',
        });
        await load();
        onUpdated?.();
        return;
      }
      setPendingDelete({ def, usageCount: result.usageCount });
    },
    [load, onUpdated],
  );

  const confirmForcedDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const { def } = pendingDelete;
    const result = await window.electron.deleteAttributeDefinition(
      def.id,
      true,
    );
    setPendingDelete(null);
    toast({
      description: result.deleted
        ? `Deleted “${def.label}” and removed it from ${result.valuesRemoved} item(s)`
        : `Could not delete “${def.label}”`,
      variant: result.deleted ? 'success' : 'destructive',
    });
    if (result.deleted) {
      await load();
      onUpdated?.();
    }
  }, [pendingDelete, load, onUpdated]);

  const handleMove = useCallback(
    async (index: number, offset: number) => {
      const next = moveByOffset(definitions, index, offset);
      if (next === definitions) return;
      // optimistic: the rows reorder immediately, then we persist 1..N
      setDefinitions(next);
      await window.electron.reorderAttributeDefinitions(next.map((d) => d.id));
      await load();
      onUpdated?.();
    },
    [definitions, load, onUpdated],
  );

  const handleTogglePublic = useCallback(
    async (def: AttributeDefinition) => {
      await window.electron.setAttributeDefinitionPublic(def.id, !def.isPublic);
      await load();
      onUpdated?.();
    },
    [load, onUpdated],
  );

  const handleToggle = useCallback(
    async (def: AttributeDefinition) => {
      await window.electron.setAttributeDefinitionActive(def.id, !def.isActive);
      await load();
      onUpdated?.();
    },
    [load, onUpdated],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled ? (
        <DialogTrigger asChild>
          <Button variant="outline" className="gap-2">
            <SlidersHorizontal size={16} />
            Attributes
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Item attributes</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Attributes describe your items (size, material, and so on). They can
          be shown as columns and edited per item. Only attributes marked
          <strong> Public</strong> are included when the catalog is published —
          everything else stays internal. The order below controls how they
          appear in the columns menu, the table, and the per-item editor.
        </p>

        {definitions.length > 0 && (
          <div className="max-h-[45vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/95 text-left text-xs font-medium text-muted-foreground backdrop-blur">
                <tr>
                  <th className="w-16 px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Used by</th>
                  <th className="px-3 py-2 font-medium">Public</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {definitions.map((def, index) => (
                  <tr key={def.id} className="border-t">
                    <td className="px-1 py-1">
                      <div className="flex items-center">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          disabled={index === 0}
                          title="Move up"
                          aria-label={`Move ${def.label} up`}
                          onClick={() => handleMove(index, -1)}
                        >
                          <ChevronUp size={14} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          disabled={index === definitions.length - 1}
                          title="Move down"
                          aria-label={`Move ${def.label} down`}
                          onClick={() => handleMove(index, 1)}
                        >
                          <ChevronDown size={14} />
                        </Button>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium">{def.label}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {def.valueType}
                      {def.unit ? ` · ${def.unit}` : ''}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                      {def.usageCount ?? 0} item
                      {(def.usageCount ?? 0) === 1 ? '' : 's'}
                    </td>
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={!!def.isPublic}
                        onCheckedChange={() => handleTogglePublic(def)}
                        aria-label={`Publish ${def.label} in the public catalog`}
                        title={
                          def.isPublic
                            ? 'Included in the published catalog'
                            : 'Kept internal — not published'
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {def.isActive ? 'Active' : 'Inactive'}
                    </td>
                    <td className="flex items-center gap-1 px-3 py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleToggle(def)}
                      >
                        {def.isActive ? 'Deactivate' : 'Reactivate'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        title={
                          (def.usageCount ?? 0) > 0
                            ? `Delete — asks first, since ${def.usageCount} item(s) use it`
                            : 'Delete this unused attribute'
                        }
                        onClick={() => handleDelete(def)}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="attr-label">Name</Label>
            <Input
              id="attr-label"
              className="w-44"
              placeholder="e.g. Paper size"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="attr-unit">Unit (optional)</Label>
            <Input
              id="attr-unit"
              className="w-28"
              placeholder="e.g. inch"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="attr-type">Type</Label>
            <Select
              value={valueType}
              onValueChange={(v) => setValueType(v as ValueType)}
            >
              <SelectTrigger id="attr-type" className="w-28 my-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALUE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mb-3 flex items-center gap-2">
            <Checkbox
              id="attr-public"
              checked={isPublic}
              onCheckedChange={(c) => setIsPublic(c === true)}
            />
            <Label htmlFor="attr-public" className="text-sm font-normal">
              Public
            </Label>
          </div>
          <Button
            variant="outline"
            onClick={handleAdd}
            disabled={!effectiveKey}
            className="mb-2"
          >
            Add
          </Button>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={`Delete “${pendingDelete?.def.label ?? ''}”?`}
        description={
          <span>
            {pendingDelete?.usageCount} item
            {pendingDelete?.usageCount === 1 ? '' : 's'} currently have a value
            for this attribute. Deleting removes the attribute{' '}
            <strong>and those values</strong>, and they cannot be recovered.
            <br />
            <br />
            To keep the values but hide the attribute, cancel and use{' '}
            <strong>Deactivate</strong> instead.
          </span>
        }
        confirmLabel="Delete attribute and values"
        confirmVariant="destructive"
        onConfirm={confirmForcedDelete}
      />
    </Dialog>
  );
};

export default ManageAttributes;
