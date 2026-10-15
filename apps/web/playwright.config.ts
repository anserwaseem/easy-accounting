import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import { soakLaunchOptions } from 'playwright-soak-test';

const PORT = Number(process.env.E2E_PORT) || 4173;
const CI_CHROMIUM = '/opt/pw-browsers/chromium';
const SYSTEM_CHROME_MAC =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const baseLaunchOptions = existsSync(CI_CHROMIUM)
  ? { executablePath: CI_CHROMIUM }
  : process.env.PW_EXECUTABLE
  ? { executablePath: process.env.PW_EXECUTABLE }
  : existsSync(SYSTEM_CHROME_MAC)
  ? { executablePath: SYSTEM_CHROME_MAC }
  : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['playwright-soak-test/reporter']],
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
    // Linux CI/dev box has a preinstalled Chromium at this path (see repo
    // task notes — do not `playwright install` there). Everywhere else,
    // Playwright uses its own browser. PW_EXECUTABLE overrides that when
    // the downloaded browser is missing (system Chrome).
    launchOptions: baseLaunchOptions,
  },
  // Projects:
  // - desktop: runs standard desktop e2e tests (ignores mobile and soak)
  // - mobile-390x844: phone viewport layout
  // - soak: memory leak soak tests (*.soak.spec.ts) with GC exposed
  projects: [
    {
      name: 'desktop',
      testIgnore: ['mobile.spec.ts', /.*\.soak\.spec\.ts/],
    },
    {
      name: 'mobile-390x844',
      testMatch: ['mobile.spec.ts'],
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: 'soak',
      testMatch: /.*\.soak\.spec\.ts/,
      timeout: 180_000,
      use: {
        launchOptions: {
          ...baseLaunchOptions,
          ...soakLaunchOptions,
          args: [
            ...((baseLaunchOptions as { args?: string[] }).args || []),
            ...(soakLaunchOptions.args || []),
          ],
        },
        trace: 'off',
        video: 'off',
      },
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
