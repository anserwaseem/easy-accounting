import type {
  VendorStockActivityItem,
  VendorStockActivityMovement,
  VendorStockMovementType,
} from 'types';

export const ACTIVITY_EQUATION =
  'Closing = Opening + Sent − Bought back + Returns + Adjusted';

export const ACTIVITY_COLUMN_HEADERS = {
  inventoryName: 'Item',
  opening: 'Opening',
  issued: 'Sent',
  purchased: 'Bought back',
  purchaseReturned: 'Returns',
  adjusted: 'Adjusted',
  closing: 'Closing',
} as const;

export type ActivityMovementFilter =
  | 'all'
  | 'issue'
  | 'purchase'
  | 'purchase_return'
  | 'adjusted';

export const ACTIVITY_FILTER_LABELS: Record<ActivityMovementFilter, string> = {
  all: 'This range',
  issue: 'Sent',
  purchase: 'Bought back',
  purchase_return: 'Returns',
  adjusted: 'Adjusted',
};

export const filterActivityMovements = (
  movements: VendorStockActivityMovement[],
  filter: ActivityMovementFilter,
): VendorStockActivityMovement[] => {
  if (filter === 'all') return movements;
  if (filter === 'adjusted') {
    return movements.filter(
      (movement) =>
        movement.movementType === 'opening' ||
        movement.movementType === 'adjustment',
    );
  }
  return movements.filter((movement) => movement.movementType === filter);
};

export const activityMovementHref = (
  movement: VendorStockActivityMovement,
): string | undefined => {
  if (movement.referenceType === 'vendor_issue' && movement.referenceId) {
    return `/vendor-stock/issues/${movement.referenceId}/edit`;
  }
  if (movement.referenceType === 'invoice' && movement.referenceId) {
    return `/purchase/invoices/${movement.referenceId}`;
  }
  return undefined;
};

const MOVEMENT_TYPE_FALLBACK: Record<VendorStockMovementType, string> = {
  issue: 'Send',
  purchase: 'Purchase',
  purchase_return: 'Purchase return',
  opening: 'Opening import',
  adjustment: 'Adjustment',
};

export const activityMovementLabel = (
  movement: VendorStockActivityMovement,
): string => {
  if (movement.movementType === 'issue' && movement.issueNumber != null) {
    return `Send #${movement.issueNumber}`;
  }
  if (movement.movementType === 'purchase' && movement.invoiceNumber != null) {
    return `Purchase #${movement.invoiceNumber}`;
  }
  if (
    movement.movementType === 'purchase_return' &&
    movement.invoiceNumber != null
  ) {
    return `Return #${movement.invoiceNumber}`;
  }
  if (movement.movementType === 'adjustment') {
    const notes = movement.notes?.trim();
    if (notes) return notes;
  }
  return MOVEMENT_TYPE_FALLBACK[movement.movementType];
};

export const itemHasFilterMovements = (
  item: VendorStockActivityItem,
  filter: ActivityMovementFilter,
): boolean => filterActivityMovements(item.movements, filter).length > 0;
