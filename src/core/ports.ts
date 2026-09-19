/**
 * Platform ports for the core package.
 *
 * Core code (services, business logic) may depend only on these interfaces —
 * never on Electron, Node, or browser APIs directly. Each platform (Electron
 * main process, web worker) supplies its own implementations.
 */

export interface CoreLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

/** Session context: which user the service calls act on behalf of. */
export interface SessionContext {
  getUsername(): string | undefined;
}

/** Minimal key-value store (electron-store on desktop, localStorage on web). */
export interface KeyValueStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

/* eslint-disable no-console */
export const consoleLogger: CoreLogger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  debug: (...args) => console.debug(...args),
};
/* eslint-enable no-console */

let coreLogger: CoreLogger = consoleLogger;

/** Install the platform logger (electron-log on desktop). Defaults to console. */
export function setCoreLogger(logger: CoreLogger): void {
  coreLogger = logger;
}

export function getCoreLogger(): CoreLogger {
  return coreLogger;
}
