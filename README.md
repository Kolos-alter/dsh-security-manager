# dsh-security-manager

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)

**dsh-security-manager** 是一个 DeepSeek Harness（DSH）插件管理器：自动识别 profile 中已安装的插件，
定位其 **npm / GitHub** 来源，并提供**快照保护的更新与回退**——全部集成在 Web 的
**设置 → 插件 → 安全** 标签页中。

[English](./README.en.md)

---

## ✨ 功能

- 🔍 **自动识别插件**：读取 profile 的 `package.json` 依赖，自动发现已安装的插件（无需手动登记名单）
- 🧭 **定位来源**：对每个插件识别其 npm 发布状态与 GitHub 仓库
  - 已发布 npm → 查询 `registry.npmjs.org` 获取最新版本
  - 仅有 GitHub 仓库（未发 npm）→ 从包内 `repository` 字段解析仓库，用 `github:<owner>/<repo>` 更新
- 📸 **快照保护**：每次更新前自动备份 `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml`，
  可一键回退到任意快照
- 🔁 **更新 / 回退**：来自 **npm 源**或 **GitHub 源**的插件都可更新；更新坏了随时回退
- 🎨 **原生 UI**：仿照 DSH 现有设置页设计（CSS 变量、卡片、徽章、双语 zh/en），
  纯增量（`replaceRisk: none`），不影响现有功能
- 🛡️ **安全分类**：已知安全插件自动打上"安全"标记并排在最前

## 📦 安装

### 方式 A：GitHub 仓库（推荐，发布后）

```powershell
# 1. 安装包（pnpm 的 github: 协议，或先 clone 后用本地路径）
dsh plugin --profile web add "github:Kolos-alter/dsh-security-manager"

# 2. 在 profile 的 cordis.patch.yml 挂载（热加载，无需重启）
```

```yaml
# profiles/web/cordis.patch.yml
- insert:
    - id: security-manager
      name: dsh-security-manager
      config:
        # 可选：pnpm 不在 PATH 时指定可执行文件
        pnpmPath: 'C:\path\to\pnpm.cmd'
        # 可选：home（默认 $DSH_HOME 或 ~/.dsh）、profile（默认 web）
```

### 方式 B：npm（若已发布）

```powershell
dsh plugin --profile web add dsh-security-manager
```

### 方式 C：本地开发

```powershell
git clone https://github.com/Kolos-alter/dsh-security-manager.git
cd dsh-security-manager
# 在 profile 目录执行（相对路径，避免空格路径问题）
cd "$env:DSH_HOME\profiles\web"
pnpm add "file:..\..\..\..\Kolos-alter\dsh-security-manager"
```

安装后**刷新页面**：设置 → 插件 → **安全** 标签页即出现。

## ⚙️ 配置

插件通过 cordis.patch.yml 的 `config` 字段配置（全部可选）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `home` | `$DSH_HOME` 或 `~/.dsh` | DSH 数据目录 |
| `profile` | `web` | 管理的 profile 名 |
| `pnpmPath` | `pnpm`（PATH） | pnpm 可执行文件；便携版/非 PATH 环境建议填绝对路径 |

## 🖥️ 使用

1. 打开 **设置 → 插件 → 安全** 标签页
2. 列表展示**自动识别**的所有已安装插件：
   - 绿色徽章 = 安全类插件（排最前）
   - 蓝色徽章 = 来源：`npm` / `GitHub` / `npm+GitHub` / 未知
   - 显示当前版本与 GitHub 仓库
3. 每个插件可：
   - **检查更新**：查询 npm 最新版 + 仓库信息
   - **更新**：更新前自动创建快照（`before-update-<包名>`），随后从识别到的源更新
   - **回退**：回退到包含该插件的历史快照
4. 底部**快照历史**：列出所有快照，可单独回退

## 🔌 提供的能力（API）

Host 半通过 webServer 提供 JSON 路由（同源访问）：

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/security-manager/status` | GET | 自动识别的插件列表（版本 / 来源 / 仓库 / 安全标记） |
| `/api/security-manager/snapshots` | GET | 快照历史 |
| `/api/security-manager/snapshot` | POST `{label}` | 创建快照 |
| `/api/security-manager/update-check` | POST `{package}` | npm 元数据（最新版 + 仓库） |
| `/api/security-manager/update` | POST `{package, version?}` | 更新（npm 或 GitHub 源，先快照） |
| `/api/security-manager/rollback` | POST `{snapshot}` | 回退到快照 |

## 🔬 工作原理

1. **自动发现**：读 `profiles/<profile>/package.json` 的 `dependencies`，逐个读 `node_modules` 下的包信息
2. **来源定位**：
   - npm：`https://registry.npmjs.org/<pkg>` 查询（`dist-tags.latest` + `repository` 字段）
   - GitHub：从包内 `repository` / npm 元数据解析 `github.com/<owner>/<repo>`
3. **更新**：`pnpm add`（npm 源：`<pkg>[@version]`；GitHub 源：`github:<owner>/<repo>[#ref]`）
4. **回退**：从快照还原 3 个受保护文件 + `pnpm install`

## 🧪 独立测试（无需 DSH）

```powershell
# 自测：显示自动发现的插件、已装版本、快照
node lib/manager.js --self-test
```

## 📂 项目结构

```
dsh-security-manager/
├── lib/
│   ├── index.js    # Host 半：cordis 插件 + webServer JSON 路由
│   ├── manager.js  # 核心：自动发现 / 来源定位 / 快照 / 更新 / 回退（纯 Node，可独立运行）
│   └── client.js   # Client 半：设置页"安全"标签页（__ModuleLoader__ 格式）
├── package.json    # dsh.client 声明 + 元数据
└── README.md / README.en.md / LICENSE
```

## 🛡️ 安全说明

- 更新只对**自动识别到的已安装插件**执行，且**快照先行**；回退即时可用
- 只读操作（status / snapshots / update-check）不修改任何文件
- 脚本/路由不执行任意命令：更新仅通过 pnpm 安装指定包，来源由包元数据决定
- 快照目录：`profiles/<profile>/.security-snapshots/`

## 📄 许可

[MIT](./LICENSE) © Kolos-alter
