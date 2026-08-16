# AGENTS.md

This file provides guidance to LLM when working with code in this repository.

## Architecture Overview

**Electron + React + better-sqlite3** accounting app built on Electron React Boilerplate. Two-process architecture:

```
src/main/                  ← Main process (Node/Electron)
├── services/              ← Business logic classes with prepared statements
│   ├── Database.service    ← SQLite singleton (better-sqlite3)
│   ├── Auth.service        ← User login/logout
│   ├── Account.service     ← Chart of accounts CRUD
│   ├── Invoice.service     ← Full invoice lifecycle (sale/purchase, return, quotation)
│   ├── Inventory.service   ← Stock management + adjustments
│   ├── Ledger.service      ← Per-account ledger entries
│   ├── Journal.service     ← Journal entries
│   ├── Chart.service       ← Chart/account hierarchy
│   ├── Print.service       ← HTML-to-PDF via webContents.printToPDF()
│   ├── Pricing.service     ← Pricing logic
│   └── Backup.service      ← Database backup
├── migrations/            ← JS migration files (001 … 023), run in name order at startup
├── errorLogger.ts
├── main.ts                ← IPC handler registration (ipcMain.handle('domain:method', …))
└── preload.ts             ← Exposes window.electron.* to renderer

src/renderer/              ← Renderer process (React 18)
├── views/                 ← Feature pages (Accounts, Invoices, Inventory, Journals, Reports, Settings)
├── components/            ← Shared UI components
├── hooks/                 ← Custom React hooks
├── lib/                   ← Utilities (reportExport.ts, utils.ts)
├── shad/ui/               ← shadcn-style components (buttons, dialogs, dataTable, datePicker, calendar, etc.)
├── routes.tsx             ← MemoryRouter-based routing
└── preload.d.ts           ← Type declarations for window.electron

src/sql/schema.sql         ← Full schema baseline (migrations add ALTER TABLE to it)
src/types/                  ← Shared TypeScript types
```

## IPC Pattern

All main-process calls go through `window.electron.*` (defined in `preload.ts`, typed in `preload.d.ts`):

- Pattern: `ipcMain.handle('domain:method', ...)` → `ipcRenderer.invoke('domain:method', ...)` → `window.electron.someMethod(...)`
- When adding new IPCs: add handler in `main.ts`, add method in `preload.ts`, add type in `preload.d.ts`

## Commands

```bash
npm start          # Dev: launches main + renderer concurrently
npm test           # Test: runs jest via electron as runtime
npm run build      # Production build (main + renderer)
npm run lint       # ESLint
npm run package    # Electron builder package
npm run patch      # Bump version (patch increment, no git tag)
```

To run a single test file:

```bash
npm test -- -- --testPathPattern="path/to/file.test.ts"
```

To run sql cmds directly on .db:

```bash
sqlite3 release/app/database.db "SELECT * FROM migrations"
```

### Packaging needs the pinned Node and an older Python

`npm run package:*` rebuilds `better-sqlite3` from source, and that step fails on
a default modern toolchain in two separate ways:

- **Node must be the pinned version.** `.nvmrc` says `v18.20` because Electron 25
  bundles Node 18.15. On Node 24 the native rebuild produces the wrong ABI even
  when it compiles.
- **Python 3.12 removed `distutils`, which node-gyp 9.4.1 imports.** On Python
  3.12+ the build dies with `ModuleNotFoundError: No module named 'distutils'`
  before it reaches any of our code.

```bash
nvm use 18.20.3 && npm_config_python=/opt/homebrew/bin/python3.11 npm run package:mac
```

`prepackage` renames the working `release/app/database.db` aside and seeds a
schema-only one in its place; `postpackage` puts it back. **`postpackage` only
runs if the build succeeds**, so a failed or interrupted package leaves the real
database at `release/app/database_backup.db`. Take a copy before packaging.

**Packaging leaves `better-sqlite3` built for the last architecture it targeted.**
`package:mac` builds arm64 then x64, so it finishes by rebuilding the native
module for x64 and every test that opens a real database then fails on an arm64
machine with `incompatible architecture (have 'x86_64', need 'arm64')`. It looks
like the test broke; nothing did. Rebuild before trusting a test run after
packaging:

```bash
npm run rebuild
```

## Cursor Rules (from `.cursor/rules/lint.mdc`)

- Always import toast from `use-toast` directly, not via a hook
- Setup new migration whenever schema changes (new table or column changes)
- New migrations must also be reflected in `schema.sql` (comment each new column with migration name)
- Use functional React components only
- Import type if possible
- Never leave unused imports
- Write comments starting from a lowercase letter
- Use lodash builtin methods where possible
- NEVER touch \*.db files — always ignore them
- Always use minimum re-renders (memoization, virtualization, splitting)
- Always write prop types for components
- Don't comment out to pass tests
- Never use `any` — always use types
- Don't use raw SQL directly in service methods — use prepared statements
- Always follow ESLint rules (extends `erb` config with typescript-eslint)
- `@typescript-eslint/no-shadow: error`, `@typescript-eslint/no-unused-vars: error`
- `no-use-before-define: [error, { functions: false }]`
- Named components: arrow functions

