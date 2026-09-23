/**
 * which open transaction the current async turn belongs to.
 *
 * `txDepth > 0` is not that. A web worker (and Electron IPC) can run
 * another login/sync/repair call while a transaction is awaiting, and
 * those calls would otherwise execute on the same connection inside the
 * open BEGIN. Only the turn that opened the transaction may run inline;
 * everyone else waits on the driver queue.
 *
 * browser worker has no AsyncLocalStorage, so this piggybacks on Promise
 * continuations (`await` installs `.then` while the owner is current).
 * macrotasks (messages, timers) start with no owner.
 */

const ZONE_KEY = '__eaTxZone';

let current: symbol | undefined;

function install(): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[ZONE_KEY]) return;
  g[ZONE_KEY] = true;

  const nativeThen = Promise.prototype.then;
  // eslint-disable-next-line no-extend-native
  Promise.prototype.then = function then(
    this: Promise<unknown>,
    onFulfilled?: ((value: unknown) => unknown) | null,
    onRejected?: ((reason: unknown) => unknown) | null,
  ) {
    const captured = current;
    const wrap = (fn: ((value: unknown) => unknown) | null | undefined) => {
      if (typeof fn !== 'function') return fn;
      return (value: unknown) => {
        const prev = current;
        current = captured;
        try {
          return fn(value);
        } finally {
          current = prev;
        }
      };
    };
    return nativeThen.call(this, wrap(onFulfilled), wrap(onRejected));
  } as typeof Promise.prototype.then;
}

install();

export function currentTxOwner(): symbol | undefined {
  return current;
}

/** run `fn` and its `await`s as `owner`. nested calls see {@link currentTxOwner}. */
export function bindTx<T>(owner: symbol, fn: () => T): T {
  const prev = current;
  current = owner;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

export interface TxState {
  depth: number;
  owner: symbol | undefined;
}

export function isTxOwner(state: TxState): boolean {
  return state.owner !== undefined && currentTxOwner() === state.owner;
}

/**
 * begin/savepoint, run `fn` as the owner, COMMIT or ROLLBACK.
 * Caller serializes outermost calls on its queue; nested calls (already
 * the owner) invoke this directly.
 */
export async function inTransaction<T>(
  state: TxState,
  exec: (sql: string) => void,
  fn: () => Promise<T>,
): Promise<T> {
  const nested = state.depth > 0;
  const savepoint = `core_tx_${state.depth}`;
  exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
  state.depth += 1;
  const created = state.owner === undefined;
  const owner = state.owner ?? Symbol('core-tx');
  state.owner = owner;
  try {
    const result = await bindTx(owner, fn);
    state.depth -= 1;
    exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
    return result;
  } catch (error) {
    state.depth -= 1;
    exec(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
    if (nested) exec(`RELEASE ${savepoint}`);
    throw error;
  } finally {
    if (created) state.owner = undefined;
  }
}
