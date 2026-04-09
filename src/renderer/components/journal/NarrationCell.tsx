/* eslint-disable react/prop-types -- props fully typed via Narration*Props interfaces */
import { memo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Journal, JournalNarrationSummary, LedgerView } from '@/types';
import { extractJournalIdFromParticulars } from '@/shared/journalParticulars';

interface NarrationCellProps {
  particulars: string;
  printMode?: boolean;
  /** batch-loaded on main for ledger / reports — avoids per-row getJournal IPC */
  journalSummary?: JournalNarrationSummary | null;
}

interface NarrationPrefetchedProps {
  particulars: string;
  printMode?: boolean;
  journalSummary: JournalNarrationSummary | null;
}

/** no hooks — cheap to mount inside virtualized ledger rows */
const NarrationPrefetchedInner: React.FC<NarrationPrefetchedProps> = (
  props,
) => {
  const { particulars, printMode = false, journalSummary } = props;
  const journalId = extractJournalIdFromParticulars(particulars);
  if (!journalId) return null;

  const linkLabel = journalSummary?.narration || `View Journal #${journalId}`;
  const billNumber = journalSummary?.billNumber;
  const discountPercentage = journalSummary?.discountPercentage;

  return (
    <div className="space-y-1">
      <Link
        to={`/journals/${journalId}`}
        className={`text-blue-600 hover:underline block ${
          printMode ? 'print:text-black print:no-underline' : ''
        }`}
      >
        {linkLabel}
      </Link>
      {(billNumber || discountPercentage) && (
        <div className="text-xs text-muted-foreground space-y-1">
          {billNumber ? <div>Bill#: {billNumber}</div> : null}
          {discountPercentage ? (
            <div>Discount: {discountPercentage}%</div>
          ) : null}
        </div>
      )}
    </div>
  );
};

const NarrationPrefetched = memo(NarrationPrefetchedInner);
NarrationPrefetched.displayName = 'NarrationPrefetched';

interface NarrationFetchedProps {
  particulars: string;
  printMode?: boolean;
}

const NarrationFetchedInner: React.FC<NarrationFetchedProps> = (props) => {
  const { particulars, printMode = false } = props;
  const [journal, setJournal] = useState<Journal | null>(null);
  const [loading, setLoading] = useState(false);
  const journalId = extractJournalIdFromParticulars(particulars);

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

  const linkLabel = journal?.narration || `View Journal #${journalId}`;
  const billNumber = journal?.billNumber;
  const discountPercentage = journal?.discountPercentage;

  return (
    <div className="space-y-1">
      <Link
        to={`/journals/${journalId}`}
        className={`text-blue-600 hover:underline block ${
          printMode ? 'print:text-black print:no-underline' : ''
        }`}
      >
        {linkLabel}
      </Link>
      {(billNumber || discountPercentage) && (
        <div className="text-xs text-muted-foreground space-y-1">
          {billNumber ? <div>Bill#: {billNumber}</div> : null}
          {discountPercentage ? (
            <div>Discount: {discountPercentage}%</div>
          ) : null}
        </div>
      )}
    </div>
  );
};

const NarrationFetched = memo(NarrationFetchedInner);
NarrationFetched.displayName = 'NarrationFetched';

/**
 * Displays a journal narration with a link to the journal
 */
export const NarrationCell: React.FC<NarrationCellProps> = (props) => {
  const { particulars, printMode = false, journalSummary } = props;
  if (journalSummary !== undefined) {
    return (
      <NarrationPrefetched
        particulars={particulars}
        printMode={printMode}
        journalSummary={journalSummary}
      />
    );
  }
  return <NarrationFetched particulars={particulars} printMode={printMode} />;
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
    journalSummary={info.row.original.journalSummary}
  />
);
