import log from 'electron-log';
import {
  AccountService,
  ChartService,
  JournalService,
  LedgerService,
  PricingService,
  SettingsService,
  StatementService,
  setCoreLogger,
} from '../core';
import type { DatabaseDriver, SessionContext } from '../core';
import { BetterSqliteDriver } from './adapters/BetterSqliteDriver';
import { DatabaseService } from './services/Database.service';
import { store } from './store';

/**
 * Wires the platform-free core to the Electron main process: better-sqlite3
 * behind the async driver, electron-log as the core logger, electron-store
 * as the session source.
 *
 * Live IPC in main.ts currently uses this bundle for account, chart, journal,
 * ledger, pricing, and statement. Invoice and inventory stay on
 * src/main/services until vendor-stock purchase effects, family-head
 * remapping, and the purchases/sales-by-party reports are ported into core.
 */

setCoreLogger({
  info: (...args) => log.info(...args),
  warn: (...args) => log.warn(...args),
  error: (...args) => log.error(...args),
  debug: (...args) => log.debug(...args),
});

export const session: SessionContext = {
  getUsername: () => store.get('username') as string | undefined,
};

let driver: DatabaseDriver | undefined;

export function getCoreDriver(): DatabaseDriver {
  if (!driver) {
    driver = new BetterSqliteDriver(
      DatabaseService.getInstance().getDatabase(),
    );
  }
  return driver;
}

let settingsServiceInstance: SettingsService | undefined;

/**
 * Lazily-constructed singleton, same pattern as {@link getCoreDriver} —
 * business settings (src/core/services/SettingsService.ts) are read/written
 * from several places that don't otherwise share a services object, so this
 * is exported directly rather than folded into {@link createCoreServices}'s
 * bundle.
 */
export function getSettingsService(): SettingsService {
  if (!settingsServiceInstance) {
    settingsServiceInstance = new SettingsService({ db: getCoreDriver() });
  }
  return settingsServiceInstance;
}

export function createCoreServices() {
  const db = getCoreDriver();

  const accountService = new AccountService({ db, session });
  const chartService = new ChartService({ db, session });
  const ledgerService = new LedgerService({ db, session });
  const pricingService = new PricingService({ db, session });
  const journalService = new JournalService({ db, session, ledgerService });
  const statementService = new StatementService({
    db,
    session,
    chartService,
    accountService,
    ledgerService,
  });
  const settingsService = getSettingsService();

  return {
    accountService,
    chartService,
    ledgerService,
    pricingService,
    journalService,
    statementService,
    settingsService,
  };
}
