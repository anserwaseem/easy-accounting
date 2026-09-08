/**
 * The pure decision behind the "connect-time duplicate-seed guard" —
 * see `SyncManager.connect`'s (apps/web/src/worker/syncManager.ts) doc
 * comment for the full story and REAL INCIDENT it exists to head off before
 * it happens (see also `SyncEngine.pullAndApply`'s doc comment for what
 * happens when it isn't headed off — the per-row apply-conflict containment
 * that's the *other* half of this same task).
 *
 * Deliberately extracted into `src/core` — platform- and I/O-free — rather
 * than living as a private method on `SyncManager`: `apps/web` has no jest
 * runner of its own (it's typechecked + built with `tsc`/`vite` and
 * exercised end-to-end with Playwright — see apps/web/e2e/sync.spec.ts),
 * while everything under `src/core` runs under the root jest suite. Putting
 * the actual go/no-go decision here, as a pure function over plain inputs,
 * makes it unit-testable there (`./__tests__/connectGuard.test.ts`) instead
 * of only reachable through an end-to-end browser test — `SyncManager`
 * itself stays a thin, three-line caller that gathers those inputs (its own
 * stored cursor, a local business-data probe, the transport's
 * `currentSeq()`) and renders the result.
 */

/** What {@link evaluateDuplicateSeedRisk} needs to know to decide — nothing more. */
export interface DuplicateSeedRiskInput {
  /**
   * This device's own `sync_state.cursor` value right now (0 if it has
   * never stored one). Only a device that has *never* synced before is a
   * duplicate-seed risk at all — a device reconnecting to a project it has
   * already synced with has necessarily already reconciled (or been
   * created fresh by) that project's data, so there is nothing left to
   * accidentally duplicate.
   */
  storedCursor: number;
  /**
   * Whether this device's local database already holds business data worth
   * protecting — the same emptiness probe the "join existing sync" gating
   * uses (`getAccounts().length === 0 && getJournals().length === 0` on the
   * renderer side; `SyncManager` reuses the identical account/journal
   * row-count check server-side for this guard — see its doc comment).
   * `false` means this device has nothing of its own that connecting could
   * possibly duplicate onto the server, regardless of what the server
   * already holds.
   */
  hasLocalBusinessData: boolean;
  /**
   * The target project's current log watermark
   * ({@link SyncTransport.currentSeq}, 0 if the log is empty). A project
   * with nothing in it yet cannot be duplicated onto — this is exactly the
   * "first device ever connects" case the guard must let through silently.
   */
  serverSeq: number;
}

/** The `SyncErrorInfo`-shaped (apps/web/src/worker/syncManager.ts) warning `SyncManager.connect` returns when {@link evaluateDuplicateSeedRisk} says stop. Structurally compatible with that interface (same three fields) without importing it — see this module's own doc comment for why the two files can't import each other. */
export interface DuplicateSeedRiskWarning {
  kind: 'duplicate_seed_risk';
  message: string;
  guidance: string;
}

export const DUPLICATE_SEED_RISK_MESSAGE =
  "This sync project already contains data. If this device's data is an " +
  'independent copy (e.g. imported separately), connecting will DUPLICATE ' +
  "the business on the server. If this device should receive the server's " +
  'data, use "Join existing sync" from the Login screen (empty device ' +
  'required). Continue only if you are intentionally seeding additional ' +
  'data.';

export const DUPLICATE_SEED_RISK_GUIDANCE =
  'Click "Connect anyway" only if you mean to add this device\'s data as ' +
  'new, additional business data on the server — not if it is meant to be ' +
  'the same business as what is already there.';

/**
 * Returns a warning when connecting right now would risk the REAL
 * INCIDENT this guard exists for — two independent copies of the same
 * business ending up on one server, wedging every device's sync loop on
 * natural-key conflicts (see `SyncEngine.pullAndApply`'s doc comment) —
 * and `null` when it's safe to proceed silently. All three conditions must
 * hold simultaneously: a never-before-synced device, with local business
 * data of its own, connecting to a project that already has data in it.
 * Any one of them being false means there is nothing to protect against:
 * an already-synced device (reconnecting) has already reconciled; an empty
 * device has nothing to duplicate; an empty project has nothing to
 * duplicate ONTO.
 */
export function evaluateDuplicateSeedRisk(
  input: DuplicateSeedRiskInput,
): DuplicateSeedRiskWarning | null {
  if (input.storedCursor !== 0) return null;
  if (!input.hasLocalBusinessData) return null;
  if (input.serverSeq === 0) return null;

  return {
    kind: 'duplicate_seed_risk',
    message: DUPLICATE_SEED_RISK_MESSAGE,
    guidance: DUPLICATE_SEED_RISK_GUIDANCE,
  };
}
