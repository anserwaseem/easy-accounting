# Web app field notes — quirks, rules of thumb, and recovery recipes

Lessons from real multi-device testing of the browser build (PWA + sync).
Everything here was hit in practice at least once.

The field-test origin is still
`easy-accounting-web.ansercrypto.workers.dev`, built from
`anserwaseem/easy-accounting-web`. Canonical product code is now
`anserwaseem/easy-accounting` on `feat/web-pwa`. Do not add more
product work in the clone. See `docs/web-deploy.md` before pointing
Cloudflare at this repo.

## Every browser origin is a separate sync device

The local database lives in OPFS, which is scoped to the page's **origin**
(scheme + host + port). So `http://localhost:5173` (vite dev) and
`http://localhost:4173` (vite preview / the installed PWA) are two
completely independent devices: separate databases, separate device ids,
separate sync cursors, separate stored sync configs.

This cuts both ways:

- Useful: a dev-server tab is a legitimate "second device" for testing
  sync convergence on one machine.
- Dangerous: a forgotten dev tab with an old import and a persisted sync
  config will auto-connect on load and push its (divergent) copy of the
  books at the shared project. If a stale origin is not being used for
  anything, wipe it (below) rather than leaving it dormant.

## Actually wiping a device (OPFS will fight you)

The database worker keeps the OPFS files open with synchronous access
handles. While any tab of that origin is running, Chrome **cannot delete
those files** — both "Empty cache and hard reload" and even DevTools →
Application → Storage → **Clear site data** can silently leave the
database behind (the button reports success; the File System usage number
stays put).

Reliable wipe recipe:

1. Close **every** tab/window of that origin (the dev server process can
   keep running; it's the browser pages that hold the lock). If the PWA is
   installed, close the app window too.
2. Open `chrome://settings/content/all`, search the host (e.g.
   `localhost`), open the entry, **Delete data**.

   **WARNING — this list groups by site, not origin.** The single
   `localhost` entry covers **every port**: deleting its data wipes the
   dev server (5173) AND the preview/PWA (4173) in one click. There is no
   per-port choice here. If other localhost devices must survive, use the
   DevTools "Clear site data" route on the doomed origin instead — after
   closing every tab of that origin first, then reopening one tab just to
   run the clear before the worker re-acquires its file handles — or
   accept the full localhost wipe and re-seed afterwards. (This was
   learned the hard way: a 5173 cleanup silently took the 4173 PWA's
   database with it.)

3. Reopen the app and verify in DevTools → Application → Storage that
   "File System" shows ~0–2 MB (a fresh empty database), not the old
   size.

The `[storage] persistence denied` console line just means Chrome declined
_guaranteed_ storage for a plain tab. An installed PWA in regular use is
effectively never evicted, and "Export my data" is the belt-and-braces
backup either way.

## Import vs. Join — first device imports, every other device joins

- **First device only**: "Import from desktop app" → connect sync → its
  copy seeds the project.
- **Every later device**: "Join existing sync" → pulls everything →
  log in with the existing username/password. Never import here.

Importing on a second device generates fresh row uuids for the same
business data; the server's copy has different uuids, so sync cannot match
them and every row duplicates (or collides on natural keys like
usernames). The Login screen enforces this by only offering "Join
existing sync" while the device has zero accounts and zero journals — if
the Join link is missing, the device isn't empty (see the wipe recipe).

## Re-importing on a connected device doubles the server log

An import on a device that is already connected must announce the change
to its peers, so it writes the wipe as ~one `delete` tombstone per old row
plus one `put` per imported row into the sync log. That's semantically
correct (peers converge to the imported data) but it roughly doubles the
log's size on the server.

Recovery: tombstones below every device's cursor are dead weight. With all
devices synced (0 pending everywhere), run in the Supabase SQL Editor:

```sql
delete from sync_log where op = 'delete';
vacuum full sync_log;
```

This halves the log after an import-over-data cycle. (`vacuum full` takes
a brief exclusive lock — fine while the only clients are our sync loops.)

Rule of thumb: treat import as first-time setup. Avoid re-importing on a
connected device; if it must happen, run the compaction afterwards.

### The post-import pull hump (57014 statement timeout)

Right after a big connected-device import finishes pushing, the importing
device's own next pull has to scan past every row it just pushed (they're
filtered out server-side, but Postgres still walks them) before finding
anything to return. On a free-tier instance that one scan can exceed the
API roles' default 8s statement timeout — the device shows "Last sync
attempt failed … 57014 canceling statement due to statement timeout" every
cycle while its peers sync fine, and it cannot heal on its own (the cursor
only jumps past the block once a pull completes). setup.sql now raises the
roles' statement_timeout to 60s (re-run it on existing projects to pick
that up), and running the compaction above shrinks the scan itself. Once
one pull completes, steady state is milliseconds again.

## What normal sync traffic looks like

- **Bootstrap push** (first connect after an import): one `sync_push` POST
  per 200 outbox entries — a ~142k-row business is ~700 requests, a few
  minutes, single-digit MB of egress. One-time cost.
