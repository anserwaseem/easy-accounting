/**
 * Wire protocol between the main thread (src/api/client.ts) and the db
 * worker (src/worker/db.worker.ts). Deliberately tiny — a promise-per-call
 * postMessage bridge, not a general RPC framework.
 */

export interface RpcCall {
  type: 'call';
  id: number;
  method: string;
  args: unknown[];
}

export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'init-error'; error: string }
  | { type: 'result'; id: number; ok: true; result: unknown }
  | { type: 'result'; id: number; ok: false; error: string }
  /**
   * One-way worker->main notification: the background sync loop
   * (apps/web/src/worker/syncManager.ts) just applied one or more pulled
   * remote rows to the local database. Carries no `id` — it is not a reply
   * to any pending RPC call, just a "your local data may have changed
   * underneath you" nudge. See api/client.ts's `onSyncApplied` and
   * electronShim.ts, which turns this into the
   * `easyaccounting:sync-applied` window event shared renderer code can
   * listen for.
   */
  | { type: 'sync-applied' };
