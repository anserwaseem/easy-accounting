import type { AccountCollectionRole, CollectionSource } from '../../types';

/** default rule for `collectionRole = NULL`; must agree with RECEIPT_ACCOUNTS_CTE */
export const isDefaultReceiptHead = (
  head: { type: string; parentId?: number | null } | undefined,
): boolean => !!head && head.type === 'Asset' && head.parentId == null;

/**
 * `receipt_accounts(id)` CTE body: accounts whose pairing with a party credit
 * makes that credit a collection. default is any account directly under a
 * top-level Asset head (cash, bank, an agent's clearing account);
 * `account.collectionRole` overrides it either way.
 */
export const RECEIPT_ACCOUNTS_CTE = `receipt_accounts AS (
        SELECT a.id
        FROM account a
        JOIN chart c ON c.id = a.chartId
        WHERE a.collectionRole = 'receipt'
           OR (a.collectionRole IS NULL AND c.type = 'Asset' AND c.parentId IS NULL)
      )`;

/** local calendar day of a stored journal date (date-only or ISO timestamp) */
export const localDaySql = (column: string): string => `(
  CASE
    WHEN length(${column}) = 10 THEN ${column}
    ELSE date(datetime(${column}, 'localtime'))
  END
)`;

/**
 * `receipt_credits(accountId, day, amount)`: every credit on the
 * `@accountIdsJson` accounts, prorated to the share of its journal's debits
 * that sit on receipt accounts (same proration as `ledger_lines`), read
 * straight from journal_entry because the ledger views re-total every journal
 * per pair and cost seconds across a whole head. needs RECEIPT_ACCOUNTS_CTE first.
 */
export const RECEIPT_CREDITS_CTE = `credits AS (
        SELECT c.journalId, c.accountId, c.creditAmount, ${localDaySql(
          'j.date',
        )} AS day
        FROM journal_entry c
        JOIN journal j ON j.id = c.journalId
        WHERE c.creditAmount > 0
          AND c.accountId IN (
            SELECT CAST(ids.value AS INTEGER) FROM json_each(@accountIdsJson) AS ids
          )
      ),
      debits AS (
        SELECT
          d.journalId,
          SUM(d.debitAmount) AS total,
          SUM(CASE WHEN d.accountId IN (SELECT id FROM receipt_accounts) THEN d.debitAmount ELSE 0 END) AS receipt
        FROM journal_entry d
        WHERE d.debitAmount > 0
          AND d.journalId IN (SELECT journalId FROM credits)
        GROUP BY d.journalId
      ),
      receipt_credits AS (
        SELECT
          credits.accountId,
          credits.day,
          credits.creditAmount * 1.0 * debits.receipt / debits.total AS amount
        FROM credits
        JOIN debits ON debits.journalId = credits.journalId AND debits.receipt > 0
      )`;

export interface CollectionSourceVerdict {
  /** whether its credits count as collections right now */
  counts: boolean;
  /** what the rule would say with no override */
  defaultCounts: boolean;
  reason: string;
  /** worth a look: the current verdict is probably wrong */
  flag: string | null;
}

/** one entry crediting at least this many shops from a non-cash account looks like a balance transfer */
const TRANSFER_MIN_SHOPS = 5;

/**
 * plain-language verdict for an account that credited an agent's shops.
 * flags only the two cases a person must judge: a big payment that does not
 * count because it came through another head, and a counted account whose
 * single entry settled many shops at once (a balance transfer, not cash).
 */
export const classifyCollectionSource = (
  source: Pick<
    CollectionSource,
    | 'chartId'
    | 'headType'
    | 'headParentId'
    | 'collectionRole'
    | 'entries'
    | 'maxShopsPerEntry'
  >,
  agentChartId: number,
): CollectionSourceVerdict => {
  const defaultCounts = isDefaultReceiptHead({
    type: source.headType,
    parentId: source.headParentId,
  });
  const counts =
    source.collectionRole === 'receipt' ||
    (source.collectionRole == null && defaultCounts);

  let reason: string;
  if (source.collectionRole === 'receipt') reason = 'Set to count';
  else if (source.collectionRole === 'exclude') reason = 'Set not to count';
  else if (source.chartId === agentChartId) {
    reason = "Moved between this agent's shop accounts";
  } else if (defaultCounts) reason = 'Cash, bank or clearing account';
  else if (source.headType === 'Expense' || source.headType === 'Revenue') {
    reason = `${source.headType} account, not money received`;
  } else if (source.headParentId != null) reason = "Another agent's account";
  else reason = `${source.headType} account`;

  let flag: string | null = null;
  if (
    !counts &&
    source.collectionRole == null &&
    source.headType === 'Asset' &&
    source.headParentId != null &&
    source.chartId !== agentChartId
  ) {
    flag = 'Looks like a payment collected through another head';
  } else if (
    counts &&
    source.collectionRole == null &&
    source.entries === 1 &&
    source.maxShopsPerEntry >= TRANSFER_MIN_SHOPS
  ) {
    flag = `One entry credited ${source.maxShopsPerEntry} shops: a balance transfer?`;
  }

  return { counts, defaultCounts, reason, flag };
};

/** the override that makes an account count (or not) with the least stored state */
export const collectionRoleFor = (
  wantCounts: boolean,
  defaultCounts: boolean,
): AccountCollectionRole | null => {
  if (wantCounts === defaultCounts) return null;
  return wantCounts ? 'receipt' : 'exclude';
};
