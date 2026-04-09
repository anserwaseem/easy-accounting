/** parses journal id from ledger line particulars (same pattern as ledger rebuild logic) */
export const extractJournalIdFromParticulars = (
  particulars: string,
): number | null => {
  const match = particulars.match(/Journal #(\d+)/);
  return match ? parseInt(match[1], 10) : null;
};
