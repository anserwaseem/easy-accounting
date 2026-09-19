import type { DatabaseDriver } from '../db/driver';

/**
 * Equalize `invoices.updatedAt` to `createdAt` wherever the two sit on
 * different calendar days. The invoice list's Edited pill
 * (`src/renderer/lib/invoiceUtils.ts`) lights when the dates differ, so
 * any historical bulk UPDATE that bumped `updatedAt` without the user
 * editing the invoice — migration 024's uuid-backfill on the origin
 * desktop, an apply-time trigger stomp, a join that landed before the
 * calendar-day repair — shows every sale as Edited.
 *
 * Runs under `sync_state.applying` so the `after_update` timestamp /
 * capture triggers do not re-stamp `updatedAt` or enqueue the repair as
 * a real local edit. A genuine future edit on this device still fires
 * those triggers (applying unset) and re-lights the pill.
 *
 * Called from {@link import('./SyncEngine').SyncEngine.pullAndApply} AND
 * from the web worker's boot (so a device whose background sync is hung
 * still heals the next time the page loads — Safari iOS can leave a
 * fetch outstanding forever, which used to block this repair forever).
 */
export async function repairInvoiceEditedTimestamps(
  db: DatabaseDriver,
): Promise<number> {
  let changes = 0;
  await db.transaction(async () => {
    await db.run(
      `INSERT INTO sync_state (key, value) VALUES ('applying', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    try {
      const result = await db.run(
        `UPDATE invoices
         SET updatedAt = createdAt
         WHERE createdAt IS NOT NULL
           AND updatedAt IS NOT NULL
           AND substr(replace(replace(cast(createdAt AS TEXT), 'T', ' '), 'Z', ''), 1, 10)
            <> substr(replace(replace(cast(updatedAt AS TEXT), 'T', ' '), 'Z', ''), 1, 10)`,
      );
      changes = result.changes ?? 0;
    } finally {
      await db.run(`DELETE FROM sync_state WHERE key = 'applying'`);
    }
  });
  return changes;
}
