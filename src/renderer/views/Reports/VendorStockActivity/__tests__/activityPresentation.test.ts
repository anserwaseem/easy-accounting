import type { VendorStockActivityMovement } from 'types';
import {
  activityMovementHref,
  activityMovementLabel,
  filterActivityMovements,
} from '../activityPresentation';

const movement = (
  overrides: Partial<VendorStockActivityMovement>,
): VendorStockActivityMovement => ({
  id: 1,
  date: '2026-01-15',
  movementType: 'issue',
  quantityDelta: 40,
  ...overrides,
});

describe('activityPresentation', () => {
  it('filters bought-back vs sent vs adjusted', () => {
    const rows = [
      movement({ id: 1, movementType: 'issue' }),
      movement({ id: 2, movementType: 'purchase', quantityDelta: -25 }),
      movement({ id: 3, movementType: 'opening', quantityDelta: 10 }),
      movement({ id: 4, movementType: 'adjustment', quantityDelta: -2 }),
    ];
    expect(filterActivityMovements(rows, 'issue')).toHaveLength(1);
    expect(filterActivityMovements(rows, 'purchase')).toHaveLength(1);
    expect(filterActivityMovements(rows, 'adjusted')).toHaveLength(2);
    expect(filterActivityMovements(rows, 'all')).toHaveLength(4);
  });

  it('labels documents and builds hrefs', () => {
    expect(
      activityMovementLabel(
        movement({
          movementType: 'issue',
          issueNumber: 12,
          referenceType: 'vendor_issue',
          referenceId: 99,
        }),
      ),
    ).toBe('Send #12');
    expect(
      activityMovementHref(
        movement({
          referenceType: 'vendor_issue',
          referenceId: 99,
        }),
      ),
    ).toBe('/vendor-stock/issues/99/edit');
    expect(
      activityMovementHref(
        movement({
          movementType: 'purchase',
          referenceType: 'invoice',
          referenceId: 7,
        }),
      ),
    ).toBe('/purchase/invoices/7');
    expect(
      activityMovementLabel(
        movement({
          movementType: 'purchase',
          invoiceNumber: 44,
        }),
      ),
    ).toBe('Purchase #44');
  });
});
