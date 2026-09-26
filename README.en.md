# dsh-security-manager

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)

**A security manager for DSH plugins.** Read-only static audit of the plugins installed in a profile,
a **risk diff before you update**, and **snapshot-backed rollback** — including rolling back a single package.

> Scope: plugin listing, enable state and fiber phase are provided by DSH itself
> (`pluginInventory` + Settings → Plugins → All). This plugin deliberately does **not** duplicate that;
> it only adds the security work DSH does not have. See [`docs/adaptation-2026-09.md`](docs/adaptation-2026-09.md).

[中文](./README.md)

---

## ✨ Features

### 1. Plugin security audit (local, read-only)

Per-plugin findings with evidence (file:line + snippet):

| Category | Check | Severity |
|---|---|---|
| Install-time | `preinstall` / `install` / `postinstall` | **high** (runs on registry install) |
| Install-time | `prepare` — graded by **how it was installed** | git/local source **high** · registry source low |
| Supply chain | `file:`/`link:`/`portal:` local source | medium |
| Supply chain | `*` / `latest` unpinned | medium |
| Supply chain | lockfile without `integrity` | low |
| Supply chain | `github:` / `git+` source | low |
| Capability | dynamic execution (`eval` / `new Function` / `vm`, real runtime code only) | medium |
| Capability | credential / settings access (`.credentials.yaml`, `settings.yaml`, `DSH_HOME`) | low |
| Capability | subprocess / network / file writes | **info (inventory, not scored)** |
| Metadata | missing `license` / `repository` | low |
| Runtime | reported `failed` by the official inventory | medium |

- 0–100 score + A–D grade. Capability inventory is **not scored**, so noise does not drown out real risk.
- Comments are masked (length-preserving) and only executed runtime files (`.js`/`.mjs`/`.cjs`) are scanned,
  so a plugin's own JSDoc is never reported as dangerous code.
- The audited plugin's code is **never executed**.

### 2. Update impact preview

Fetch the candidate version's `package.json` and diff the risk-relevant fields: newly added or changed
install-time scripts, dependency set changes, license and repository changes. Turns a blind update into
an informed one.

### 3. Snapshot-backed rollback

- Automatic snapshot of `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml` before every update
- **Snapshot diff**: what would change if you returned to that snapshot (added / removed / changed per package)
- **Roll back one package** to the spec recorded in a snapshot, leaving other plugins untouched
  (a safety snapshot is taken first, so the rollback itself is reversible)
- **Restore all** protected files and reinstall

---

## 📦 Install

```powershell
# from GitHub (pnpm's github: protocol)
dsh plugin --profile web add "github:Kolos-alter/dsh-security-manager"

# or build a tarball and install it locally
cd dsh-security-manager
pnpm pack
cd "$env:DSH_HOME\profiles\web"
pnpm add "file:<absolute path to the .tgz>"
```

Mount it in the profile's `cordis.patch.yml` (hot reload, no restart needed):

```yaml
- insert:
    - id: security-manager
      name: dsh-security-manager
      config:
        # all optional
        # home: 'D:\DeepSeekHarness-Portable\home'
        # profile: web
        # pnpmPath: 'C:\path\to\pnpm.cmd'   # recommended for portables without pnpm on PATH
        # scan: true                        # disable the capability scan for a faster audit
```

Refresh the page and open **Settings → Plugins → Security**.

---

## 🖥️ Usage

- **Header**: overall score / grade, high·medium·low·info counts, re-audit
- **Plugin cards**: installed version, install source (`spec` first; local sources are labelled explicitly),
  scored findings with evidence
  - **Check update** — query the latest npm version
  - **Preview update** — risk diff for the candidate version (red warning when it introduces high risk)
  - **Update** — snapshot first, then update
- **Snapshot history**: **Diff** lists per-package changes; **Roll back this package** for reversible
  entries; **Restore all** for a full rollback
  - Note: if a package is absent from the snapshot, a single-package rollback cannot remove it —
    the UI says so explicitly instead of pretending otherwise

---

## 🔌 Host API

| Route | Method | Purpose |
|---|---|---|
| `/api/security-manager/audit` | GET | Local static audit: score, per-plugin findings, capability inventory |
| `/api/security-manager/snapshots` | GET | Snapshot history |
| `/api/security-manager/snapshot` | POST `{label}` | Create a snapshot |
| `/api/security-manager/update-check` | POST `{package}` | npm metadata (latest version + repository) |
| `/api/security-manager/update-preview` | POST `{package, version?}` | Risk diff for a candidate version |
| `/api/security-manager/update` | POST `{package, version?, ref?}` | Update (snapshot first) |
| `/api/security-manager/snapshot-diff` | POST `{snapshot}` | Per-package changes since that snapshot |
| `/api/security-manager/rollback-package` | POST `{package, snapshot}` | Roll back one package only |
| `/api/security-manager/rollback` | POST `{snapshot}` | Restore a whole snapshot |

---

## 🧪 Verification without a running DSH

```powershell
npm test          # 22 unit tests (node --test)
npm run audit     # audit the current home/profile, prints JSON
npm run preview   # verify the update-preview pipeline against the real npm registry (read-only)
```

`npm test` includes a regression test for the comment false-positive and a **browser-free client
render test** (fakes `__ModuleLoader__` and a minimal React, executes the real bundle).

### Measured on a real profile (example)

```
@nanmicoder/dsh-agent-teams  0.1.17-rc.1 → 0.1.21   preview: high=0 medium=0 low=5
dsh-better-sidebar           0.19.0      → 0.21.1   preview: high=0 medium=0 low=2
dsh-security-guard           prepare script (git/local source) → high
dsh-security-manager         local tarball dependency → medium
```

---

## 📂 Layout

```
dsh-security-manager/
├── lib/
│   ├── index.js     # Host half: webServer routes (thin glue)
│   ├── manager.js   # source location / snapshot / update / rollback / diff (pure Node)
│   ├── audit.js     # audit engine + update-impact preview (pure Node, read-only)
│   └── client.js    # Client half: Settings → Plugins → Security (__ModuleLoader__ format)
├── test/            # node --test: audit / manager / client
├── tools/           # read-only verification scripts against the real environment
├── docs/            # DSH capability comparison and decisions (with measured evidence)
└── CHANGELOG.md
```

---

## 🛡️ Safety boundaries

- The audit is **read-only**: it reads files and metadata of installed packages and never executes their code
- Updates only target **discovered installed plugins** and always **snapshot first**; package names are
  validated against a whitelist before reaching `pnpm` (path traversal, backslashes and illegal specs are rejected)
- Per-package rollback also takes a safety snapshot first, so the rollback itself is undoable
- Read-only routes (audit / snapshots / update-check / update-preview / snapshot-diff) modify nothing

## 📄 License

[MIT](./LICENSE) © Kolos-alter
