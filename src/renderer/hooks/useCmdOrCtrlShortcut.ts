import { useEffect } from 'react';

/**
 * registers ⌘/Ctrl + <key> on window (fires even when an input is focused).
 * ignores alt/shift combinations.
 */
export const useCmdOrCtrlShortcut = (
  key: string,
  onAction: () => void,
): void => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // support both lowercase and uppercase (e.g. 'n' or 'N')
      if (e.key.toLowerCase() !== key.toLowerCase()) {
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
  }, [key, onAction]);
};