- **Join** (second device): pages of `sync_log` GETs until caught up
  (~10 MB compressed for the same business), then steady state.
- **Steady state**: 2 small GETs (~1.6 kB total) every 30 seconds per open
  device, plus a debounced cycle ~3 s after local writes. A device never
  re-downloads its own pushed rows (they're filtered server-side by
  `device_id`).

If the network tab shows a device downloading large `sync_log` pages long
after it's caught up, something is wrong — capture it and investigate;
that pattern cost real egress twice during development (own-echo
re-download before the `device_id=neq` filter, and a stale device pulling
a log it had already seen after its cursor was lost).

## Updating the app in place

A rebuilt deploy (or `npm run build && npm run preview` locally) reaches
the installed PWA through the service worker on the next reload — OPFS
data, sync config, and device id all survive. Updating the app never
requires re-importing or re-joining. Only wiping the origin's site data
resets the device.

Offline PWA locally is `npm run web:build && npm --prefix apps/web run
preview`. Vite **dev has no service worker**.

**Exception — iOS Safari.** A reload often keeps a stale service worker
and a stale worker bundle. Field test (Sep 2026): deploys that changed
the Login toast never appeared on Safari despite dozens of refreshes,
while Chrome on the same phone ran the new code. Treat Chrome (or an
installed Chromium PWA) as the phone device. See **iOS Safari is not a
supported second device** below.

## Adding another device (QR / invite link)

Once any device is connected, Settings → Sync → **Add a device** shows a
QR of `https://<public-origin>/#join=<base64(url+anonKey)>` plus a
copy-link button. On localhost you type the https URL phones should
open (the hosted app) — a phone camera cannot open `http://127.0.0.1`.
That URL is remembered on the device after you enter it; nothing is
baked into the app. The payload is in the **fragment**, so Cloudflare/the
host never see the anon key; the receiving device copies it into
sessionStorage and strips `#join=` from the address bar as soon as it
reads it (so a service-worker reload of the hashless URL still prefills
Join). Scan with a phone → Join form is prefilled → Join this project →
sign in.

Treat that link like a password. Production hosting steps (Cloudflare
Workers static assets, private repo, COOP/COEP headers) live in
`docs/web-deploy.md`.

## If the server log is ever wiped

If `sync_log` gets truncated/reset on the server (accidentally or
otherwise), no manual re-import is needed anymore. Any device that still
holds the business's data notices on its own next sync cycle (≈30s) that
the server's log is empty while it has real data and nothing pending in
its own outbox, and automatically re-queues every current row for
re-upload. That same cycle pushes it straight back out, so the server is
repopulated within one sync interval — the app just logs a warning
(`"server log is empty but this device holds data — re-seeding N
row(s)..."`) and keeps going; nothing needs to be clicked.

Every other already-connected device detects its now-stale cursor as an
"epoch reset" on its own next sync and re-pulls from scratch, converging
back onto the exact same rows (same uuids) — not duplicates. A device that
hasn't joined yet just needs the data-holding device to sync at least once
first; after that, "Join existing sync" works normally.

If more than one device holds the business's data (the ordinary case once
sync is up and running), it's fine for more than one to reseed at once —
the reseed key is deterministic per row, so the server dedups the repeats
instead of doubling anything.

**Hazard note**: this is exactly the failure mode that motivated the
automatic recovery above. The Supabase SQL Editor keeps the previously-run
query sitting in its buffer — re-running a tab without checking what's in
it (e.g. an old `truncate sync_log` left over from a prior cleanup) is how
this actually happens in practice. Clear or replace the editor's buffer
after any maintenance query, rather than leaving it loaded.

## iOS Safari is not a supported second device

Parked after a week of field testing (Sep 2026) against a ~288k-row
business on `easy-accounting-web.ansercrypto.workers.dev`. Chrome on the
same iPhone (Add to Home Screen / in-app browser) joined, signed in,
synced, logged out, and logged back in. Safari did not become a reliable
copy. **Use Chrome (or desktop) as the phone device. Do not keep
chasing Safari login.**

### Safari and Chrome on iPhone are two devices

iOS gives Safari and Chrome **separate website data** even on the same
URL. OPFS, the sqlite-wasm database, `device_id`, sync cursor, and
session are not shared. A healthy Chrome PWA says nothing about the
Safari tab, and vice versa.

### What actually happened in the field

1. **QR join from Safari.** `#join=` in the fragment was consumed then
   scrubbed; the PWA service worker reloaded the hashless URL and dropped
   the invite until it was stashed in `sessionStorage` (`joinLink.ts`,
   inline script in `apps/web/index.html`).
2. **Safari `fetch` "Load failed" / hung requests.** Join of ~288k rows
   is many sequential pulls. Safari drops or never completes a `fetch`
   after the tab is frozen. Credentials used to persist only _after_ the
   pull, so Settings looked disconnected; later we persist after probe
   and resume the cursor. Hung fetches still left the UI on
   **syncing…** with 0 pending. Mitigations in tree: `fetchWithRetry` +
   30s abort, do not kick a second `syncOnce` the instant join finishes,
   stale-syncing UI falls back to last-sync time after 45s. None of that
   makes Safari a good daily driver.
