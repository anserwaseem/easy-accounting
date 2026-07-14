import {
  memo,
  useCallback,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { Input } from '@/renderer/shad/ui/input';
import type { InventoryBulkEditCol } from './inventoryBulkEdit';

interface InventoryBulkEditCellProps {
  inventoryId: number;
  col: InventoryBulkEditCol;
  defaultValue: string;
  editSessionKey: number;
  onWrite: (
    inventoryId: number,
    col: InventoryBulkEditCol,
    raw: string,
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

const InventoryBulkEditCellComponent = ({
  inventoryId,
  col,
  defaultValue,
  editSessionKey,
  onWrite,
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
      onWrite(inventoryId, col, e.target.value);
    },
    [col, inventoryId, onWrite],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!NAV_KEYS.has(e.key)) return;
      e.preventDefault();
      onNavigate(inventoryId, col, e.key, e.currentTarget.value, e.shiftKey);
    },
    [col, inventoryId, onNavigate],
  );

  return (
    <Input
      key={`${inventoryId}-${col}-${editSessionKey}`}
      type="text"
      inputMode={col === 'price' ? 'decimal' : 'numeric'}
      data-inventory-id={inventoryId}
      data-col={col}
      defaultValue={defaultValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="my-0 h-8 px-2 py-1 text-sm tabular-nums"
      aria-label={col === 'price' ? 'Price' : 'List number'}
    />
  );
};

export const InventoryBulkEditCell = memo(InventoryBulkEditCellComponent);
