import { useEffect, useRef } from 'react';

/**
 * registers ⌘/Ctrl + <key> on window (fires even when an input is focused).
 * ignores alt/shift combinations.
 */
export const useCmdOrCtrlShortcut = (
  key: string,
  onAction: () => void,
  shiftKey = false,
): void => {
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e?.key || !key) {
        return;
      }
      // support both lowercase and uppercase (e.g. 'n' or 'N')
      if (e.key.toLowerCase() !== key.toLowerCase()) {
        return;
      }
      if (!e.metaKey && !e.ctrlKey) {
        return;
      }
      if (e.altKey || e.shiftKey !== shiftKey) {
        return;
      }
      e.preventDefault();
      onActionRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key, shiftKey]);
};
