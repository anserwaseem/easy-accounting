import { useEffect, useState } from 'react';

/** Matches Tailwind's `md` breakpoint (768px) — below this the app shell
 * switches from a static collapsible sidebar to a collapsed-by-default,
 * hamburger-triggered overlay (see components/Sidebar.tsx). */
const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)';

/**
 * Tracks whether the viewport is currently below the `md` breakpoint.
 * Presentation-only (no data/logic implications) — used purely to decide
 * shell chrome (sidebar overlay vs static, icon-only vs labeled nav).
 */
export const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches
      : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
};
