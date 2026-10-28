/**
 * UI-side "is this account usable" check.
 *
 * `getAccounts()` intentionally returns inactive rows (reports and ledgers need
 * history), so every selection surface has to filter them out itself. Older UI
 * payloads and some test fixtures predate the flag — treat a missing flag as
 * active so a fixture without `isActive` never hides a party.
 */
export const isAccountActive = (account: {
  isActive?: boolean | number;
}): boolean => account.isActive !== false && account.isActive !== 0;
