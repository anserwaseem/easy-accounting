import { forwardRef, useEffect, useRef } from 'react';
import {
  Content,
  Group,
  Icon,
  Item,
  ItemIndicator,
  ItemText,
  Label,
  Portal,
  Root,
  ScrollDownButton,
  ScrollUpButton,
  Separator,
  Trigger,
  Value,
  Viewport,
} from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

import { cn } from 'renderer/lib/utils';

const Select = Root;

const SelectGroup = Group;

const SelectValue = Value;

const SelectTrigger = forwardRef<
  React.ElementRef<typeof Trigger>,
  React.ComponentPropsWithoutRef<typeof Trigger>
>(({ className, children, ...props }, ref) => (
  <Trigger
    ref={ref}
    className={cn(
      // 44px touch target on mobile, 40px on desktop. See input.tsx.
      'flex h-11 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:h-10 [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1 [&>span:first-child]:text-left [&>span:first-child]:line-clamp-1',
      className,
    )}
    {...props}
  >
    {children}
    <Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </Icon>
  </Trigger>
));
SelectTrigger.displayName = Trigger.displayName;

const SelectScrollUpButton = forwardRef<
  React.ElementRef<typeof ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof ScrollUpButton>
>(({ className, ...props }, ref) => (
  <ScrollUpButton
    ref={ref}
    className={cn(
      'flex cursor-default items-center justify-center py-1',
      className,
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </ScrollUpButton>
));
SelectScrollUpButton.displayName = ScrollUpButton.displayName;

const SelectScrollDownButton = forwardRef<
  React.ElementRef<typeof ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof ScrollDownButton>
>(({ className, ...props }, ref) => (
  <ScrollDownButton
    ref={ref}
    className={cn(
      'flex cursor-default items-center justify-center py-1',
      className,
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </ScrollDownButton>
));
SelectScrollDownButton.displayName = ScrollDownButton.displayName;

/**
 * radix dialog (sheets/modals) sets `pointer-events: none` on <body> while open and re-enables them
 * only for layers registered in its own dismissable-layer copy. our select ships a different copy,
 * so its portaled content stays mouse-dead inside a sheet (keyboard still works). forcing pointer
 * events on the content keeps mouse selection working wherever the select is rendered.
 */
const forcedPointerEvents: React.CSSProperties = { pointerEvents: 'auto' };

const SelectContent = forwardRef<
  React.ElementRef<typeof Content>,
  React.ComponentPropsWithoutRef<typeof Content>
>(
  (
    {
      className,
      children,
      position = 'popper',
      style,
      onWheel,
      onTouchMove,
      ...props
    },
    forwardedRef,
  ) => {
    const contentRef = useRef<HTMLDivElement | null>(null);

    // radix dialog's react-remove-scroll intercepts document wheel/touchmove events
    // outside the dialog overlay and calls preventDefault(), which freezes select dropdown scrolling.
    // stopping native event propagation at the content element allows the browser to perform
    // normal scrolling without the dialog's document listener cancelling it.
    useEffect(() => {
      const el = contentRef.current;
      if (!el) return;
      const stopProp = (e: Event) => {
        e.stopPropagation();
      };
      el.addEventListener('wheel', stopProp, { passive: true });
      el.addEventListener('touchmove', stopProp, { passive: true });
      return () => {
        el.removeEventListener('wheel', stopProp);
        el.removeEventListener('touchmove', stopProp);
      };
    }, []);

    const handleRef = (node: HTMLDivElement | null) => {
      contentRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        (
          forwardedRef as React.MutableRefObject<HTMLDivElement | null>
        ).current = node;
      }
    };

    return (
      <Portal>
        <Content
          ref={handleRef}
          style={{ ...forcedPointerEvents, ...style }}
          onWheel={(e) => {
            e.stopPropagation();
            onWheel?.(e);
          }}
          onTouchMove={(e) => {
            e.stopPropagation();
            onTouchMove?.(e);
          }}
          className={cn(
            // select is often nested inside popovers/dialogs; it must sit above them
            // max-w keeps the panel inside the viewport when the trigger sits
            // near an edge on a phone.
            'relative z-[70] max-h-[min(24rem,var(--radix-select-content-available-height,24rem))] min-w-[8rem] max-w-[calc(100vw-2rem)] overflow-y-auto scrollbar rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
            position === 'popper' &&
              'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
            className,
          )}
          position={position}
          {...props}
        >
          <SelectScrollUpButton />
          <Viewport
            className={cn(
              'p-1',
              position === 'popper' &&
                'w-full min-w-[var(--radix-select-trigger-width)]',
            )}
          >
            {children}
          </Viewport>
          <SelectScrollDownButton />
        </Content>
      </Portal>
    );
  },
);
SelectContent.displayName = Content.displayName;

const SelectLabel = forwardRef<
  React.ElementRef<typeof Label>,
  React.ComponentPropsWithoutRef<typeof Label>
>(({ className, ...props }, ref) => (
  <Label
    ref={ref}
    className={cn('py-1.5 pl-8 pr-2 text-sm font-semibold', className)}
    {...props}
  />
));
SelectLabel.displayName = Label.displayName;

const SelectItem = forwardRef<
  React.ElementRef<typeof Item>,
  React.ComponentPropsWithoutRef<typeof Item>
>(({ className, children, ...props }, ref) => (
  <Item
    ref={ref}
    className={cn(
      // min-h-11 on mobile: the option row is the tap target, and py-1.5
      // alone rendered a ~28px row — too small for a thumb.
      'relative flex min-h-11 w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 md:min-h-0',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ItemIndicator>
        <Check className="h-4 w-4" />
      </ItemIndicator>
    </span>

    <ItemText>{children}</ItemText>
  </Item>
));
SelectItem.displayName = Item.displayName;

const SelectSeparator = forwardRef<
  React.ElementRef<typeof Separator>,
  React.ComponentPropsWithoutRef<typeof Separator>
>(({ className, ...props }, ref) => (
  <Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-muted', className)}
    {...props}
  />
));
SelectSeparator.displayName = Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
