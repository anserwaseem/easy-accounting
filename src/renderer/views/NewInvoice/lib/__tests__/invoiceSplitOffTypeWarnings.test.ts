import { AccountType, type InventoryItem } from 'types';
import { buildPartyTypingContext } from '../partyAccountTyping';
import {
  buildItemTypeNameById,
  buildInventoryById,
} from '../splitInvoiceRowResolution';
import { detectSplitOffAccountItemTypeMismatches } from '../invoiceSplitOffTypeWarnings';

describe('detectSplitOffAccountItemTypeMismatches', () => {
  const baseAcc = {
    id: 10,
    name: 'Acme',
    code: 'AC',
    chartId: 1,
    type: AccountType.Asset,
  };
  const typedTt = {
    id: 55,
    name: 'Acme-TT',
    code: 'AC-TT',
    chartId: 1,
    type: AccountType.Asset,
  };
  const typedPp = {
    id: 66,
    name: 'Acme-PP',
    code: 'AC-PP',
    chartId: 1,
    type: AccountType.Asset,
  };

  const itemTypes = [
    { id: 1, name: 'P' },
    { id: 2, name: 'TT' },
    { id: 3, name: 'PP' },
  ];
  const itemTypeNameById = buildItemTypeNameById(itemTypes);

  const inventory: InventoryItem[] = [
    {
      id: 100,
      name: 'a',
      price: 0,
      quantity: 0,
      itemTypeId: 1,
      itemTypeName: 'P',
    },
    {
      id: 200,
      name: 'b',
      price: 0,
      quantity: 0,
      itemTypeId: 2,
      itemTypeName: 'TT',
    },
    {
      id: 300,
      name: 'c',
      price: 0,
      quantity: 0,
      itemTypeId: 3,
      itemTypeName: 'PP',
    },
  ];
  const invById = buildInventoryById(inventory);

  const primaryId = 1;

  it('flags non-primary line when header is base account', () => {
    const ctx = buildPartyTypingContext([baseAcc, typedTt], ['TT', 'PP']);
    const rows = [{ inventoryId: 200 }];
    const m = detectSplitOffAccountItemTypeMismatches(
      rows,
      invById,
      itemTypeNameById,
      baseAcc,
      ctx,
      primaryId,
    );
    expect(m).toEqual([{ rowIndex: 0, kind: 'base_account_non_primary_line' }]);
  });

  it('allows primary-type line on base account', () => {
    const ctx = buildPartyTypingContext([baseAcc, typedTt], ['TT', 'PP']);
    const rows = [{ inventoryId: 100 }];
    const m = detectSplitOffAccountItemTypeMismatches(
      rows,
      invById,
      itemTypeNameById,
      baseAcc,
      ctx,
      primaryId,
    );
    expect(m).toEqual([]);
  });

  it('flags primary-type line when header is typed suffixed account', () => {
    const ctx = buildPartyTypingContext([baseAcc, typedTt], ['TT', 'PP']);
    const rows = [{ inventoryId: 100 }];
    const m = detectSplitOffAccountItemTypeMismatches(
      rows,
      invById,
      itemTypeNameById,
      typedTt,
      ctx,
      primaryId,
    );
    expect(m).toEqual([{ rowIndex: 0, kind: 'typed_account_primary_line' }]);
  });

  it('flags wrong suffix when typed header does not match line item type', () => {
    const ctx = buildPartyTypingContext(
      [baseAcc, typedTt, typedPp],
      ['TT', 'PP'],
    );
    const rows = [{ inventoryId: 200 }];
    const m = detectSplitOffAccountItemTypeMismatches(
      rows,
      invById,
      itemTypeNameById,
      typedPp,
      ctx,
      primaryId,
    );
    expect(m).toEqual([{ rowIndex: 0, kind: 'typed_account_wrong_suffix' }]);
  });

  it('allows matching typed header and line', () => {
    const ctx = buildPartyTypingContext(
      [baseAcc, typedTt, typedPp],
      ['TT', 'PP'],
    );
    const rows = [{ inventoryId: 200 }];
    const m = detectSplitOffAccountItemTypeMismatches(
      rows,
      invById,
      itemTypeNameById,
      typedTt,
      ctx,
      primaryId,
    );
    expect(m).toEqual([]);
  });

  it('skips rows with no inventory id', () => {
    const ctx = buildPartyTypingContext([baseAcc, typedTt], ['TT', 'PP']);
    const rows = [{ inventoryId: 0 }];
    const m = detectSplitOffAccountItemTypeMismatches(
      rows,
      invById,
      itemTypeNameById,
      baseAcc,
      ctx,
      primaryId,
    );
    expect(m).toEqual([]);
  });

  it('does not flag base vs non-primary when primary type is unknown', () => {
    const ctx = buildPartyTypingContext([baseAcc, typedTt], ['TT', 'PP']);
    const rows = [{ inventoryId: 200 }];
    const m = detectSplitOffAccountItemTypeMismatches(
      rows,
      invById,
      itemTypeNameById,
      baseAcc,
      ctx,
      undefined,
    );
    expect(m).toEqual([]);
  });
});
