import type { ComponentProps } from 'react';
import { cn } from 'renderer/lib/utils';

/** label for primary OS shortcut modifier (⌘ on Apple platforms, Ctrl elsewhere) */
export const getOsModifierLabel = (): string =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/i.test(navigator.userAgent)
    ? '⌘'
    : 'Ctrl';

const Kbd = ({ className, ...props }: ComponentProps<'kbd'>) => (
  <kbd
    data-slot="kbd"
    className={cn(
      // Physical-key look (minimalist-ui): bordered, subtle surface, mono,
      // tighter type. Keep heights/gaps/shadcn tooltip color overrides below.
      'bg-muted/70 text-muted-foreground border border-border/70 pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-md px-1.5 font-mono text-[10px] font-medium',
      "[&_svg:not([class*='size-'])]:size-3",
      '[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10',
      className,
    )}
    {...props}
  />
);

const KbdGroup = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="kbd-group"
    className={cn('inline-flex items-center gap-1', className)}
    {...props}
  />
);

export { Kbd, KbdGroup };
