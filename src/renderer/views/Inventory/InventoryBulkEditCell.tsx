import {
  memo,
  useCallback,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { Input } from '@/renderer/shad/ui/input';
import { cn } from '@/renderer/lib/utils';
import type { InventoryBulkEditCol } from './inventoryBulkEdit';

interface InventoryBulkEditCellProps {
  inventoryId: number;
  col: InventoryBulkEditCol;
  /** only used on mount / editSessionKey remount — not updated while typing */
  defaultValue: string;
  editSessionKey: number;
  onWrite: (
    inventoryId: number,
    col: InventoryBulkEditCol,
    raw: string,
  ) => void;
  onBlurCommit: (
    inventoryId: number,
    col: InventoryBulkEditCol,
    raw: string,
    relatedTarget: EventTarget | null,
  ) => void;
  onNavigate: (
    inventoryId: number,
    col: InventoryBulkEditCol,
    key: string,
    raw: string,
    shiftKey: boolean,
  ) => void;
}

const NAV_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Tab',
]);

const isTextCol = (col: InventoryBulkEditCol): boolean =>
  col === 'description' || col === 'descriptionUrdu';

const ariaLabelForCol = (col: InventoryBulkEditCol): string => {
  if (col === 'price') return 'Price';
  if (col === 'listPosition') return 'List number';
  if (col === 'description') return 'Description';
  if (col === 'descriptionUrdu') return 'Description (Urdu)';
  if (col.startsWith('list:')) return 'List price';
  return col;
};

const InventoryBulkEditCellComponent = ({
  inventoryId,
  col,
  defaultValue,
  editSessionKey,
  onWrite,
  onBlurCommit,
  onNavigate,
}: InventoryBulkEditCellProps) => {
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onWrite(inventoryId, col, e.target.value);
    },
    [col, inventoryId, onWrite],
  );

  const handleBlur = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      onBlurCommit(inventoryId, col, e.target.value, e.relatedTarget);
    },
    [col, inventoryId, onBlurCommit],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!NAV_KEYS.has(e.key)) return;
      e.preventDefault();
      onNavigate(inventoryId, col, e.key, e.currentTarget.value, e.shiftKey);
    },
    [col, inventoryId, onNavigate],
  );

  const textCol = isTextCol(col);

  // key on wrapper remounts input only when discard/enter edit resets session
  return (
    <span key={editSessionKey} className="block min-w-0">
      <Input
        type="text"
        inputMode={
          // eslint-disable-next-line no-nested-ternary
          col === 'price' || col.startsWith('list:')
            ? 'decimal'
            : textCol
            ? 'text'
            : 'numeric'
        }
        data-inventory-id={inventoryId}
        data-col={col}
        defaultValue={defaultValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        dir={col === 'descriptionUrdu' ? 'rtl' : undefined}
        lang={col === 'descriptionUrdu' ? 'ur' : undefined}
        className={cn('my-0 h-8 px-2 py-1 text-sm', !textCol && 'tabular-nums')}
        aria-label={ariaLabelForCol(col)}
      />
    </span>
  );
};

export const InventoryBulkEditCell = memo(InventoryBulkEditCellComponent);
