import type { JournalNarrationSummary } from '../../types';
import { extractJournalIdFromParticulars } from '../../shared/journalParticulars';
import type { JournalService } from '../services/JournalService';

/** attaches journalSummary for rows whose particulars reference Journal #id (single batch query). */
export const enrichLedgerRowsWithJournalSummaries = async <
  T extends { particulars: string },
>(
  rows: T[],
  journalService: JournalService,
): Promise<Array<T & { journalSummary?: JournalNarrationSummary | null }>> => {
  const ids: number[] = [];
  for (const row of rows) {
    const id = extractJournalIdFromParticulars(row.particulars);
    if (id != null) ids.push(id);
  }
  const summaries =
    ids.length > 0
      ? await journalService.getJournalNarrationSummariesByIds(ids)
      : {};

  return rows.map((row) => {
    const jid = extractJournalIdFromParticulars(row.particulars);
    if (jid == null) {
      return { ...row };
    }
    return {
      ...row,
      journalSummary: summaries[jid] ?? null,
    };
  });
};
