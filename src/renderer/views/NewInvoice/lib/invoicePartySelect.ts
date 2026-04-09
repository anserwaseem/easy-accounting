import { toNumber } from 'lodash';
import type { PartyAccount } from '@/renderer/views/NewInvoice/hooks/useNewInvoiceParties';
import { InvoiceType } from 'types';

/**
 * customer/vendor dropdown only lists "base" parties; typed suffixed accounts are filtered out.
 * on edit, invoice header may still point at a typed account id — merge that row in so VirtualSelect can show a label.
 */
export function mergePartyOptionForSelect(
  parties: PartyAccount[],
  singleAccountId: number | undefined,
  extra: PartyAccount | undefined,
): PartyAccount[] {
  const sid = toNumber(singleAccountId);
  if (sid <= 0) return parties;
  if (parties.some((p) => toNumber(p.id) === sid)) return parties;
  if (extra && toNumber(extra.id) === sid) return [...parties, extra];
  return parties;
}

interface BuildCustomerVendorSelectOptionsParams {
  invoiceType: InvoiceType;
  baseParties: PartyAccount[];
  extendedParties: PartyAccount[];
  useSingleAccount: boolean;
  splitByItemType: boolean;
  singleAccountId: number | undefined;
  missingExtra: PartyAccount | undefined;
}

/** sale + single + split-on: base parties only (+ merge missing header). otherwise full party-type rows including typed suffix accounts */
export function buildCustomerVendorSelectOptions(
  params: BuildCustomerVendorSelectOptionsParams,
): PartyAccount[] {
  const {
    invoiceType,
    baseParties,
    extendedParties,
    useSingleAccount,
    splitByItemType,
    singleAccountId,
    missingExtra,
  } = params;
  const useBaseOnlyForSaleSplit =
    invoiceType === InvoiceType.Sale && useSingleAccount && splitByItemType;
  const source = useBaseOnlyForSaleSplit ? baseParties : extendedParties;
  return mergePartyOptionForSelect(source, singleAccountId, missingExtra);
}
