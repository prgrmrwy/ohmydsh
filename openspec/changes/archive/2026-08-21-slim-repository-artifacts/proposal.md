## Why

仓库当前约 9 MiB 的 tracked 内容中，近九成由验收原始快照、重复架构图导出、子包 lockfile 与可重建的 `lib/` 产物构成，真正的源码和配置反而只占少数。这些派生文件增加 clone、review 和维护噪音，也容易让 TypeScript 源码与已提交 JavaScript 产物发生漂移。

## What Changes

- 将 TypeScript local package 的 `src/` 确立为代码真相源，不再提交可由标准构建命令重建的 `packages/*/lib/` JavaScript、declaration 与 source map。
- 在 sync 安装或更新启用的 TypeScript local package 前自动构建，确保全新 clone 不依赖已提交的 `lib/` 仍能完成 `dsh build`，并保持未变仓库重复 sync 幂等。
- 删除两个 local package 的独立 `package-lock.json`，保留根 `package-lock.json` 作为仓库安装、`npm ci` 与 Worktree Session lean cache 的唯一依赖锁和指纹来源。
- 将 OpenSpec checking 的长期 Git 内容收敛为轻量报告、trail、gate 与必要脚本；不再提交大型 raw session/history baseline 和批量截图，历史归档中的同类原始证据一并移出版本控制。
- 将仓库架构图收敛为一种可直接展示的轻量格式及可编辑图源，移除重复的明暗 PNG 和自包含交互 HTML；Worktree Session 的长期架构说明迁移到可维护的文本或轻量图形真相源。
- 扩充 `.gitignore` 和仓库约定，防止构建产物、nested lockfile、raw checking evidence 和重复图形导出重新被提交。

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `repo-layout`: 明确 local package 的源码/构建产物边界、sync 构建后安装行为、根 lockfile 单一来源及派生仓库资产的版本控制规则。

## Impact

- 受影响文件包括 `.gitignore`、`scripts/sync.mjs`、`packages/README.md`、两个 TypeScript local package 的 `lib/` 与 nested lockfile、README 架构图引用、OpenSpec checking 目录及相关文档。
- `packages/worktree-session` 的 CLI 和 DSH package exports 仍从 `lib/` 运行，但 `lib/` 改为部署前生成而非 Git tracked。
- 根 `package-lock.json` 必须保留；Worktree Session 依赖指纹和 promote 流程不改变。
- 不改变插件对外功能、DSH composition API 或用户配置；主要变化是 clone 后的本地构建/物化链路和仓库维护规则。
