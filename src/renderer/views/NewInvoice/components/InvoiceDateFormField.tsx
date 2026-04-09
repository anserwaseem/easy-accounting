import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import type {
  ControllerRenderProps,
  FieldPath,
  FieldValues,
} from 'react-hook-form';
import { Button } from 'renderer/shad/ui/button';
import { Calendar } from 'renderer/shad/ui/calendar';
import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
} from 'renderer/shad/ui/form';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'renderer/shad/ui/popover';

interface InvoiceDateFormFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  field: ControllerRenderProps<TFieldValues, TName>;
  onDateSelection: (date?: Date) => void;
  formItemClassName?: string;
  buttonClassName: string;
  calendarIconClassName?: string;
}

/** FormControl wraps the trigger button so field.ref targets a focusable control for setFocus('date') */
export const InvoiceDateFormField = <
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  field,
  onDateSelection,
  formItemClassName,
  buttonClassName,
  calendarIconClassName = 'mr-2 h-4 w-4 shrink-0',
}: InvoiceDateFormFieldProps<TFieldValues, TName>) => (
  <FormItem labelPosition="top" className={formItemClassName}>
    <FormLabel className="text-base">
      Date
      <span className="text-destructive"> *</span>
    </FormLabel>
    <Popover>
      <PopoverTrigger asChild>
        <FormControl>
          <Button
            type="button"
            variant="outline"
            ref={field.ref}
            onBlur={field.onBlur}
            name={field.name}
            className={buttonClassName}
          >
            <CalendarIcon className={calendarIconClassName} />
            {field.value ? (
              format(new Date(field.value as string), 'PPP')
            ) : (
              <span>Pick a date</span>
            )}
          </Button>
        </FormControl>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={field.value ? new Date(field.value as string) : undefined}
          onSelect={onDateSelection}
          initialFocus
        />
      </PopoverContent>
    </Popover>
    <FormMessage />
  </FormItem>
);
