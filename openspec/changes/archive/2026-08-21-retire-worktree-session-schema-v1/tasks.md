## 1. Wire contract

- [x] 1.1 `packages/worktree-session/src/wire.ts`: 从 `OperationRecord` 删除 `handoff?` 字段，`schemaVersion` 收紧为字面量 `2`，`TransportedSessionBinding` 仅保留 `source-session` 成员
- [x] 1.2 删除 `legacyBindingFrom()`；`bindingOf()` 简化为仅返回 `operation.binding`，`SessionBinding` 类型删除 `target-session-v1`
- [x] 1.3 ROUTES 删除 `handoff: '/worktree-session/api/handoff'`，并删除 `HandoffRequest`/`handoff` action 相关 contract 与 `target-bound` 状态字面量
- [x] 1.4 在 `loadOperation()` 读取后增加版本校验：`schemaVersion !== 2` → 抛出 unsupported-version 错误（含实际版本号），不触碰任何文件/Git/依赖

## 2. Host operation layer

- [x] 2.1 `packages/worktree-session/src/host/operation.ts`: 删除 `updateHandoff()`、`bind-target` 分支及其对 `handoff` 字段的读写
- [x] 2.2 `bindSource()`/`updateSourceBinding()`/`findBySourceSession()` 统一走 `bindingOf()` 的 v2-only 语义，移除 v1 兼容分支（含 `handoff: _discardedHandoff` 解构）
- [x] 2.3 确认所有 operation 新建路径仍只写 `schemaVersion: 2` 与 `binding`（无 `handoff`）

## 3. Host maintenance

- [x] 3.1 `packages/worktree-session/src/host/maintenance.ts`: 删除 `legacyTarget` 分支，`sourceBinding` 判定收紧为 `schemaVersion === 2 && binding.mode === 'source-session'`，否则 `CLEAN_REFUSED`
- [x] 3.2 cleanup 动作统一为 worktree remove + branch -d + 保留 cleaned tombstone；删除“v1 时移除 operation 文件”的 `rm` 分支

## 4. Host HTTP / tool / context / policy / recovery

- [x] 4.1 `packages/worktree-session/src/host/http.ts`: 删除 `ROUTES.handoff` 路由（bind-target/handoff 段），保留 v2 `bindSource`/`sessionStatus` 等其他路由
- [x] 4.2 `packages/worktree-session/src/host/tool.ts`、`context.ts`、`policy.ts`、`recovery.ts`: 移除所有 `target-session-v1`/legacy 分支，保留 v2 fail-closed（v1 由 loadOperation 统一拒绝）
- [x] 4.3 `ws` tool/`ws.sh` 的 legacy compatibility 文案改为 v2 operator recovery/diagnostics

## 5. Client handoff

- [x] 5.1 `packages/worktree-session/src/client/handoff.ts`: 删除 `bind-target`/legacy 分支与 `ROUTES.handoff` 调用，仅保留 v2 `bind-source`/`claim-submit`/`admitted`/`uncertain` 语义
- [x] 5.2 `packages/worktree-session/src/client/stage-store.ts` 与 `controls.tsx`: 移除 legacy lifecycle/状态分支，确认 v2 状态机（bound/submit-claimed/admitted/uncertain/cleaned）不变

## 6. Tests

- [x] 6.1 新增 fail-closed 测试：`schemaVersion: 1`（及未知版本如 3）在 load/status/promote/clean/recovery 下全部拒绝，且不修改任何 Git 资源、依赖、绑定或 operation 文件
- [x] 6.2 新增 `bindingOf` 对无 binding 的 v2 返回 `undefined`、v1 触发 unsupported 错误的单测
- [x] 6.3 删除/改写 legacy 兼容用例（`source-binding.test.ts`、`context.test.ts`、`maintenance.test.ts`、`cli.test.ts`、`client-handoff.test.ts`、`ws-tool.test.ts` 中的 v1 handoff 分支）
- [x] 6.4 全量跑 `vitest`/包测试，确认 v2 全链路（start→bound→promote→clean tombstone、restart 恢复、uncertain 重试）仍全绿

## 7. Docs / ADR / build

- [x] 7.1 `packages/worktree-session/README.md` 与 `worktree-session-architecture.html` 移除 schema-v1 compatible 描述，标注 v1 已退役、v2-only 与显式 path recovery 语义
- [x] 7.2 `skills/ws/SKILL.md` 删除 Schema-v1 compatibility 段，改为「仅 v2 source-session binding」与 unsupported-version fail-closed 说明
- [x] 7.3 新增 ADR（如 `docs/adr/NNNN-retire-worktree-session-schema-v1.md`）：Context/Decision/Consequences/Evidence（4 个注册 Workspace 扫描、0 v1 operation、验收 fixture 已清理）
- [x] 7.4 运行 `openspec validate source-workspace-worktree-session --type spec --strict` 与本 change `--type change --strict`；`git diff --check`；构建 `dsh build` 并验证 sync 幂等
