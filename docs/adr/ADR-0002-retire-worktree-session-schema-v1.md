# ADR-0002: Retire Worktree Session schema-v1 target-handoff operations

- **Status**: Accepted
- **Date**: 2026-08-21
- **Relates to**: ADR-0001 (plugin selection, unrelated), OpenSpec change `retire-worktree-session-schema-v1`

## Context

Worktree Session 经历了两次数据模型的演进：

1. **schema-v1（旧）**：独立 target-Workspace/target-Session handoff 流程。operation 持久记录 `handoff.targetSessionId`，worktree 注册为独立 DSH Workspace，首条消息从 source Session 迁移到新建 target Session，Session cwd 就是 worktree。
2. **schema-v2（现行）**：一个 Git 仓库映射一个 DSH Workspace，源 Session 原地绑定 `<repo>/.worktrees/<task>` 作为 managed execution root。operation 持久记录 `binding.sourceSessionId`，不创建第二个 Workspace/Session，Session cwd 保持仓库根，cleanup 后保留 `cleaned` tombstone。

schema-v1 只服务于已废弃的产品路径，且其维护分支分散在 wire、`bindingOf`、Host HTTP 路由、`updateHandoff`、maintenance 清理逻辑和整套测试矩阵中。

退役时的盘点证据（2026-08-21）：

- 扫描全部已注册 DSH Workspace（`dev-infra-server`、`ohmydsh`、`multica-runtime`、`nexus`）的 `.git/ws/operations/*.json`：**0 个 schema-v1 operation**。
- 验收用 schema-v1 fixture operation 及其 worktree/branch 已通过兼容 safe clean 清空。
- 当前无任何 v1 持久数据需要继续读取。

## Decision

- Operation 持久格式**仅接受 `schemaVersion: 2`**；`schemaVersion: 1` 及任何未知未来版本在 `loadOperation()` 读取时以明确的 unsupported-version 诊断 **fail closed**（不创建、不修改、不删除任何 Git/worktree/branch/binding/dependency/operation 文件，不自动迁移，不伪造绑定）。
- 删除 `handoff` 持久字段、`target-session-v1` binding 成员、`legacyBindingFrom()`、`bindingOf()` 的 v1 分支、`/worktree-session/api/handoff` route 与 `updateHandoff()`。
- Maintenance（status/promote/clean）只接受 schema-v2 source-session binding；cleanup 统一 `git worktree remove` + `git branch -d` + 保留 `cleaned` tombstone（不再有“v1 时删除 operation 文件”分支）。
- **保留 `schemaVersion: 2` 字段**，不做版本号重编号/收敛；其作为检测损坏与未来 schema v3 升级的单一检查锚点。
- 显式 path 维护入口（`dsh-ws status/promote/clean /absolute/worktree/path` 与 `scripts/ws.sh`）保留，但定位从“schema-v1 兼容”改为“schema-v2 operator recovery/diagnostics”。
- 历史 Session 日志与既有 Workspace/Session 注册**不被迁移、重命名、重绑定或删除**；任何路径都不能为旧格式伪造 source-session binding。

## Consequences

### Positive

- operation 数据模型只剩一种 binding，删除跨 Workspace dead code 与不可达分支。
- Maintenance 逻辑统一：只保留 cleaned tombstone 路径，安全面收敛。
- wire/HTTP/client contract 简化，移除 handoff route 与 target-bound 状态字面量。
- 测试矩阵减少一组 legacy 兼容用例，新增一组明确 fail-closed 用例。
- 新开发者不再误以为 schema-v1 仍是产品路径。

### Negative

- 若未来出现未被发现的遗留 v1 operation，新代码不能对其执行 status/promote/clean；operator 需使用旧版本插件、手工 Git 恢复，或忽略该历史记录（历史日志仍保留）。
- 回滚到旧 target-Workspace 流程不再受支持。

## Evidence

- `openspec/changes/retire-worktree-session-schema-v1/` 全部 4 个 artifacts 完成，`openspec validate --type change --strict` 通过。
- 包测试 `73→74` 全绿（13 files / 74 tests），新增用例覆盖：v1 在 load/status/promote/clean 下 fail closed 且 Git/worktree/branch 不变；未知 schemaVersion 3 同样拒绝并报告版本号；读取不重写文件、不伪造 binding。
- `npm run build` 与 `dsh build` 成功，部署 sync 幂等。

## Alternatives considered

- **保留 union 仅在读取时打补丁**：推迟删除、保留不可达分支，被拒绝。
- **将 v2 重编号为 v1**：版本号代表历史格式而非“还有几个版本”，会造成歧义，被拒绝。
- **各 host 函数分别判断 `schemaVersion === 1`**：重复且易漏；统一在读取层 fail closed 更符合单一锚点，被拒绝。
