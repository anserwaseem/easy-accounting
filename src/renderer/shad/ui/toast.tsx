import { forwardRef } from 'react';
import {
  Provider as ToastProvider,
  Viewport,
  Root,
  Title,
  Description,
  Action,
  Close,
} from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';

import { cn } from 'renderer/lib/utils';

const ToastViewport = forwardRef<
  React.ElementRef<typeof Viewport>,
  React.ComponentPropsWithoutRef<typeof Viewport>
>(({ className, ...props }, ref) => (
  <Viewport
    ref={ref}
    className={cn(
      'fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px] print:hidden',
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = Viewport.displayName;

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-4 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default: 'border bg-background text-foreground shadow-md',
        destructive:
          'destructive group border-red-300 bg-red-50 text-red-950 shadow-md dark:border-red-900/60 dark:bg-red-950 dark:text-red-100',
        success:
          'success group border-emerald-300 bg-emerald-50 text-emerald-950 shadow-md dark:border-emerald-900/60 dark:bg-emerald-950 dark:text-emerald-100',
        warning:
          'warning group border-amber-300 bg-amber-50 text-amber-950 shadow-md dark:border-amber-900/60 dark:bg-amber-950 dark:text-amber-100',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Toast = forwardRef<
  React.ElementRef<typeof Root>,
  React.ComponentPropsWithoutRef<typeof Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  );
});
Toast.displayName = Root.displayName;

const ToastAction = forwardRef<
  React.ElementRef<typeof Action>,
  React.ComponentPropsWithoutRef<typeof Action>
>(({ className, ...props }, ref) => (
  <Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-red-300/60 group-[.destructive]:hover:border-red-400 group-[.destructive]:hover:bg-red-100 group-[.destructive]:hover:text-red-950 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-50 dark:group-[.destructive]:border-muted/40 dark:group-[.destructive]:hover:border-destructive/30 dark:group-[.destructive]:hover:bg-destructive dark:group-[.destructive]:hover:text-destructive-foreground dark:group-[.destructive]:focus:ring-destructive dark:group-[.destructive]:focus:ring-offset-red-950 group-[.success]:border-emerald-300/60 group-[.success]:hover:border-emerald-400 group-[.success]:hover:bg-emerald-100 group-[.success]:hover:text-emerald-950 group-[.warning]:border-amber-300/60 group-[.warning]:hover:border-amber-400 group-[.warning]:hover:bg-amber-100 group-[.warning]:hover:text-amber-950',
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = Action.displayName;

const ToastClose = forwardRef<
  React.ElementRef<typeof Close>,
  React.ComponentPropsWithoutRef<typeof Close>
>(({ className, ...props }, ref) => (
  <Close
    ref={ref}
    className={cn(
      'absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-700/70 group-[.destructive]:hover:text-red-950 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-100 dark:group-[.destructive]:text-red-300 dark:group-[.destructive]:hover:text-red-50 dark:group-[.destructive]:focus:ring-offset-red-900 dark:text-neutral-50/50 dark:hover:text-neutral-50 group-[.success]:text-emerald-700/70 group-[.success]:hover:text-emerald-950 group-[.success]:focus:ring-emerald-400 group-[.warning]:text-amber-800/70 group-[.warning]:hover:text-amber-950 group-[.warning]:focus:ring-amber-400 dark:group-[.warning]:text-amber-300 dark:group-[.warning]:hover:text-amber-50',
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </Close>
));
ToastClose.displayName = Close.displayName;

const ToastTitle = forwardRef<
  React.ElementRef<typeof Title>,
  React.ComponentPropsWithoutRef<typeof Title>
>(({ className, ...props }, ref) => (
  <Title
    ref={ref}
    className={cn('text-sm font-semibold', className)}
    {...props}
  />
));
ToastTitle.displayName = Title.displayName;

const ToastDescription = forwardRef<
  React.ElementRef<typeof Description>,
  React.ComponentPropsWithoutRef<typeof Description>
>(({ className, ...props }, ref) => (
  <Description
    ref={ref}
    className={cn('text-sm opacity-90', className)}
    {...props}
  />
));
ToastDescription.displayName = Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
