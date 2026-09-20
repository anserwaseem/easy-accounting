/**
 * Every `migrations.name` this build will ever record.
 *
 * Import rejects a file that contains any name not in this set — that file
 * came from a newer app. Compare the full `name` string, never the numeric
 * prefix: `027_add_chart_nameUrdu` (desktop 027.js) and
 * `027_create_ledger_and_inventory_quantity_views` (CORE) both exist.
 *
 * `DESKTOP_MIGRATION_NAMES` = `src/main/migrations/*.js` `name` exports
 * (released origin/main `001`–`028`). `CORE_MIGRATION_NAMES` = post-main
 * chain in `src/core/db/migrations`. Keep both lists in lockstep with
 * those sources — `knownMigrations.test.ts` fails if they drift.
 *
 * Do not import CORE_MIGRATIONS from here — `029_create_sync_tables`
 * already imports this module via import.ts, and that cycle left
 * CORE_MIGRATIONS half-initialized at bootstrap.
 */
export const DESKTOP_MIGRATION_NAMES: readonly string[] = [
  '001_update_chart_type_constraint',
  '002_add_inventory_and_invoice_modules',
  '003_add_invoice_items_triggers',
  '004_add_discount_in_invoice_items_table',
  '005_add_extra_discount_in_invoice_table',
  '006_add_parentId_in_chart_table',
  '007_add_address_phone1_phone2_goodsName_in_account_table',
  '008_update_account_code_type',
  '009_add_biltyNumber_cartons_in_invoices_table',
  '010_add_account_id_to_invoice_items_table',
  '011_add_unique_constraint_to_account_name_and_code_in_chart',
  '012_add_isActive_to_account_table',
  '013_add_billNumber_and_discountPercentage_to_journal_table',
  '014_opening_stock_and_stock_adjustments',
  '015_add_item_types_and_discount_profiles',
  '016_add_journal_invoiceId_and_invoice_extraDiscountAccountId',
  '017_add_invoice_return_fields',
  '018_add_invoices_isQuotation',
  '019_add_inventory_listPosition',
  '020_add_attributes_families_and_price_lists',
  '021_add_attribute_isPublic',
  '022_add_inventory_excludeFromCatalog',
  '023_add_inventory_title',
  '024_normalize_invoice_date_format',
  '025_vendor_stock',
  '026_add_urdu_print_fields',
  '027_add_chart_nameUrdu',
  '028_add_isActive_to_inventory',
];

/** Must match CORE_MIGRATIONS[].name in array order. */
export const CORE_MIGRATION_NAMES: readonly string[] = [
  '024_add_uuid_to_business_tables',
  '025_migrate_opening_balance_ledger_to_journal',
  '026_index_journal_entry_and_ledger_lookup',
  '027_create_ledger_and_inventory_quantity_views',
  '028_create_settings_table',
  '029_create_sync_tables',
  '030_create_sync_apply_conflicts',
  '031_replicate_blob_columns',
  '032_redate_import_baselines',
  '033_sync_settings',
  '034_suppress_timestamp_triggers_during_apply',
  '035_insert_timestamps_fill_only',
];

export function knownMigrationNames(): Set<string> {
  return new Set([...DESKTOP_MIGRATION_NAMES, ...CORE_MIGRATION_NAMES]);
}

export function unknownMigrationNames(sourceNames: string[]): string[] {
  const known = knownMigrationNames();
  return sourceNames.filter((name) => !known.has(name));
}
