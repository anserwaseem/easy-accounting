// Migration 032 — desktop-side twin of the platform-free
// '032_redate_import_baselines' migration (src/core/db/migrations/
// 032_redate_import_baselines.ts) — see that file's doc comment for the full
// design (the field bug this fixes: import-baseline `stock_adjustments`
// rows were dated import-day and reasoned as an "import baseline", when they
// actually represent each item's opening stock from before recorded history
// began — a real owner database had 11,290 invoices with business dates
// back to 2008 predating the desktop's stock-counter feature entirely).
// Needed for the same reason migrations 028-031 have desktop twins (see
// 030.js's own comment): the existing Electron install path runs schema
// changes exclusively through this synchronous MigrationRunner, which never
// calls bootstrapDatabase, so a schema change meant to reach it has to be
// expressed twice. Shares the exact migration `name` with the core version
// so both runners share one bookkeeping row.
//
// The old reason literal and the new reason/date values are duplicated here
// rather than imported (same reason 029.js/031.js duplicate the trigger
// builder instead of requiring the core .ts module: a plain synchronous
// `require()` cannot load a .ts module without a build step). Keep these
// three literals in sync by hand with
// src/core/db/inventoryBaselineBackfill.ts's `INVENTORY_BASELINE_REASON` /
// `INVENTORY_BASELINE_DATE` and this migration's own core twin's
// `OLD_BASELINE_REASON`.
module.exports = {
  name: '032_redate_import_baselines',
  up: (db) => {
    try {
      // Frozen historical value — the OLD INVENTORY_BASELINE_REASON, before
      // this change. Intentionally not re-derived from anything: this WHERE
      // clause must keep matching exactly the rows the old code produced,
      // regardless of what the reason string becomes in the future.
      const OLD_BASELINE_REASON =
        'Import baseline: carried from desktop stored quantity';
      const NEW_BASELINE_REASON = 'Opening stock carried from desktop import';
      const NEW_BASELINE_DATE = '2000-01-01';

      db.prepare(
        `UPDATE stock_adjustments SET date = ?, reason = ? WHERE reason = ?`,
      ).run(NEW_BASELINE_DATE, NEW_BASELINE_REASON, OLD_BASELINE_REASON);

      return true;
    } catch (error) {
      console.log('032 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('032 migration completed!');
    }
  },
};
