# dsh-security-manager

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)

**dsh-security-manager** is a plugin manager for DeepSeek Harness (DSH): it auto-discovers the
plugins installed in a profile, locates their **npm / GitHub** source, and provides
**snapshot-backed update and rollback** — all from a **Settings → Plugins → Security** tab in the web UI.

[中文](./README.md)

---

## ✨ Features

- 🔍 **Auto-discovery**: reads the profile's `package.json` dependencies and lists every installed plugin (no manual registry)
- 🧭 **Source location**: identifies npm publication status and the GitHub repository for each plugin
  - published on npm → queries `registry.npmjs.org` for the latest version
  - GitHub-only (not on npm) → resolves `github:<owner>/<repo>` from the package's `repository` field
- 📸 **Snapshot protection**: backs up `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml` before every update; roll back to any snapshot anytime
- 🔁 **Update / rollback**: works for both **npm-sourced** and **GitHub-sourced** plugins
- 🎨 **Native UI**: mirrors the shipped DSH settings design (CSS variables, cards, badges, zh/en), purely additive (`replaceRisk: none`)
- 🛡️ **Security category**: known security plugins are tagged "Security" and listed first

## 📦 Install

### A. GitHub repo (recommended after publishing)

```powershell
dsh plugin --profile web add "github:Kolos-alter/dsh-security-manager"
```

Then mount it in the profile's `cordis.patch.yml` (hot-reloaded, no restart):

```yaml
- insert:
    - id: security-manager
      name: dsh-security-manager
      config:
        pnpmPath: 'C:\path\to\pnpm.cmd'   # optional; absolute path for portables
```

### B. npm (if published)

```powershell
dsh plugin --profile web add dsh-security-manager
```

### C. Local development

```powershell
git clone https://github.com/Kolos-alter/dsh-security-manager.git
cd "$env:DSH_HOME\profiles\web"
pnpm add "file:..\..\..\..\Kolos-alter\dsh-security-manager"
```

Refresh the page: Settings → Plugins → **Security**.

## ⚙️ Configuration

All optional (cordis patch `config`):

| Field | Default | Description |
|---|---|---|
| `home` | `$DSH_HOME` or `~/.dsh` | DSH data directory |
| `profile` | `web` | profile to manage |
| `pnpmPath` | `pnpm` (PATH) | pnpm executable; use an absolute path for portable installs |

## 🖥️ Usage

Open **Settings → Plugins → Security**. The list shows every **auto-discovered** plugin:

- green badge = security plugin (listed first)
- blue badge = source: `npm` / `GitHub` / `npm+GitHub` / unknown
- current version and GitHub repository shown

Per plugin: **Check update** (npm latest + repo info), **Update** (snapshot first), **Rollback** (restore a snapshot that contains the plugin). Snapshot history at the bottom supports direct rollback.

## 🔌 HTTP API (host, same-origin)

| Route | Method | Description |
|---|---|---|
| `/api/security-manager/status` | GET | discovered plugins (version / source / repo / security) |
| `/api/security-manager/snapshots` | GET | snapshot history |
| `/api/security-manager/snapshot` | POST `{label}` | create a snapshot |
| `/api/security-manager/update-check` | POST `{package}` | npm metadata (latest + repo) |
| `/api/security-manager/update` | POST `{package, version?}` | update (npm or GitHub source, snapshot first) |
| `/api/security-manager/rollback` | POST `{snapshot}` | restore a snapshot |

## 🔬 How it works

1. **Discover**: reads `profiles/<profile>/package.json` dependencies + each package under `node_modules`
2. **Locate**: npm via `registry.npmjs.org` (`dist-tags.latest` + `repository`); GitHub via the package's `repository` field
3. **Update**: `pnpm add` (npm: `<pkg>[@version]`; GitHub: `github:<owner>/<repo>[#ref]`)
4. **Rollback**: restore the 3 protected files from a snapshot + `pnpm install`

## 🧪 Standalone test (no DSH needed)

```powershell
node lib/manager.js --self-test
```

## 📂 Structure

```
dsh-security-manager/
├── lib/
│   ├── index.js    # Host half: cordis plugin + webServer JSON routes
│   ├── manager.js  # core: discovery / source location / snapshot / update / rollback (pure Node)
│   └── client.js   # Client half: Settings "Security" tab (__ModuleLoader__ format)
├── package.json    # dsh.client declaration + metadata
└── README.md / README.en.md / LICENSE
```

## 🛡️ Security notes

- Updates only ever target **auto-discovered installed plugins**, and always **snapshot first**
- Read-only routes (status / snapshots / update-check) never modify files
- No arbitrary command execution: updates install a specific package via pnpm; the source comes from package metadata
- Package names are **allowlist-validated** before entering update / update-check (rejects path traversal, backslashes, `..`, and other non-spec names)
- Snapshots live in `profiles/<profile>/.security-snapshots/`

## 📄 License

[MIT](./LICENSE) © Kolos-alter
