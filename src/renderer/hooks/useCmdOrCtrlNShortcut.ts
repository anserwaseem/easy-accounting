import { useEffect } from 'react';

/**
 * registers ⌘/Ctrl+N on window (fires even when an input is focused).
 * ignores alt/shift combinations.
 */
export const useCmdOrCtrlNShortcut = (onAction: () => void): void => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') {
        return;
      }
      if (!e.metaKey && !e.ctrlKey) {
        return;
      }
      if (e.altKey || e.shiftKey) {
        return;
      }
      e.preventDefault();
      onAction();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onAction]);
};
