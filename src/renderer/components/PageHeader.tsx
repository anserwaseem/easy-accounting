/* eslint-disable react/prop-types -- props fully typed via PageHeaderProps/FilterGroupProps interfaces */
import type { ReactNode } from 'react';
import { cn } from 'renderer/lib/utils';

interface PageHeaderProps {
  /** Screen title. Rendered as the page's h1. */
  title: ReactNode;
  /** Filter/sort controls that sit next to the title on desktop. */
  filters?: ReactNode;
  /** Primary and secondary actions. Right-aligned on desktop, full-width
   *  row on mobile. */
  actions?: ReactNode;
  /** Drop the the h1 (used by the split-pane detail screens, which render
   *  their own heading). */
  hideTitle?: boolean;
  className?: string;
}

/**
 * The screen header shared by the list screens (Journals, Invoices,
 * Quotations, Accounts).
 *
 * It replaces the hand-rolled `grid-cols-3` headers those screens used,
 * which had no responsive rules: on a phone the three columns stayed
 * side by side, so the "VIEW BY:" label, the date range picker, the
 * title and the primary button all overlapped.
 *
 * Layout:
 *   desktop  title .................. filters ..... actions
 *   mobile   title
 *            filters
 *            actions
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  filters,
  actions,
  hideTitle = false,
  className,
}) => (
  <div className={cn('flex flex-col gap-3 py-4', className)}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {hideTitle ? null : (
        <h1 className="title-new text-left sm:text-center">{title}</h1>
      )}
      {filters ? (
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
          {filters}
        </div>
      ) : null}
    </div>
    {actions ? (
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {actions}
      </div>
    ) : null}
  </div>
);

interface FilterGroupProps {
  label?: string;
  children: ReactNode;
  className?: string;
}

/**
 * A labelled filter cluster ("VIEW BY: [date range]"). The label sits
 * above the control on a phone so neither is squeezed, and inline on a
 * wider screen.
 */
export const FilterGroup: React.FC<FilterGroupProps> = ({
  label,
  children,
  className,
}) => (
  <div
    className={cn(
      'flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3',
      className,
    )}
  >
    {label ? (
      <p className="text-muted-foreground font-bold text-sm">{label}</p>
    ) : null}
    {children}
  </div>
);
