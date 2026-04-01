import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'renderer/lib/utils';

const alertVariants = cva(
  'relative flex w-full gap-3 rounded-lg border px-3 py-2 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground [&>svg]:text-foreground',
        destructive:
          'border-destructive/50 bg-destructive/5 text-destructive dark:border-destructive [&>svg]:text-destructive',
        warning:
          'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-50 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, role, ...props }, ref) => {
    let implicitRole: 'alert' | 'status' | undefined;
    if (variant === 'destructive') implicitRole = 'alert';
    else if (variant === 'warning') implicitRole = 'status';
    const resolvedRole = role ?? implicitRole;

    return (
      <div
        ref={ref}
        role={resolvedRole}
        className={cn(alertVariants({ variant }), className)}
        {...props}
      />
    );
  },
);
Alert.displayName = 'Alert';

const AlertTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  // eslint-disable-next-line jsx-a11y/heading-has-content -- title text provided by caller
  <h5
    ref={ref}
    className={cn('mb-1 font-medium leading-none tracking-tight', className)}
    {...props}
  />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
