/* eslint-disable react/prop-types -- props fully typed via ReportHeaderProps interface */
import type { ReactNode } from 'react';
import { cn } from 'renderer/lib/utils';

interface ReportHeaderProps {
  /** Report title. Rendered as the page's h1. */
  title: ReactNode;
  /** The filter controls (account picker, date range, ...). */
  filters?: ReactNode;
  /** Icon buttons and the like (refresh, export). */
  actions?: ReactNode;
  className?: string;
}

/**
 * The header shared by the report screens.
 *
 * Every report had its own hand-rolled header, and they all had the
 * same problem on a phone: a title on the left, a row of filter controls
 * and icon buttons on the right, and no wrapping. A report with an
 * account picker and a date range needed ~500px, so on a 390px screen
 * the title was squeezed to two words per line and the controls ran off
 * the edge (see the Ledger Report, where the account dropdown opened
 * off-screen entirely).
 *
 * Layout:
 *   desktop  title ........................ filters .... actions
 *   mobile   title ....................... actions
 *            filters
 */
export const ReportHeader: React.FC<ReportHeaderProps> = ({
  title,
  filters,
  actions,
  className,
}) => (
  <div className={cn('print-header flex flex-col gap-2 pb-2', className)}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="title-new min-w-0 truncate">{title}</h1>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
    {filters ? (
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        {filters}
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
