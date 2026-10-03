import { test, expect, type Page } from '@playwright/test';

/**
 * BYOK ("bring your own key/backend") multi-device sync — connect wizard +
 * background loop + Settings/status UI + "join existing sync" (second
 * device), end to end.
 *
 * ## Three independent suites, different reachability stories
 *
 * 1. **Real Supabase project** (env-gated, below) — the full story: paste
 *    real `SUPABASE_URL`/`SUPABASE_ANON_KEY` env values into the actual
 *    Settings form, connect against a real project, create an account, and
 *    watch the pending outbox actually drain against `supabase/setup.sql`'s
 *    real `sync_push`/`sync_log`. Gated exactly like
 *    `src/core/sync/__tests__/supabaseTransport.integration.test.ts`: if
 *    either env var is missing, this suite prints a loud message and skips
 *    cleanly — it never fails for that reason, only skips. **This is the
 *    condition that applies in this repo's sandbox today**: neither env var
 *    is set here, so this suite is expected to (and does) skip.
 *
 * 2. **Mock transport** (always runs, below) — proves the exact same
 *    connect-wizard-through-status-through-background-loop UI plumbing
 *    works, without needing a real Supabase project or even network egress
 *    at all. The task this suite was built against flagged a real
 *    reachability risk worth checking early: Playwright's Chromium in some
 *    sandboxes reaches the network directly (bypassing the container's own
 *    HTTPS egress proxy other tools go through), which may or may not
 *    reach `*.supabase.co` depending on the sandbox's own network policy —
 *    a risk that's moot here anyway since suite 1 above never gets far
 *    enough to hit the network (no env vars to begin with). Suite 2 exists
 *    so this spec still exercises real coverage regardless: it drives the
 *    real Settings UI and the real app-shell status pill, but establishes
 *    the connection itself via the worker's dev/test-only mock hook
 *    (`window.electron.syncConnect({ mock: true, url: '', anonKey: '' })`
 *    — see apps/web/src/worker/syncManager.ts's `SyncManager.connect`,
 *    which wires an in-worker `MockSyncServer` — src/core/sync/__tests__/
 *    mockServer.ts — instead of a real `SupabaseSyncTransport` when `mock`
 *    is set) rather than pasting a URL/key into the form. Everything after
 *    that connect call — the Settings status card, the shell's
 *    `SyncIndicator` pill, the pending-count drain after a real local
 *    write, "Sync now", reload persistence, and "Disconnect" — is the same
 *    real UI suite 1 would exercise.
 *
 * 3. **"Join existing sync" UI plumbing** (always runs, below Suite 2) —
 *    the second-device flow's form, validation-error classification, and
 *    post-join success note, via the same mock hook as Suite 2. The actual
 *    cross-device pull-and-converge story it can't simulate in one browser
 *    context is proven separately by a jest unit test — see that suite's
 *    own doc comment just above it for the full reasoning.
 *
 * See this file's test run output / the task report for which of these
 * actually ran in a given environment.
 */

const { SUPABASE_URL } = process.env;
const { SUPABASE_ANON_KEY } = process.env;

function loud(lines: string[]): void {
  const bar = '='.repeat(78);
  // eslint-disable-next-line no-console
  console.warn(['', bar, ...lines, bar, ''].join('\n'));
}

async function registerAndLoginViaUi(
  page: Page,
  username: string,
  password: string,
) {
  await page.goto('/');
  await page.evaluate(() => window.easyAccounting.ready);
  await page.evaluate(
    async ({ username: u, password: p }) => {
      const ok = await window.easyAccounting.api.register({
        username: u,
        password: p,
      });
      if (!ok) throw new Error('setup register() returned false');
    },
    { username, password },
  );
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
  await page.locator('input[placeholder="Username"]').fill(username);
  await page.locator('input[placeholder="Password"]').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 10_000 });
}

