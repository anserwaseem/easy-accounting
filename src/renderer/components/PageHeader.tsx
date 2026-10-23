/* eslint-disable react/prop-types -- props fully typed via PageHeaderProps/FilterGroupProps interfaces */
import type { ReactNode } from 'react';
import { cn } from 'renderer/lib/utils';

interface PageHeaderProps {
  /** Screen title. Rendered as the page's h1. */
  title: ReactNode;
  /** Filter/sort controls that sit next to the title. */
  filters?: ReactNode;
  /**
   * Put the filters on the title's row instead of a row of their own.
   *
   * A header that costs two rows costs the list a row of content. When
   * the filter is one control (a date range, a "view by" picker) it can
   * share the title's row: the title truncates, the filter takes what
   * is left.
   */
  filtersInline?: boolean;
  /** Primary and secondary actions. */
  actions?: ReactNode;
  /** Drop the h1 (used by the split-pane detail screens, which render
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
 * On a phone the title and the actions share the first row, and the
 * filters sit in a row of their own beneath it. A phone header used to
 * take three full-width rows before the user reached any content; two
 * compact rows leave the list visible immediately.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  filters,
  filtersInline = false,
  actions,
  hideTitle = false,
  className,
}) => (
  <div className={cn('flex flex-col gap-2 py-3 sm:gap-3 sm:py-4', className)}>
    <div className="flex items-center justify-between gap-2 sm:justify-end sm:gap-4">
      {hideTitle ? (
        <div className="sm:hidden" />
      ) : (
        <h1 className="title-new min-w-0 truncate text-left sm:text-center">
          {title}
        </h1>
      )}
      {filtersInline && filters ? (
        // The filter shares the title's row: it takes the space the
        // title does not need, and the title truncates before the
        // filter does.
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none sm:justify-end">
          {filters}
        </div>
      ) : null}
      {actions ? (
        <div className="flex shrink-0 items-center gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
    {filters && !filtersInline ? (
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
        {filters}
      </div>
    ) : null}
  </div>
);

interface FilterGroupProps {
  label?: string;
  children: ReactNode;
  /**
   * Hide the label on a phone. The control itself says what it is (a
   * calendar button, a "view by" picker), and on a narrow row the
   * label is the first thing to go.
   */
  hideLabelOnMobile?: boolean;
  className?: string;
}

/**
 * A labelled filter cluster ("VIEW BY: [date range]"). On a phone the
 * label sits inline before the control rather than above it, so the
 * control gets the width it needs to show a date range.
 */
export const FilterGroup: React.FC<FilterGroupProps> = ({
  label,
  children,
  hideLabelOnMobile = false,
  className,
}) => (
  <div className={cn('flex min-w-0 items-center gap-2 sm:gap-3', className)}>
    {label ? (
      <p
        className={cn(
          'shrink-0 text-muted-foreground font-bold text-sm',
          hideLabelOnMobile && 'hidden sm:block',
        )}
      >
        {label}
      </p>
    ) : null}
    {children}
  </div>
);
