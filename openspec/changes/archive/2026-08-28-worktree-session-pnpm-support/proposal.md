# Proposal: Worktree Session pnpm support and clear unsupported-project diagnostics

## Why

`dsh-cockpit`（本会话正在使用的多机驾驶舱仓库）是 pnpm workspace（`packageManager: pnpm@10.23.0`，仅有 `pnpm-lock.yaml` + `pnpm-workspace.yaml`，无 `package-lock.json`）。Worktree Session 的依赖准备硬编码 npm（读取 `package-lock.json`、执行 `npm ci`），因此在该仓库启动 Worktree Session 时先创建了 task branch 与 worktree，随后在依赖准备阶段抛出 `ENOENT: .../package-lock.json` 并卡在 `phase: worktree-created`，留下无 binding 的孤儿分支/worktree/operation；用户看到的是看不出原因的 ENOENT 报错。pnpm 支持此前被列为 backlog（skill 明文"pnpm/Rush support ... are backlog only"），但用户明确要求其在 dsh-cockpit 这类 pnpm monorepo 上可用，且对无法支持的项目类型要有清晰、前置的诊断。

## What Changes

- **支持 pnpm 项目**：Worktree Session 依据 lockfile 自动识别项目类型（`package-lock.json` → npm；`pnpm-lock.yaml` → pnpm）；pnpm 项目的 lean 准备、promote、指纹与状态展示全部可用，依赖隔离语义保持（pnpm 的全局 store 提供与 npm lean cache 等价的共享性）。
- **支持面探测前置化（fail-closed 提前拒绝）**：在创建任何 Git 资源（branch/worktree）与任何 operation 文件**之前**探测并校验项目类型；既不支持也无 lockfile 的项目返回明确的 `UNSUPPORTED_PROJECT` 诊断（含"仅支持 npm/pnpm 锁文件项目"的说明），**不留**半成品资源。混合 lockfile（同时存在 package-lock.json 与 pnpm-lock.yaml）同样前置返回明确诊断。
- **错误信息可理解**：前端错误提示从"ENOENT ... package-lock.json"变为明确的诊断（如"项目缺少 package-lock.json / pnpm-lock.yaml，Worktree Session 仅支持 npm 或 pnpm 项目"）；operation 持久 `diagnostics` 保留同样文本。
- **保持既有行为不变**：npm 项目的 lockfile 指纹、共享 lean cache、promote（`npm ci`）、clean 语义不变；ready.json 元数据升级为可声明 packageManager 的 v2（旧 v1 缓存按失效重建，不迁移）。
- **仍不支持**：yarn、bun、rush 等其他包管理器（与 skill 的 backlog 声明保持一致，明确诊断而非静默失败）。

## Capabilities

### New Capabilities

（无新增 spec 目录：所有行为变化都属于既有 `source-workspace-worktree-session` 能力面。）

### Modified Capabilities

- `source-workspace-worktree-session`: 在"准备失败"语义上新增两个方向——① pnpm 项目（workspace 或单包）可完整走通 start/lean/promote，② 不支持/无 lockfile/混合 lockfile 项目在创建任何资源前被明确拒绝；状态与维持命令同时反映 project type。

## Impact

- `packages/worktree-session`（`src/host/dependencies.ts`、`src/host/operation.ts`、`src/host/maintenance.ts`、`src/host/http.ts`、`src/wire.ts`、`src/host/errors.ts` 相关错误码、`src/cli.ts` 状态输出、`src/client/controls.tsx` 状态栏展示）。
- wire 契约：`OperationRecord` 新增可选 `packageManager`；`StatusResult`/`PreparedOperationResult` 暴露 `packageManager`；新增 `WsErrorCode.UNSUPPORTED_PROJECT`。
- 依赖指纹/缓存：`ReadyMetadata` 升级 schemaVersion 2（npm/pnpm 统一声明 `packageManager` 与对应 CLI major），旧 v1 缓存判定为失效并自动重建。
- 测试：新增项目类型探测、pnpm fingerprint/准备/promote（fake runner + 小型真实 pnpm fixture）、unsupported 前置拒绝、CLI/前端状态展示用例。
- 文档：`skills/ws/SKILL.md` 去掉"pnpm/Rush 支持为 backlog"的表述，改为"pnpm 已支持；yarn/bun/rush 暂不支持（backlog）"。
- 运维动作：清理 `dsh-cockpit` 仓库现有孤儿状态（`ws/commit-prgrmr-prgrmr` 分支、`.worktrees/commit-prgrmr-prgrmr`、`.git/ws/operations/759f5b7b-4a24-455a-aeaf-a3ecc2af1d99.json` —— 无 binding、phased `worktree-created` 的失败残留）。
