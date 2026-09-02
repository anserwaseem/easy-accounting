module.exports = {
  name: '026_repair_invoice_updatedat_after_024',
  up: (db) => {
    try {
      // The first shipped form of migration 024 rewrote invoice date
      // strings without suspending after_update_invoices_add_timestamp, so
      // the trigger stamped `updatedAt = now` on every converted row and
      // the whole imported history lit up with the "Edited" indicator
      // (which is simply `updatedAt > createdAt`).
      //
      // Repair: a person edits one invoice at a time, so dozens of
      // invoices sharing the exact same `updatedAt` second can only be a
      // bulk write. Reset `updatedAt = createdAt` for every invoice whose
      // updatedAt value is shared by BULK_THRESHOLD or more rows that
      // currently read as edited. On databases created after 024 was
      // fixed there is no such cluster and this is a no-op; re-runs are
      // no-ops because repaired rows no longer satisfy
      // `updatedAt > createdAt`.
      //
      // Known loss, accepted: an imported invoice genuinely edited before
      // 024 ran had its real edit timestamp overwritten by that same bulk
      // stamp, so it is indistinguishable from the rest of the cluster and
      // loses its indicator. The edit itself (lines, amounts) is untouched.
      const BULK_THRESHOLD = 20;

      db.transaction(() => {
        const clusters = db
          .prepare(
            `SELECT "updatedAt" AS value FROM "invoices"
               WHERE "updatedAt" IS NOT NULL
                 AND "createdAt" IS NOT NULL
                 AND "updatedAt" > "createdAt"
               GROUP BY "updatedAt"
               HAVING COUNT(*) >= ?`,
          )
          .all(BULK_THRESHOLD);

        if (clusters.length === 0) return;

        // Same rationale as the fixed 024: this restore is a repair, not
        // an edit, so the timestamp trigger stays out of the way.
        db.exec('DROP TRIGGER IF EXISTS after_update_invoices_add_timestamp');

        try {
          const reset = db.prepare(
            `UPDATE "invoices" SET "updatedAt" = "createdAt"
               WHERE "updatedAt" = ? AND "updatedAt" > "createdAt"`,
          );
          clusters.forEach((cluster) => reset.run(cluster.value));
        } finally {
          db.exec(`CREATE TRIGGER IF NOT EXISTS after_update_invoices_add_timestamp
            AFTER UPDATE ON invoices
            BEGIN
              UPDATE invoices SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END`);
        }
      })();

      return true;
    } catch (error) {
      console.log('026 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('026 migration completed!');
    }
  },
};
