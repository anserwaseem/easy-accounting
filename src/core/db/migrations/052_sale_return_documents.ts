import type { DatabaseDriver } from '../driver';
import { createCaptureTriggers } from './034_create_sync_tables';

/**
 * a sale return is its own invoice: stock in, Sale debited, customer
 * credited, dated on the return day. `isSaleReturn` marks it. `sourceInvoiceId`
 * is set when the lines came from one sale; an agent carton has neither a
 * source invoice nor a source line.
 *
 * `sourceInvoiceItemId` is not a foreign key. editing a sale deletes and
 * reinserts its lines, then points any return lines at the new ids. a
 * foreign key would reject that delete.
 *
 * numbered 052 because main already shipped `051_journal_reversal_link`.
 * a database that applied this work under the old name
 * `051_sale_return_documents` already has the columns, so each add is
 * skipped when the column is there.
 *
 * existing rows stay at the default, so nothing is re-emitted. the capture
 * triggers still have to be rebuilt or the new columns never enter the outbox.
 *
 * `inventory_quantity_view` must add the quantity back. `CREATE VIEW IF NOT
 * EXISTS` would keep the old definition.
 */
const TABLES = ['invoices', 'invoice_items'] as const;

async function hasColumn(
  driver: DatabaseDriver,
  table: string,
  column: string,
): Promise<boolean> {
  const columns = await driver.all<{ name: string }>(
    `PRAGMA table_info("${table}")`,
  );
  return columns.some((info) => info.name === column);
}

async function addColumn(
  driver: DatabaseDriver,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  if (await hasColumn(driver, table, column)) return;
  await driver.exec(
    `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`,
  );
}

async function rebuildCaptureTriggers(
  driver: DatabaseDriver,
  table: string,
): Promise<void> {
  await driver.exec(
    `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_insert"`,
  );
  await driver.exec(
    `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_update"`,
  );
  await driver.exec(
    `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_delete"`,
  );
  await createCaptureTriggers(driver, table);
}

export const migration052 = {
  name: '052_sale_return_documents',
  async up(driver: DatabaseDriver): Promise<void> {
    await addColumn(
      driver,
      'invoices',
      'isSaleReturn',
      'BOOLEAN NOT NULL DEFAULT 0',
    );
    await addColumn(
      driver,
      'invoices',
      'sourceInvoiceId',
      'INTEGER REFERENCES invoices(id)',
    );
    await addColumn(driver, 'invoice_items', 'sourceInvoiceItemId', 'INTEGER');

    for (const table of TABLES) {
      // eslint-disable-next-line no-await-in-loop
      await rebuildCaptureTriggers(driver, table);
    }

    await driver.exec(`DROP VIEW IF EXISTS inventory_quantity_view`);
    await driver.exec(`
      CREATE VIEW inventory_quantity_view AS
      SELECT
        i.id AS inventoryId,
        COALESCE(os.quantity, 0)
        + COALESCE((
            SELECT SUM(
              CASE
                WHEN COALESCE(inv.isQuotation, 0) != 0 THEN 0
                WHEN inv.invoiceType = 'Sale' THEN
                  CASE
                    WHEN COALESCE(inv.isReturned, 0) != 0 THEN 0
                    WHEN COALESCE(inv.isSaleReturn, 0) = 1 THEN ii.quantity
                    ELSE -ii.quantity
                  END
                WHEN inv.invoiceType = 'Purchase' THEN
                  CASE WHEN COALESCE(inv.isReturned, 0) = 0 THEN ii.quantity ELSE 0 END
                ELSE 0
              END
            )
            FROM invoice_items ii
            JOIN invoices inv ON inv.id = ii.invoiceId
            WHERE ii.inventoryId = i.id
          ), 0)
        + COALESCE((
            SELECT SUM(sa.quantityDelta)
            FROM stock_adjustments sa
            WHERE sa.inventoryId = i.id
          ), 0) AS quantity
      FROM inventory i
      LEFT JOIN inventory_opening_stock os ON os.inventoryId = i.id
    `);
  },
};
