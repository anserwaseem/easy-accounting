import type { FC } from 'react';
import { Loader2, Pencil, Save, X } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { getOsModifierLabel } from '@/renderer/shad/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/renderer/shad/ui/tooltip';

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
        Bulk edit
      </Button>
    );
  }

  const mod = getOsModifierLabel();
  const saveLabel = `Save${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={saving}
            aria-label={`${saveLabel}, shortcut ${mod}+S`}
          >
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            {saveLabel}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-sm">
            Save&nbsp;
            <span className="text-muted-foreground">({mod}+S)</span>
          </p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDiscard}
            disabled={saving}
            aria-label="Discard, shortcut Escape"
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Discard
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-sm">
            Discard&nbsp;
            <span className="text-muted-foreground">(Esc)</span>
          </p>
        </TooltipContent>
      </Tooltip>
    </>
  );
};
