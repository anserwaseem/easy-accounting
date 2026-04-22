import { cn } from 'renderer/lib/utils';

interface SidebarProps {
  /** rendered as-is (caller controls links/buttons inside) */
  title?: React.ReactNode;
  items?: React.ReactNode[];
  footer?: React.ReactNode;
  position?: 'left' | 'right';
  className?: string;
  titleClassName?: string;
  itemsClassName?: string;
  itemClassName?: string;
  /** when true the sidebar narrows to icon-only width */
  collapsed?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  title,
  items,
  footer,
  position = 'left',
  className,
  titleClassName,
  itemsClassName,
  itemClassName,
  collapsed = false,
}: SidebarProps) => (
  <aside
    className={cn(
      'flex flex-col bg-gray-200 dark:bg-gray-800 transition-all duration-200',
      position === 'right' ? 'order-1' : '',
      collapsed ? 'w-14' : 'w-[260px]',
      className,
    )}
  >
    {/* header */}
    {title && (
      <div
        className={cn(
          'flex-shrink-0 bg-gray-200 dark:bg-background border-b border-gray-800 dark:border-gray-300',
          titleClassName,
        )}
      >
        {title}
      </div>
    )}

    {/* scrollable nav items */}
    <div
      className={cn(
        'flex flex-col flex-1 overflow-y-auto py-2',
        itemsClassName,
      )}
    >
      {/* use index as key — callers already supply stable keys on each element */}
      {items?.map((item, index) => (
        <div
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          className={cn('flex w-full mb-1 px-2', itemClassName)}
        >
          {item}
        </div>
      ))}
    </div>

    {/* pinned footer */}
    {footer && (
      <div className="flex-shrink-0 border-t border-gray-800 dark:border-gray-300">
        {footer}
      </div>
    )}
  </aside>
);
