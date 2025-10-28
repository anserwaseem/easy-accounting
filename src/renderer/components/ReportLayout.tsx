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
          'w-full mx-auto print-container h-full flex flex-col',
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
            'flex-grow overflow-y-auto print:overflow-visible',
            bodyClassName,
          )}
        >
          {children}
        </div>
      </div>
    </>
  );
};
