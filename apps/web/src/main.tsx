import './bufferPolyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Pure helper — no `window.electron`. Called immediately below, before
// the async boot() (and before the PWA service worker claims this page
// and reloads it) so `#join=` is copied into sessionStorage while it is
// still on the URL. See joinLink.ts.
import { consumeJoinHashFromWindow } from 'renderer/lib/joinLink';
// The real renderer's design system: Tailwind base/components/utilities
// (@tailwind directives) plus the shadcn CSS custom properties (--background,
// --foreground, etc. — see components.json's `cssVariables: true`) every
// shad/ui component reads. Normally pulled in by src/renderer/index.tsx
// (the Electron renderer's own entry) — imported directly here since that
// entry point itself is bypassed (routes.tsx is mounted straight from
// main.tsx below, not through index.tsx).
import 'renderer/styles/App.global.css';

consumeJoinHashFromWindow();

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');
const root = createRoot(container);

/**
 * Full-screen "already open elsewhere" notice, rendered INSTEAD of booting
 * the app when another tab/window of this origin already holds the
 * single-instance lock below. Plain elements + inline styles only — the
 * shadcn components can't be used here because nothing from src/renderer may
 * load before `window.electron` exists, and the shim is deliberately not
 * installed on this path (the app is not booting).
 */
function AlreadyOpenNotice() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        padding: '2rem',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>
        Easy Accounting is already open in another tab
      </h1>
      <p style={{ maxWidth: '28rem', opacity: 0.8 }}>
        This browser&apos;s database can only be opened by one tab or window at
        a time. Close the other Easy Accounting tab (or app window), then press
        Retry.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginTop: '0.5rem',
          padding: '0.5rem 1.25rem',
          borderRadius: '0.375rem',
          border: '1px solid currentColor',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Single-instance guard: OPFS sync access handles (how the SQLite worker
 * holds the database — see worker/db.worker.ts) are exclusive per file, so a
 * second live instance of this app on the same origin cannot open the
 * database and used to die at boot with a raw
 * `NoModificationAllowedError: Access Handles cannot be created...` in the
 * console and a blank screen (seen in the field with a forgotten second
 * localhost tab hiding behind the PWA window). The Web Locks API gives a
 * clean pre-flight: the first instance acquires `easy-accounting-app` and
 * holds it until its tab closes (the browser releases a held lock
 * automatically when the owning context is destroyed); any later instance
 * sees it taken (`ifAvailable: true` resolves with null instead of queuing)
 * and renders {@link AlreadyOpenNotice} WITHOUT ever creating the db worker
 * — which is why everything below is dynamically imported: statically
 * importing ./api/client would spawn the worker (and start the OPFS open) at
 * module-evaluation time, before this check could run.
 *
 * Resolves `true` when this instance owns the lock (or Web Locks is
 * unavailable — old browsers just keep today's behavior), `false` when
 * another instance does.
 */
function acquireSingleInstanceLock(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    // iOS Safari has been seen to never invoke the Web Locks callback
    // after a frozen tab. Prefer "maybe two tabs" over a permanent
    // blank screen.
    const timer = window.setTimeout(() => resolve(true), 1500);
    navigator.locks
      .request('easy-accounting-app', { ifAvailable: true }, (lock) => {
        window.clearTimeout(timer);
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        // Never settle: the lock is released only when this tab/worker
        // context is destroyed, which is exactly the lifetime the OPFS
        // handles have.
        return new Promise<void>(() => {});
      })
      .catch(() => {
        window.clearTimeout(timer);
        resolve(true);
      });
  });
}

type ClientModule = typeof import('./api/client');

let resolveClientModule: (m: ClientModule) => void;
/** Settles once boot() has loaded ./api/client (i.e. this instance owns the single-instance lock and the worker exists). Never settles on the blocked path — nothing should proceed there. */
const clientModuleLoaded = new Promise<ClientModule>((resolve) => {
  resolveClientModule = resolve;
});

/**
 * Exposes the full AppApi client on `window` for Playwright e2e specs that
 * exercise a method with no UI yet, or that cover a flow via API rather than
 * the DOM (see apps/web/e2e/renderer.spec.ts's doc comment) — the same RPC
 * client `window.electron` is built from, not a second surface.
 *
 * Assigned SYNCHRONOUSLY at module evaluation (specs read
 * `window.easyAccounting.ready` the moment the page loads, before the async
 * single-instance check in boot() below has finished), as a facade over the
 * lazily-loaded ./api/client: every `api` method call and the `ready`
 * promise transparently wait for {@link clientModuleLoaded} first. Every
 * AppApi method already returns a Promise, so the extra await changes
 * nothing observable.
 */
