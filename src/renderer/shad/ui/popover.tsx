import { forwardRef } from 'react';
import { Content, Portal, Root, Trigger } from '@radix-ui/react-popover';

import { cn } from 'renderer/lib/utils';

const Popover = Root;

const PopoverTrigger = Trigger;

/**
 * radix dialog (sheets/modals) sets `pointer-events: none` on <body> while open and relies on its
 * own dismissable-layer registry to re-enable them on the topmost layer. our popover ships a
 * different copy of that package, so its layer is invisible to the dialog's registry and the
 * portaled content stays mouse-dead inside a sheet (keyboard still works). re-enabling pointer
 * events on the content keeps mouse selection working wherever the popover is rendered.
 */
const forcedPointerEvents: React.CSSProperties = { pointerEvents: 'auto' };

const PopoverContent = forwardRef<
  React.ElementRef<typeof Content>,
  React.ComponentPropsWithoutRef<typeof Content>
>(({ className, align = 'center', sideOffset = 4, style, ...props }, ref) => (
  <Portal>
    <Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      style={{ ...forcedPointerEvents, ...style }}
      className={cn(
        'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    />
  </Portal>
));
PopoverContent.displayName = Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
