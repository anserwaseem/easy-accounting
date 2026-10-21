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
  /** The sales performance report: trends, top customers, top items. */
  salesPerformanceReport: 'salesPerformance.report',
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
  [ADVANCED_CAPABILITIES.salesPerformanceReport]: 'Sales performance report',
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
 * A group of related capabilities, for the Settings list.
 *
 * The owner reading this list is looking for "the one about returning
 * invoices" among two dozen switches. Grouping by what the action is about
 * is what makes the list findable; a flat list in registry order is not.
 */
export interface AdvancedCapabilityGroup {
  /** Stable id, used as a React key and for the group heading. */
  id: string;
  /** What the group is about, in the owner's words. */
  title: string;
  /** One line saying what these controls have in common. */
  description: string;
  /** The capabilities in this group, in the order they should be listed. */
  capabilities: readonly AdvancedCapability[];
}

/**
 * The Settings list, grouped.
 *
 * This is the single source of truth for the order capabilities appear in.
 * Every capability in the registry appears in exactly one group, and the
 * groups together cover the whole registry; a test enforces both, because a
 * capability that fell out of every group would silently vanish from the
 * Settings list with nothing to show it had happened.
 */
export const ADVANCED_CAPABILITY_GROUPS: readonly AdvancedCapabilityGroup[] = [
  {
    id: 'journals',
    title: 'Journals',
    description: 'What can be done to a journal after it is posted.',
    capabilities: [
      ADVANCED_CAPABILITIES.journalReverse,
      ADVANCED_CAPABILITIES.journalDelete,
      ADVANCED_CAPABILITIES.journalEditFields,
    ],
  },
  {
    id: 'invoices',
    title: 'Invoices',
    description: 'What can be done to a posted invoice.',
    capabilities: [
      ADVANCED_CAPABILITIES.invoiceReturnSale,
      ADVANCED_CAPABILITIES.invoiceReturnPurchase,
    ],
  },
  {
    id: 'accounts',
    title: 'Accounts',
    description: 'Changes to the people and companies on your books.',
    capabilities: [
      ADVANCED_CAPABILITIES.accountDelete,
      ADVANCED_CAPABILITIES.accountToggleActive,
      ADVANCED_CAPABILITIES.accountTrackVendorStock,
      ADVANCED_CAPABILITIES.accountCollectionRole,
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory and stock',
    description: 'Changes to your items and how much stock you have.',
    capabilities: [
      ADVANCED_CAPABILITIES.inventoryDelete,
      ADVANCED_CAPABILITIES.inventoryToggleActive,
      ADVANCED_CAPABILITIES.inventoryAdjustStock,
      ADVANCED_CAPABILITIES.inventorySetOpeningStock,
      ADVANCED_CAPABILITIES.inventoryCatalogHold,
    ],
  },
  {
    id: 'vendorStock',
    title: 'Vendor stock',
    description: 'Changes to the stock you have left at your vendors.',
    capabilities: [
      ADVANCED_CAPABILITIES.vendorStockDelete,
      ADVANCED_CAPABILITIES.vendorStockSetOpeningStock,
    ],
  },
  {
    id: 'commissions',
    title: 'Commissions',
    description:
      'The whole agent commission module, and reversing a settlement.',
    capabilities: [
      ADVANCED_CAPABILITIES.commissionModule,
      ADVANCED_CAPABILITIES.commissionUnpostSettlement,
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    description: 'Reports the owner may not want on every device.',
    capabilities: [ADVANCED_CAPABILITIES.salesPerformanceReport],
  },
  {
    id: 'pricing',
    title: 'Pricing',
    description: 'Changes to the pricing policies on your accounts.',
    capabilities: [ADVANCED_CAPABILITIES.pricingDeletePolicy],
  },
  {
    id: 'data',
    title: 'Data and devices',
    description: 'Actions that replace what is on this device.',
    capabilities: [
      ADVANCED_CAPABILITIES.syncRebuild,
      ADVANCED_CAPABILITIES.dataImport,
    ],
  },
];

/**
 * Every capability id, in the order the groups list them.
 *
 * Same set as {@link ALL_ADVANCED_CAPABILITIES}, which is the registry
 * order; this one is the reading order. Storage serialization uses this
 * so the stored value follows what the owner sees.
 */
export const ALL_ADVANCED_CAPABILITIES_IN_GROUP_ORDER: readonly AdvancedCapability[] =
  ADVANCED_CAPABILITY_GROUPS.flatMap((group) => [...group.capabilities]);

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
 * The marker the guard's error message carries.
 *
 * The message has to survive the trip from the main process (or the db
 * worker) back to the renderer, where it is stripped of its Electron IPC
 * wrapper and shown in a toast. This substring is how the renderer
 * recognizes the message and replaces it with something a person can act
 * on, instead of showing the raw capability id.
 */
export const ADVANCED_CAPABILITY_ERROR_MARKER = 'is an advanced control';

/**
 * The error thrown when an advanced capability is turned off.
 *
 * Lives here, in the shared registry, because both platforms raise it and
 * the renderer has to recognize it. The message names the action the way
 * the Settings list does, not the capability id: "journal.reverse" means
 * nothing to a shop owner, "Reverse a journal" does.
 *
 * The second sentence says where to go, because the person who hit this
 * needs to know the action is available rather than broken.
 */
export const advancedCapabilityError = (
  capability: AdvancedCapability,
): string => {
  const label = ADVANCED_CAPABILITY_LABELS[capability] ?? capability;
  return (
    `"${label}" ${ADVANCED_CAPABILITY_ERROR_MARKER}, turned off on this ` +
    'device. Turn it on in Settings to use it.'
  );
};

/**
 * Whether a message is the advanced-capability refusal.
 *
 * The renderer calls this on a stripped IPC error message to decide
 * whether to show the raw text or the friendlier version.
 */
export const isAdvancedCapabilityError = (message: string): boolean =>
  message.includes(ADVANCED_CAPABILITY_ERROR_MARKER);

/**
 * The action a refusal names, if it names one we recognize.
 *
 * The guard's message quotes the label the Settings list uses, so the
 * person reading the toast can tell which action was turned off. A label
 * that is not one of ours is dropped rather than shown: a label nobody
 * recognizes is no better than the raw id.
 *
 * The search is not anchored to the start of the message, because some
 * call sites prefix the error with what they were doing ("Error deleting
 * account: ..."). The caller has already established that the message is
 * a refusal, so the first quoted label in it is the one that was refused.
 */
export const advancedCapabilityErrorLabel = (
  message: string,
): string | null => {
  // the message is:  "<label>" is an advanced control, turned off ...
  const match = message.match(/"([^"]+)"\s/);
  if (!match) return null;
  const label = match[1];
  const known = Object.values(ADVANCED_CAPABILITY_LABELS).includes(
    label as AdvancedCapability,
  );
  return known ? label : null;
};

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
 *
 * The order is the group order, which is the order the Settings list
 * shows, so the stored value reads the way the owner sees it.
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
  return ALL_ADVANCED_CAPABILITIES_IN_GROUP_ORDER.filter((c) =>
    expanded.has(c),
  );
};

/** Whether `capability` is in `enabled`. */
export const hasAdvancedCapability = (
  enabled: ReadonlySet<AdvancedCapability>,
  capability: AdvancedCapability,
): boolean => enabled.has(capability);