## Important Conventions

- **Class-based services** with prepared statements initialized in constructor
- **`@logErrors` decorator** for error logging on all services
- **SQLite date columns stored as TEXT**, compared with `datetime()` in SQL
- **Boolean SQLite values** use 0/1 with `SqliteBoolean` type wrapper (`src/main/utils/sqlite.ts`)
- **Exports** use `xlsx` library, report exports go through `src/renderer/lib/reportExport.ts`
- **Print** uses `PrintService.printPDF()` which calls `webContents.printToPDF()` for some flows; many reports instead open a **hidden iframe** with HTML + `contentWindow.print()` (save as PDF in the dialog) so virtualized tables and `print:hidden` chrome do not strip rows.
- **DataTable export/print parity:** `DataTable` exposes `onViewModelChange(rows)` — current rows **after search + column sort** (`useLayoutEffect` in `src/renderer/shad/ui/dataTable.tsx`). Reports that search/sort in `DataTable` must feed Excel + iframe print from `gridViewRows ?? sourceRows` (see `handleGridViewModelChange` + `exportPrintRows` in `src/renderer/views/Reports/InventoryHealth/index.tsx`). Do not export raw API rows if the grid filters. Ledger is different: it renders `LedgerTableBase` with the full fetched entry list for that account, not a searched subset.
- **Database** lives at `release/app/database.db` — never modify it from code
- **Reports** use `ReportLayout` component with fixed header + scrollable body, `print:hidden` on toolbar
- **Tests** use Jest with real SQLite database (in-memory or temp file), mocking `electron-log` and `electron-store`

# Agent memory

## Learned User Preferences

- Prefer small, domain-focused hooks over one large hook so no single hook becomes a behemoth.
- Stabilize callbacks passed to hooks (e.g. useCallback) when they appear in effect dependency arrays to avoid infinite re-render loops.
- Add comments to zod schema refinements and to each useEffect for clarity and future maintenance.
- Add comments to non-obvious derived state (e.g. createPolicyHint-style useMemos) explaining each branch.
- When refactoring large components: extract subcomponents and/or domain hooks first; optionally group related files in a folder with a barrel export.
- Prefer a skeptical, high-standards approach: double check assumptions and call out issues rather than agreeing by default.

## react-hook-form + Virtualization Rules

The invoice line-item table uses `useFieldArray` with `react-virtuoso` (virtual rendering). This combination has critical pitfalls:

1. **Never use `remove()` from useFieldArray with virtualized tables.** RHF's `remove()` updates `_fields` before `_formValues`; non-mounted FormFields (outside viewport) don't re-register after index shifts, leaving `_formValues` permanently stale. **Use `replace(filteredArray)` instead** — it atomically overwrites the full array.
2. **`form.getValues('invoiceItems')` returns stale ARRAY after structural ops.** Per-field reads `form.getValues('invoiceItems.${i}')` are correct. Build filtered arrays by iterating `fields` (from useFieldArray) and reading each item individually.
3. **`form.watch()` callbacks fire during useFieldArray's transitional state.** Guard structural operations (replace/append) with a `suppressWatchRef` flag so the callback doesn't read half-updated form values.
4. **Never use `useWatch('invoiceItems')` at page level.** It subscribes to ALL field changes across ALL rows → full page re-render on every keystroke. Use `form.watch()` callback (no re-render) + selective `setState` with functional updates that skip when value unchanged.
5. **Virtual cell keys must not include `row.index` on the outer element.** Use `key="${fieldKey}:${columnId}"` on `<TableCell>`. Put `row.index` only on the inner `<div>` (forces `useController` re-registration without full cell remount).

## Learned Workspace Facts

