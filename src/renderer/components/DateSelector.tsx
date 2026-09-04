import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Calendar } from '@/renderer/shad/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/renderer/shad/ui/popover';
import { cn } from '@/renderer/lib/utils';

interface DateSelectorProps {
  id?: string;
  value: string;
  onSelect: (date?: Date) => void;
  className?: string;
}

/** invoice-style calendar picker: displays PPP, stores via caller (local-noon ISO). */
export const DateSelector: React.FC<DateSelectorProps> = ({
  id,
  value,
  onSelect,
  className,
}: DateSelectorProps) => {
  const selected = value ? new Date(value) : undefined;
  const isValid = selected != null && !Number.isNaN(selected.getTime());

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal min-w-0',
            !isValid && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {isValid && selected ? (
            format(selected, 'PPP')
          ) : (
            <span>Pick a date</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={isValid && selected ? selected : undefined}
          onSelect={onSelect}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
};
