## Why

ohmydsh 的核心部署脚本已经使用 Node，但公开 `dsh` 入口和初始化仍依赖 Bash 与 Unix 进程命令，原生 Windows 无法使用。需要将命令编排统一为现有仓库风格的 `.mjs` + Google zx，而不是维护 Bash/PowerShell 两套产品实现。

## What Changes

- 在一次迭代内顺序完成四步：等价拆分 Bash 能力 → 补齐原子能力与命令级契约测试 → 迁移 `.mjs` + zx → 以同一行为测试验收后一次性切换全部平台。中间 Bash 模块只作迁移支架，不长期维护双实现。
- 根包声明 npm `bin`，以 `npm link` 安装统一入口；Windows 的 `.cmd`/`.ps1` shim 由 npm 生成。先保留可重复的根 `npm ci`，不把 `npm link` 当作锁定依赖安装的替代。
- 保留 start/web、build/`-b`、stop、restart、reset、history、doctor、plugin-update、官方 CLI 转交、自动更新和 npm 环境隔离能力。
- 按平台实现端口所有者查询、进程身份检查、终止、后台运行和 UI 打开。Windows 接受核验后的强制终止，不承诺优雅刷盘；禁止按名称批量杀 Node/浏览器。
- **BREAKING** POSIX start 和 stop 一样需要可用的 lsof/ps 归属查询，缺少时明确诊断，不自动安装；Windows 的显式 DSH_BIN 仅支持 JS 入口或原生 exe，脚本 shim 拒绝并提示使用其真实入口。
- **BREAKING** `.env.local` 统一为纯 `KEY=VALUE` 配置，支持引号，不执行变量展开、命令替换或脚本；旧 Shell 语法拒绝加载并提示迁移，且错误不回显配置值。用户于 2026-10-24 确认此兼容性调整。
- macOS 保留既有 PWA/同端口 Chrome 标签清理；Windows/Linux 不自动关闭普通浏览器标签，并明确告知。
- 2026-10-25 实测后用户确认：Host builder 去掉全量脚本批准，改精确版本策略/未知拒绝；Windows 采用共享锁下可回滚而非原子可见的指针发布，调用方固定已核验物理 generation，发布不自动回收旧代。新增执行许可仍另行确认。
- 修复命令闭包内 npm/npx/pnpm 调用、测试入口和 Host compatibility builder 的原生 Windows 阻碍；加入真实 Windows/Linux/macOS CI。默认 manifest 的完整 Windows build/启动检查失败时不得宣称“仓库已支持 Windows”。

## Capabilities

### New Capabilities

- `cross-platform-launcher`：统一命令入口、命令兼容、跨平台执行与错误语义、独立于实现的迁移验收。

### Modified Capabilities

- `startup-autoupdate`：明确跨平台端口归属核验、Windows 强制停止及平台 UI 生命周期边界，保留版本与开关语义。
- `repo-layout`：初始化工具链检查改为 Node 入口，不再要求 Bash 内版本比较，保留根 lock 和最低版本；环境解析共用模块，但明确保留裸脚本白名单兼容与启动器严格模式边界。

## Impact

- `bin/dsh`、新增 Node CLI 入口与 `scripts/launcher/`、`scripts/bootstrap.sh`、`scripts/install.sh` 及其 Node 后继入口。
- `scripts/lib/dsh-runtime.sh`、`dsh-cli.mjs`、`run-bounded.mjs`，sync、doctor、自动更新、插件升级、third-party resources 和 Pet compatibility builder 的传递调用面。
- 根 `package.json` 的 `bin`、测试入口与 zx 精确依赖，根 lockfile；README 中安装、迁移、Node 全局前缀和 PowerShell execution policy 说明。
- `tests/launcher-*.test.mjs`、runtime/初始化/集成测试、CI；受影响 package 仅处理本次真实闭包内的兼容问题，不重新设计插件功能。
- 不升级 DSH、不改上游或远端插件源码、不重新部署本机生产 DSH；不开发 Windows 服务、自更新安装器或任意浏览器控制。旧运行体升级已经按用户授权归档，不作为本 change 前置。
