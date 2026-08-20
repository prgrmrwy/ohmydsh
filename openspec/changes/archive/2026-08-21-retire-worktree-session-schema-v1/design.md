## Context

当前包以统一 `OperationRecord` 承载两种流程（见 proposal.md - Why）。v2 是唯一会产生新 operation 的路径，但 wire/host 仍保留 `handoff` union、`target-session-v1` binding、`legacyBindingFrom()`、`/worktree-session/api/handoff` route 与 `updateHandoff()`；maintenance 仍按 `schemaVersion` 分支决定“保留 tombstone”还是“删除 v1 operation 文件”。当前所有已注册 DSH Workspace（dev-infra-server / ohmydsh / multica-runtime / nexus）的 `.git/ws/operations` 均为空，无 v1 数据需要继续读取。

## Goals / Non-Goals

**Goals:**
- 持久格式与实际读写路径统一为 schema-v2 唯一模型。
- 对 v1 与未知未来版本给出明确 unsupported-version 诊断并 fail closed，绝不自动迁移、重绑或伪造绑定。
- 删除 v1 专用 wire union、host 分支、handoff route 与“v1 clean 后删除 operation 文件”的 legacy 路径。
- maintenance 只接受 v2 source-session binding，clean 统一保留 `cleaned` tombstone。
- 保留 `schemaVersion: 2` 字段（作为检测损坏/未来升级的锚点）与显式 path 维护入口（定位改为 v2 诊断/恢复）。

**Non-Goals:**
- 不重编号 v2 为 v1，不做版本号收敛。
- 不删除历史 Session 日志与既有 Workspace/Session 注册记录。
- 不改 DSH 核心、Host、AgentLoop、文件工具、沙箱或 Session 模型。
- 不新增任何新的依赖/schema 迁移能力。

## Decisions

### 1. `wire.ts` 移除 v1 union，`bindingOf()` 简化为直接返回 `operation.binding`

- 删除 `handoff?: {...}` 字段、`target-session-v1` union 成员、`legacyBindingFrom()` 与 `bindingOf()` 的 v1 分支（wire.ts L84-96）。
- `SessionBinding` 仅保留 `source-session`；`bindingOf(operation)` 变为 `schemaVersion === 2 ? operation.binding : undefined` 或直接断言 v2。
- `schemaVersion` 类型收紧为字面量 `2`，持久 reader 在遇到非 2 时抛 unsupported-version 错误（见决策 2）。
- **备选**: 保留 union 仅在读取时打补丁。→ 拒绝：这只推迟删除，仍让所有调用方携带不可达分支；且无法通过 UT 覆盖“将来出现 v1 文件”的失败路径。

### 2. 持久 reader 明确拒绝 `schemaVersion !== 2`

- 在 `loadOperation()` 解析成功后增加版本校验：`schemaVersion !== 2` → 抛出 `WS_UNSUPPORTED_SCHEMA_VERSION`（含实际版本号），不触碰任何文件/Git。
- 与 spec 的 Reset fail-closed 场景对齐：status/promote/clean/recovery 统一经 `bindingOf`/`loadOperation` 间接继承该拒绝，无需每个 host 模块各自判断。
- 未来 schema v3 只需扩这个字面量检查点，而不是在 `maintenance.ts`/`operation.ts` 里散布分支。
- **备选**: 各 host 函数分别判断 `schemaVersion === 1`。→ 拒绝：重复且易漏；统一在读取层 fail closed 更符合“单一锚点”。

### 3. 删除 `/worktree-session/api/handoff` route 与 `updateHandoff()`

- `wire.ts` ROUTES 移除 `handoff`；`http.ts` L146-151 route 整段删除。
- `operation.ts` 删除 `updateHandoff()`（L183-193 附近）与 `HandoffRequest`/`HandoffResult` contract。
- `client/handoff.ts` 拆分为仅保留 v2 `bindingAction` 语义（`bind-source`/`claim-submit`/`admitted`/`uncertain`），移除所有 `bind-target` 分支；client 已不调用 `ROUTES.handoff`，无运行时消费者。

### 4. `maintenance.ts` 只接受 v2 source-session binding

- 删除 `legacyTarget` 分支（L114）；`sourceBinding` 判定简化为 `operation.schemaVersion === 2 && binding.mode === 'source-session'`，否则 `CLEAN_REFUSED`。
- cleanup 动作统一为：`git worktree remove` + `git branch -d` + 保留 cleaned tombstone；删除“v1 时移除 operation 文件”的 `if (sourceBinding === undefined)` 分支与 `rm` 调用。
- 由于 reader 已对非 v2 fail closed（决策 2），这里不再出现 `schemaVersion === 1` 的真实操作对象。

### 5. 显式 path 维护入口保留，重定位为 v2 诊断/恢复

- `ws status/promote/clean /absolute/worktree/path` 继续可用，但文档措辞从“legacy schema-v1 compatible”改为“operator diagnostics/recovery for schema-v2”。
- `skills/ws/SKILL.md` 移除 Schema-v1 compatibility 段；README/architecture HTML 同步。

### 6. 测试策略

- 新增：`prepared` 记录被改写为 `schemaVersion: 1` 时，load/status/promote/clean 全部 fail closed 且不改任何 Git/依赖/文件；未知版本（如 3）同样拒绝并报告版本号；`bindingOf` 对无 binding 的 v2 返回 `undefined`。
- 删除/改写：所有 legacy handoff 兼容用例（`source-binding.test.ts` “does not eagerly rewrite schema-v1”，`context.test.ts` `boundContextText(legacy…)`，`maintenance.test.ts` legacy-clean 分支，`cli.test.ts`/`client-handoff.test.ts` 的 v1 handoff contract）。
- 保留并回归：v2 全链路（start→bound→promote→clean tombstone）、restart 恢复、uncertain 重试。

## Risks / Trade-offs

- [已弃用路径的既有 v1 worktree 无法再用新代码 status/promote/clean] → 当前无此类数据；存在时 operator 用旧版本插件或手工 Git 处理，ADR 记录该边界。
- [版本号字面量收紧后，读取损坏/未来文件产生硬错误而非降级] → 这正是 fail-closed 目标；错误含版本号便于诊断，且绝无静默重绑风险。
- [`bindingOf` 改为断言 v2 后，调用方假设 schema 保证] → 所有读取统一先经 `loadOperation` 版本校验，host 层不再单独假设，避免漏检路径。
- [文档/ADR 与实际代码漂移] → 本 change 统一更新 spec、Skill、README、architecture HTML，并在 ADR 记录退役前提与盘点证据。

## Migration Plan

1. 按 tasks.md 顺序：wire/persist reader → host（operation/http/maintenance/context/policy/recovery）→ client（handoff/controls）→ 测试 → 文档/ADR。
2. 部署：`dsh build`（sync.mjs 物化）+ 重启 Host；无持久 schema 迁移动作，因为当前无任何 v1 数据。
3. 回滚：`git revert` 本 change 源码；若未来出现 v1 数据，先手工导出再考虑重加 reader（不自动迁移）。

## Open Questions

无（schema 退役的范围、fail-closed 语义、路径入口保留均已在上文决策中固定，未来 v3 升级仅扩展单一版本检查点）。
