import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'renderer/shad/ui/tooltip';

export const DateHeader = () => (
  <div className="flex items-center gap-1">
    <span>Date</span>
    <span className="hidden print:block text-[6px] text-muted-foreground mb-auto">
      (MM/DD/YYYY)
    </span>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="h-3 w-3 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>
          <p>Date format: MM/DD/YYYY</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
);
