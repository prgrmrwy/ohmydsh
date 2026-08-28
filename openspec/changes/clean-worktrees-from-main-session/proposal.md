## Why

`ws clean` 当前与 `status`/`promote` 共用“按调用 Session 绑定解析目标”的入口，因此从主仓普通 Session 发起时会因为没有 Worktree Session binding 直接报错。然而清理操作本来就不能从仍在使用目标 worktree 的绑定 Session 发起；正常入口应是同仓库的普通主仓 Session，由它扫描并安全清理其他已归档、已合并且无活动执行的 Worktree Session。

## What Changes

- 将模型可见 `ws clean` 的入口语义从“清理当前 Session 绑定”改为“从无绑定的主仓普通 Session 扫描当前仓库的 Worktree Session”。
- 对扫描到的 operation 复用现有 active、dirty、in-flight、Git merge ancestry 与 binding 完整性安全门，并新增源 Session 必须已归档的候选条件。
- 一次调用清理全部满足条件的候选；不满足条件的候选保持不变，并在汇总结果中说明拒绝原因。
- 仍绑定 Worktree Session 的调用者不得清理自己或扫描其他任务，系统返回明确提示，要求切换到同仓库的普通主仓 Session。
- `ws status`、`ws promote` 和显式路径 `dsh-ws` operator CLI 保持现有语义，本 change 不扩展跨仓库目标选择，也不重构 CLI 的恢复契约。

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `source-workspace-worktree-session`: 修正 `ws clean` 的调用上下文与仓库级候选扫描语义，并明确归档前置条件、批量汇总和绑定 Session 拒绝行为。

## Impact

- `packages/worktree-session/src/host/tool.ts`：按 action 区分绑定目标和主仓清理入口。
- `packages/worktree-session/src/host/maintenance.ts`：增加当前仓库 operation 枚举、候选判定和批量清理协调，复用现有单 operation 安全门。
- `packages/worktree-session/src/wire.ts`：按需补充仓库级 clean 汇总结果类型。
- `packages/worktree-session/test/`：覆盖无绑定主仓调用、已归档候选批量清理、拒绝原因及绑定 Session 拒绝。
- `skills/ws/SKILL.md` 与当前 capability spec：同步模型操作说明和行为契约。
- 不改变 operation schema、Git 分支/worktree 布局、Session/Workspace 历史保留策略、远端分支或共享依赖缓存。