window.easyAccounting = {
  api: new Proxy({} as ClientModule['api'], {
    get:
      (_target, prop: string) =>
      (...args: unknown[]) =>
        clientModuleLoaded.then((m) =>
          (m.api as unknown as Record<string, (...a: unknown[]) => unknown>)[
            prop
          ](...args),
        ),
  }),
  ready: clientModuleLoaded.then((m) => m.ready),
};

async function boot(): Promise<void> {
  const isOnlyInstance = await acquireSingleInstanceLock();
  if (!isOnlyInstance) {
    root.render(<AlreadyOpenNotice />);
    return;
  }

  // Everything app-related loads only now, on the lock-holding path — see
  // acquireSingleInstanceLock's doc comment for why these cannot be static
  // imports. installElectronShim() must run before anything from
  // src/renderer is imported: renderer modules read `window.electron` at
  // module/hook-init time, not just call time.
  const [
    clientModule,
    { installElectronShim },
    { migrateBusinessSettingsFromLocalStorage },
  ] = await Promise.all([
    import('./api/client'),
    import('./electronShim'),
    import('./settingsMigration'),
  ]);
  resolveClientModule(clientModule);
  installElectronShim();

  // One-time, idempotent copy of business settings out of `localStorage`
  // into the `settings` table — see settingsMigration.ts. Not awaited:
  // it waits on worker `ready`, and Safari can take minutes to open a
  // large OPFS database. Blocking first paint on that looked like a
  // permanent white screen. The settings hooks re-read after migration.
  void migrateBusinessSettingsFromLocalStorage();

  // `?legacy=1` keeps the original minimal Accounts-only screen reachable —
  // the direct AccountService/ChartService-over-the-worker proof of
  // architecture this app started from (see git history) — for isolating a
  // worker/driver problem from a real-renderer one without the full
  // shadcn/router UI in the way. Not linked from the app anywhere;
  // dev/debug escape hatch only.
  const isLegacy =
    new URLSearchParams(window.location.search).get('legacy') === '1';

  if (isLegacy) {
    // Dynamic imports: the placeholder screen (and its plain-CSS styling,
    // ./index.css — unlayered rules that would otherwise fight
    // App.global.css's `@layer base` body theme above) have no reason to be
    // in the main bundle for the real app.
    const [{ App }] = await Promise.all([
      import('./App'),
      import('./index.css'),
    ]);
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    return;
  }

  // This pulls in the entire real renderer (src/renderer — routes, views,
  // shadcn UI) behind the shim-install above, so nothing in that tree can
  // run before `window.electron` exists.
  //
  // Not wrapped in StrictMode: src/renderer/index.tsx (the Electron
  // renderer's own entry) doesn't wrap it either, and several views assume
  // effects run once (e.g. IPC-store reads used as initial state) — this
  // keeps the browser mount behaviorally identical to desktop rather than
  // introducing StrictMode's double-invoke here for the first time.
  const [{ default: AppRoutes }, { setUrduPrintFontUrl }] = await Promise.all([
    import('renderer/routes'),
    import('renderer/lib/invoicePrint/urduFont'),
  ]);
  // same-origin Worker route → R2. must match workers/urduPrintFont.ts.
  // VITE_URDU_PRINT_FONT_URL overrides (tests / a different host). empty
  // string keeps the default. never import the 10MB file into the vite graph.
  const printFontOverride = import.meta.env.VITE_URDU_PRINT_FONT_URL;
  setUrduPrintFontUrl(
    typeof printFontOverride === 'string' && printFontOverride.trim().length > 0
      ? printFontOverride.trim()
      : '/fonts/jameel-noori-nastaleeq.woff2',
  );
  root.render(<AppRoutes />);
}

declare global {
  interface Window {
    easyAccounting: {
      api: ClientModule['api'];
      ready: ClientModule['ready'];
    };
  }
}

void boot();

/**
 * Best-effort request that the browser treat this origin's storage (OPFS
 * included) as "persistent" rather than subject to eviction under storage
 * pressure. This is advisory only — the browser may grant or deny it based
 * on its own heuristics (site engagement, install state, etc.) and there is
 * nothing actionable to do with a denial beyond noting it, so this never
 * blocks or affects app boot.
 */
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage
    .persist()
    .then((granted) => {
      console.log(`[storage] persistence ${granted ? 'granted' : 'denied'}`);
    })
    .catch((error: unknown) => {
      console.warn('[storage] persist() request failed', error);
    });
}
