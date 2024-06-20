import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, addMonths, addYears, format } from 'date-fns';
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
  { label: 'This Week', value: '-7' },
  { label: 'This Month', value: '-30' },
  { label: 'This Year', value: '-365' },
];

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
    const numberVal = toNumber(value);

    setSelectValue(value);

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
  }, []);

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
              {presets.concat(DEFAULT_PRESETS).map((preset) => (
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
