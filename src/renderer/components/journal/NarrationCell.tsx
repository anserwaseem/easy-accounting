import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Journal, LedgerView } from '@/types';

/**
 * Extracts a journal ID from the particulars text
 */
export const extractJournalId = (particulars: string): number | null => {
  const match = particulars.match(/Journal #(\d+)/);
  return match ? parseInt(match[1], 10) : null;
};

interface NarrationCellProps {
  particulars: string;
  printMode?: boolean;
}

/**
 * Displays a journal narration with a link to the journal
 */
export const NarrationCell = ({
  particulars,
  printMode = false,
}: NarrationCellProps) => {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [loading, setLoading] = useState(false);
  const journalId = extractJournalId(particulars);

  useEffect(() => {
    const fetchJournal = async () => {
      if (!journalId) return;

      setLoading(true);
      try {
        const journalData = await window.electron.getJournal(journalId);
        setJournal(journalData);
      } catch (error) {
        console.error('Error fetching journal:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchJournal();
  }, [journalId]);

  if (!journalId) return null;

  if (loading) return <span>Loading...</span>;

  return (
    <Link
      to={`/journals/${journalId}`}
      className={`text-blue-600 hover:underline ${
        printMode ? 'print:text-black print:no-underline' : ''
      }`}
    >
      {journal?.narration ? journal.narration : `View Journal #${journalId}`}
    </Link>
  );
};

/**
 * Helper function to render a NarrationCell in a DataTable
 */
export const renderJournalCell = (
  info: { row: { original: LedgerView } },
  printMode = false,
) => (
  <NarrationCell
    particulars={info.row.original.particulars}
    printMode={printMode}
  />
);
