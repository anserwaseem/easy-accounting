import {
  DUPLICATE_SEED_RISK_GUIDANCE,
  DUPLICATE_SEED_RISK_MESSAGE,
  evaluateDuplicateSeedRisk,
} from '../connectGuard';

/**
 * Unit tests for the pure decision behind `SyncManager.connect`'s
 * connect-time duplicate-seed guard — see connectGuard.ts's doc comment for
 * why this lives here (jest-able) rather than only provable end-to-end
 * against apps/web (which has no jest runner of its own — see
 * apps/web/e2e/sync.spec.ts for the companion UI-rendering coverage).
 */
describe('evaluateDuplicateSeedRisk', () => {
  it('warns when a never-synced device with local business data connects to a non-empty project — the real incident this guards against', () => {
    const result = evaluateDuplicateSeedRisk({
      storedCursor: 0,
      hasLocalBusinessData: true,
      serverSeq: 42,
    });
    expect(result).toEqual({
      kind: 'duplicate_seed_risk',
      message: DUPLICATE_SEED_RISK_MESSAGE,
      guidance: DUPLICATE_SEED_RISK_GUIDANCE,
    });
  });

  it('lets a genuinely first connect through: empty project, nothing to duplicate onto', () => {
    expect(
      evaluateDuplicateSeedRisk({
        storedCursor: 0,
        hasLocalBusinessData: true,
        serverSeq: 0,
      }),
    ).toBeNull();
  });

  it('lets an empty device through: nothing local to duplicate, regardless of the server', () => {
    expect(
      evaluateDuplicateSeedRisk({
        storedCursor: 0,
        hasLocalBusinessData: false,
        serverSeq: 42,
      }),
    ).toBeNull();
  });

  it('lets a reconnect through: this device has synced before (non-zero cursor), so it has already reconciled', () => {
    expect(
      evaluateDuplicateSeedRisk({
        storedCursor: 17,
        hasLocalBusinessData: true,
        serverSeq: 42,
      }),
    ).toBeNull();
  });

  it('lets the fully-empty case through (no data anywhere, never synced)', () => {
    expect(
      evaluateDuplicateSeedRisk({
        storedCursor: 0,
        hasLocalBusinessData: false,
        serverSeq: 0,
      }),
    ).toBeNull();
  });
});
