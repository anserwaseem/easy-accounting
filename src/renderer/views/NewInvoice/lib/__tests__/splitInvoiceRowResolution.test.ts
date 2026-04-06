import {
  classifySplitRowResolution,
  resolveInventoryLineItemType,
} from '../splitInvoiceRowResolution';

describe('splitInvoiceRowResolution', () => {
  const map = new Map<number, string>([
    [1, 'P'],
    [2, 'TT'],
  ]);

  describe('resolveInventoryLineItemType', () => {
    it('prefers catalog name when inventory omits itemTypeName', () => {
      const { itemTypeId, itemTypeName } = resolveInventoryLineItemType(
        {
          id: 1,
          name: 'x',
          price: 1,
          quantity: 1,
          itemTypeId: 2,
          itemTypeName: '',
        },
        map,
      );
      expect(itemTypeId).toBe(2);
      expect(itemTypeName).toBe('TT');
    });
  });

  describe('classifySplitRowResolution', () => {
    it('routes global-primary line with mismatched typed header to base', () => {
      expect(
        classifySplitRowResolution({
          partyName: 'Acme',
          itemTypeId: 1,
          itemTypeName: 'P',
          primaryId: 1,
          primaryNum: 1,
          headerIsTyped: true,
          headerSuffix: 'TT',
        }),
      ).toEqual({ kind: 'base' });
    });

    it('routes suffixed when line type differs from header and line is not global-primary', () => {
      expect(
        classifySplitRowResolution({
          partyName: 'Acme',
          itemTypeId: 2,
          itemTypeName: 'TT',
          primaryId: 1,
          primaryNum: 1,
          headerIsTyped: true,
          headerSuffix: 'X',
        }),
      ).toEqual({ kind: 'suffixed', suffixedName: 'Acme-TT' });
    });

    it('routes through header when base header and global-primary line', () => {
      expect(
        classifySplitRowResolution({
          partyName: 'Acme',
          itemTypeId: 1,
          itemTypeName: 'P',
          primaryId: 1,
          primaryNum: 1,
          headerIsTyped: false,
          headerSuffix: '',
        }),
      ).toEqual({ kind: 'header' });
    });
  });
});
