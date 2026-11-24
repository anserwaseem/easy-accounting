import { useCallback, useMemo, useState } from 'react';
import { addDays } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { DateRange } from 'react-day-picker';

import { cn } from 'renderer/lib/utils';

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from 'renderer/shad/ui/popover';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from 'renderer/shad/ui/select';
import { Button } from 'renderer/shad/ui/button';
import { Calendar } from 'renderer/shad/ui/calendar';
import { useMountEffect } from '@/renderer/hooks/useMountEffect';
import { useIsMobile } from '@/renderer/hooks/useIsMobile';
import { formatDisplayDate } from '@/lib/displayDate';
import {
  getDateRangePresetLabel,
  mergeDateRangePresets,
  resolveDateRangePreset,
} from '@/renderer/lib/dateRangePresets';

/**
 * A range picker shows two months side by side on desktop. On a phone
 * that is ~570px of calendar in a 390px viewport, so it must collapse to
 * a single month there. `useIsMobile` matches Tailwind's `md` breakpoint
 * (768px) — the same threshold the app shell uses.
 */
const useRangeMonthCount = (): 1 | 2 => (useIsMobile() ? 1 : 2);

export const DatePicker: React.FC = () => {
  const [date, setDate] = useState<Date>();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal sm:w-[280px]',
            !date && 'text-muted-foreground',
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? formatDisplayDate(date) : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={date}
          onSelect={setDate}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
};

export const DatePickerWithPresets: React.FC = () => {
  const [date, setDate] = useState<Date | undefined>(undefined);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal sm:w-[280px]',
            !date && 'text-muted-foreground',
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? formatDisplayDate(date) : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-auto flex-col space-y-2 p-2">
        <Select
          onValueChange={(value) =>
            setDate(addDays(new Date(), parseInt(value, 10)))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="0">Today</SelectItem>
            <SelectItem value="1">Tomorrow</SelectItem>
            <SelectItem value="3">In 3 days</SelectItem>
            <SelectItem value="7">In a week</SelectItem>
          </SelectContent>
        </Select>
        <div className="rounded-md border">
          <Calendar mode="single" selected={date} onSelect={setDate} />
        </div>
      </PopoverContent>
    </Popover>
  );
};

interface DateRangePickerProps extends React.HTMLAttributes<HTMLDivElement> {
  $onSelect?: (date?: DateRange, selectValue?: string) => void;
  presets?: { label: string; value: string }[];
  initialRange?: DateRange;
  initialSelectValue?: string;
  /**
   * Classes for the trigger button. Used to squeeze the picker into
   * the space left over on a header row: the button shrinks and its
   * label truncates instead of pushing the rest of the header off the
   * screen.
   */
  triggerClassName?: string;
}

export const DateRangePicker: React.FC<Partial<DateRangePickerProps>> = ({
  className,
  initialRange,
}: Partial<DateRangePickerProps>) => {
  const [date, setDate] = useState<DateRange | undefined>(initialRange);

  const dateDisplay = useMemo(() => {
    if (!date?.from) return <span>Pick a date</span>;
    if (!date?.to) return formatDisplayDate(date.from);
    return (
      <>
        {formatDisplayDate(date.from)} - {formatDisplayDate(date.to)}
      </>
    );
  }, [date]);

  return (
    <div className={cn('grid gap-2', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant="outline"
            className={cn(
              'w-full justify-start text-left font-normal sm:w-[300px]',
              !date && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {dateDisplay}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={setDate}
            numberOfMonths={useRangeMonthCount()}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};

export const DateRangePickerWithPresets: React.FC<DateRangePickerProps> = ({
  className,
  $onSelect,
  presets = [],
  initialRange,
  initialSelectValue,
  triggerClassName,
}: DateRangePickerProps) => {
  const [date, setDate] = useState<DateRange | undefined>(initialRange);
  const [selectValue, setSelectValue] = useState<string | undefined>(
    initialSelectValue,
  );
  const rangeMonthCount = useRangeMonthCount();
  const allPresets = useMemo(() => mergeDateRangePresets(presets), [presets]);

  useMountEffect(() => {
    $onSelect?.(date, selectValue);
  });

  const getSelectLabel = useCallback(() => {
    const presetLabel = getDateRangePresetLabel(selectValue, presets);
    if (presetLabel) return presetLabel;

    if (date?.from && date.to)
      return `${formatDisplayDate(date.from)} - ${formatDisplayDate(date.to)}`;

    if (date?.from) return formatDisplayDate(date.from);

    return 'Pick a date';
  }, [date?.from, date?.to, presets, selectValue]);

  const onValueChange = useCallback(
    (value: string) => {
      const nextDate = resolveDateRangePreset(value);
      setSelectValue(value);
      setDate(nextDate);
      $onSelect?.(nextDate, value);
    },
    [$onSelect],
  );

  return (
    <div className={cn('grid gap-2', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant="outline"
            className={cn(
              'w-auto justify-start text-left font-normal',
              !date && 'text-muted-foreground',
              triggerClassName,
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            <span className="truncate">{getSelectLabel()}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-auto flex-col space-y-2 p-2">
          <Select value={selectValue} onValueChange={onValueChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[70]">
              {allPresets.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="rounded-md border">
            <Calendar
              mode="range"
              defaultMonth={date?.from}
              selected={date}
              onSelect={(selectedDate) => {
                setDate(selectedDate);
                setSelectValue('');
                $onSelect?.(selectedDate, '');
              }}
              numberOfMonths={rangeMonthCount}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export { type DateRange };