3. **Blank white screen without `#join=`.** First React paint waited on
   worker `ready` (settings migration). Opening a large OPFS DB on Safari
   can take minutes, so the page stayed on the default light background.
   `#join=` felt different only because that tab was left open long
   enough. Fix in tree: paint immediately ("Starting…"), run timestamp
   repair _after_ `ready`.
4. **Edited pills on every invoice.** Same-day create-then-save, join
   stamping `updatedAt` to today, and a twice-seeded log (desktop import +
   PWA import). Calendar-day pill + `repairInvoiceEditedTimestamps`. The
   repair used to run only at the end of a sync cycle, so a hung Safari
   sync never cleared the pills.
5. **141k "rows need review".** Second seed in `sync_log` hit UNIQUE /
   missing-parent FK. Those rows are discarded now, not quarantined.
   Compaction recipe is still in **Re-importing on a connected device**.
6. **Logout then cannot log in (username `default`, password correct).**
   Re-join wipes local rows and replays the log. A leftover
   `localStorage` session still opened the dashboard without checking
   the password. After logout, `users.password_hash` on that device was
   empty or unusable (origin capture can race the hash insert; a later
   log row with NULL hash used to overwrite). Login returned false with
   the same toast as a wrong password.
   - Login screen showed **Join existing sync** → this Safari origin
     had **zero accounts and zero journals** (`Login/index.tsx`
     `canJoinSync`). It was not the Chrome books. Do not Join again
     from there; Chrome already holds the live copy.
   - The toast still mentioned auto-capitalization after deploys that
     changed it → Safari was running a **stale service worker**, not
     the new worker bundle.
     Mitigations in tree (may never reach a stuck Safari tab): case-
     insensitive username, decode wasm BLOB hashes, do not start the
     background pull on a logged-out boot, do not apply a NULL
     `password_hash` over an existing one, if the device _has_ business
     data but no usable hash then save the typed password and sign in.
     **Do not spend more time proving those on iOS Safari.**

### Rules of thumb

- Phone: **Chrome PWA** (or desktop). Not Safari.
- If Login offers **Join existing sync**, that origin is empty. Joining
  it replays the whole log (~288k rows, tens of minutes, easy to leave
  mid-way). Prefer the device that already has the books.
- iOS Safari will not reliably pick up a Cloudflare deploy on refresh.
  Close every tab of the origin and delete Website Data for
  `*.workers.dev` only if you intentionally want a **new empty** Safari
  device — that does not fix Chrome, and it does not migrate the old
  Safari DB.
- `users.username` for this business is `default` (desktop import).
  Login is local (`users.password_hash`), not a network check.

## Catalog publish from the browser

Settings → Publish now generates the catalogs in the worker and PUTs them
with AWS Signature Version 4 (`apps/web/src/worker/s3Put.ts`). Secrets stay
in `web_kv` on this device; connection fields sync through `settings`.

The object store must allow this origin. A typical CORS rule:

```json
[
  {
    "AllowedOrigins": ["https://easy-accounting-web.ansercrypto.workers.dev"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": [
      "Authorization",
      "Content-Type",
      "x-amz-content-sha256",
      "x-amz-date"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Add `http://localhost:5173` and `http://localhost:4173` while developing.
The images-manifest host must allow GET from the same origins (preview
counts photographs by fetching that JSON). A failed PUT that looks like
"Failed to fetch" is almost always CORS, not a bad signature.

This code is on `feat/web-pwa`. Production still builds from
`easy-accounting-web` until Cloudflare Git is switched — see
`docs/web-deploy.md`.

## Remaining web work (Safari parked)

Shipped: local-first PWA, BYOK sync in the browser, import, join/QR,
export, accounting UI, report/`window.print()`, catalog publish (config,
price lists, preview, SigV4 upload), vendor stock / Urdu / party reports
on `src/core`. Electron now runs those services through core.

Still open, in useful order:

1. **Compact the live Supabase log** (ops, not code) once every device
   shows 0 pending: `delete from sync_log where op = 'delete'; vacuum
full sync_log;` and re-run `supabase/setup.sql` if statement_timeout
   is still 8s. The project log has two overlapping seeds.
2. **Prove a live web publish** against the real bucket (CORS + one
   successful Publish now). Code is in this repo; production still
   deploys from the clone until Git is switched.
3. **Sync inside the Electron app** — renderer Join/Sync UI is gated on
   `supportsSync`; preload never sets it. The PWA worker already has
   `SyncManager`.
4. **Batch PDF export** (`printToPdf`) and **folder backups** — web has
   `window.print()` and **Export my data** instead.
5. **Conflict review screen** — duplicate-seed rows are discarded; other
   apply conflicts still only increment a count.
6. Merge `feat/web-pwa` when calling it production, then point Cloudflare
   Git at this repo (see `docs/web-deploy.md`). Custom domain optional.
