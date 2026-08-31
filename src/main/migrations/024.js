module.exports = {
  name: '024_normalize_invoice_date_format',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      // The bulk import wrote invoice dates as US-style strings such as
      // '11/23/2021', while everything the app writes itself is ISO
      // ('2026-01-01' or '2026-08-28T07:00:00.000Z'). Date columns are TEXT
      // and every date filter is a string comparison, so an imported row
      // sorts below every ISO date and silently drops out of any
      // date-ranged report (Sales Performance, Stock As Of, Inventory
      // Health). This rewrites the imported form to the system-generated
      // ISO convention so both populations sort on one axis.
      //
      // Format is confirmed month-first: across the imported rows the
      // second slash token exceeds 12 thousands of times and the first
      // never does.
      //
      // Anything that is not a clean, calendar-valid M/D/YYYY string is
      // left exactly as it was — a wrong-looking date a person can read is
      // better than a NULL or a guess nobody can audit.
      const daysInMonth = (year, month) =>
        // day 0 of the following month is the last day of `month` (1-based)
        new Date(Date.UTC(year, month, 0)).getUTCDate();

      const pad = (value) => String(value).padStart(2, '0');

      // returns the ISO equivalent for an M/D/YYYY or MM/DD/YYYY string,
      // or null for anything else (already ISO, empty, or unparseable)
      const slashDateToIso = (value) => {
        if (typeof value !== 'string') return null;
        const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!match) return null;
        const month = Number(match[1]);
        const day = Number(match[2]);
        const year = Number(match[3]);
        if (month < 1 || month > 12) return null;
        if (day < 1 || day > daysInMonth(year, month)) return null;
        return `${year}-${pad(month)}-${pad(day)}T07:00:00.000Z`;
      };

      db.transaction(() => {
        // `date` always exists; `returnedAt` arrived with migration 017.
        // Only rows containing a slash are candidates, which also makes a
        // re-run a no-op: converted rows no longer match.
        ['date', 'returnedAt'].forEach((columnName) => {
          if (!hasColumn('invoices', columnName)) return;

          const candidates = db
            .prepare(
              `SELECT "id", "${columnName}" AS value FROM "invoices"
                 WHERE "${columnName}" LIKE '%/%'`,
            )
            .all();

          const update = db.prepare(
            `UPDATE "invoices" SET "${columnName}" = ? WHERE "id" = ?`,
          );

          candidates.forEach((invoiceRow) => {
            const isoDate = slashDateToIso(invoiceRow.value);
            if (isoDate) update.run(isoDate, invoiceRow.id);
          });
        });
      })();

      return true;
    } catch (error) {
      console.log('024 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('024 migration completed!');
    }
  },
};
