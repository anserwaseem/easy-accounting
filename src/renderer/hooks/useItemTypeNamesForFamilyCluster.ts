import { useEffect, useState } from 'react';
import {
  ensureItemTypeNamesLoaded,
  getItemTypeNamesSync,
} from '@/renderer/lib/itemTypeNamesCache';

/** loads item-type names once so account pickers can cluster tiered families */
export const useItemTypeNamesForFamilyCluster = (): string[] => {
  const [names, setNames] = useState<string[]>(getItemTypeNamesSync);

  useEffect(() => {
    let cancelled = false;
    ensureItemTypeNamesLoaded().then((loaded) => {
      if (!cancelled) {
        setNames(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return names;
};
