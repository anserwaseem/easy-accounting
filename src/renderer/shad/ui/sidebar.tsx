import { cn } from 'renderer/lib/utils';

interface SidebarProps {
  title?: React.ReactNode;
  items?: React.ReactNode[];
  position?: 'left' | 'right';
  className?: string;
  titleClassName?: string;
  itemsClassName?: string;
  itemClassName?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  title,
  items,
  position = 'left',
  className,
  titleClassName,
  itemsClassName,
  itemClassName,
}) => (
  <aside
    className={cn(
      `flex overflow-y-auto bg-gray-800 text-white justify-between ${
        position === 'right' ? 'order-1' : ''
      }`,
      className,
    )}
  >
    <div className={itemsClassName}>
      {title && (
        <div
          className={cn(
            'flex items-center justify-center w-full border-b h-20 mb-2 pt-4',
            titleClassName,
          )}
        >
          {title}
        </div>
      )}
      {items?.map((item, idx) => (
        <div
          key={idx}
          className={cn('flex items-center justify-center mb-2', itemClassName)}
        >
          {item}
        </div>
      ))}
    </div>
  </aside>
);
