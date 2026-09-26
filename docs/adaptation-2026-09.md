# DSH 新版能力对照与功能取舍（2026-09）

本文记录 `dsh-security-manager` 针对**当前版本 DSH** 的适配结论：哪些能力官方已经提供（应当舍弃重复实现）、
哪些是官方缺口（应当作为核心价值继续开发）、以及本次新增的安全审计设计。

证据来源：`cordis_inspect_query` 实时接口查询 + 已安装的 `@deepseek-ai/*` 包源码。
环境：`DSH_HOME=D:\DeepSeekHarness-Portable\home`，profile `web`。

---

## 1. 实测到的接口现状

| 接口 | 现状 | 证据 |
|---|---|---|
| `webServer.register(route)` | ✅ 未变 | 精确契约：`WebRoute { kind: 'exact'\|'prefix', path, handler }`；`(kind, path)` 重复会抛错 |
| `settings.plugins.tab` | ✅ 未变 | `kind: list`，注册项 `id`(必填) / `order` / `label`；当前占用：`configurable`(order 0)、`all`(10)、`security`(20) |
| `settings.plugin.item` | 🆕 **新增** | keyed 槽位，父槽 `settings.plugins.tab` 之下；"插件配置区里每个插件的卡片"；由 `dsh-client-ui-settings-plugins` 派发；`keyDomain` 开放、**当前无人占用** |
| `locale`（client） | ✅ 未变 | `register(ns, {zh, en})` 与 `bind(ns)` 均在；内置语言 id 确认为 `["zh","en"]` |
| `ctx.get('loader')` | ❌ **不再可用** | `loader` 是 Cordis 内部服务，**不在可检目录**（`no catalogued Service named "loader"`） |

### 由此确认的两处老代码问题

1. **`lib/index.js` 的 `loader` 手工枚举已失效**
   旧代码 `const loader = ctx.get('loader')`（且未声明 `inject`）永远得到 `undefined`，
   导致列表里所有插件的 `entryId / enabled / fiberPhase / mounted` 恒为空。

2. **官方已提供等价且更完整的服务**
   `@deepseek-ai/dsh-host-plugin-inventory` 提供 `pluginInventory` 服务（`@Remote('list')`），
   返回 `{ entries: [{ entryId, moduleName, enabled, fiberPhase }], agentPresets? }` ——
   与旧代码手工拼装的结构一致，且是官方支持的跨端路径（客户端可用 `ctx.remote.pluginInventory.list()`）。

---

## 2. 官方已覆盖 vs 本项目提供

| 能力 | 官方 | 本项目（旧） | 结论 |
|---|---|---|---|
| 插件清单、启用状态、fiber 状态 | ✅ `pluginInventory` + `all` 选项卡 | 手工枚举 loader（已失效） | **舍弃**（删除失效代码，需要时改读官方服务） |
| 插件配置界面 | ✅ `configurable` 选项卡 | 无 | 不涉及 |
| 每个插件卡片内的扩展位 | ✅ `settings.plugin.item`（无人占用） | 无 | **利用**（把安全徽章嵌进官方卡片） |
| 更新检查 / 版本对比 | ❌ 全 scope 无 `registry.npmjs.org` / `checkForUpdate` / `latestVersion` | ✅ `inspectPackage` | **保留并强化** |
| 快照保护 + 更新 + 回退 | ❌ 无（仅 Cordis 内部 HMR 有 rollback） | ✅ `makeSnapshot/updatePackage/rollbackSnapshot` | **保留并强化** |

> 判定依据：对整个 `@deepseek-ai` scope 检索 `registry.npmjs.org|checkForUpdate|latestVersion` **零命中**；
> `rollback|snapshot` 的命中全部属于会话/存储/Cordis HMR 语义，与"插件更新回退"无关。

---

## 3. 本次开发计划

老功能"插件列表展示"删除后，本项目聚焦官方缺口，做真正与安全相关的增量。

### P0 移除重复与死代码
- 删除 `lib/index.js` 中失效的 `loader` 手工枚举
- 需要运行时状态时，改读官方 `pluginInventory`（可选依赖，缺失则降级为 null）

### P1 新增：插件安全审计引擎（`lib/audit.js`，纯 Node，可独立自测）
对 profile 内每个已装插件产出分级发现项（finding）：

| 类别 | 检查内容 | 典型严重度 |
|---|---|---|
| 供应链来源 | `file:`/`link:`/`portal:` 本地源、`github:` 源、未固定版本范围（`*`/`latest`）、lockfile 缺 `integrity` | low–medium |
| 安装期执行 | 插件自身 `preinstall`/`install`/`postinstall`/`prepare` 脚本（安装即执行任意代码） | **high** |
| 能力面（静态扫描产物 JS） | 子进程、动态求值（`eval`/`new Function`/`vm.`）、网络出站、写文件、读取凭据/设置文件 | low–high |
| 元数据卫生 | 缺 `license` / `repository` / `version` | info–low |
| 运行时关联 | 官方 `pluginInventory` 中处于 `failed` 的插件 | medium |

