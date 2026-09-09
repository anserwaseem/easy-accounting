/**
 * Shared between db.worker.ts's `ensurePlaceholderDefaultUser` (which
 * creates this row) and syncManager.ts's `SyncManager.join` (which removes
 * it as part of joining an existing sync project — see that method's doc
 * comment for why). Split into its own tiny module rather than exported
 * from db.worker.ts directly so importing it from syncManager.ts doesn't
 * create a module cycle (db.worker.ts already imports `SyncManager` from
 * ./syncManager).
 */
export const PLACEHOLDER_USERNAME = 'default';
