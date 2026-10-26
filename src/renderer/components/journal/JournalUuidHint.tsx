import type { ReactElement } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/renderer/shad/ui/tooltip';

interface JournalUuidHintProps {
  uuid?: string;
  children: ReactElement;
}

/** hover or focus on the child shows the journal uuid. the integer id is local. */
export const JournalUuidHint: React.FC<JournalUuidHintProps> = ({
  uuid,
  children,
}: JournalUuidHintProps) => {
  if (!uuid) return children;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>
          <p className="font-mono text-xs">{uuid}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
