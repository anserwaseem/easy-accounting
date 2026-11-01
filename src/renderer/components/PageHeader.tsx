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
 * Layout is responsive by intent:
 *  - On a phone (<sm) the title and the actions share the first row and
 *    the filters sit in a row of their own beneath it — that is what keeps
 *    the mobile header to two compact rows.
 *  - On a desktop (sm+) it returns to the original three-column row:
 *    filters on the left, the title centred, actions on the right. Putting
 *    everything on one row there leaves the list room and keeps the title
 *    anchored in the middle of the screen.
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
    {/* Mobile layout: title + actions on one row, filters below. */}
    <div className="sm:hidden">
      <div className="flex items-center justify-between gap-2">
        {hideTitle ? (
          <div className="min-w-0 flex-1" />
        ) : (
          <h1 className="title-new min-w-0 truncate text-left">{title}</h1>
        )}
        {filtersInline && filters ? (
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {filters}
          </div>
        ) : null}
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {filters && !filtersInline ? (
        <div className="mt-2 flex flex-col items-stretch gap-2">{filters}</div>
      ) : null}
    </div>

    {/* Desktop layout: filters left, title centred, actions right. */}
    <div className="hidden sm:grid sm:grid-cols-3 sm:items-center sm:gap-4">
      <div className="flex min-w-0 items-center gap-2 sm:justify-self-start">
        {!filtersInline && filters ? filters : null}
      </div>
      <div className="flex min-w-0 justify-center">
        {hideTitle ? null : (
          <h1 className="title-new min-w-0 truncate text-center">{title}</h1>
        )}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2 sm:justify-self-end">
        {filtersInline && filters ? filters : null}
        {actions || null}
      </div>
    </div>
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
  hideLabelOnMobile = false,
  children,
  className,
}) => (
  <div className={cn('flex min-w-0 items-center gap-2 sm:gap-3', className)}>
    {label ? (
      <p
        className={cn(
          'shrink-0 text-muted-foreground font-medium text-sm',
          hideLabelOnMobile && 'hidden sm:block',
        )}
      >
        {label}
      </p>
    ) : null}
    {children}
  </div>
);
