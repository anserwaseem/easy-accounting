/**
 * Shared between db.worker.ts's `ensurePlaceholderDefaultUser` (which
 * creates this row) and SyncManager's `join` (which removes
 * it as part of joining an existing sync project — see that method's doc
 * comment for why). Split into its own tiny module rather than exported
 * from db.worker.ts directly so importing it from SyncManager doesn't
 * create a module cycle.
 */
export const PLACEHOLDER_USERNAME = 'default';
