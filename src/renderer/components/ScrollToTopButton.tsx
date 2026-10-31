/* eslint-disable react/prop-types -- props fully typed via ScrollToTopButtonProps interface */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { cn } from 'renderer/lib/utils';
import { Button } from 'renderer/shad/ui/button';

interface ScrollToTopButtonProps {
  className?: string;
}

/**
 * The element that actually scrolls the current screen.
 *
 * There is no single scroller: the app shell's content pane scrolls
 * most screens, but the virtualised tables (react-virtuoso) own their
 * own scroller, and the split-pane detail screens (invoice, ledger,
 * journal) put an `overflow-y-auto` div inside the shell. Scrolling the
 * wrong one does nothing, which is why the button appeared to be
 * broken on exactly those screens.
 *
 * So: ask the DOM which element can scroll, preferring the innermost
 * one that still has room to move.
 */
const findScrollableElement = (): HTMLElement | null => {
  if (typeof document === 'undefined') return null;

  const candidates: HTMLElement[] = [];

  // The virtualised tables' own scroller.
  document
    .querySelectorAll<HTMLElement>('[data-virtuoso-scroller]')
    .forEach((el) => candidates.push(el));

  // The app shell's content pane.
  const shell = document.querySelector<HTMLElement>('[data-app-scroll]');
  if (shell) candidates.push(shell);

  // The split-pane detail screens' inner pane.
  document
    .querySelectorAll<HTMLElement>('[data-detail-scroll]')
    .forEach((el) => candidates.push(el));

  const scrollable = candidates.filter(
    (el) => el.scrollHeight - el.clientHeight > 8,
  );

  if (scrollable.length === 0) return candidates[0] ?? null;

  // The one that matters is the one the user is actually looking at.
  //
  // A virtualised table's own scroller is nested INSIDE the app shell,
  // so "innermost" and "last in the document" both point at the table —
  // but the table's scroller is the one with the rows. The shell has a
  // few pixels of give and would win a naive "most scrollable" test
  // only by accident.
  //
  // So: prefer the scroller that holds the most content, and break
  // ties towards the innermost one.
  return scrollable.reduce((best, el) => {
    const bestRange = best.scrollHeight - best.clientHeight;
    const range = el.scrollHeight - el.clientHeight;
    if (range > bestRange * 1.2) return el;
    if (range > bestRange) return el;
    return best;
  });
};

/**
 * A floating button that jumps to the top or the bottom of the current
 * screen.
 *
 * A long list on a phone is a lot of thumb work: to reach the last
 * entry you either flick repeatedly or drag the scrollbar, which is
 * nearly impossible with one hand. One button that alternates between
 * "top" and "bottom" removes the guesswork, and it is the pattern
 * every long mobile list uses.
 *
 * It only appears once the screen is long enough for the jump to be
 * worth the space, and it floats above the content rather than sitting
 * in it, so it never covers a row.
 */
export const ScrollToTopButton: React.FC<ScrollToTopButtonProps> = ({
  className,
}) => {
  const [atBottom, setAtBottom] = useState(true);
  const [visible, setVisible] = useState(false);
  const rafIdRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const scroller = findScrollableElement();
      if (!scroller) {
        setVisible(false);
        return;
      }
      const { scrollTop, scrollHeight, clientHeight } = scroller;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      setVisible(scrollTop > 40 || distanceFromBottom > 40);
      setAtBottom(distanceFromBottom <= 40);
    });
  }, []);

  useEffect(() => {
    measure();

    // Scroll events do not bubble, so they are captured on the
    // document to catch every scroller on the page. Throttled via rAF
    // with passive capture to eliminate synchronous layout thrashing.
    document.addEventListener('scroll', measure, {
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
      }
      document.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const scrollTo = (edge: 'top' | 'bottom') => {
    const scroller = findScrollableElement();
    if (!scroller) return;
    scroller.scrollTo({
      top: edge === 'top' ? 0 : scroller.scrollHeight,
      behavior: 'smooth',
    });
  };

  if (!visible) return null;

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      onClick={() => scrollTo(atBottom ? 'top' : 'bottom')}
      aria-label={atBottom ? 'Scroll to top' : 'Scroll to bottom'}
      title={atBottom ? 'Scroll to top' : 'Scroll to bottom'}
      className={cn(
        // Floating, above the content, clear of the home indicator.
        'fixed bottom-4 right-3 z-30 rounded-full shadow-lg safe-bottom',
        className,
      )}
    >
      {atBottom ? (
        <ArrowUp className="h-5 w-5" aria-hidden />
      ) : (
        <ArrowDown className="h-5 w-5" aria-hidden />
      )}
    </Button>
  );
};
