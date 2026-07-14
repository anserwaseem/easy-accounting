import type { FC } from 'react';
import { Loader2, Pencil, Save, X } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';

interface InventoryBulkEditToolbarProps {
  editMode: boolean;
  dirtyCount: number;
  saving: boolean;
  onEnterEdit: () => void;
  onSave: () => void;
  onDiscard: () => void;
}

/** header actions only — safe to re-render without touching Virtuoso */
export const InventoryBulkEditToolbar: FC<InventoryBulkEditToolbarProps> = ({
  editMode,
  dirtyCount,
  saving,
  onEnterEdit,
  onSave,
  onDiscard,
}: InventoryBulkEditToolbarProps) => {
  if (!editMode) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={onEnterEdit}>
        <Pencil className="mr-1.5 h-3.5 w-3.5" />
        Edit prices
      </Button>
    );
  }

  return (
    <>
      <Button type="button" size="sm" onClick={onSave} disabled={saving}>
        {saving ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="mr-1.5 h-3.5 w-3.5" />
        )}
        Save{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onDiscard}
        disabled={saving}
      >
        <X className="mr-1.5 h-3.5 w-3.5" />
        Discard
      </Button>
    </>
  );
};
