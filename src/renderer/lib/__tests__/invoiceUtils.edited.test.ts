import {
  isPersistedRowEdited,
  showInvoiceEditedIndicator,
} from '../invoiceUtils';

describe('isPersistedRowEdited', () => {
  it('is false when timestamps are missing or equal', () => {
    expect(isPersistedRowEdited({})).toBe(false);
    expect(
      isPersistedRowEdited({
        createdAt: '2026-01-15 10:00:00',
        updatedAt: '2026-01-15 10:00:00',
      }),
    ).toBe(false);
  });

  it('is true when updatedAt is later than createdAt', () => {
    expect(
      isPersistedRowEdited({
        createdAt: '2026-01-15 10:00:00',
        updatedAt: '2026-01-15 11:00:00',
      }),
    ).toBe(true);
  });
});

describe('showInvoiceEditedIndicator', () => {
  it('hides the pill on returned invoices even if timestamps differ', () => {
    expect(
      showInvoiceEditedIndicator({
        createdAt: '2026-01-15 10:00:00',
        updatedAt: '2026-01-15 11:00:00',
        isReturned: true,
      }),
    ).toBe(false);
  });
});
