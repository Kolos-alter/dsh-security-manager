# dsh-security-manager

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)

**DSH 插件安全管理器。** 对 profile 里已安装的插件做**只读静态审计**，并在**更新前给出风险差异**、
支持**快照保护的回退**（含只回退单个包）。

> 定位说明：插件列表、启用状态、fiber 状态由 DSH 官方提供（`pluginInventory` + 设置→插件→全部），
> 本插件**不重复实现**。这里只做官方没有的**安全**能力。详见 [`docs/adaptation-2026-09.md`](docs/adaptation-2026-09.md)。

[English](./README.en.md)

---

## ✨ 能力

### 1. 插件安全审计（本地、只读）

对每个已装插件给出分级发现项与证据（文件:行号 + 代码片段）：

| 类别 | 检查内容 | 严重度 |
|---|---|---|
| 安装期执行 | `preinstall` / `install` / `postinstall` | **high**（注册表安装即执行） |
| 安装期执行 | `prepare` —— **按安装来源分级** | git/本地源 **high**（install 时会跑）· 注册表源 low（不跑） |
| 供应链来源 | `file:`/`link:`/`portal:` 本地源 | medium |
| 供应链来源 | `*` / `latest` 未固定版本 | medium |
| 供应链来源 | lockfile 缺少 `integrity` | low |
| 供应链来源 | `github:` / `git+` 源 | low |
| 能力面 | 动态执行（`eval` / `new Function` / `vm`，仅真实运行时代码） | medium |
| 能力面 | 访问凭据/设置数据（`.credentials.yaml` / `settings.yaml` / `DSH_HOME`） | low |
| 能力面 | 子进程 / 网络 / 文件写入 | **info（能力清单，不计分）** |
| 元数据 | 缺 `license` / `repository` | low |
| 运行时 | 官方清单报告 `failed` | medium |

- 评分 0–100 + A–D 等级；**能力清单不计分**——避免"每个插件都能起进程"这类噪音淹没真实风险
- 扫描前**等长屏蔽注释**、只扫会被执行的 `.js/.mjs/.cjs`：不会把插件自己的 JSDoc 当危险代码
- **只读**：不执行被审计插件的任何代码

### 2. 更新影响预览（升级前先看差异）

拉取候选版本的 `package.json`，对比风险字段：**新增/变更的安装期脚本、依赖集合变化、许可证与仓库变化**。
把"盲目更新"变成"有依据的更新"。

### 3. 快照保护的回退

- 更新前自动快照 `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml`
- **快照差异**：回到某快照会改变哪些包（新增/移除/版本变化）
- **按包回退**：只回退一个包到快照记录的 spec，其他插件不受影响；回退前再自动建安全快照
- **整表回退**：还原全部受保护文件并重新安装

---

## 📦 安装

```powershell
# 从 GitHub（pnpm 的 github: 协议）
dsh plugin --profile web add "github:Kolos-alter/dsh-security-manager"

# 或本地开发：先打包，再用 file: 安装
cd dsh-security-manager
pnpm pack            # 生成 dsh-security-manager-<version>.tgz
cd "$env:DSH_HOME\profiles\web"
pnpm add "file:<上面 tgz 的绝对路径>"
```

在 profile 的 `cordis.patch.yml` 挂载（热加载，无需重启）：

```yaml
- insert:
    - id: security-manager
      name: dsh-security-manager
      config:
        # 全部可选
        # home: 'D:\DeepSeekHarness-Portable\home'
        # profile: web
        # pnpmPath: 'C:\path\to\pnpm.cmd'   # 便携版不在 PATH 时建议填绝对路径
        # scan: true                        # 关闭能力扫描（更快的审计）
```

刷新页面：**设置 → 插件 → 安全**。

---

## 🖥️ 使用

- **顶部**：总评分 / 等级、高·中·低·提示计数、重新审计
- **插件卡片**：已装版本、安装来源（`spec` 优先；本地源显式标注）、分级发现项与证据
  - **检查更新**：查 npm 最新版本
  - **预览更新**：显示候选版本的风险差异（有 high 会红色告警）
  - **更新**：先快照再更新
- **快照历史**：**差异**逐包列出变化；对可回退的包提供**回退此包**；也可**整表回退**
  - 说明：若某包在快照中不存在，单包回退无法"移除"它，界面会明确提示需用整表回退

---

## 🔌 Host API

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/security-manager/audit` | GET | 本地静态审计：评分、逐包 findings、能力清单 |
| `/api/security-manager/snapshots` | GET | 快照历史 |
| `/api/security-manager/snapshot` | POST `{label}` | 创建快照 |
| `/api/security-manager/update-check` | POST `{package}` | npm 元数据（最新版 + 仓库） |
| `/api/security-manager/update-preview` | POST `{package, version?}` | 候选版本的风险差异 |
| `/api/security-manager/update` | POST `{package, version?, ref?}` | 更新（先快照） |
| `/api/security-manager/snapshot-diff` | POST `{snapshot}` | 该快照与当前的逐包差异 |
| `/api/security-manager/rollback-package` | POST `{package, snapshot}` | 只回退单个包 |
| `/api/security-manager/rollback` | POST `{snapshot}` | 整表回退 |

---

## 🧪 验证（无需 DSH 运行）

```powershell
npm test              # 22 例单元测试（node --test）
npm run audit         # 对当前 home/profile 跑一次审计，输出 JSON
npm run preview       # 对真实 npm 验证更新预览链路（只读）
```

`npm test` 覆盖：注释误报回归、来源分级、评分口径、快照差异与按包回退的守卫，
以及**无需浏览器**的客户端渲染测试（伪造 `__ModuleLoader__` 与最小 React，执行真实 bundle）。

### 本机实测结果（示例）

```
@nanmicoder/dsh-agent-teams  0.1.17-rc.1 → 0.1.21   预览: high=0 medium=0 low=5
dsh-better-sidebar           0.19.0      → 0.21.1   预览: high=0 medium=0 low=2
dsh-security-guard           prepare 脚本（git/本地源）→ high
dsh-security-manager         本地 tarball 依赖 → medium
```

---

## 📂 结构

```
dsh-security-manager/
├── lib/
│   ├── index.js     # Host 半：webServer 路由（薄胶水）
│   ├── manager.js   # 来源定位 / 快照 / 更新 / 回退 / 差异（纯 Node）
│   ├── audit.js     # 安全审计引擎 + 更新影响预览（纯 Node，只读）
│   └── client.js    # Client 半：设置→插件→安全（__ModuleLoader__ 格式）
├── test/            # node --test：audit / manager / client
├── tools/           # 对真实环境的只读验证脚本
├── docs/            # 新版 DSH 能力对照与取舍（含实测证据）
└── CHANGELOG.md
```

---

## 🛡️ 安全边界

- 审计**只读**：只读取 profile 内已装包的文件与元数据，不执行其中任何代码
- 更新只对**已识别到的已安装插件**执行，且**快照先行**；包名进入 update 前经白名单校验
  （拒绝路径穿越、反斜杠、非法 spec）
- 按包回退同样先建安全快照，回退操作本身可撤销
- 只读操作（audit / snapshots / update-check / update-preview / snapshot-diff）不修改任何文件

## 📄 许可

[MIT](./LICENSE) © Kolos-alter
