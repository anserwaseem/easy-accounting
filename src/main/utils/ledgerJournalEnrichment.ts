/**
 * Ledger/journal enrichment moved to the platform-free core
 * (src/core/utils/ledgerJournalEnrichment.ts) so it can be typed against the
 * core JournalService. This module stays as a re-export so existing
 * main-process imports keep working during the migration.
 */
export { enrichLedgerRowsWithJournalSummaries } from '../../core/utils/ledgerJournalEnrichment';
