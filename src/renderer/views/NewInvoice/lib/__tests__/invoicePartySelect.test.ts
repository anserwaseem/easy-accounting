import { AccountType, InvoiceType } from 'types';
import type { PartyAccount } from '@/renderer/views/NewInvoice/hooks/useNewInvoiceParties';
import {
  buildCustomerVendorSelectOptions,
  mergePartyOptionForSelect,
} from '../invoicePartySelect';

const baseParty = (overrides: Partial<PartyAccount> = {}): PartyAccount => ({
  id: 1,
  name: 'DIARY CASH',
  type: AccountType.Asset,
  code: 'DIARY CASH',
  chartId: 1,
  discountProfileId: null,
  discountProfileIsActive: null,
  ...overrides,
});

describe('mergePartyOptionForSelect', () => {
  it('leaves list unchanged when singleAccountId is already in parties (VirtualSelect can resolve)', () => {
    const parties = [baseParty({ id: 10, name: 'ACME' })];
    expect(mergePartyOptionForSelect(parties, 10, undefined)).toEqual(parties);
  });

  it('appends extra row when header account id is missing from parties (typed / suffixed ledger account)', () => {
    const parties = [
      baseParty({ id: 1, name: 'DIARY CASH', code: 'DIARY CASH' }),
    ];
    const typedHeader = baseParty({
      id: 2,
      name: 'DIARY CASH-T',
      code: 'DIARY CASH-T',
    });
    const merged = mergePartyOptionForSelect(parties, 2, typedHeader);
    expect(merged).toHaveLength(2);
    expect(merged.map((p) => p.id)).toEqual([1, 2]);
    expect(merged[1]).toEqual(typedHeader);
  });

  it('does not duplicate when extra is absent', () => {
    const parties = [baseParty({ id: 1 })];
    const merged = mergePartyOptionForSelect(parties, 99, undefined);
    expect(merged).toEqual(parties);
  });
});

describe('buildCustomerVendorSelectOptions', () => {
  const base = baseParty({ id: 1, name: 'Base' });
  const typed = baseParty({ id: 2, name: 'Base-T' });

  it('uses base list only for sale single-account split-by-type', () => {
    expect(
      buildCustomerVendorSelectOptions({
        invoiceType: InvoiceType.Sale,
        baseParties: [base],
        extendedParties: [base, typed],
        useSingleAccount: true,
        splitByItemType: true,
        singleAccountId: 1,
        missingExtra: undefined,
      }),
    ).toEqual([base]);
  });

  it('uses extended list when split is off', () => {
    expect(
      buildCustomerVendorSelectOptions({
        invoiceType: InvoiceType.Sale,
        baseParties: [base],
        extendedParties: [base, typed],
        useSingleAccount: true,
        splitByItemType: false,
        singleAccountId: 1,
        missingExtra: undefined,
      }).map((p) => p.id),
    ).toEqual([1, 2]);
  });

  it('uses extended list for purchase (parity)', () => {
    expect(
      buildCustomerVendorSelectOptions({
        invoiceType: InvoiceType.Purchase,
        baseParties: [base],
        extendedParties: [base, typed],
        useSingleAccount: true,
        splitByItemType: true,
        singleAccountId: 1,
        missingExtra: undefined,
      }).map((p) => p.id),
    ).toEqual([1, 2]);
  });

  it('uses extended list when not single-account (sections)', () => {
    expect(
      buildCustomerVendorSelectOptions({
        invoiceType: InvoiceType.Sale,
        baseParties: [base],
        extendedParties: [base, typed],
        useSingleAccount: false,
        splitByItemType: true,
        singleAccountId: undefined,
        missingExtra: undefined,
      }).map((p) => p.id),
    ).toEqual([1, 2]);
  });
});
