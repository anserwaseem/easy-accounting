/**
 * Advanced capabilities — the registry of actions a normal user is not
 * meant to see or perform, and the device-local flag that decides whether
 * they are offered.
 *
 * ## Why a flag and not roles
 *
 * The app has no role system and, as of this writing, no way to grow one
 * cheaply: the `users` table is a login list with no `role` column, the
 * `status` column is write-only (nothing reads it), there is no
 * user-management UI, and the data model is only partly user-scoped —
 * `chart.userId` scopes the chart of accounts, but invoices and inventory
 * carry no user column at all. A per-user role would therefore have to
 * either (a) ignore the data model and gate only the UI, or (b) first
 * retrofit user-scoping across most of the schema, which is a far larger
 * project than the problem this file solves.
 *
 * A device-local capability flag is the smallest thing that actually
 * holds: it hides the controls from the people using the machine, and it
 * survives an app restart without any identity plumbing.
 *
 * ## What this is and is not
 *
 * This is a *usability* boundary, not a security one. The renderer hides
 * the controls, and the main-process handlers additionally refuse the
 * destructive calls even if the renderer UI is bypassed — but the flag
 * itself is a plain value on disk, so anyone who knows where to look can
 * turn it back on. That is a deliberate trade: a second credential would
 * be a secret employees eventually learn and share, whereas a toggle is
 * obvious, reversible, and per-device.
 *
 * The threat model this suits: an employee should not stumble into a
 * destructive action, and should not be casually shown buttons the owner
 * does not want them using. It does not suit: a determined user with
 * DevTools open, on a machine they own.
 *
 * ## Storage
 *
 * The enabled set lives in the platform's `KeyValueStore` (see
 * ./ports.ts) — `electron-store` on desktop, the `web_kv` table in the
 * web worker. Deliberately NOT the `settings` table: that table
 * replicates across devices and ships in backups/exports, and this flag
 * is a per-device UI preference, exactly like the sidebar-collapsed state
 * and the table filters that already live in device-local storage.
 */

/**
 * Every advanced capability, as a stable string id.
 *
 * Ids are dotted and capability-scoped (`journal.reverse`) so a new
 * capability reads as a capability rather than as a feature name, and so
 * the destructive ones can be recognized by shape. They are persisted
 * verbatim in the store, so **treat them as permanent**: renaming one
 * silently drops whatever a user had enabled.
 */
export const ADVANCED_CAPABILITIES = {
  /** Reverse a posted manual journal (posts a counter-balancing journal). */
  journalReverse: 'journal.reverse',
  /** Permanently delete an unlinked manual journal. */
  journalDelete: 'journal.delete',
  /** Edit a posted journal's narration / bill number / discount. */
  journalEditFields: 'journal.editFields',
  /** Return a posted sale invoice. */
  invoiceReturnSale: 'invoice.returnSale',
  /** Return a posted purchase invoice. */
  invoiceReturnPurchase: 'invoice.returnPurchase',
  /** Delete a chart-of-accounts account. */
  accountDelete: 'account.delete',
  /** Deactivate or reactivate an account. */
  accountToggleActive: 'account.toggleActive',
  /** Turn stock-at-vendor tracking on or off for an account. */
  accountTrackVendorStock: 'account.trackVendorStock',
  /** Change whether an account's sales count as collection. */
  accountCollectionRole: 'account.collectionRole',
  /** Delete an inventory item. */
  inventoryDelete: 'inventory.delete',
  /** Deactivate or reactivate an inventory item. */
  inventoryToggleActive: 'inventory.toggleActive',
  /** Write a manual stock adjustment. */
  inventoryAdjustStock: 'inventory.adjustStock',
  /** Restate warehouse opening stock from a spreadsheet. */
  inventorySetOpeningStock: 'inventory.setOpeningStock',
  /** Keep an item out of, or put it into, the published catalog. */
  inventoryCatalogHold: 'inventory.catalogHold',
  /** Delete a send-to-vendor issue. */
  vendorStockDelete: 'vendorStock.delete',
  /** Restate consignment opening stock at vendors from a spreadsheet. */
  vendorStockSetOpeningStock: 'vendorStock.setOpeningStock',
  /** The whole agent-commission module: report, rates, settlement posting. */
  commissionModule: 'commission.module',
  /** Unpost a frozen agent-commission settlement. */
  commissionUnpostSettlement: 'commission.unpostSettlement',
  /** Delete a discount profile / pricing policy. */
  pricingDeletePolicy: 'pricing.deletePolicy',
  /** Re-download every row from the sync server. */
  syncRebuild: 'sync.rebuild',
  /** Replace this device's books from a database file. */
  dataImport: 'data.import',
} as const;

