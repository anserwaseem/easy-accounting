import { useCallback, useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  addYears,
  startOfMonth,
  startOfYear,
  endOfYear,
  endOfMonth,
  subYears,
  subMonths,
} from 'date-fns';
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
import { toNumber, isNaN } from 'lodash';
import { useMountEffect } from '@/renderer/hooks/useMountEffect';
import { useIsMobile } from '@/renderer/hooks/useIsMobile';
import { formatDisplayDate } from '@/lib/displayDate';

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

const DEFAULT_PRESETS = [
  { label: 'Today', value: '0' },
  { label: 'Yesterday', value: '-1' },
  { label: 'Last 7 Days', value: '-7' },
  { label: 'Last 30 Days', value: '-30' },
  { label: 'Last 365 Days', value: '-365' },
  { label: 'Last 2 Years', value: 'last-2-years' },
  { label: 'Current Month', value: 'current-month' },
  { label: 'Current Year', value: 'current-year' },
  { label: 'Last Month', value: 'last-month' },
  { label: 'Last Year', value: 'last-year' },
];

/** Merge presets: defaults + extras, removing duplicate values (prefers custom label) */
const mergePresets = (
  customPresets: { label: string; value: string }[],
): { label: string; value: string }[] => {
  const map = new Map<string, { label: string; value: string }>();
  for (const p of DEFAULT_PRESETS) map.set(p.value, p);
  for (const p of customPresets) map.set(p.value, p);
  return Array.from(map.values());
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
  useMountEffect(() => {
    $onSelect?.(date, selectValue);
  });

  const getSelectLabel = useCallback(() => {
    if (selectValue && presets.some((preset) => preset.value === selectValue))
      return presets.find((preset) => preset.value === selectValue)?.label;

    if (date?.from && date.to)
      return `${formatDisplayDate(date.from)} - ${formatDisplayDate(date.to)}`;

    if (date?.from) return formatDisplayDate(date.from);

    return 'Pick a date';
  }, [date?.from, date?.to, presets, selectValue]);

  const onValueChange = useCallback(
    (value: string) => {
      let nextDate: DateRange | undefined;
      if (value === 'all') {
        nextDate = { from: subYears(new Date(), 100), to: new Date() };
      } else if (value === 'current-month') {
        nextDate = {
          from: startOfMonth(new Date()),
          to: new Date(),
        };
      } else if (value === 'current-year') {
        nextDate = {
          from: startOfYear(new Date()),
          to: new Date(),
        };
      } else if (value === 'last-year') {
        const lastYear = subYears(new Date(), 1);
        nextDate = {
          from: startOfYear(lastYear),
          to: endOfYear(lastYear),
        };
      } else if (value === 'last-month') {
        const lastMonth = subMonths(new Date(), 1);
        nextDate = {
          from: startOfMonth(lastMonth),
          to: endOfMonth(lastMonth),
        };
      } else if (value === 'last-2-years') {
        // rolling window: two whole years back from today up to today
        nextDate = {
          from: subYears(new Date(), 2),
          to: new Date(),
        };
      } else {
        const numberVal = toNumber(value);

        if (isNaN(numberVal)) nextDate = undefined;
        else if (numberVal === 0)
          nextDate = { from: new Date(), to: new Date() };
        else if (numberVal < 0) {
          let fromDate;
          switch (numberVal) {
            case -30:
              fromDate = addMonths(new Date(), -1);
              break;
            case -365:
              fromDate = addYears(new Date(), -1);
              break;
            default:
              fromDate = addDays(new Date(), numberVal);
              break;
          }
          nextDate = {
            from: fromDate,
            to: new Date(),
          };
        } else {
          let toDate;
          switch (numberVal) {
            case 30:
              toDate = addMonths(new Date(), 1);
              break;
            case 365:
              toDate = addYears(new Date(), 1);
              break;
            default:
              toDate = addDays(new Date(), numberVal);
              break;
          }
          nextDate = {
            from: new Date(),
            to: toDate,
          };
        }
      }
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
              {mergePresets(presets).map((preset) => (
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
