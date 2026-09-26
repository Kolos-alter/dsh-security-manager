# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-09-26

**定位调整：只做 DSH 官方没有的能力。** 依据对当前 DSH 的接口实测（见 `docs/adaptation-2026-09.md`），
插件列表/启用状态展示属官方已覆盖范围，已删除；开发重心转为官方缺失的**更新安全**与**静态审计**。

### Removed

- **删除了基于 `ctx.get('loader')` 的插件枚举**。`loader` 已不在可检服务目录，该路径恒返回空，
  导致 `mounted` / `enabled` / `fiberPhase` 永远为空；官方 `pluginInventory` 提供等价且更完整的数据。
- **删除 `/api/security-manager/status` 路由**：与官方 `all` 选项卡的插件列表重复。
- **删除 `settings.plugin.item` 内嵌徽章计划**：实测官方按**设置命名空间**派发该槽位
  （`renderSlot("settings.plugin.item", {}, { entryKey: ns })`），按包名注册永远不会渲染，属死代码。

### Added

- **插件安全审计引擎** `lib/audit.js`（纯 Node、只读、可独立自测）：
  - 供应链来源：本地 `file:`/`link:` 源、git 源、未固定版本、lockfile 缺 `integrity`
  - 安装期执行：`preinstall`/`install`/`postinstall` 恒为 high；`prepare` 按**安装来源**分级
    （git/本地源会执行 → high，注册表源不执行 → low）
  - 能力面静态扫描：等长屏蔽注释后只扫运行时文件（`.js`/`.mjs`/`.cjs`），
    识别动态执行、子进程、网络出站、文件写入、凭据/设置访问，附文件:行号与代码片段证据
  - 元数据卫生与运行时关联（官方 `pluginInventory` 的 `failed` 状态）
  - 0–100 评分与 A–D 等级；**能力清单为 info 不计分**，避免噪音淹没真实风险
- **更新影响预览** `previewUpdate()` / `diffManifests()`：安装前对比候选版本与本地版本的风险字段
  （新增/变更安装期脚本、依赖集合变化、许可证与仓库变化）。
- **快照差异** `diffSnapshot()`：回到某快照会改变哪些包（新增/移除/版本变化）。
- **按包回退** `rollbackPackage()`：只回退单个包到快照记录的 spec，其他插件不受影响；
  回退前自动建安全快照，使回退本身可逆。
- **客户端安全仪表盘**：评分/等级、分级发现项与证据、更新检查、更新预览、快照差异与按包回退；
  能力清单默认折叠。
- **测试**：22 例（`node --test`）。含注释误报回归用例，以及无需浏览器的客户端渲染测试
  （伪造 `__ModuleLoader__` 与最小 React，执行真实 bundle）。
- `tools/verify-preview.mjs`：对真实 npm 验证更新预览链路（只读）。

### Changed

- 新路由：`GET /audit`、`POST /update-preview`、`POST /snapshot-diff`、`POST /rollback-package`；
  所有路由统一异常包装，错误以 JSON 返回而不是中断。
- 运行时状态改读官方 `pluginInventory`（可选依赖，取不到则优雅降级为不关联）。
- 新增 `scan` 配置项可关闭能力扫描；`package.json` 增加 `./audit` 导出与 `test`/`audit`/`preview` 脚本。

### Verified

- 真实 profile（6 个插件）实测：75 分 / B 级；正确识别 `dsh-security-guard` 的 `prepare` 脚本、
  本插件自身的本地 tgz 依赖、`@sky_sun/dsh-balance` 缺少 repository。
- 更新预览实测：`@nanmicoder/dsh-agent-teams` 0.1.17-rc.1 → 0.1.21、`dsh-better-sidebar` 0.19.0 → 0.21.1，
  两者均未引入安装期执行。

## [0.2.0] — 2026-08-18

### Added

- 自动识别 profile 已装插件；定位 npm / GitHub 来源
- 快照保护的更新与回退（`package.json` / `cordis.patch.yml` / `pnpm-lock.yaml`）
- 设置 → 插件 → 安全 标签页（zh/en）

## [0.1.0] — 2026-08-17

- 初始版本：插件列表与安装状态展示
