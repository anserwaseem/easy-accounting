import { useEffect, useState } from 'react';

/**
 * Tracks a CSS media query.
 *
 * `useIsMobile` covers the single `md` threshold the app shell cares
 * about. This is the general form for components that need to react to
 * a specific breakpoint (e.g. a table dropping a column below `sm`).
 *
 * Presentation-only — no data/logic implications.
 *
 * `window.matchMedia` is not implemented in jsdom, which the unit tests
 * run in, so it is treated as "no match" there: a test renders the
 * desktop layout, which is what the assertions expect.
 */
const supportsMatchMedia = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState<boolean>(() =>
    supportsMatchMedia() ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (!supportsMatchMedia()) return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
};

/** True at Tailwind's `sm` breakpoint and up (640px). */
export const useIsSmallScreenUp = (): boolean =>
  useMediaQuery('(min-width: 640px)');

/** True at Tailwind's `lg` breakpoint and up (1024px). */
export const useIsLargeScreenUp = (): boolean =>
  useMediaQuery('(min-width: 1024px)');
