import { useEffect } from 'react';

/**
 * Warns before the page is closed or reloaded with unsaved changes.
 *
 * The desktop app is a separate window the user can leave open, so a
 * dirty form usually survives. The PWA is a browser tab: closing it, a
 * pull-to-refresh, or a swipe-back gesture all discard the draft
 * silently. The browser's own "leave site?" prompt is the only
 * available signal.
 *
 * `when` is the form's dirty flag — pass `isDirty` from react-hook-form
 * (or any boolean that means "there is unsaved work").
 */
export const useUnsavedChangesGuard = (when: boolean): void => {
  useEffect(() => {
    if (!when) return undefined;

    const handler = (event: BeforeUnloadEvent) => {
      // The browser requires preventDefault() to show its prompt.
      event.preventDefault();
      // Chrome/Edge show their own generic message; the returnValue is
      // still required for older engines and for Firefox.
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [when]);
};
