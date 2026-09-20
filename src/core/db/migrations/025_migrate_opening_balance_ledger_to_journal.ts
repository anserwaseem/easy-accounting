import type { DatabaseDriver } from '../driver';
import { backfillOpeningBalanceJournals } from '../openingBalanceBackfill';

/**
 * Backfill `journal` + `journal_entry` for pre-cutover
 * "Opening Balance from B/S" ledger rows. Delegates to
 * {@link backfillOpeningBalanceJournals} (same SQL, same idempotency
 * guard). Import calls that function too — destination bookkeeping already
 * claims this name applied against an empty DB, so import must re-run the
 * backfill against uploaded rows.
 */
export const migration025 = {
  name: '025_migrate_opening_balance_ledger_to_journal',
  async up(driver: DatabaseDriver): Promise<void> {
    await backfillOpeningBalanceJournals(driver);
  },
};