- New Invoice screen uses domain-split hooks (inventory, next number, parties, form core, sections, resolution, discounts) rather than one useNewInvoiceForm.
- Project is configured to run locally on port 3001 (npm start).
- Journal `billNumber` is set from `invoiceNumber`; journal `discountPercentage` is derived from the account’s discount profile per item type only when a single policy discount applies (otherwise left unset; missing `itemTypeId` is treated as 0%).
- Some customers have multiple accounts suffixed by item-type/discount tiers (e.g. `-T`, `-TT`); a single invoice can split ledger/journals per suffixed account while still being “one invoice per customer”.
- Customer item-type tier for sale invoices uses **account code** only (`getHeaderTypedSuffixFromCode`): split-by-type row resolution and split-off mismatch warnings; display names are not authoritative.
- **`src/sql/schema.sql` is the base schema, not the current one.** A fresh install execs it and then runs every migration on top, so it lags: it carries `attribute_definitions` but not `inventory.itemTypeId`. Anything needing the real shape (tests included) must exec the schema _and_ apply the migrations, which is what `seedBasicSchema` in `Inventory.service.test.ts` now does.
- **Migrations are covered by `src/main/migrations/__tests__/migrations.test.ts`**, which drives the real `MigrationRunner` over both paths a release meets: a fresh install, and a database left on 019. A new migration needs no new test to be covered by the fresh-install and idempotency cases; add a case only when it transforms existing rows, since nothing else checks that data survives.
- **Never renumber or edit a released migration file.** The runner keys applied state on the `name` field, so changing a name re-runs the migration on every existing install and changing the body silently skips it on installs that already recorded it.
- **Do not add "rename item" without a migration path.** `inventory.name` is the SKU, and the publishing pipeline uses it as the identity key everywhere downstream — image folder, R2 prefix, images manifest, WooCommerce `sku`, Meta feed `id`. Renaming forks the product: azs-ops' `sync_woo.py` would create a _second_ WooCommerce product at a new URL and `--prune` would draft the original, moving its order history, reviews and SEO onto a hidden product, while the new one loses its photograph (the masters folder still carries the old name). The immutability is currently enforced by omission — `UPDATE inventory` in `Inventory.service.ts` does not set `name`, and `editInventoryItem.tsx` passes `disabledFields={['name', 'quantity']}` — which reads like an oversight rather than a decision. If renaming is ever wanted it needs a coordinated rename map in azs-ops that moves the R2 prefix and updates the existing Woo product in place; see azs-ops `CLAUDE.md`.

# Deferred Tasks

- [ ] Make Settings sections Accordion-style for better organization and readability. Handle confusing global 'Save' button too.
- [ ] Supabase→client-config migration for API keys
- [ ] Stop committing real data in `release/app/database.db` (public repo). The DB is currently tracked and contains real accounts/invoices/ledger + trade prices; older snapshots are already in `origin/main` history. Plan: reuse the `prepackage-db.ts` mechanism (backs up existing DB, seeds a fresh schema-only DB from `src/sql/schema.sql`) so only a schema-only DB is ever committed — then purge existing `.db` blobs from history (filter-repo/BFG) + force-push.
- [ ] Sticky Name column in the inventory table. **Probably unnecessary now** — the per-row accordion shipped (`ItemDetailPanel.tsx`), so attributes and price-list values no longer need columns and the identifying columns stay on screen. Revisit only if someone turns enough optional columns on to scroll the name out of view again. If it is ever needed: pin the Name cell (`position: sticky; left: 0`) with a matching sticky header cell, an opaque background so scrolled content does not show through, and a right border to mark the seam. The table is virtualised (react-virtuoso), so the offset goes on the cell, not the row wrapper.

- [ ] Extend "Copy attributes from…" to multi-select: apply one source item to N selected inventory rows. The single-item case shipped (see `CopyAttributesPanel.tsx` / `copyAttributes.ts`); the bulk case needs a selection model in the inventory table plus a per-row conflict summary, since a source that fits one row may overwrite another's distinguishing value.

- [ ] Drop the `data_flags` attribute. It carried import provenance ("FILL (no fehrist match)", "CHECK (partial match)", "STOCKOUT") while the master sheet was being reconciled; that work is done and the values are now noise on 175 items. It is already private (`isPublic = 0`) so nothing leaks, but it still shows in the attributes editor and competes for attention. Delete the definition and the values together — a definition without values reads as "not filled in yet" rather than "retired".

- [ ] Consider a `lamination` boolean attribute (yes/no). Several bindings already encode it in free text ("Golden Embossed + Glossy Laminate", "Laminated Four-Color Art Card"), which means it cannot be filtered on and splits one real property across binding values. If it becomes an attribute it joins the `Features` facet automatically (see `FEATURE_FLAGS` in azs-ops `sync_woo.py`), like `tajweedi`/`zip`/`khushbu`. Worth confirming with the business first that it is a property buyers choose by, not an incidental finish.


- [ ] Search, filter and sort across everything in the inventory table: all attributes, the price-list price columns, and the Publish status column. Today search covers the name only, and sorting covers the base columns, so with 264 catalog rows the answer to "which 16-line items have no binding set" is a manual scan. This is the largest of the table tasks and probably wants a shared column-descriptor model (type, accessor, comparator) rather than per-column special cases.

- [ ] _(lowest priority)_ Un-pin `@aws-sdk/client-s3` after upgrading Electron/Node. It is pinned to exactly `3.965.0` — the last release supporting Node 18 (`3.968.0` moved to `engines: node >=20`), because Electron 25 bundles Node 18.15. Once Electron (and `.nvmrc`, currently `v18.20`) moves to Node 20+, bump to the current SDK. The pin is intentional: `^` would let npm drift into a Node-20-only release that installs with only a warning and fails at release time. Note the SDK is lazy-loaded inside `PublishService.publish()` (keeps ~18MB out of the startup graph and avoids `TextDecoder` errors in jsdom tests) — keep it that way.
