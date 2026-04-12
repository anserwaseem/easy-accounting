import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type TooltipContentProps,
} from '@/renderer/shad/ui/tooltip';

interface FileUploadTooltipProps {
  children: React.ReactElement;
  content: string;
  side?: TooltipContentProps['side'];
}

/** wraps upload trigger; requires TooltipProvider ancestor (e.g. Sidebar layout) */
export const FileUploadTooltip: React.FC<FileUploadTooltipProps> = ({
  children,
  content,
  side = 'top',
}: FileUploadTooltipProps) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side={side} className="max-w-xs">
      <p className="whitespace-pre-line text-xs leading-relaxed">{content}</p>
    </TooltipContent>
  </Tooltip>
);
