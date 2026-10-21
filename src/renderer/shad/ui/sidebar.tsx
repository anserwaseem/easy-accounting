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
  /**
   * Bubbles clicks anywhere in the sidebar (nav links included) up to the
   * caller — used on mobile to close the off-canvas overlay when a nav link
   * is followed, without threading a close callback through every item.
   */
  onClick?: React.MouseEventHandler<HTMLElement>;
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
  onClick,
}: SidebarProps) => (
  // Delegated click-bubbling only (used to detect a click landing on one of
  // the interactive nav links/buttons rendered inside — see `onClick`'s doc
  // comment above); those children already carry their own keyboard
  // handling, so this wrapper itself needs none.
  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
  <aside
    onClick={onClick}
    className={cn(
      // Was bg-gray-200 in both themes: a light slab in a light app and a
      // hard grey slab in a dark one. The nav is now a real surface
      // (card-colored) with a hairline border, so it reads as a panel
      // rather than a different app.
      'flex flex-col bg-card text-card-foreground border-r transition-all duration-200',
      position === 'right' ? 'order-1' : '',
      collapsed ? 'w-14' : 'w-[260px]',
      className,
    )}
  >
    {/* header */}
    {title && (
      <div className={cn('flex-shrink-0 bg-card border-b', titleClassName)}>
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
    {footer && <div className="flex-shrink-0 border-t">{footer}</div>}
  </aside>
);
