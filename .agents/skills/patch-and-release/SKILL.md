---
name: patch-and-release
description: Standard operating procedure for bumping patch versions, building, packaging, and publishing desktop and web releases for Easy Accounting. Use when the user requests a patch, release, deployment, or publishing new binaries/updates.
---

# Easy Accounting Release Runbook

This skill defines the exact, end-to-end workflow to bump versions, package multi-platform binaries (macOS arm64, macOS x64, Windows x64), publish to GitHub Releases, and trigger PWA deployments.

---

## Prerequisites & Environment Requirements

1. **Pinned Node Version:** Electron 25 requires Node 18 (use `.nvmrc`: `18.20.3`).
2. **Pinned Python for node-gyp:** `better-sqlite3` rebuild requires Python ≤3.11 (`/opt/homebrew/bin/python3.11`).
3. **GitHub CLI Auth:** `GH_TOKEN=$(gh auth token)` for electron-builder to upload draft release assets.

---

## End-to-End Workflow

### Step 1: Bump Version Across All Sub-Packages
Easy Accounting has 3 `package.json` files that must stay in sync:
- Root `package.json`
- `release/app/package.json`
- `apps/web/package.json`

Run:
```bash
npm run patch:release
```
*(Verify that all 3 print the new target version, e.g. `v0.3.3`).*

---

### Step 2: Stage, Commit, and Tag
Stage modified package files and changes:
```bash
git add apps/web/package-lock.json apps/web/package.json \
        package-lock.json package.json \
        release/app/package-lock.json release/app/package.json \
        <any other modified files>

git commit -m "<type>(<scope>): <summary> (vX.Y.Z)"
git tag -a vX.Y.Z -m "<summary> (vX.Y.Z)"
```
*(Pre-commit hooks will run prettier, eslint, and tsc automatically).*

---

### Step 3: Push to GitHub
Push both the `main` branch and the new release tag:
```bash
git push origin main
git push origin vX.Y.Z
```

---

### Step 4: Build and Upload Multi-Platform Binaries
Run `npm run release` with the pinned toolchain. This packages macOS (arm64 & x64 DMG/ZIP) and Windows (NSIS EXE) and uploads assets directly to GitHub Releases as a draft:

```bash
source ~/.nvm/nvm.sh && nvm use 18.20.3 && npm_config_python=/opt/homebrew/bin/python3.11 GH_TOKEN=$(gh auth token) npm run release
```

> [!IMPORTANT]
> **Immediately restore native module for host architecture:**
> `npm run release` targets x64 at the end, which leaves `better-sqlite3` built for x64. Run this immediately after release finishes so local tests don't fail:
> ```bash
> source ~/.nvm/nvm.sh && nvm use 18.20.3 && npm_config_python=/opt/homebrew/bin/python3.11 ./node_modules/.bin/electron-rebuild --parallel --types prod,dev,optional --module-dir release/app
> ```

---

### Step 5: Publish the GitHub Release (Undraft & Set Latest)
Electron-builder leaves the GitHub release in draft state. Make it public and latest with clear release notes:

```bash
gh release edit vX.Y.Z --draft=false --latest --repo anserwaseem/easy-accounting --notes "## What's Changed

• <bullet points of key changes>"
```

Verify release assets:
```bash
gh release view vX.Y.Z --repo anserwaseem/easy-accounting
```

---

### Step 6: Deploy Web PWA (Optional / When Web is Affected)
Trigger the web deployment workflow in `azs-ops`:
```bash
gh workflow run deploy-ea-web.yml --repo anserwaseem/azs-ops --ref main
```

Monitor run status:
```bash
gh run list --repo anserwaseem/azs-ops --workflow=deploy-ea-web.yml --limit 1
```
