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
