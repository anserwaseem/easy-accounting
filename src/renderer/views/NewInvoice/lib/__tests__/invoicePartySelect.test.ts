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

  it('pins stock-tracking vendor accounts to the top for purchase invoices', () => {
    const regularVendorA = baseParty({
      id: 10,
      name: 'Alpha Vendor',
      tracksVendorStock: false,
    });
    const regularVendorB = baseParty({
      id: 20,
      name: 'Beta Vendor',
      tracksVendorStock: false,
    });
    const stockVendorZ = baseParty({
      id: 30,
      name: 'Zeta Stock Vendor',
      tracksVendorStock: true,
    });
    const stockVendorM = baseParty({
      id: 40,
      name: 'Mu Stock Vendor',
      tracksVendorStock: true,
    });

    const result = buildCustomerVendorSelectOptions({
      invoiceType: InvoiceType.Purchase,
      baseParties: [regularVendorA, regularVendorB, stockVendorZ, stockVendorM],
      extendedParties: [
        regularVendorA,
        regularVendorB,
        stockVendorZ,
        stockVendorM,
      ],
      useSingleAccount: true,
      splitByItemType: false,
      singleAccountId: undefined,
      missingExtra: undefined,
    });

    // stock-tracking accounts should be first (sorted by name: Mu, then Zeta), followed by rest (Alpha, then Beta)
    expect(result.map((p) => p.id)).toEqual([40, 30, 10, 20]);
    // names should not have any suffixes appended
    expect(result.map((p) => p.name)).toEqual([
      'Mu Stock Vendor',
      'Zeta Stock Vendor',
      'Alpha Vendor',
      'Beta Vendor',
    ]);
  });

  it('does not pin stock-tracking accounts for sale invoices', () => {
    const partyA = baseParty({
      id: 10,
      name: 'Alpha Customer',
      tracksVendorStock: false,
    });
    const partyZ = baseParty({
      id: 30,
      name: 'Zeta Customer',
      tracksVendorStock: true,
    });

    const result = buildCustomerVendorSelectOptions({
      invoiceType: InvoiceType.Sale,
      baseParties: [partyZ, partyA],
      extendedParties: [partyZ, partyA],
      useSingleAccount: true,
      splitByItemType: false,
      singleAccountId: undefined,
      missingExtra: undefined,
    });

    // for sale invoices, list remains in original provided order
    expect(result.map((p) => p.id)).toEqual([30, 10]);
  });
});
