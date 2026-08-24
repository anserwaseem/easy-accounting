import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  addYears,
  format,
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
import { Input } from 'renderer/shad/ui/input';
import { Calendar } from 'renderer/shad/ui/calendar';
import { toNumber, isNaN } from 'lodash';

export const DatePicker: React.FC = () => {
  const [date, setDate] = useState<Date>();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-[280px] justify-start text-left font-normal',
            !date && 'text-muted-foreground',
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, 'PPP') : <span>Pick a date</span>}
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
            'w-[280px] justify-start text-left font-normal',
            !date && 'text-muted-foreground',
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, 'PPP') : <span>Pick a date</span>}
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
}

export const DateRangePicker: React.FC<Partial<DateRangePickerProps>> = ({
  className,
  initialRange,
}: Partial<DateRangePickerProps>) => {
  const [date, setDate] = useState<DateRange | undefined>(initialRange);

  const dateDisplay = useMemo(() => {
    if (!date?.from) return <span>Pick a date</span>;
    if (!date?.to) return format(date.from, 'LLL dd, y');
    return (
      <>
        {format(date.from, 'LLL dd, y')} - {format(date.to, 'LLL dd, y')}
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
              'w-[300px] justify-start text-left font-normal',
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
            numberOfMonths={2}
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
  { label: 'Current Month', value: 'current-month' },
  { label: 'Current Year', value: 'current-year' },
  { label: 'Last Month', value: 'last-month' },
  { label: 'Last Year', value: 'last-year' },
  { label: 'Last 2 Years', value: 'last-2-years' },
  { label: 'Last 3 Years', value: 'last-3-years' },
  { label: 'Last 5 Years', value: 'last-5-years' },
];

/** rolling window of whole years back from today, e.g. 'last-2-years' */
const LAST_N_YEARS_PATTERN = /^last-(\d+)-years$/;

export const MAX_LAST_N_YEARS = 100;

/** builds the preset value for a custom "last N years" selection */
export const getLastNYearsPresetValue = (years: number) =>
  `last-${years}-years`;

/** reads N back out of a "last N years" preset value (null when it isn't one) */
export const parseLastNYearsPresetValue = (value?: string): number | null => {
  const match = value ? LAST_N_YEARS_PATTERN.exec(value) : null;
  if (!match) return null;

  const years = toNumber(match[1]);
  if (isNaN(years) || years < 1 || years > MAX_LAST_N_YEARS) return null;

  return years;
};

/** Merge presets: defaults + extras, removing duplicate values (prefers custom label) */
const mergePresets = (
  customPresets: { label: string; value: string }[],
  selectValue?: string,
): { label: string; value: string }[] => {
  const map = new Map<string, { label: string; value: string }>();
  for (const p of DEFAULT_PRESETS) map.set(p.value, p);
  for (const p of customPresets) map.set(p.value, p);

  // keep an ad-hoc "last N years" pick (e.g. last 7 years) selectable/labelled in the list
  const customYears = parseLastNYearsPresetValue(selectValue);
  if (customYears && selectValue && !map.has(selectValue)) {
    map.set(selectValue, {
      label: `Last ${customYears} Years`,
      value: selectValue,
    });
  }

  return Array.from(map.values());
};

export const DateRangePickerWithPresets: React.FC<DateRangePickerProps> = ({
  className,
  $onSelect,
  presets = [],
  initialRange,
  initialSelectValue,
}: DateRangePickerProps) => {
  const [date, setDate] = useState<DateRange | undefined>(initialRange);
  const [selectValue, setSelectValue] = useState<string | undefined>(
    initialSelectValue,
  );
  const [customYearsInput, setCustomYearsInput] = useState('');

  useEffect(
    () => $onSelect?.(date, selectValue),
    [$onSelect, date, selectValue],
  );

  const getSelectLabel = useCallback(() => {
    if (selectValue && presets.some((preset) => preset.value === selectValue))
      return presets.find((preset) => preset.value === selectValue)?.label;

    if (date?.from && date.to)
      return `${format(date.from, 'LLL dd, y')} - ${format(
        date.to,
        'LLL dd, y',
      )}`;

    if (date?.from) return format(date.from, 'LLL dd, y');

    return 'Pick a date';
  }, [date?.from, date?.to, presets, selectValue]);

  const onValueChange = useCallback((value: string) => {
    setSelectValue(value);

    const lastNYears = parseLastNYearsPresetValue(value);

    if (value === 'all') {
      setDate({ from: subYears(new Date(), 100), to: new Date() });
    } else if (value === 'current-month') {
      setDate({
        from: startOfMonth(new Date()),
        to: new Date(),
      });
    } else if (value === 'current-year') {
      setDate({
        from: startOfYear(new Date()),
        to: new Date(),
      });
    } else if (value === 'last-year') {
      const lastYear = subYears(new Date(), 1);
      setDate({
        from: startOfYear(lastYear),
        to: endOfYear(lastYear),
      });
    } else if (value === 'last-month') {
      const lastMonth = subMonths(new Date(), 1);
      setDate({
        from: startOfMonth(lastMonth),
        to: endOfMonth(lastMonth),
      });
    } else if (lastNYears) {
      // rolling window: N whole years back from today up to today
      setDate({
        from: subYears(new Date(), lastNYears),
        to: new Date(),
      });
    } else {
      const numberVal = toNumber(value);

      if (isNaN(numberVal)) setDate(undefined);
      else if (numberVal === 0) setDate({ from: new Date(), to: new Date() });
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
        setDate({
          from: fromDate,
          to: new Date(),
        });
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
        setDate({
          from: new Date(),
          to: toDate,
        });
      }
    }
  }, []);

  const customYears = toNumber(customYearsInput);
  const canApplyCustomYears =
    !!customYearsInput.trim() &&
    !isNaN(customYears) &&
    Number.isInteger(customYears) &&
    customYears >= 1 &&
    customYears <= MAX_LAST_N_YEARS;

  const applyCustomYears = useCallback(() => {
    if (!canApplyCustomYears) return;
    onValueChange(getLastNYearsPresetValue(customYears));
  }, [canApplyCustomYears, customYears, onValueChange]);

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
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            <span>{getSelectLabel()}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-auto flex-col space-y-2 p-2">
          <Select value={selectValue} onValueChange={onValueChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent position="popper">
              {mergePresets(presets, selectValue).map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-sm text-muted-foreground">
              Last
            </span>
            <Input
              type="number"
              min={1}
              max={MAX_LAST_N_YEARS}
              step={1}
              value={customYearsInput}
              onChange={(event) => setCustomYearsInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                applyCustomYears();
              }}
              placeholder="N"
              aria-label={`Last N years (1-${MAX_LAST_N_YEARS})`}
              className="my-0 h-9 w-20"
            />
            <span className="whitespace-nowrap text-sm text-muted-foreground">
              years
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={applyCustomYears}
              disabled={!canApplyCustomYears}
            >
              Apply
            </Button>
          </div>
          <div className="rounded-md border">
            <Calendar
              mode="range"
              defaultMonth={date?.from}
              selected={date}
              onSelect={(selectedDate) => {
                setDate(selectedDate);
                setSelectValue('');
              }}
              numberOfMonths={2}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export { type DateRange };