export type AdvancedCapability =
  (typeof ADVANCED_CAPABILITIES)[keyof typeof ADVANCED_CAPABILITIES];

/**
 * A short label for each capability, for the Settings list.
 *
 * The label is what the owner reads, so it names the action rather than the
 * capability id (`journal.reverse` reads as nothing to a shop owner;
 * "Reverse a journal" does).
 */
export const ADVANCED_CAPABILITY_LABELS: Record<AdvancedCapability, string> = {
  [ADVANCED_CAPABILITIES.journalReverse]: 'Reverse a journal',
  [ADVANCED_CAPABILITIES.journalDelete]: 'Delete a journal',
  [ADVANCED_CAPABILITIES.journalEditFields]: 'Edit a journal after posting',
  [ADVANCED_CAPABILITIES.invoiceReturnSale]: 'Return a sale invoice',
  [ADVANCED_CAPABILITIES.invoiceReturnPurchase]: 'Return a purchase invoice',
  [ADVANCED_CAPABILITIES.accountDelete]: 'Delete an account',
  [ADVANCED_CAPABILITIES.accountToggleActive]: 'Deactivate an account',
  [ADVANCED_CAPABILITIES.accountTrackVendorStock]: 'Track stock at a vendor',
  [ADVANCED_CAPABILITIES.accountCollectionRole]:
    'Set what counts as a collection',
  [ADVANCED_CAPABILITIES.inventoryDelete]: 'Delete an inventory item',
  [ADVANCED_CAPABILITIES.inventoryToggleActive]: 'Deactivate an inventory item',
  [ADVANCED_CAPABILITIES.inventoryAdjustStock]: 'Adjust stock by hand',
  [ADVANCED_CAPABILITIES.inventorySetOpeningStock]: 'Set opening stock',
  [ADVANCED_CAPABILITIES.inventoryCatalogHold]:
    'Keep an item out of the published catalog',
  [ADVANCED_CAPABILITIES.vendorStockDelete]: 'Delete a send to a vendor',
  [ADVANCED_CAPABILITIES.vendorStockSetOpeningStock]:
    'Set starting qty at vendors',
  [ADVANCED_CAPABILITIES.commissionModule]: 'Agent commissions',
  [ADVANCED_CAPABILITIES.commissionUnpostSettlement]:
    'Unpost an agent settlement',
  [ADVANCED_CAPABILITIES.pricingDeletePolicy]: 'Delete a pricing policy',
  [ADVANCED_CAPABILITIES.syncRebuild]: 'Re-download everything from sync',
  [ADVANCED_CAPABILITIES.dataImport]: 'Import a database from the desktop app',
};

/** Every capability id, in a stable order. */
export const ALL_ADVANCED_CAPABILITIES: readonly AdvancedCapability[] =
  Object.values(ADVANCED_CAPABILITIES);

/**
 * The capabilities that change or destroy financial records.
 *
 * Two things depend on this list, and they are different:
 *
 *  - Turning one of these on asks for confirmation first, because the
 *    actions it reveals rewrite the books and, for most of them, cannot be
 *    undone. The Settings panel is the only place that happens.
 *  - Every capability is refused by the main process (desktop) and the db
 *    worker (web) while it is off, so the destructive ones are not a
 *    special case at the enforcement layer. What separates them is how
 *    much damage the action does once it is allowed.
 *
 * Reversing a journal, deleting one, returning a posted invoice, deleting
 * an account or an item, adjusting stock by hand, restating opening stock,
 * and unposting a settlement all leave the books in a state the owner cannot
 * trivially get back. Editing a journal's narration or deactivating an
 * account does not.
 *
 * Restating opening stock is here for a specific reason: its "set the
 * quantity of everything not in the file to 0" option zeroes out stock the
 * owner may have recorded by hand since, and there is no undo for it.
 * Turning the whole capability on asks for confirmation for that reason,
 * even though a plain import with the option off is only a bulk write.
 */
