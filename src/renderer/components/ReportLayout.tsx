import { type ReactNode } from 'react';
import { cn } from 'renderer/lib/utils';

interface ReportLayoutProps {
  /** Content for the fixed header section */
  header: ReactNode;
  /** Content for the scrollable body section */
  children: ReactNode;
  /** Additional CSS classes for the main container */
  className?: string;
  /** Additional CSS classes for the header */
  headerClassName?: string;
  /** Additional CSS classes for the body */
  bodyClassName?: string;
  /** Custom print styles (optional) */
  printStyles?: string;
}

/**
 * Fixed header + one scrollable body. Default body owns vertical scroll.
 * Virtualised reports must pass bodyClassName with overflow-hidden and
 * size their own scroller (Virtuoso) with a min-h-0 height chain — do not
 * nest a second overflow-y-auto inside the default body.
 */
export const ReportLayout: React.FC<ReportLayoutProps> = ({
  header,
  children,
  className,
  headerClassName,
  bodyClassName,
  printStyles,
}: ReportLayoutProps) => {
  return (
    <>
      {printStyles && <style>{printStyles}</style>}
      <div
        className={cn(
          'mx-auto flex h-full min-h-0 w-full flex-col print-container print:block print:h-auto',
          className,
        )}
      >
        {/* Fixed Header */}
        <div
          className={cn(
            'flex-shrink-0 bg-background border-b print:hidden',
            headerClassName,
          )}
        >
          {header}
        </div>

        {/* Scrollable Content */}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto print:block print:h-auto print:overflow-visible',
            bodyClassName,
          )}
        >
          {children}
        </div>
      </div>
    </>
  );
};
