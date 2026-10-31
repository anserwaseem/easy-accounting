import { useEffect, useRef } from 'react';

/**
 * Registers the browser's own back/forward keyboard shortcuts.
 *
 * ⌘/Ctrl + ← and ⌘/Ctrl + → are what every desktop app uses to step
 * back and forward, and the app renders inside a `MemoryRouter` that
 * never touches the browser's history — so the shortcuts did nothing
 * until the navigation stack was mirrored into it.
 *
 * Plain ← / → are deliberately not bound: they scroll, and on a
 * ledger or a journal list the user is usually scrolling.
 */
export const useBrowserNavigationShortcuts = (
  goBack: () => void,
  goForward: () => void,
): void => {
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  const goForwardRef = useRef(goForward);
  goForwardRef.current = goForward;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.altKey || e.shiftKey) return;

      switch (e.key) {
        case 'ArrowLeft':
        case 'Left':
          e.preventDefault();
          goBackRef.current();
          break;
        case 'ArrowRight':
        case 'Right':
          e.preventDefault();
          goForwardRef.current();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
};
