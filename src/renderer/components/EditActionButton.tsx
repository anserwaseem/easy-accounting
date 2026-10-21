import { Pencil } from 'lucide-react';
import { forwardRef } from 'react';

import { Button, type ButtonProps } from '@/renderer/shad/ui/button';
import { cn } from '@/renderer/lib/utils';

/**
 * Consistent ghost icon trigger for edit flows (tables, dialogs, menus).
 * Default: Lucide Pencil, ghost + icon sizing.
 *
 * 32×32 on desktop, 44×44 on a phone — 32px is below the smallest
 * comfortable touch target.
 */
export const EditActionButton = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      children,
      variant = 'ghost',
      size = 'icon',
      type = 'button',
      'aria-label': ariaLabel = 'Edit',
      title,
      ...props
    },
    ref,
  ) => (
    <Button
      ref={ref}
      type={type}
      variant={variant}
      size={size}
      className={cn('h-11 w-11 shrink-0 md:h-8 md:w-8', className)}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      {...props}
    >
      {children ?? <Pencil className="h-4 w-4" />}
    </Button>
  ),
);

EditActionButton.displayName = 'EditActionButton';
