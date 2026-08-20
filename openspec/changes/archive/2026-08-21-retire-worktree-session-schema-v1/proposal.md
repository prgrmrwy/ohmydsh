## Why

Worktree Session 已从旧的“跨 Workspace target-handoff”流程（schema-v1）演进为“源 Session 原地绑定 managed worktree”流程（schema-v2）。v1 只服务于已废弃的旧产品路径，且当前所有已注册 DSH Workspace 的 `.git/ws/operations` 均为空、无任何 v1 持久数据需要继续读取。保留 v1 会让 wire、维护逻辑、路由和测试矩阵长期携带不可达的分支，代价只会随时间增大。

## What Changes

- **BREAKING**: operation 持久格式仅接受 `schemaVersion: 2`；遇到 `schemaVersion: 1` 或未知版本必须给出明确的 unsupported-version 诊断并 fail closed，绝不自动迁移或静默重绑。
- **BREAKING**: 删除 `target-session-v1` binding 模式、`handoff` 持久字段、`legacyBindingFrom()`、`bindingOf()` 的 v1 分支以及旧 `/worktree-session/api/handoff` route 及其 `bind-target` action。
- Maintenance（status/promote/clean）只接受 v2 source-session binding；移除以“删除 v1 operation 文件”为分支的 legacy cleanup 路径，v2 cleanup 统一保留 `cleaned` tombstone。
- 保留 `schemaVersion: 2` 字段与显式 path 维护入口，但后者的定位从“schema-v1 兼容”改为“v2 显式诊断/恢复”，并在文档中标注。
- 新增或改写测试：明确拒绝 `schemaVersion: 1`、未知未来版本同 fail closed、v1 输入下不得改动 Git/依赖/operation metadata。
- 更新规范、`skills/ws/SKILL.md`、README 与架构文档，移除 v1 兼容承诺的描述，并记录 ADR 说明本次退役。

## Capabilities

### New Capabilities

（无新增 capability。）

### Modified Capabilities

- `source-workspace-worktree-session`: 替换“Existing independent Workspace records remain compatible”Requirement。新语义改为：v1 旧格式 operation 不再被兼容执行，系统 SHALL 明确识别并安全拒绝（fail closed），同时不得伪造 source binding、不得静默迁移、不得删除历史 Session 日志。

## Impact

- `packages/worktree-session/src/wire.ts`：移除 `handoff`、`target-session-v1`、`legacyBindingFrom()`，收紧 `schemaVersion` 与 `SessionBinding`。
- `packages/worktree-session/src/host/*`：`operation.ts`（parser/binding/retry）、`maintenance.ts`（只接受 v2）、`context.ts`（去掉 legacy 分支）、`policy.ts`（guard 路径）、`recovery.ts`、`http.ts`（移除 handoff route）、`tool.ts`（文案）。
- `packages/worktree-session/src/client/handoff.ts`、`controls.tsx`：移除已不再调用的 v1 handoff 契约与相关 UI 分支。
- 测试：新增 v1 拒绝/fail-closed 单测，移除或改写 legacy 兼容用例（`source-binding.test.ts`、`context.test.ts`、`maintenance.test.ts`、`cli.test.ts`、`client-handoff.test.ts`、`ws-tool.test.ts` 等）。
- 文档：`skills/ws/SKILL.md`、`packages/worktree-session/README.md`、`worktree-session-architecture.html`、ADR。
- DSH 核心与 Host 机制：无改动；本 change 仅影响 `dsh-worktree-session` 包及其 Skill/文档。
