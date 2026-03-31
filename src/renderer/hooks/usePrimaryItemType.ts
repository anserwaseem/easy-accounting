import { useEffect, useState } from 'react';

/** loads primary item type name and list of item type names (for grouping and display). */
export const usePrimaryItemType = (): {
  primaryItemTypeName: string | null;
  itemTypeNames: string[];
} => {
  const [primaryItemTypeName, setPrimaryItemTypeName] = useState<string | null>(
    null,
  );
  const [itemTypeNames, setItemTypeNames] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const [primaryId, itemTypes] = await Promise.all([
        window.electron.getPrimaryItemType?.(),
        window.electron.getItemTypes?.(),
      ]);
      if (Array.isArray(itemTypes)) {
        const names = itemTypes
          .map((t: { name?: string }) => t.name?.trim())
          .filter((n): n is string => Boolean(n));
        setItemTypeNames(names);
      } else {
        setItemTypeNames([]);
      }
      if (primaryId && Array.isArray(itemTypes)) {
        const primary = itemTypes.find(
          (t: { id: number; name?: string }) => t.id === primaryId,
        );
        setPrimaryItemTypeName(primary?.name?.trim() ?? null);
      } else {
        setPrimaryItemTypeName(null);
      }
    };
    load();
  }, []);

  return { primaryItemTypeName, itemTypeNames };
};
