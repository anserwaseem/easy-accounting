import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Tracks where the user has been so the app can offer real "back" and
 * "forward" affordances.
 *
 * The app renders inside a `MemoryRouter`, which keeps its own history
 * but never touches the browser URL. Two things follow:
 *
 * 1. The browser's back button (and the Android system back gesture)
 *    leaves the app entirely instead of stepping back a screen.
 * 2. There is no way back inside the app except the hamburger menu,
 *    which means moving between two related screens (a list, a detail
 *    view, a form) takes two menu taps and loses the place you were in.
 *
 * This hook keeps a small stack of the visited locations, so the shell
 * can offer a back button that steps to the previous one, and a
 * forward button that steps again. It also mirrors the current location
 * into the browser's own history (via `history.pushState`) so the
 * browser's back gesture steps through the app rather than out of it.
 */

interface MirroredEntry {
  __appHistoryMarker: true;
  path: string;
}

const isMirroredEntry = (state: unknown): state is MirroredEntry =>
  !!state &&
  typeof state === 'object' &&
  (state as MirroredEntry).__appHistoryMarker === true;

/** Where "back" goes when there is nothing to go back to. */
export const HOME_PATH = '/';

export interface NavigationHistory {
  /** True when there is a previous screen to return to. */
  canGoBack: boolean;
  /** True when there is a next screen to return to. */
  canGoForward: boolean;
  /** Steps back one screen, or goes home when there is nothing to go back to. */
  goBack: () => void;
  /** Steps forward one screen, if there is one. */
  goForward: () => void;
}

export const useNavigationHistory = (): NavigationHistory => {
  const navigate = useNavigate();
  const location = useLocation();

  // The stack of visited paths, oldest first. The current location is
  // NOT in it — it is what "back" would return to.
  const stackRef = useRef<string[]>([]);
  // Where "forward" would go, once the user goes back.
  const forwardRef = useRef<string | null>(null);

  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const currentPath = `${location.pathname}${location.search}`;

  useEffect(() => {
    const stack = stackRef.current;
    // A duplicate path means the user is on the same screen (a
    // re-render, a filter change); do not push a second copy.
    if (stack[stack.length - 1] !== currentPath) {
      stack.push(currentPath);
    }
    // A new destination clears the forward history.
    forwardRef.current = null;
    setCanGoBack(stack.length > 1);
    setCanGoForward(false);
  }, [currentPath]);

  // Mirror the location into the browser's history so the browser's own
  // back button steps through the app instead of leaving it.
  useEffect(() => {
    const entry: MirroredEntry = {
      __appHistoryMarker: true,
      path: currentPath,
    };
    window.history.pushState(entry, '', currentPath);
  }, [currentPath]);

  // The browser's back button fired: pop the mirrored entry off the
  // browser stack and step back inside the app.
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (!isMirroredEntry(event.state)) return;
      const stack = stackRef.current;
      if (stack.length > 1) {
        const leaving = stack.pop()!;
        forwardRef.current = leaving;
        setCanGoBack(stack.length > 1);
        setCanGoForward(true);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const goBack = useCallback(() => {
    const stack = stackRef.current;
    if (stack.length > 1) {
      const leaving = stack.pop()!;
      forwardRef.current = leaving;
      setCanGoBack(stack.length > 1);
      setCanGoForward(true);
      navigate(stack[stack.length - 1]);
      return;
    }
    navigate(HOME_PATH);
  }, [navigate]);

  const goForward = useCallback(() => {
    const forward = forwardRef.current;
    if (!forward) return;
    forwardRef.current = null;
    setCanGoForward(false);
    // The effect above pushes the new path onto the stack.
    navigate(forward);
  }, [navigate]);

  return { canGoBack, canGoForward, goBack, goForward };
};
