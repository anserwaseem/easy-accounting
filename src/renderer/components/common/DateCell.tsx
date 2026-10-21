import type { FC } from 'react';
import { displayDateTitle, formatDisplayDate } from '@/lib/displayDate';

interface DateCellProps {
  /** the stored date: a bare 'YYYY-MM-DD' day, a localtime timestamp, or a local-noon ISO string */
  value: string | Date | null | undefined;
  /** shown when there is no date to display */
  fallback?: string;
}

/**
 * A date cell in a table.
 *
 * Shows the app-wide date format ('03 Feb, 2026') and carries the full
 * date with hour and minute as its `title`, so the exact time is one hover
 * away without widening the column. The hover text and the cell text come
 * from the same place (`src/lib/displayDate.ts`), so they cannot drift.
 */
export const DateCell: FC<DateCellProps> = ({ value, fallback = '' }) => (
  <span title={displayDateTitle(value)}>
    {value ? formatDisplayDate(value) : fallback}
  </span>
);