/** Creates an account through the real Accounts view's "New Account" dialog — the local write suite 2 uses to prove the outbox actually drains. */
async function createAccountViaUi(page: Page, accountName: string) {
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await page.getByRole('button', { name: 'New Account' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox').click();
  await page
    .getByRole('option', { name: 'Current Asset', exact: true })
    .click();
  await dialog.getByLabel('Account Name').fill(accountName);
  await dialog.getByRole('button', { name: 'Submit' }).click();

  await expect(
    page.getByText(`"${accountName}" account created successfully`, {
      exact: true,
    }),
  ).toBeVisible({ timeout: 10_000 });
}

async function goToSettings(page: Page) {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Suite 1 — real Supabase project (env-gated, mirrors the integration test).
// ---------------------------------------------------------------------------

test.describe('BYOK sync — real Supabase project (env-gated)', () => {
  test('connects through the Settings UI, drains the pending outbox, and survives a reload', async ({
    page,
  }) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      loud([
        'SKIPPING sync.spec.ts — real Supabase suite',
        'SUPABASE_URL and/or SUPABASE_ANON_KEY are not set in the environment.',
        'This is expected in the default e2e run — this suite only runs against',
        'a real Supabase test project (with supabase/setup.sql already applied).',
        'The always-on mock-transport suite in this same file covers the UI',
        'plumbing regardless; see this file’s header doc comment.',
      ]);
      test.skip(
        true,
        'SUPABASE_URL / SUPABASE_ANON_KEY not set — see supabaseTransport.integration.test.ts for the identical gate.',
      );
      return;
    }

    // Browser-egress precheck: the page's worker fetches Supabase DIRECTLY
    // (browsers don't read HTTPS_PROXY), so in sandboxes whose only outbound
    // path is an egress proxy this suite can never pass even though the
    // Node-side integration tests (which do use the proxy) are green. Probe
    // from a real page context and skip loudly if direct egress is blocked.
    await page.goto('/');
    const egressOk = await page.evaluate(async (url) => {
      try {
        const res = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/health`, {
          signal: AbortSignal.timeout(8000),
        });
        return res.status < 500;
      } catch {
        return false;
      }
    }, SUPABASE_URL);
    if (!egressOk) {
      loud([
        'SKIPPING sync.spec.ts — real Supabase suite',
        'The browser cannot reach the Supabase project directly (no direct',
        'egress from this sandbox; browsers ignore HTTPS_PROXY). The protocol',
        'itself is live-verified by supabaseTransport.integration.test.ts,',
        'and the mock-transport suite below covers the UI plumbing. Run this',
        'suite on a machine with normal internet access.',
      ]);
      test.skip(
        true,
        'browser has no direct egress to the Supabase project in this environment',
      );
      return;
    }

    const stamp = Date.now();
    const username = `sync-e2e-${stamp}`;
    const password = 'sync-e2e-password';
    const accountName = `Sync E2E Account ${stamp}`;

    await registerAndLoginViaUi(page, username, password);
    await goToSettings(page);

    await page.getByLabel('Project URL').fill(SUPABASE_URL);
    await page.getByLabel('Anon public API key').fill(SUPABASE_ANON_KEY);
    await page.getByRole('button', { name: 'Connect' }).click();

    await expect(page.getByTestId('sync-connected-card')).toBeVisible({
      timeout: 20_000,
    });

    await createAccountViaUi(page, accountName);

    await goToSettings(page);
    await expect(page.getByText(/0 pending change/)).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(page.getByText('Signed in as')).toBeVisible({
      timeout: 10_000,
    });
    await goToSettings(page);
    await expect(page.getByTestId('sync-connected-card')).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText('Sync complete.', { exact: true })).toBeVisible(
      {
        timeout: 15_000,
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — mock transport (always runs; see this file's header doc comment).
// ---------------------------------------------------------------------------

test.describe('BYOK sync — mock transport (worker test hook, network-independent)', () => {
  test('the real Settings/status UI reflects a connect, a write draining to 0 pending, a reload, sync now, and disconnect', async ({
    page,
  }) => {
    const stamp = Date.now();
    const username = `sync-mock-e2e-${stamp}`;
    const password = 'sync-mock-e2e-password';
    const accountName = `Sync Mock E2E Account ${stamp}`;

    await registerAndLoginViaUi(page, username, password);

    // Establish the connection via the worker's dev/test-only mock hook —
    // see this file's header doc comment for why suite 2 does this instead
    // of pasting a URL/key into the form. Everything from here on drives
    // (and verifies) the same real UI suite 1 exercises.
    const connectResult = await page.evaluate(() =>
      window.electron.syncConnect!({ url: '', anonKey: '', mock: true }),
    );
    expect(connectResult.ok).toBe(true);

    await goToSettings(page);
    await expect(page.getByTestId('sync-connected-card')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('mock (local, no network)')).toBeVisible();

    // The app-shell status pill (src/renderer/components/SyncIndicator.tsx)
    // reflects it too, independent of the Settings screen.
    await expect(page.getByTestId('sync-indicator').first()).toBeVisible({
      timeout: 10_000,
    });

    // A local write schedules a debounced background sync (see
    // syncManager.ts's `scheduleDebouncedSync`, hooked into every mutating
    // RPC call in db.worker.ts) — the pending outbox must reach 0 with no
    // manual "Sync now" at all.
    await createAccountViaUi(page, accountName);
    await goToSettings(page);
    await expect(page.getByText(/0 pending change/)).toBeVisible({
      timeout: 15_000,
    });

    // Reload -> still connected: the device-scoped config persisted to
    // web_kv (see SyncManager.bootIfConfigured), independent of the
    // business session.
    await page.reload();
    await expect(page.getByText('Signed in as')).toBeVisible({
      timeout: 10_000,
    });
    await goToSettings(page);
    await expect(page.getByTestId('sync-connected-card')).toBeVisible({
      timeout: 10_000,
    });

    // "Sync now" works on demand.
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText('Sync complete.', { exact: true })).toBeVisible(
      {
        timeout: 10_000,
      },
    );

    // Disconnect returns the card to the connect form and drops the pill.
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('sync-indicator')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — "Join existing sync" (second-device flow) UI plumbing.
//
// A real cross-device join (device A pushes real data on one MockSyncServer
// instance, device B — a genuinely separate browser context — joins and
// pulls it) is impossible to simulate in ONE Playwright run: the mock
// server lives inside the worker's own in-memory instance
// (src/core/sync/__tests__/mockServer.ts), so a second browser context gets
// a completely fresh, empty MockSyncServer of its own — joining it would
// prove nothing. That actual pull-and-converge story is proven instead by
// a jest unit test (src/core/sync/__tests__/SyncEngine.test.ts — see "(i)"
// below in that file) against two in-memory device databases sharing one
// real `MockSyncServer`, using the exact same `SyncEngine.initialPull` this
// worker's `SyncManager.join` calls.
//
// What THIS suite covers instead, per the task's own "acceptable fallback":
// the Join form only appears on an empty device, real (non-mock) validation
// failures are classified with guidance exactly like the Settings connect
// form, a mock join actually completes through the real click path (not a
// bypassed RPC call), and the Login screen's post-join success note
// actually renders.
// ---------------------------------------------------------------------------

test.describe('Join existing sync — UI plumbing (mock transport, network-independent)', () => {
  test('the Join form is offered on an empty device, classifies a real validation failure, completes a mock join, and lands back on Login with a success note', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(() => window.easyAccounting.ready);

    // A brand-fresh device — nobody has registered/logged in yet, so
    // AuthCheck redirects straight to Login — has no accounts or journals
    // (the boot-created placeholder user + starter chart don't count; see
    // db.worker.ts's `ensurePlaceholderDefaultUser` and Login's own
    // `canJoinSync` check) and offers "Join existing sync" right there.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
    const joinLink = page.getByRole('link', { name: 'Join existing sync' });
    await expect(joinLink).toBeVisible({ timeout: 10_000 });

    await joinLink.click();
    await expect(
      page.getByRole('heading', { name: 'Join existing sync' }),
    ).toBeVisible();
    const joinButton = page.getByRole('button', { name: 'Join' });
    await expect(joinButton).toBeDisabled();

    // A real (non-mock) attempt against an unreachable project fails and is
    // classified with guidance, exactly like the Settings connect form —
    // same underlying `classifySyncError`, same rendering.
    await page
      .getByLabel('Project URL')
      .fill('https://not-a-real-project-e2e.supabase.co');
    await page.getByLabel('Anon public API key').fill('not-a-real-anon-key');
    await expect(joinButton).toBeEnabled();
    await joinButton.click();
    await expect(
      page.getByRole('heading', { name: 'Could not join' }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(
      page.getByRole('heading', { name: 'Join existing sync' }),
    ).toBeVisible();

    // Force this next call through the worker's dev/test-only mock hook —
    // the same escape hatch Suite 2 uses for `syncConnect`, just wired
    // through the real click path here rather than called directly, so the
    // form's own `joining` -> `done` transition and the Login screen's
    // post-join success note are both exercised as real UI, not asserted
    // structurally. Nothing about the join flow itself is bypassed: this
    // still goes through the real `window.electron.syncJoin` ->
    // `sync:join` RPC -> `SyncManager.join` (boot-placeholder cleanup +
    // `SyncEngine.rebuildFromServer` — join always rebuilds from zero, see
    // that method's doc comment) end to end.
    await page.evaluate(() => {
      const realSyncJoin = window.electron.syncJoin!;
      window.electron.syncJoin = (config) =>
        realSyncJoin({ ...config, mock: true });
    });

    await page
      .getByLabel('Project URL')
      .fill('https://mock-project-placeholder.supabase.co');
    await page
      .getByLabel('Anon public API key')
      .fill('mock-anon-key-placeholder');
    await joinButton.click();

    await expect(page.getByRole('heading', { name: 'Joined' })).toBeVisible({
      timeout: 15_000,
    });
    // Join refuses an EMPTY server log by design (nothing to join — see
    // SyncManager.join's doc comment), so mock mode pre-seeds its
    // MockSyncServer with a minimal joinable business
    // (SyncManager.seedMockJoinFixture: one credentialed user + one chart
    // head, FK sibling and all) — this join therefore pulls those real rows
    // through the full rebuild-from-zero apply path, like every real join.
    await expect(
      page.getByText(/^Pulled [1-9]\d* rows?\. Data synced/),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Continue to Login' }).click();
    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
    await expect(
      page.getByText('Data synced — sign in with your existing account.', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('a #join= fragment prefills the Join form and is scrubbed from the address bar', async ({
    page,
  }) => {
    // Encode here rather than importing src/renderer/lib/joinLink.ts —
    // Playwright's test runner is CJS and cannot load that ESM file.
    // Keep this in lockstep with encodeJoinHash (joinLink.ts).
    const url = 'https://example-project.supabase.co';
    const anonKey = 'eyJ-e2e-anon-key';
    const token = Buffer.from(JSON.stringify({ u: url, k: anonKey }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    await page.goto(`/#join=${token}`);
    await page.evaluate(() => window.easyAccounting.ready);

    await expect(
      page.getByRole('heading', { name: 'Join existing sync' }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel('Project URL')).toHaveValue(url);
    await expect(page.getByLabel('Anon public API key')).toHaveValue(anonKey);
    expect(new URL(page.url()).hash).toBe('');

    // Service-worker autoUpdate reloads the (now hashless) URL. The invite
    // must still prefill after that, from sessionStorage.
    await page.reload();
    await page.evaluate(() => window.easyAccounting.ready);
    await expect(
      page.getByRole('heading', { name: 'Join existing sync' }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel('Project URL')).toHaveValue(url);
    await expect(page.getByLabel('Anon public API key')).toHaveValue(anonKey);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — connect-time duplicate-seed guard, warning card rendering (test
// hook, network-independent).
//
// The guard's actual go/no-go DECISION (`evaluateDuplicateSeedRisk`,
// src/core/sync/connectGuard.ts) is unit-tested directly — see
// src/core/sync/__tests__/connectGuard.test.ts — because it is a pure
// function reachable by the root jest suite. Reproducing the underlying
// three-way condition for real (a genuinely never-synced device, with local
// business data, connecting to a project that already has OTHER data on it)
// is not reachable from a single Playwright run: it requires two truly
// independent origins/devices, which is exactly the incident this guard
// exists to prevent, and exactly what suite 3's header doc comment explains
// one mock-server-per-worker-instance can't simulate either. What THIS
// suite covers instead, per the task's own documented fallback: the
// Settings UI actually renders the amber warning card (not the ordinary red
// error alert) for a `duplicate_seed_risk` result, with the exact copy and
// the [Cancel] / [Connect anyway] choice, and that "Connect anyway" really
// does retry with `force: true` and lands on the normal connected state —
// driven via a monkey-patched `window.electron.syncConnect` (the same test
// hook idiom suite 3 uses for `syncJoin`), not a bypassed click path.
// ---------------------------------------------------------------------------

test.describe('Connect-time duplicate-seed guard — warning card rendering (test hook, network-independent)', () => {
  test('a duplicate_seed_risk result renders the amber warning card with Cancel/Connect anyway, Cancel dismisses it, and Connect anyway retries with force and connects', async ({
    page,
  }) => {
    const stamp = Date.now();
    const username = `sync-guard-e2e-${stamp}`;
    const password = 'sync-guard-e2e-password';

    await registerAndLoginViaUi(page, username, password);

    // Force the FIRST (non-forced) syncConnect call to come back exactly as
    // SyncManager.connect's real guard would for a duplicate-seed risk, and
    // let a `force: true` retry fall through to the real mock connect — so
    // "Connect anyway" is proven to actually reconnect, not just dismiss a
    // dialog.
    await page.evaluate(() => {
      const real = window.electron.syncConnect!;
      window.electron.syncConnect = (config) => {
        if (config.force) return real({ ...config, mock: true });
        return Promise.resolve({
          ok: false,
          error: {
            kind: 'duplicate_seed_risk' as const,
            message:
              'This sync project already contains data. If this device\'s data is an independent copy (e.g. imported separately), connecting will DUPLICATE the business on the server. If this device should receive the server\'s data, use "Join existing sync" from the Login screen (empty device required). Continue only if you are intentionally seeding additional data.',
            guidance:
              'Click "Connect anyway" only if you mean to add this device\'s data as new, additional business data on the server — not if it is meant to be the same business as what is already there.',
          },
        });
      };
    });

    await goToSettings(page);
    await page
      .getByLabel('Project URL')
      .fill('https://guard-e2e-placeholder.supabase.co');
    await page
      .getByLabel('Anon public API key')
      .fill('guard-e2e-placeholder-key');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    const warningCard = page.getByTestId('duplicate-seed-warning');
    await expect(warningCard).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('heading', { name: 'This project already has data' }),
    ).toBeVisible();
    await expect(warningCard.getByText(/DUPLICATE the business/)).toBeVisible();
    await expect(warningCard.getByText(/Join existing sync/)).toBeVisible();

    // Cancel dismisses the warning without connecting — the plain Connect
    // form comes back, no connected card anywhere.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(warningCard).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Connect', exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('sync-connected-card')).toHaveCount(0);

    // Trigger it again, and this time follow through with "Connect anyway".
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(warningCard).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Connect anyway' }).click();

    await expect(page.getByTestId('sync-connected-card')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('mock (local, no network)')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — "Add a device" QR / copy-link dialog (mock connection + stubbed
// invite, network-independent).
//
// A real invite needs a stored non-mock url+anonKey (SyncManager.getJoinInvite
// returns null for mock). This suite stubs that RPC so the dialog, QR image,
// and copy button are proven as real UI without a live Supabase project.
// ---------------------------------------------------------------------------

test.describe('Add a device — QR / copy-link dialog', () => {
  test('the connected card offers Add a device; the dialog shows a QR and a copy-link button', async ({
    page,
  }) => {
    const stamp = Date.now();
    await registerAndLoginViaUi(
      page,
      `sync-invite-e2e-${stamp}`,
      'sync-invite-e2e-password',
    );
    const connectResult = await page.evaluate(() =>
      window.electron.syncConnect!({ url: '', anonKey: '', mock: true }),
    );
    expect(connectResult.ok).toBe(true);

    await goToSettings(page);
    await expect(page.getByTestId('sync-connected-card')).toBeVisible({
      timeout: 10_000,
    });

    await page.evaluate(() => {
      window.electron.syncGetJoinInvite = async () => ({
        url: 'https://example-project.supabase.co',
        anonKey: 'eyJ-e2e-anon-key',
      });
    });

    await page.getByRole('button', { name: 'Add a device' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Add a device' }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('img', { name: /QR code to join/ }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Copy invite link' }),
    ).toBeVisible();
  });
});
