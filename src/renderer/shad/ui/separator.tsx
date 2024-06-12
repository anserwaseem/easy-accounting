import { forwardRef } from 'react';
import { Root } from '@radix-ui/react-separator';

import { cn } from 'renderer/lib/utils';

interface SeparatorProps extends React.ComponentPropsWithoutRef<typeof Root> {
  height?: number;
  width?: number;
}

const Separator = forwardRef<React.ElementRef<typeof Root>, SeparatorProps>(
  (
    {
      className,
      orientation = 'horizontal',
      decorative = true,
      height,
      width,
      ...props
    },
    ref,
  ) => (
    <Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal'
          ? `h-[${height || 1}px] w-${width ? `[${width}px]` : 'full'}`
          : `w-[${width || 1}px] h-${height ? `[${height}px]` : 'full'}`,
        className,
      )}
      {...props}
    />
  ),
);
Separator.displayName = Root.displayName;

export { Separator };
