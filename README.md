# Easy Accounting

Desktop (Electron) and browser (PWA) accounting for a single business. Books live in SQLite on the device. Optional multi-device sync uses **your** Supabase project (BYOK).

## Features

- Accounts, journals, ledgers, invoices, inventory, vendor stock
- Works offline; sync when online
- Catalog publish (S3/R2) from desktop or browser
- Cloud backup of the SQLite file (desktop)

## Trust model (read this)

One Supabase project = one business. The join QR / invite link carries that project's URL + anon key. **Anyone with the invite can read and write the sync log and download cloud backups.** Treat it like a password. This is not zero-knowledge and not multi-tenant SaaS.

On the web, use **Chrome** (Add to Home Screen on iPhone). iOS Safari is a separate, unreliable origin — do not use it as a second device.

## Desktop

1. Download the installer for your OS.
2. See [User Manual](docs/USER_MANUAL.md) and [troubleshooting](#troubleshooting).

```sh
npm install
npm start          # desktop, port 3001
npm run package    # Mac + Windows installers
```

Node must match `.nvmrc` (`v18.20`). See `AGENTS.md` for packaging Python/Node caveats.

## Browser (PWA)

```sh
npm run web        # vite dev
npm run web:build  # production assets in apps/web/dist
```

Paste `supabase/setup.sql` into **your** Supabase SQL editor (idempotent). That creates `sync_log`, `sync_push`, and the `easy-accounting-backups` storage bucket. Then Settings → Sync → connect, or scan a join QR from a device that already has the books.

Field-test PWAs that recorded old CORE names (`024_add_uuid…`) must wipe OPFS and re-import / re-join. Close every tab of that origin first, then delete site data — a hard reload will not drop a locked OPFS database.

Deploy: [docs/web-deploy.md](docs/web-deploy.md). Point Cloudflare Workers Builds at **this** repo, production branch `main` after merge.

## Schema

Frozen desktop: `src/main/migrations/001.js`–`028.js`. New schema: `src/core/db/migrations` (`029`–`040`, next `041_…`). Both Electron and the PWA apply CORE via `bootstrapDatabase`.

## Docs

| File | Who |
|------|-----|
| `README.md` | public |
| `docs/USER_MANUAL.md` | users |
| `docs/web-deploy.md` | deploy |
| `AGENTS.md` | agents + contributors |
| `docs/derived-state-design.md` | why ledger/qty are views |

## Troubleshooting

For common issues and their solutions, please refer to our Troubleshooting Guide.

#### Q: Not able to download the app

- **(Mac)** If a dialog appears stating "Easy Accounting cannot be opened because Apple cannot check it for malicious software," then follow these steps:
  1. Press OK on the dialog.
  2. Open the Settings app, navigate to the 'Privacy & Security' section and scroll down to see a button labeled 'Open Anyway.' Click on it.
  3. If prompted, enter your system password.
  4. Another dialog will appear stating "Easy Accounting cannot be opened because Apple cannot check it for malicious software." Press 'Open' to launch the app.
- **(Windows)** If a danger icon appears besides the file being dowloaded, then follow these steps:
  1. Navigate to the downloads page of your browser.
  2. Right-click on the downloaded file.
  3. Select the 'Keep' option to complete the download.
  4. Open the file to begin the installation process.

#### Q: Not able to install the app

- **(Windows)** During the installation of the app, if a popup appears stating 'Easy Accounting cannot be closed. Please close it manually and click Retry to continue,' please try [these instructions](#q-not-able-to-update-the-app) first otherwise follow these steps:

  1. Open 'Task Manager' by pressing `Ctrl + Shift + Esc`
  2. Scroll down to find tasks labelled as 'Easy Accounting'
  3. Select each task one by one and press 'End Task' button on bottom right side.

  This will resolve the issue.

#### Q: Not able to update the app

- **(Windows)** During the installation of the app update, if a popup appears stating 'Easy Accounting cannot be closed. Please close it manually and click Retry to continue,' please follow these steps:

  1. Hover over the app's icon in the menu bar (located at the bottom).
  2. Click the cross icon (on the top right side) to close the previous instance of the application.
  3. Press the 'Retry' button on the setup dialog to continue with the installation.

  This will resolve the issue.

#### Q: How to check renderer process logs in packaged app

- **(Mac)** Press `Cmd + Option + I` Or Go to 'View' Menu, and select 'Toggle Developer Tools' option.
- **(Windows)** Press `Ctrl + Alt + I`

#### Q: How to check main process logs in packaged app

- (Mac Live) Open up terminal and Run this command to spin up the app, and logs will appear in the terminal window

```shell
/Applications/Easy\ Accounting.app/Contents/MacOS/Easy\ Accounting
```

- **(Mac)** check file `main.log` at path: `/Users/<username>/Library/Logs/easy-accounting.main.log`
- **(Windows)** check file `main.log` at path: `C:\Users\<username>\AppData\Roaming\easy-accounting\logs\main.log`

#### Q: How to check current state of electron-store

- **(Mac)** check file `config.json` at path `/Users/<username>/Library/Application Support/easy-accounting/config.json`
- **(Windows)** check file `config.json` at path `C:\Users\<username>\AppData\Roaming\easy-accounting\config.json`

#### Q: How to check db being used in packaged app

- **(Mac)** check file `database.db` at path `/Users/<username>/Library/Application Support/easy-accounting/database.db`
- **(Windows)** check directory `C:\Users\<username>\AppData\Roaming\easy-accounting\database.db`

#### Q: How to check contents of packaged app (and resources exported as-it-is like migration files)

- **(Mac)** Open `Applications` directory, find the app, right click and select 'Show Package Contents' option, navigate to `Contents/Resources` directory
- **(Windows)** check directory `C:\Users\<username>\AppData\Local\Programs\easy-accounting`

