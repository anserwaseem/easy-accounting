/**
 * One background/RPC turn at a time. A second message stays pending until
 * the turn that holds a transaction finishes, so it cannot run SQL inside
 * that BEGIN. Nested driver calls do not use this queue (they would
 * deadlock); they run inline while `TxState.depth > 0`.
 */
export function createTurnQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const job = tail.then(fn, fn);
    tail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  };
}
