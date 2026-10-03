import type { DatabaseDriver } from '../driver';
import { seedOutboxFromLocalData } from '../../sync/seedOutbox';

/**
 * Migration 041 — Seeds existing local business data into sync_outbox.
 *
 * Migration 034 installed capture triggers for future writes, but for devices
 * that already had business data before v0.3.0, those pre-existing rows were
 * never captured into sync_outbox.
 *
 * This migration calls seedOutboxFromLocalData to ensure all existing rows
 * in business tables (chart, account, inventory, invoices, journals, etc.)
 * are queued into sync_outbox so multi-device sync can replicate them.
 *
 * Idempotent by construction: uses 'reseed:<table>:' || uuid keys guarded
 * by NOT EXISTS. Safe on empty/new devices (no rows inserted).
 */
export const migration041 = {
  name: '041_seed_existing_business_data_outbox',
  async up(driver: DatabaseDriver): Promise<void> {
    await seedOutboxFromLocalData(driver);
  },
};
