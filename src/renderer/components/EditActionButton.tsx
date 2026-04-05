import { Pencil } from 'lucide-react';
import { forwardRef } from 'react';

import { Button, type ButtonProps } from '@/renderer/shad/ui/button';
import { cn } from '@/renderer/lib/utils';

/**
 * Consistent ghost icon trigger for edit flows (tables, dialogs, menus).
 * Default: Lucide Pencil, 32×32 tap target, ghost + icon sizing.
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
      className={cn('h-8 w-8 shrink-0', className)}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      {...props}
    >
      {children ?? <Pencil className="h-4 w-4" />}
    </Button>
  ),
);

EditActionButton.displayName = 'EditActionButton';
