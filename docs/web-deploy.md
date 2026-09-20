# Cloudflare — Easy Accounting web

Static Vite app (`apps/web`). Cloudflare hosts JS/CSS/wasm. Business data
never goes there — each business uses **their** Supabase project (BYOK).

## Production

Worker `easy-accounting-web` is already connected to **this** repo
(`anserwaseem/easy-accounting`). Production branch is `feat/web-pwa`
until merge, then switch it to `main`. Keep the Worker name, R2 font
bucket, and origin so installed PWAs stay on the same host.

Do **not** create a second Cloudflare project.

## Workers Builds

Workers Builds runs `npm clean-install` at **Path** before the custom
build command. Leave Path at `/` (repo root). Electron `postinstall`
skips on CI. sqlite-wasm still runs in the browser. Root `wrangler.jsonc`
deploys `apps/web/dist`. `apps/web/wrangler.jsonc` is a local preview
only.

Build command: `cd apps/web && npm ci && npm run build`  
Deploy command: `npx wrangler deploy`  
`NODE_VERSION=20`

Do not set Path to `apps/web` — that package has no `@types/react`, so
`tsc` fails.

## Headers

OPFS needs COOP + COEP (`apps/web/public/_headers`). Without them the
worker cannot open the database (blank screen).

`Cache-Control: no-cache` on `sw.js`, `registerSW.js`,
`manifest.webmanifest`. Hashed `/assets/*` stay cacheable.

`assets.not_found_handling = "single-page-application"` is the SPA
fallback. Do **not** add Pages-style `_redirects`.

Leave **Protect with Cloudflare Access** off — a phone scanning the join
QR must open this origin without a Cloudflare login.

Urdu print font: Worker route `/fonts/jameel-noori-nastaleeq.woff2` from
R2 bucket `easy-accounting-fonts` (public access Disabled). Binding name
in `wrangler.jsonc` must stay `"FONTS"`.

## After it is live

1. Re-run `supabase/setup.sql` in the SQL editor (idempotent). Creates
   `sync_log`, `sync_push`, and bucket `easy-accounting-backups`.
2. Settings → Sync → **Add a device**. Invite lives in the URL fragment
   (`#join=…`) — never sent to Cloudflare. Treat it like a password.
3. Sign in with the existing username/password (`default` / desktop
   file's password). **Phone: Chrome (Add to Home Screen), not Safari.**

### Wipe a field-test OPFS database

Close every tab/window of that origin (including an installed PWA). Then
`chrome://settings/content/all` → delete data for the host. Hard reload
does not drop a locked OPFS file. `localhost` delete wipes every port.

Old CORE names (`024_add_uuid…`) from pre-linear-clock field tests: wipe
and re-import / re-join. Do not keep mixed `migrations` bookkeeping.

### Compact the sync log after a connected-device re-import

With every device at 0 pending:

```sql
delete from sync_log where op = 'delete';
vacuum full sync_log;
```

Prefer import as first-time setup, not on a live joined device.
