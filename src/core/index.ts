/**
 * Core package: platform-free accounting logic.
 *
 * Rules of the room (enforced by ESLint import boundaries):
 *  - Nothing in src/core may import from electron, electron-*, node builtins,
 *    src/main, or src/renderer.
 *  - Platform capabilities come in through the ports (./ports) and the
 *    DatabaseDriver (./db/driver), injected by whoever hosts the core:
 *    the Electron main process today, a web worker next.
 *
 * Services were ported here from src/main/services. Electron main.ts now
 * serves account, chart, journal, ledger, pricing, and statement from this
 * package via src/main/coreRuntime.ts. Invoice, inventory, and vendor stock
 * still run on the main-process copies until those desktop-only paths are
 * ported (purchase vendor-stock effects, family-head remapping, party
 * reports).
 */

export * from './ports';
export * from './errorLogger';
export * from './db/driver';
export * from './utils/sqlite';
export type { AppApi } from './api/AppApi';
export { AccountService } from './services/AccountService';
export { ChartService } from './services/ChartService';
export { LedgerService } from './services/LedgerService';
export { PricingService } from './services/PricingService';
export { InventoryService } from './services/InventoryService';
export { JournalService } from './services/JournalService';
export { StatementService } from './services/StatementService';
export { InvoiceService } from './services/InvoiceService';
export { SettingsService } from './services/SettingsService';
export { SyncEngine } from './sync/SyncEngine';
export type { SyncReport } from './sync/SyncEngine';
export type {
  SyncTransport,
  OutboxEntry,
  PushResult,
  PushRejection,
  LogRow,
} from './sync/transport';
export {
  SupabaseSyncTransport,
  TransportError,
} from './sync/SupabaseSyncTransport';
export {
  evaluateDuplicateSeedRisk,
  DUPLICATE_SEED_RISK_MESSAGE,
  DUPLICATE_SEED_RISK_GUIDANCE,
} from './sync/connectGuard';
export type {
  DuplicateSeedRiskInput,
  DuplicateSeedRiskWarning,
} from './sync/connectGuard';
