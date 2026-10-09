export interface JournalDiscountLine {
  discount: number;
  isNetRate?: boolean;
}

/**
 * journal percent box.
 * untyped lines share one profile percent and none are typed → that percent.
 * they share one percent and at least one line is typed → `N·percent`.
 * every line is typed → `N`.
 * untyped lines do not share one percent → blank.
 */
export const journalDiscountLabel = (
  lines: JournalDiscountLine[],
): number | string | undefined => {
  if (lines.length === 0) return undefined;

  const hasNet = lines.some((line) => line.isNetRate);
  const profilePercents = [
    ...new Set(
      lines
        .filter((line) => !line.isNetRate)
        .map((line) => Number(line.discount) || 0),
    ),
  ];

  if (profilePercents.length === 0) return hasNet ? 'N' : undefined;
  if (profilePercents.length !== 1) return undefined;

  const percent = profilePercents[0];
  if (hasNet) return `N·${percent}`;
  return percent;
};

/** `20` → `20%`. `N` stays `N`. `N·20` → `N · 20%`. empty → `-`. */
export const formatJournalDiscountLabel = (
  value: number | string | null | undefined,
): string => {
  if (value == null || value === '' || value === '-') return '-';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `${value}%` : '-';
  }
  const text = value.trim();
  if (text === 'N') return 'N';
  const marked = /^(?:N\$|N·)(\d+(?:\.\d+)?)$/.exec(text);
  if (marked) return `N · ${marked[1]}%`;
  const numeric = Number(text.replace(/%$/, ''));
  if (text !== '' && Number.isFinite(numeric)) return `${numeric}%`;
  return text;
};

/** number, `N`, or `N$20`. a blank or unreadable value is unset. */
export const parseJournalDiscountInput = (
  raw: string,
): number | string | undefined => {
  const text = raw.trim();
  if (text === '') return undefined;
  if (text === 'N' || /^(?:N\$|N·)\d+(\.\d+)?$/.test(text)) return text;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;
  return undefined;
};

/** profile percent inside a label, for the bills-aging "at least N%" filter. `N` alone has none. */
export const profilePercentFromJournalLabel = (
  value: number | string | null | undefined,
): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text === '-' || text === 'N') return null;
  const marked = /^(?:N\$|N·)(.+)$/.exec(text);
  const raw = marked ? marked[1] : text.replace(/%$/, '');
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
};
