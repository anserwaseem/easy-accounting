import { cn } from '@/renderer/lib/utils';
import { Indicator, Root } from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  forwardRef,
} from 'react';

const Checkbox = forwardRef<
  ElementRef<typeof Root>,
  ComponentPropsWithoutRef<typeof Root>
>(({ className, ...props }, ref) => (
  <Root
    ref={ref}
    className={cn(
      // The visible box stays 16px (it must not look like a 44px control),
      // but the button itself carries the 44px touch target on mobile via
      // a pseudo-element that extends past the box.
      'peer relative h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground before:absolute before:-inset-3.5 before:content-[""] md:before:hidden',
      className,
    )}
    {...props}
  >
    <Indicator className={cn('flex items-center justify-center text-current')}>
      <Check className="h-4 w-4" />
    </Indicator>
  </Root>
));
Checkbox.displayName = Root.displayName;

export { Checkbox };
