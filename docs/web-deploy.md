# Cloudflare — Easy Accounting web

The browser build is a static Vite app (`apps/web`) that talks to **your**
Supabase project (BYOK). Cloudflare only hosts the JS/CSS/wasm; business
data never goes there. The repo can stay **private**.

## Do not reconnect GitHub yet

Production still builds from `anserwaseem/easy-accounting-web` on
`claude/easy-accounting-mobile-offline-nirxt3`. The Worker name
(`easy-accounting-web`), R2 bucket, and `*.workers.dev` origin stay as
they are. These files are here so a future switch is a dashboard Git
change, not a rewrite of the deploy.

When you are ready to switch:

1. Point the existing Cloudflare Worker project at
   `anserwaseem/easy-accounting` (this repo).
2. Set **Production branch** to `feat/web-pwa` until that branch merges
   to `main`.
3. Leave the Worker **name**, R2 bucket, and custom domain (if any)
   unchanged so phones keep the same origin.

Do **not** create a second Cloudflare project.

## Workers Builds

Cloudflare's current dashboard "Import a Git repository" flow is
**Workers Builds** (`npx wrangler deploy`), not the older Pages
"build output directory" form. There is a small Worker script
(`workers/urduPrintFont.ts`) that only handles
`/fonts/jameel-noori-nastaleeq.woff2` from R2. sqlite-wasm still
runs in the browser. `wrangler.jsonc` at the repo root points the
deploy at `apps/web/dist`. `apps/web/wrangler.jsonc` is assets-only
for a local `cd apps/web && npx wrangler deploy` preview — production
uses the root config.

Workers Builds always `npm clean-install`s at **Path** _before_ the
custom build command. Leave Path at `/` (repo root). The Electron
`postinstall` is skipped on CI; then the build command installs and
builds `apps/web`. Do not set Path to `apps/web` — that package has no
`@types/react` of its own, so `tsc` fails.

## Why these headers exist

SQLite-wasm's OPFS VFS needs the page to be cross-origin isolated
(COOP + COEP). Locally `vite.config.ts` sets those on `vite dev` /
`vite preview`. In production they come from `apps/web/public/_headers`,
copied into `dist/` by the Vite build. Without them the worker cannot
open the database and the app shows a blank screen.

Wrangler's `assets.not_found_handling = "single-page-application"` is
the SPA fallback so `/join-sync` and `/settings` still serve
`index.html`. Do **not** add a Pages-style `/* /index.html 200` file at
`_redirects` — Workers rejects that as an infinite loop.

## Dashboard setup (after Git is switched to this repo)

Leave **Protect with Cloudflare Access** off — a phone scanning the
"Add a device" QR must open this origin without a Cloudflare login.

1. Repository: `anserwaseem/easy-accounting`.
2. Project name: keep `easy-accounting-web` (the existing Worker).
3. **Build command:** `cd apps/web && npm ci && npm run build`
   (not `npm run build` at the repo root — that is the Electron app).
4. **Deploy command:** leave `npx wrangler deploy`.
5. **Path:** `/` (repo root).
6. **Production branch:** `feat/web-pwa` until merged to `main`.
7. **Environment variable:** `NODE_VERSION` = `20`.
   No `VITE_URDU_PRINT_FONT_URL` needed — production uses the same-origin
   Worker route `/fonts/jameel-noori-nastaleeq.woff2` (R2). Bucket
   `easy-accounting-fonts` already exists. Public access stays **Disabled**
   — the Worker binding reads it; do not flip the bucket public.

   Binding in `wrangler.jsonc` must stay `"FONTS"`. If `wrangler r2 bucket
create` rewrote it to `easy_accounting_fonts`, revert that file
   (`git checkout -- wrangler.jsonc`). Then:

   ```bash
   npx wrangler r2 object get easy-accounting-fonts/jameel-noori-nastaleeq.woff2 --file /tmp/jameel-check.woff2 --remote
   ls -lh /tmp/jameel-check.woff2   # expect ~9.5M
   ```

   Re-upload only if that get fails:

   ```bash
   ./scripts/upload-urdu-print-font.sh \
     src/renderer/fonts/JameelNooriNastaleeq.ttf
   ```

   Dashboard Objects tab can sit at 0 B for a bit after a CLI upload.
   Trust `wrangler r2 object get`, not a stale empty UI. Do **not** put
   the TTF in `apps/web/public` or the PWA precache.

8. API token: "+ Create new token" / auto-create is fine.
9. Optional: uncheck **Builds for non-production branches** unless you
   want a preview URL per git branch.
10. Deploy. First build takes a couple of minutes; later pushes to the
    production branch deploy automatically.

Optional: attach a custom domain. The PWA install + `#join=` links use
whatever origin you open (`*.workers.dev` is fine).

## After it is live

On a **connected** device (PWA or the Cloudflare URL, already
joined/imported):

Settings → Sync → **Add a device** — scan the QR with a phone, or copy
the invite link. The other device opens this app, lands on Join with the
project URL and anon key prefilled, and pulls the books down. You still
sign in with the existing username/password (`default` / the desktop
file's password). **On iPhone use Chrome (Add to Home Screen), not
Safari** — iOS Safari is a separate, unreliable origin. See
`docs/web-field-notes.md` ("iOS Safari is not a supported second
device").

Treat the invite link like a password: anyone who has it can join this
project. The payload lives in the URL **fragment** (`#join=...`), so it
is never sent to Cloudflare; the receiving device strips it from the
address bar as soon as it is read.

## Re-running `setup.sql`

A Cloudflare deploy does **not** change the Supabase project.
`supabase/setup.sql` still has to be applied in the SQL editor of
**your** project (idempotent). New devices only need the invite — they
do not re-run setup.sql.
