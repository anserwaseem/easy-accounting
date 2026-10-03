/**
 * BEGIN / savepoint around `fn`. Depth stays raised for the whole
 * `await fn()`, including native async continuations.
 *
 * Who may enter the connection while depth > 0 is the driver's problem:
 * Node uses AsyncLocalStorage (see BetterSqliteDriver); the browser worker
 * serializes RPCs and background sync so a second turn cannot reach the
 * driver until this function settles (see db.worker.ts). A global
 * `Promise#then` patch does not survive ES2022 `await`.
 */

export interface TxState {
  depth: number;
}

export async function inTransaction<T>(
  state: TxState,
  exec: (sql: string) => void,
  fn: () => Promise<T>,
): Promise<T> {
  const nested = state.depth > 0;
  const savepoint = `core_tx_${state.depth}`;
  exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
  state.depth += 1;
  try {
    const result = await fn();
    exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
    return result;
  } catch (error) {
    exec(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
    if (nested) exec(`RELEASE ${savepoint}`);
    throw error;
  } finally {
    state.depth -= 1;
  }
}