### P2 新增：更新影响预览（升级前先看差异）
更新前拉取候选版本的 `package.json`，与本地版本对比**风险相关字段**：
新增/变化的安装脚本（high）、依赖数量变化、`license`/`repository` 变化、版本跨度。
把"盲目更新"变成"有依据的更新"。

### P3 新增：快照差异与按包回退
- `snapshot diff`：快照 vs 现在，逐包列出 新增/移除/版本变化
- `rollback package`：只回退单个包（把版本写回 `package.json` 后 `pnpm add <pkg>@<version>`），
  不再必须整表还原

### ~~P4 在官方插件卡片内嵌安全徽章~~ —— 实测后砍掉 ❌

原计划：向 `settings.plugin.item` 注册 keyed 条目（key = 包名），在每个官方插件卡片里显示安全徽章。

**实测否定**：`dsh-client-ui-settings-plugins/lib/client.js:416` 的派发代码是

```js
namespaces.map((ns) => renderSlot("settings.plugin.item", {}, { entryKey: ns }))
```

该槽位的 key 是**插件自己的设置命名空间**（`ns`），不是包名。按包名注册的条目**永远不会被派发**，等于死代码。
因此不做此集成；安全视图保留为 `settings.plugins.tab` 下的一等选项卡（官方认可的入口，id=`security`）。

---

## 4. 兼容与安全约束

- 保持**纯 Node 核心**（`manager.js` / `audit.js`）不依赖 cordis，便于 `node lib/audit.js --self-test` 独立验证
- Host 半只使用经查询确认的接口：`webServer.register`、`pluginInventory`（可选）
- 所有新增副作用挂在 `ctx.effect` / 注册返回的 disposer 上，停用即清理
- 审计为**只读**：不执行被审计插件的任何代码，仅读取文件与元数据
- 更新/回退路径继续坚持"快照先行 + 包名校验 + 来源由元数据决定"

---

## 5. 开发过程中的实测修正（用真实 profile 验证，不靠推测）

实测环境：本机 `profiles/web` 的 6 个真实插件。

### 5.1 注释误报 —— 已修复并加回归测试

首版能力扫描把**注释和 `.d.ts` 类型声明**当成危险代码，导致：

| 包 | 首版命中 | 实际内容 |
|---|---|---|
| `dsh-security-guard` | 动态执行代码（high） | `types.d.ts` 的**文档注释**里写着 `` `eval(...)`, `new Function(...)` `` |
| `dsh-security-guard` | 可执行外部进程（medium） | 注释里的 `malicious code (eval/child_process/network exfiltration)` |
| `dsh-security-manager` | 可读取凭据（medium） | 自己 JSDoc 里的 `$DSH_HOME` |

一个把**自己的文档**当危险代码的扫描器不可信。修正：

- 新增 `maskComments()`：按**等长**方式屏蔽注释（保留换行与字节数，因此行号与证据片段仍然准确），
  字符串字面量**保留**（例如字符串里出现 `.credentials.yaml` 是真实信号）
- 只扫描**会被执行的运行时文件**（`.js` / `.mjs` / `.cjs`），跳过 `.d.ts`、`.map`
- 结果：findings 24 → 17，命中的每一条都能在真实代码里定位出处

### 5.2 评分口径 —— 从"狼来了"改成可信

首版给健康环境打 **0 分 / D 级**，因为把"能起子进程""能发网络请求"这类**普遍且合法**的能力计了分。
不可信的评分会被直接无视。修正后的口径：

| 类别 | 严重度 | 理由 |
|---|---|---|
| `preinstall`/`install`/`postinstall` | **high** | 注册表安装即执行 |
| `prepare`（**git/本地源**） | **high** | pnpm 安装 git/本地源时会执行 prepare |
| `prepare`（注册表源） | low | 注册表安装不执行 |
| 本地 `file:`/`link:` 源、`*`/`latest` 未固定 | medium | 来源不可复现 |
| 动态执行（eval/new Function/vm，真实运行时代码） | medium | 安装前无法审计其行为 |
| 访问凭据/设置数据 | low | 值得知情，但极常见 |
| 子进程 / 网络 / 写文件 | **info**（不计分） | 能力清单，不是漏洞 |
| 缺 license / repository | low | 元数据卫生 |
| 运行时 `failed` | medium | 与"更新后坏掉"强相关 |

实测结果：同一环境 **75 分 / B 级**，评分只由 1 个 medium + 5 个 low 构成，与直觉一致。

### 5.3 纠正一处会误导的字段

`discoverPackages()` 的 `source` 字段由包内 `repository` 推导，表示"**代码在哪**"，
而不是"**怎么装的**"。实测中所有插件都显示 `source=github`，但 profile 里实际是：

```json
"dsh-security-guard": "0.1.0-rc.7",                                  // npm 注册表，精确锁定
"dsh-security-manager": "file:D:/DeepSeek 工作区/.../0.2.0.tgz"      // 本地 tgz
```

安装来源（`spec`）才是安装期风险的判据。审计项因此只输出 `spec`（怎么装）与 `github`（代码在哪），
不再输出会误导的 `source` 标签。

附带结论：这些包**都发布在 npm 上且被精确锁定**，因此"更新影响预览"走 npm 注册表是**实际可用**的路径
（不是为 GitHub 源特制的假设功能）。

