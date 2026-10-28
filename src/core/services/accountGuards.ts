import type { DatabaseDriver } from '../db/driver';

interface AccountActiveRow {
  id: number;
  name: string;
  isActive: number | boolean;
}

/**
 * Reject postings to inactive accounts.
 *
 * `isActive` is otherwise only a UI hint: nothing in the schema or the write
 * services stopped an invoice, journal, import or API call from posting to a
 * retired account. This is the service-side guard for the app's own write
 * paths (sync apply and the raw import/restore path do not go through here).
 *
 * `allowInactive` is for editing an existing document: the accounts it was
 * already saved with may stay even if one has since been deactivated, but a
 * newly introduced inactive account is still rejected.
 */
export async function assertActiveAccounts(
  db: DatabaseDriver,
  rawAccountIds: Array<number | null | undefined>,
  context: string,
  options: { allowInactive?: ReadonlySet<number> } = {},
): Promise<void> {
  const ids = [
    ...new Set(
      rawAccountIds.filter(
        (id): id is number =>
          typeof id === 'number' && Number.isFinite(id) && id > 0,
      ),
    ),
  ];
  if (ids.length === 0) return;

  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db.all<AccountActiveRow>(
    `SELECT id, name, isActive FROM account WHERE id IN (${placeholders})`,
    ids,
  );

  const found = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(
      `${context}: account ${missing
        .map((id) => `#${id}`)
        .join(', ')} not found.`,
    );
  }

  const inactive = rows.filter(
    (row) => !row.isActive && !options.allowInactive?.has(row.id),
  );
  if (inactive.length === 0) return;

  const labels = inactive.map((row) => `"${row.name}"`).join(', ');
  throw new Error(
    `${context}: ${labels} ${
      inactive.length === 1 ? 'is' : 'are'
    } inactive. Choose an active account before saving.`,
  );
}
