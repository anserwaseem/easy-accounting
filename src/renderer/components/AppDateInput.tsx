import { useMemo, useState } from 'react';
import type { FC } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Calendar } from '@/renderer/shad/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/renderer/shad/ui/popover';
import { cn } from '@/renderer/lib/utils';
import { formatDisplayDate, parseStoredDate } from '@/lib/displayDate';
import { toLocalDateInputValue } from '@/renderer/lib/localDate';

interface AppDateInputProps {
  id?: string;
  /** the stored value: a bare 'YYYY-MM-DD' day */
  value: string;
  /** called with a bare 'YYYY-MM-DD' day */
  onChange: (value: string) => void;
  /** earliest selectable day, as a bare 'YYYY-MM-DD' */
  min?: string;
  /** latest selectable day, as a bare 'YYYY-MM-DD' */
  max?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
}

/**
 * A date input that shows the app-wide display format ('03 Feb, 2026') instead
 * of the browser-native one, which the OS decides and no CSS or JS can change.
 *
 * The value stays a bare 'YYYY-MM-DD' day because that is what the callers
 * store and validate against (agent_tours, stock_adjustments). The day is
 * built from its parts rather than parsed with `new Date()`, which would read
 * it as UTC midnight and shift a day west of UTC.
 */
export const AppDateInput: FC<AppDateInputProps> = ({
  id,
  value,
  onChange,
  min,
  max,
  className,
  placeholder = 'Pick a date',
  disabled,
  required,
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => parseStoredDate(value), [value]);

  const disabledMatcher = useMemo(() => {
    const minDate = min ? parseStoredDate(min) : null;
    const maxDate = max ? parseStoredDate(max) : null;
    if (!minDate && !maxDate) return undefined;
    return (day: Date) => {
      if (minDate && day < minDate) return true;
      if (maxDate && day > maxDate) return true;
      return false;
    };
  }, [min, max]);

  const handleSelect = (day: Date | undefined) => {
    setOpen(false);
    if (!day) return;
    onChange(toLocalDateInputValue(day));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-required={required}
          disabled={disabled}
          className={cn(
            'w-full justify-start text-left font-normal min-w-0',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {selected ? formatDisplayDate(selected) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected ?? undefined}
          onSelect={handleSelect}
          disabled={disabledMatcher}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
};
