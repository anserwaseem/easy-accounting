import { useEffect } from 'react';

/**
 * registers Escape on window. skips when a modal/dialog is open (role=dialog).
 */
export const useEscapeKey = (onEscape: () => void, enabled = true): void => {
  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // radix confirm/dialog already owns Escape while open
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      onEscape();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, onEscape]);
};
