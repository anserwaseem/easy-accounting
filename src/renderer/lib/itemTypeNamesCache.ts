/**
 * shared item-type name list for account-family clustering in pickers /
 * global search. loaded once per session; empty until first successful fetch.
 */

let cachedNames: string[] = [];
let loadPromise: Promise<string[]> | null = null;

export const getItemTypeNamesSync = (): string[] => cachedNames;

export const ensureItemTypeNamesLoaded = (): Promise<string[]> => {
  if (cachedNames.length > 0) {
    return Promise.resolve(cachedNames);
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = window.electron
    .getItemTypes()
    .then((types) => {
      cachedNames = (types ?? [])
        .map((type) => type.name)
        .filter((name): name is string => Boolean(name && String(name).trim()));
      return cachedNames;
    })
    .catch((error) => {
      console.error('failed to load item types for family clustering', error);
      loadPromise = null;
      return cachedNames;
    });

  return loadPromise;
};

/** test-only: reset module cache between cases */
export const resetItemTypeNamesCache = (): void => {
  cachedNames = [];
  loadPromise = null;
};
