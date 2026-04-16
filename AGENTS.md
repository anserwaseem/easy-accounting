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
├── migrations/            ← JS migration files (002, 003, … 018)
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
