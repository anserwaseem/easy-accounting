/**
 * Makes a `Buffer` global available in browser contexts (main thread and the
 * db worker) for `xlsx` (used both directly by src/core/services/
 * InvoiceService.ts's exportSaleInvoices, and by src/renderer/lib/lib.ts +
 * reportExport.ts) — some of its code paths branch on
 * `typeof Buffer !== 'undefined'`. Its actual write/read paths already fall
 * back to `Uint8Array` cleanly without this (verified: xlsx's own
 * `has_buf` gate additionally requires a real `process.versions.node`,
 * which a browser never has, so this alone doesn't change which code path
 * xlsx takes) — this is defense-in-depth so nothing in that dependency, now
 * or in a future version, trips over a bare `Buffer` reference.
 *
 * Deliberately does NOT polyfill `process`/`process.versions.node`: doing so
 * would make xlsx (or anything else checking it) believe it's really running
 * under Node and take code paths that assume real Node APIs (fs, zlib) that
 * don't exist here.
 */
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}
