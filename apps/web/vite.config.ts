import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// serialize-javascript@7 (via workbox → @rollup/plugin-terser) reads the
// Web Crypto global. Node 18 — this repo's .nvmrc — does not have it.
// Pin is in package.json overrides; this covers a worker thread that
// still loads the old package.
if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');

// SQLite-wasm's OPFS VFS (and the SAH-pool VFS fallback) require the page to
// be "cross-origin isolated", which the browser only grants when these two
// response headers are present. Needed in both `vite dev` and `vite preview`
// — the smoke e2e drives one of these servers directly.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  root: dirname,
  resolve: {
    alias: [
      // Core is platform-free business logic that lives outside apps/web
      // (src/core). Imported directly by subpath (not through src/core/index.ts,
      // which is a barrel that pulls in every service) so nothing has to
      // import more of core than it actually uses.
      { find: '@core', replacement: path.resolve(repoRoot, 'src/core') },
      // src/core imports domain types as the bare specifier `from 'types'`
      // (see src/core/services/AccountService.ts) — the root Electron build
      // resolves this via tsconfig `baseUrl: "./src"` + Jest's
      // `moduleDirectories`; Vite has neither, so it needs an explicit alias.
      {
        find: 'types',
        replacement: path.resolve(repoRoot, 'src/types/index.ts'),
      },
      // The real renderer (src/renderer — mounted here in place of the
      // former placeholder Accounts screen) resolves its own bare/aliased
      // imports the same way the root Electron build does: tsconfig
      // `baseUrl: "./src"` (bare `renderer/...`) and `paths: { "@/*":
      // ["./*"] }` (`@/renderer/...`, `@/main/...`, `@/types`, `@/shared/...`
      // — src/renderer/views/Settings/PublishSettings.tsx reaches into
      // `@/main/utils/catalog`, a platform-free pure module). '@' must come
      // after '@core' so it never swallows that more specific prefix.
      { find: '@', replacement: path.resolve(repoRoot, 'src') },
      { find: 'renderer', replacement: path.resolve(repoRoot, 'src/renderer') },
    ],
    // src/renderer is mounted from outside apps/web, but its React tree must
    // still share the exact React/React-DOM module instance apps/web's own
    // entry (main.tsx) creates the root with — both `react` and `react-dom`
    // are dependencies of both package.json's, so without this each side
    // resolves its own copy via upward node_modules lookup (apps/web's
    // installs its own; src/renderer, being outside apps/web entirely,
    // resolves the repo root's) and React's hooks break across the
    // boundary ("Invalid hook call") since two React copies never share
    // dispatcher state.
    dedupe: ['react', 'react-dom'],
  },
  css: {
    postcss: {
      // shadcn/Tailwind UI lives in src/renderer and is styled by the ROOT
      // design system (tailwind.config.js, components.json) — reused as-is
      // via its file path rather than forked. The root Electron build wires
      // the same two plugins inline in webpack (postcss-loader options in
      // .erb/configs/webpack.config.renderer.*.ts); this mirrors that
      // instead of adding a postcss.config file, so there's exactly one
      // place that lists them.
      plugins: [
        tailwindcss(path.resolve(repoRoot, 'tailwind.config.js')),
        autoprefixer(),
      ],
    },
  },
  define: {
    // Some browser-targeted polyfills (e.g. the `buffer` package used by
    // src/bufferPolyfill.ts for xlsx — see that file's doc comment) expect a
    // Node-style `global`. `globalThis` is the standards-based equivalent in
    // every environment this app runs in (window, worker).
    global: 'globalThis',
  },
  // @sqlite.org/sqlite-wasm ships its own wasm asset loading; letting esbuild
  // pre-bundle it in dev has been unreliable for OPFS builds upstream, so it
  // is excluded from dependency optimization (documented gotcha).
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: {
    // The db worker uses ES module imports (of @core/* and the wasm
    // package); Vite's default worker output format is 'iife', which cannot
    // contain import statements.
    format: 'es',
  },
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  build: {
    target: 'es2022',
  },
  plugins: [
    react(),
    VitePWA({
      // 'generateSW' (the default strategy) builds the service worker from
      // `workbox.globPatterns` below rather than a hand-written SW source —
      // plenty for an app-shell + precache setup with no custom routing
      // logic needed.
      registerType: 'autoUpdate',
      // The manifest icons (below) are already under public/icons and thus
      // already picked up by workbox.globPatterns — skip the plugin's
      // separate "also fetch+precache every manifest icon" pass so each
      // icon isn't precached twice under two different manifest entries.
      includeManifestIcons: false,
      // Only register the SW against a real production build. `vite dev`
      // serves unbundled ESM straight from source (no dist/ to precache,
      // and a different, unstable set of request URLs on every reload) —
      // registering a SW there would fight the dev server's own caching
      // rather than help it. `vite preview` serves the real build, which is
      // what both the manifest/icons and the offline e2e test are for.
      devOptions: { enabled: false },
      manifest: {
        name: 'Easy Accounting',
        short_name: 'Easy Acct',
        description:
          'Offline-capable accounting app shell running the real core services on SQLite-wasm/OPFS.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // Matches src/index.css: body background and the primary button's
        // accent color.
        background_color: '#f5f6f8',
        theme_color: '#2f6fed',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // `skipWaiting`+`clientsClaim` so a first-time install takes control
        // of the page that triggered it immediately (no second reload
        // needed before the SW is actually in the request path) — the
        // offline e2e test relies on this.
        skipWaiting: true,
        clientsClaim: true,
        // Default globPatterns omit `.wasm`; the sqlite3 wasm binary (and
        // the db worker + the sqlite3-wasm package's own nested worker
        // scripts, all plain `.js`) must be part of the precache or the app
        // cannot boot its database offline.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        // never precache print fonts. Noto (~260KB woff2) loads on first
        // Urdu invoice; Jameel (optional, multi-MB) is runtime-only via
        // VITE_URDU_PRINT_FONT_URL. a 25MB ttf in the app-shell precache
        // would make every PWA install unusable on typical PK connections.
        globIgnores: ['**/*.{ttf,otf,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\.(?:woff2?|ttf|otf)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'urdu-invoice-fonts',
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
        // SPA fallback: any navigation not otherwise matched (there's only
        // one route today, but this is what makes a hard offline reload of
        // '/' resolve from the precache instead of failing the navigation).
        navigateFallback: 'index.html',
      },
    }),
  ],
});
