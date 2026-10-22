import { createContext, forwardRef, useContext, useMemo } from 'react';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  Content,
  Portal,
  type TooltipContentProps,
} from '@radix-ui/react-tooltip';

import { cn } from 'renderer/lib/utils';

const TooltipContent = forwardRef<
  React.ElementRef<typeof Content>,
  React.ComponentPropsWithoutRef<typeof Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <Portal>
    <Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[60] overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        // On a phone the tooltip must not be a full-width bar over the
        // content it describes.
        'max-w-[calc(100vw-2rem)]',
        className,
      )}
      {...props}
    />
  </Portal>
));
TooltipContent.displayName = Content.displayName;

/**
 * Whether the primary pointer is a touch one.
 *
 * A tooltip that only opens on hover is unreachable on a phone: there
 * is no hover, and a tap on a non-focusable element does nothing. So on
 * a touch device the tooltip opens on tap instead.
 *
 * Read from `matchMedia` rather than a one-time check, so a
 * touchscreen laptop (which reports a fine pointer but no hover) is
 * handled too.
 */
const isTouchPrimary = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(hover: none)').matches;
};

/** Tells the trigger that the primary pointer is a touch one. */
const TooltipTouchContext = createContext<{ touch: boolean }>({
  touch: false,
});

const TooltipWrapper = ({
  delayDuration = 200,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Tooltip>) => {
  const touch = isTouchPrimary();
  const contextValue = useMemo(() => ({ touch }), [touch]);

  return (
    <TooltipTouchContext.Provider value={contextValue}>
      <Tooltip {...props} delayDuration={touch ? 0 : delayDuration}>
        {children}
      </Tooltip>
    </TooltipTouchContext.Provider>
  );
};
TooltipWrapper.displayName = 'Tooltip';

const TooltipTriggerWrapper = forwardRef<
  React.ElementRef<typeof TooltipTrigger>,
  React.ComponentPropsWithoutRef<typeof TooltipTrigger>
>(({ children, onClick, ...props }, ref) => {
  const { touch } = useContext(TooltipTouchContext);
  return (
    <TooltipTrigger
      ref={ref}
      // A tap opens the tooltip on a touch device (a second tap closes
      // it). Without this the information is simply unreachable on a
      // phone.
      //
      // The `preventDefault` matters: Radix's own click handler closes
      // the tooltip, so without it the tap opened and closed it in the
      // same gesture. Radix skips its handler when the event is already
      // default-prevented.
      onClick={
        touch
          ? (event) => {
              // Radix closes the tooltip on click. On a touch device the
              // tap that focuses the trigger (which opens it) is
              // followed by the click (which closed it again), so the
              // tooltip flashed and vanished. Preventing the default
              // makes Radix skip its close handler; the tooltip then
              // stays open until the user taps elsewhere, and Radix's
              // own focus handler does the opening.
              event.preventDefault();
            }
          : onClick
      }
      {...props}
    >
      {children}
    </TooltipTrigger>
  );
});
TooltipTriggerWrapper.displayName = TooltipTrigger.displayName;

const TooltipProviderWrapper = ({
  delayDuration = 200,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipProvider>) => (
  <TooltipProvider delayDuration={delayDuration} {...props} />
);
TooltipProviderWrapper.displayName = 'TooltipProvider';

export {
  TooltipWrapper as Tooltip,
  TooltipTriggerWrapper as TooltipTrigger,
  TooltipContent,
  TooltipProviderWrapper as TooltipProvider,
  type TooltipContentProps,
};
