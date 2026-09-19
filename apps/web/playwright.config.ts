import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT) || 4173;
const CI_CHROMIUM = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
    // Linux CI/dev box has a preinstalled Chromium at this path (see repo
    // task notes — do not `playwright install` there). Everywhere else,
    // Playwright uses its own browser (npx playwright install chromium).
    launchOptions: existsSync(CI_CHROMIUM)
      ? { executablePath: CI_CHROMIUM }
      : {},
  },
  // Two projects, split by test file rather than run every spec twice:
  // every existing spec keeps running at Playwright's default desktop
  // viewport (unchanged — those specs' selectors were written against that
  // layout), while mobile.spec.ts is the one place that actually needs the
  // 390x844 phone viewport the mobile shell/layout work targets.
  projects: [
    {
      name: 'desktop',
      testIgnore: ['mobile.spec.ts'],
    },
    {
      name: 'mobile-390x844',
      testMatch: ['mobile.spec.ts'],
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    // `vite preview` against a real production build, not `vite dev`: the
    // offline e2e test (e2e/offline.spec.ts) proves the PWA service worker
    // actually boots the app from cache with the network cut off, and SW
    // behavior under the dev server is materially different (no real
    // precache manifest, HMR's own request patterns, etc.) — the dev server
    // doesn't register a SW at all (see vite.config.ts's `devOptions`).
    // `preview` still serves the COOP/COEP headers OPFS needs.
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
