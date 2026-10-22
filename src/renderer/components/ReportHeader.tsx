/* eslint-disable react/prop-types -- props fully typed via ReportHeaderProps interface */
import type { ReactNode } from 'react';
import { cn } from 'renderer/lib/utils';

interface ReportHeaderProps {
  /** Report title. Rendered as the page's h1. */
  title: ReactNode;
  /** A count or status chip beside the title (e.g. "297 accounts"). */
  badge?: ReactNode;
  /** The filter trigger. Sits on the title's row. */
  filters?: ReactNode;
  /**
   * A key figure (e.g. "Total outstanding"). It shares the row with
   * the action buttons, so it is squeezed rather than given a row of
   * its own.
   */
  summary?: ReactNode;
  /** Icon buttons and the like (refresh, export, print). */
  actions?: ReactNode;
  className?: string;
}

/**
 * The header shared by the report screens.
 *
 * Every report had its own hand-rolled header, and they all had the
 * same problem on a phone: the title, a key figure, a Filters button and
 * three icon buttons stacked into a tall column that pushed the report's
 * own content off the screen. A report's header should cost two rows,
 * not five.
 *
 * Layout:
 *   desktop  title ....... badge ...... filters | summary .... actions
 *   mobile   title ....... badge ...... filters
 *            summary .... actions
 *
 * The Filters button travels with the title (it is about what the
 * report shows, like the title is), and the key figure travels with the
 * action buttons (it is the report's result, next to the controls that
 * change it).
 */
export const ReportHeader: React.FC<ReportHeaderProps> = ({
  title,
  badge,
  filters,
  summary,
  actions,
  className,
}) => (
  <div className={cn('print-header flex flex-col gap-2 pb-2', className)}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="title-new min-w-0 truncate">{title}</h1>
        {badge}
      </div>
      {filters ? (
        <div className="flex shrink-0 items-center gap-2">{filters}</div>
      ) : null}
    </div>
    {summary || actions ? (
      <div className="flex flex-wrap items-center justify-between gap-2">
        {summary ? <div className="min-w-0 flex-1">{summary}</div> : null}
        {actions ? (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        ) : null}
      </div>
    ) : null}
  </div>
);

interface ReportFilterProps {
  label?: string;
  children: ReactNode;
  className?: string;
}

/**
 * A labelled report filter ("Account: [picker]"). The label sits inline
 * before the control so the control gets the width it needs — above it
 * on a phone, the picker was squeezed to the width of its label.
 */
export const ReportFilter: React.FC<ReportFilterProps> = ({
  label,
  children,
  className,
}) => (
  <div className={cn('flex min-w-0 items-center gap-2', className)}>
    {label ? (
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
    ) : null}
    {children}
  </div>
);
