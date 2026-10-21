/* eslint-disable react/prop-types -- props fully typed via ScrollToTopButtonProps interface */
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { cn } from 'renderer/lib/utils';
import { Button } from 'renderer/shad/ui/button';

interface ScrollToTopButtonProps {
  /**
   * The scrollable element. Defaults to the app shell's content pane
   * (the element with `data-app-scroll`), which is what every screen
   * scrolls inside.
   */
  target?: HTMLElement | null;
  className?: string;
}

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
 * worth the space, and it sits above the content rather than in it, so
 * it never covers a row.
 */
export const ScrollToTopButton: React.FC<ScrollToTopButtonProps> = ({
  target,
  className,
}) => {
  const [atBottom, setAtBottom] = useState(true);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scroller =
      target ??
      (typeof document !== 'undefined'
        ? document.querySelector<HTMLElement>('[data-app-scroll]')
        : null);
    if (!scroller) return undefined;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scroller;
      const scrolled = scrollTop > 40;
      setVisible(scrolled || scrollHeight - scrollTop - clientHeight > 40);
      setAtBottom(scrollHeight - scrollTop - clientHeight <= 40);
    };

    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [target]);

  const scrollTo = (edge: 'top' | 'bottom') => {
    const scroller =
      target ?? document.querySelector<HTMLElement>('[data-app-scroll]');
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
