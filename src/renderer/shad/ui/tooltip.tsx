import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
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
 * is no hover, and Radix deliberately refuses to open on focus while a
 * pointer is down (its way of keeping tooltips off touch devices).
 * So on a touch device the tooltip is driven explicitly.
 *
 * Read from `matchMedia` rather than a one-time check, so a
 * touchscreen laptop (which reports a fine pointer but no hover) is
 * handled too.
 */
const isTouchPrimary = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(hover: none)').matches;
};

/** Lets the trigger ask the tooltip to open on a tap. */
const TooltipTouchContext = createContext<{
  touch: boolean;
  openOnTap: () => void;
}>({ touch: false, openOnTap: () => {} });

const TooltipWrapper = ({
  delayDuration = 200,
  children,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof Tooltip>) => {
  const touch = isTouchPrimary();
  // On a touch device the tooltip's open state is ours, not Radix's:
  // Radix opens on focus (which a tap triggers) and closes on click
  // (which the same tap also triggers), so the tooltip would flash and
  // vanish before it could be read.
  const [open, setOpen] = useState(false);
  // A tap that opened the tooltip also produces a click, and Radix
  // closes on click. This flag lets that one close be ignored, while a
  // later tap elsewhere still closes it.
  const tapGuardRef = useRef(false);

  const openOnTap = useCallback(() => {
    tapGuardRef.current = true;
    setOpen(true);
  }, []);

  const contextValue = useMemo(
    () => ({ touch, openOnTap }),
    [touch, openOnTap],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && tapGuardRef.current) {
        tapGuardRef.current = false;
        // Let the guard lapse so a later close (a tap elsewhere) works.
        window.setTimeout(() => {
          tapGuardRef.current = false;
        }, 400);
        return;
      }
      if (touch) {
        setOpen(next);
        return;
      }
      onOpenChange?.(next);
    },
    [onOpenChange, touch],
  );

  return (
    <TooltipTouchContext.Provider value={contextValue}>
      <Tooltip
        {...props}
        delayDuration={touch ? 0 : delayDuration}
        open={touch ? open : undefined}
        onOpenChange={handleOpenChange}
      >
        {children}
      </Tooltip>
    </TooltipTouchContext.Provider>
  );
};
TooltipWrapper.displayName = 'Tooltip';

const TooltipTriggerWrapper = forwardRef<
  React.ElementRef<typeof TooltipTrigger>,
  React.ComponentPropsWithoutRef<typeof TooltipTrigger>
>(({ children, onPointerDown, ...props }, ref) => {
  const { touch, openOnTap } = useContext(TooltipTouchContext);
  return (
    <TooltipTrigger
      ref={ref}
      // A tap opens the tooltip on a touch device. Without this the
      // information is simply unreachable on a phone.
      onPointerDown={
        touch
          ? (event) => {
              // Only a real tap, not the start of a scroll.
              if (event.pointerType !== 'touch') return;
              openOnTap();
            }
          : onPointerDown
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
