import {
  SALE_RETURN_NUMBER_BASE,
  toDisplaySaleReturnNumber,
  toStoredSaleReturnNumber,
} from '../saleReturnNumber';

describe('saleReturnNumber', () => {
  it('stores display 1 below the quotation range and reads it back', () => {
    expect(toStoredSaleReturnNumber(1)).toBe(-(SALE_RETURN_NUMBER_BASE + 1));
    expect(toDisplaySaleReturnNumber(toStoredSaleReturnNumber(1))).toBe(1);
    expect(toDisplaySaleReturnNumber(toStoredSaleReturnNumber(12))).toBe(12);
  });
});
