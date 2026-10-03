import packageJson from '../../package.json';

/**
 * product version from the repo-root package.json. both the electron
 * renderer and the web shim read this so Settings never depends on a
 * platform-only ipc. packaged electron can still overlay `app.getVersion()`
 * (release/app/package.json) when that call is available.
 */
export const APP_VERSION: string = packageJson.version;
