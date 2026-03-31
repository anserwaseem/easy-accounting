import { useEffect, useMemo, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { InvoiceType } from 'types';
import type { CustomerSection } from '../components/CustomerSectionsBlock';

interface InvoiceItemsWithId {
  id: number;
  [key: string]: unknown;
}

export interface UseNewInvoiceSectionsParams {
  invoiceType: InvoiceType;
  useSingleAccount: boolean;
  splitByItemType: boolean;
  form: UseFormReturn<Record<string, unknown>>;
  watchedInvoiceItems: InvoiceItemsWithId[] | undefined;
}

/** owns sections state and row-section mapping for multi-customer sale mode; syncs multipleAccountIds from section mapping */
export function useNewInvoiceSections(params: UseNewInvoiceSectionsParams): {
  sections: CustomerSection[];
  setSections: React.Dispatch<React.SetStateAction<CustomerSection[]>>;
  activeSectionId: string | null;
  setActiveSectionId: React.Dispatch<React.SetStateAction<string | null>>;
  rowSectionMap: Record<number, string>;
  setRowSectionMap: React.Dispatch<
    React.SetStateAction<Record<number, string>>
  >;
} {
  const {
    invoiceType,
    useSingleAccount,
    splitByItemType,
    form,
    watchedInvoiceItems,
  } = params;

  const [sections, setSections] = useState<CustomerSection[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [rowSectionMap, setRowSectionMap] = useState<Record<number, string>>(
    {},
  );

  const items = useMemo(
    () => (Array.isArray(watchedInvoiceItems) ? watchedInvoiceItems : []),
    [watchedInvoiceItems],
  );

  // ensure multi-customer sale mode always starts with one section selected
  useEffect(() => {
    if (invoiceType !== InvoiceType.Sale || useSingleAccount) return;
    if (sections.length > 0) return;

    const sectionId = `section-${Date.now()}`;
    setSections([{ id: sectionId }]);
    setActiveSectionId(sectionId);
  }, [invoiceType, sections.length, useSingleAccount]);

  // keep every row mapped to a valid section and clean stale row mappings
  useEffect(() => {
    if (invoiceType !== InvoiceType.Sale || useSingleAccount) return;
    if (sections.length === 0) return;

    const fallbackSectionId = activeSectionId ?? sections[0].id;
    setRowSectionMap((prev) => {
      let changed = false;
      const next: Record<number, string> = {};

      items.forEach((item) => {
        const assignedSectionId = prev[item.id];
        const hasAssignedSection = sections.some(
          (section) => section.id === assignedSectionId,
        );
        const targetSectionId = hasAssignedSection
          ? assignedSectionId
          : fallbackSectionId;
        next[item.id] = targetSectionId;
        if (prev[item.id] !== targetSectionId) {
          changed = true;
        }
      });

      const staleIds = Object.keys(prev).filter(
        (id) => !next[Number(id)] && prev[Number(id)],
      );
      if (staleIds.length > 0) {
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [activeSectionId, invoiceType, sections, useSingleAccount, items]);

  // derive multipleAccountIds from current row-to-section customer mapping (sections mode)
  useEffect(() => {
    if (invoiceType !== InvoiceType.Sale || useSingleAccount) {
      if (!splitByItemType) {
        (
          form.setValue as (
            name: string,
            value: number[],
            opts?: object,
          ) => void
        )('accountMapping.multipleAccountIds', [], { shouldValidate: false });
      }
      return;
    }

    const multipleAccountIds = items.map((item) => {
      const sectionId = rowSectionMap[item.id];
      const section = sections.find((entry) => entry.id === sectionId);
      return section?.accountId && section.accountId > 0
        ? section.accountId
        : 0;
    });

    (form.setValue as (name: string, value: number[], opts?: object) => void)(
      'accountMapping.multipleAccountIds',
      multipleAccountIds,
      {
        shouldValidate: false,
      },
    );
  }, [
    form,
    invoiceType,
    rowSectionMap,
    sections,
    splitByItemType,
    useSingleAccount,
    items,
  ]);

  return {
    sections,
    setSections,
    activeSectionId,
    setActiveSectionId,
    rowSectionMap,
    setRowSectionMap,
  };
}
