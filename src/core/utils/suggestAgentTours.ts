import { addDays, format, parseISO, startOfMonth } from 'date-fns';
import { sortBy } from 'lodash';
import type { AgentTour, SuggestedAgentTour } from '../../types';

/** a manual journal crediting at least this many accounts of one head is a tour's settlement */
export const BULK_RECEIPT_MIN_CREDIT_LINES = 5;

export interface BulkReceiptDay {
  /** local calendar day, yyyy-MM-dd */
  day: string;
  /** first bulk journal booked on that day */
  journalId: number;
  /** distinct head accounts credited by bulk journals that day */
  creditLines: number;
}

const OPEN_END = '9999-12-31';

/** inclusive yyyy-MM-dd ranges; a null end runs forever */
export const toursOverlap = (
  a: Pick<AgentTour, 'startDate' | 'endDate'>,
  b: Pick<AgentTour, 'startDate' | 'endDate'>,
): boolean =>
  a.startDate <= (b.endDate ?? OPEN_END) &&
  b.startDate <= (a.endDate ?? OPEN_END);

/**
 * the part of a tour inside a sheet range, as the columns count it.
 * a running tour keeps a null end unless the range ends before today.
 */
export const clipTourToRange = <
  T extends Pick<AgentTour, 'startDate' | 'endDate'>,
>(
  tour: T,
  from: string,
  to: string,
  today: string,
): T & { clipped: boolean } => {
  const startDate = tour.startDate < from ? from : tour.startDate;
  const effectiveEnd = tour.endDate ?? today;
  let { endDate } = tour;
  if (effectiveEnd > to) endDate = to;
  return {
    ...tour,
    startDate,
    endDate,
    clipped: startDate !== tour.startDate || endDate !== tour.endDate,
  };
};

const shiftDay = (day: string, amount: number): string =>
  format(addDays(parseISO(day), amount), 'yyyy-MM-dd');

/**
 * one tour per bulk receipt day: from the day after the previous one to this one.
 * the first window has no predecessor, so it starts on the first of its month.
 * windows that touch an already-saved tour are dropped, the rest are left for review.
 */
export const suggestAgentTours = (
  chartId: number,
  bulkDays: BulkReceiptDay[],
  existing: Pick<AgentTour, 'startDate' | 'endDate'>[],
): SuggestedAgentTour[] => {
  const days = sortBy(bulkDays, 'day');
  const names = new Map<string, number>();
  const suggestions: SuggestedAgentTour[] = [];

  days.forEach((bulk, index) => {
    const startDate =
      index === 0
        ? format(startOfMonth(parseISO(bulk.day)), 'yyyy-MM-dd')
        : shiftDay(days[index - 1].day, 1);
    const window = { startDate, endDate: bulk.day };
    if (existing.some((tour) => toursOverlap(tour, window))) return;

    const month = format(parseISO(bulk.day), 'MMM yyyy');
    const seen = (names.get(month) ?? 0) + 1;
    names.set(month, seen);
    suggestions.push({
      chartId,
      name: seen === 1 ? month : `${month} (${seen})`,
      ...window,
      journalId: bulk.journalId,
      creditLines: bulk.creditLines,
    });
  });

  return suggestions;
};