export const DESTRUCTIVE_ADVANCED_CAPABILITIES: readonly AdvancedCapability[] =
  [
    ADVANCED_CAPABILITIES.journalReverse,
    ADVANCED_CAPABILITIES.journalDelete,
    ADVANCED_CAPABILITIES.invoiceReturnSale,
    ADVANCED_CAPABILITIES.invoiceReturnPurchase,
    ADVANCED_CAPABILITIES.accountDelete,
    ADVANCED_CAPABILITIES.inventoryDelete,
    ADVANCED_CAPABILITIES.inventoryAdjustStock,
    ADVANCED_CAPABILITIES.inventorySetOpeningStock,
    ADVANCED_CAPABILITIES.vendorStockDelete,
    ADVANCED_CAPABILITIES.vendorStockSetOpeningStock,
    ADVANCED_CAPABILITIES.commissionUnpostSettlement,
  ];

/**
 * Store key holding the enabled capability ids.
 *
 * The value is a JSON array of capability ids (the platform `store`
 * serializes values to JSON on both desktop and web), so the whole
 * enabled set is one entry and one write.
 */
export const ADVANCED_CAPABILITIES_STORE_KEY = 'advancedCapabilities';

/** Fallback id used when a stored id is not one we recognize. */
export const ALL_ADVANCED_CAPABILITIES_SENTINEL = 'all';

const CAPABILITY_IDS = new Set<string>(ALL_ADVANCED_CAPABILITIES);

/**
 * Parses a stored value into a set of capability ids.
 *
 * Tolerates the shapes a hand-edited or legacy store could hold: a
 * missing value (nothing enabled), a JSON array of ids, a JSON array
 * containing the `all` sentinel, or a bare string id. Unknown ids are
 * dropped rather than passed through, so a capability retired from the
 * registry cannot linger as an enabled entry.
 */
export const parseAdvancedCapabilities = (
  value: unknown,
): Set<AdvancedCapability> => {
  if (value === undefined || value === null) return new Set();

  let raw: unknown = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      // A bare, unquoted id — treat the string as the id itself.
      raw = [value];
    }
  }

  if (!Array.isArray(raw)) return new Set();

  const enabled = new Set<AdvancedCapability>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    if (entry === ALL_ADVANCED_CAPABILITIES_SENTINEL) {
      for (const capability of ALL_ADVANCED_CAPABILITIES) {
        enabled.add(capability);
      }
      continue;
    }
    if (CAPABILITY_IDS.has(entry)) {
      enabled.add(entry as AdvancedCapability);
    }
  }
  return enabled;
};

/**
 * Normalizes a capability set for storage: the `all` sentinel collapses
 * to the full list, and the result is sorted so the stored value is
 * stable regardless of the order the user toggled things in.
 */
export const serializeAdvancedCapabilities = (
  capabilities: Iterable<AdvancedCapability>,
): AdvancedCapability[] => {
  const set = new Set(capabilities);
  const expanded = new Set<AdvancedCapability>();
  for (const capability of set) {
    if (
      capability === (ALL_ADVANCED_CAPABILITIES_SENTINEL as AdvancedCapability)
    ) {
      for (const every of ALL_ADVANCED_CAPABILITIES) expanded.add(every);
      continue;
    }
    if (CAPABILITY_IDS.has(capability)) expanded.add(capability);
  }
  return ALL_ADVANCED_CAPABILITIES.filter((c) => expanded.has(c));
};

/** Whether `capability` is in `enabled`. */
export const hasAdvancedCapability = (
  enabled: ReadonlySet<AdvancedCapability>,
  capability: AdvancedCapability,
): boolean => enabled.has(capability);
