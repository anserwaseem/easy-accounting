import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Tracks where the user has been so the app can offer a real "back"
 * affordance.
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
 * This hook keeps a small stack of the locations visited in this
 * session, so the shell can show a back button that steps to the
 * previous one. `goBack` returns to that entry; when the stack is
 * empty it falls back to the app's home screen, so the button always
 * does something sensible.
 *
 * It also mirrors the current location into the browser's own history
 * (via `history.pushState`) so the browser's own back button steps
 * through the app's screens rather than exiting it. The mirrored
 * entries are marked so the `popstate` handler can tell them apart
 * from real navigations.
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
  /** Steps back one screen, or goes home when there is nothing to go back to. */
  goBack: () => void;
  /** The path of the screen immediately before the current one. */
  previousPath: string | null;
}

export const useNavigationHistory = (): NavigationHistory => {
  const navigate = useNavigate();
  const location = useLocation();

  // The stack of visited paths, oldest first. The current location is
  // NOT in it — it is what "back" would return to.
  const stackRef = useRef<string[]>([]);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    const path = `${location.pathname}${location.search}`;
    const stack = stackRef.current;
    // A duplicate path means the user is on the same screen (a
    // re-render, a filter change); do not push a second copy.
    if (stack[stack.length - 1] !== path) {
      stack.push(path);
    }
    setCanGoBack(stack.length > 1);
  }, [location.pathname, location.search]);

  // Mirror the location into the browser's history so the browser's own
  // back button steps through the app instead of leaving it.
  useEffect(() => {
    const path = `${location.pathname}${location.search}`;
    const entry: MirroredEntry = { __appHistoryMarker: true, path };
    window.history.pushState(entry, '', path);
  }, [location.pathname, location.search]);

  // The browser's back button fired: pop the mirrored entry off the
  // browser stack and step back inside the app.
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (!isMirroredEntry(event.state)) return;
      const stack = stackRef.current;
      if (stack.length > 1) {
        stack.pop();
        setCanGoBack(stack.length > 1);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const goBack = useCallback(() => {
    const stack = stackRef.current;
    if (stack.length > 1) {
      stack.pop();
      setCanGoBack(stack.length > 1);
      navigate(stack[stack.length - 1]);
      return;
    }
    navigate(HOME_PATH);
  }, [navigate]);

  return {
    canGoBack,
    goBack,
    previousPath:
      stackRef.current.length > 1
        ? stackRef.current[stackRef.current.length - 2]
        : null,
  };
};
