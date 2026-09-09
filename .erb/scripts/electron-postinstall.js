/* eslint-disable no-console */
/**
 * Electron postinstall: native-deps check + webpack DLL.
 *
 * Cloudflare Workers Builds always runs `npm clean-install` at the configured
 * root *before* the custom build command. At the repo root that would compile
 * the Electron renderer (and demand webpack env vars). Skip on CI hosts;
 * local `npm install` is unchanged.
 */
const { execSync } = require('child_process');

if (
  process.env.CI ||
  process.env.CF_PAGES ||
  process.env.WORKERS_CI ||
  process.env.SKIP_ELECTRON_POSTINSTALL
) {
  console.log('Skipping Electron postinstall on CI.');
  process.exit(0);
}

execSync(
  'ts-node .erb/scripts/check-native-dep.js && electron-builder install-app-deps && cross-env NODE_ENV=development TS_NODE_TRANSPILE_ONLY=true webpack --config ./.erb/configs/webpack.config.renderer.dev.dll.ts',
  { stdio: 'inherit' },
);
