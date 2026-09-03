## Why

模型可见的 `ws` 工具目前无条件拒绝 Agent 提供显式 `path`，目标只能从调用 Session 自身（binding 或 cwd）解析。这使任何 cwd 不在目标仓库的合法调用方——最典型的是 DSH Pet 执行会话（cwd 固定为 Pet Workspace，却持有 `pet_context` 返回的可信 `repositoryRoot`）——在所有条件正常时也必然失败（session-1f3e83ad 中三轮 `ws clean` 全部得到 `Not inside a Git repository: …/dsh-pet/workspace`）。需要一条**通用、不耦合具体调用方**的通道：Agent 可以请求显式路径，但该路径必须经用户实时一次性授权才被信任。

## What Changes

- 模型可见的 `ws` 工具参数 schema 新增可选 `path`（此前刻意不声明），使授权通道可被发现，而不是依赖“参数根开放、未声明参数也能到达 execute”这一未公开行为；工具描述同步调整。
- Agent 调用 `ws` 携带非空显式 `path` 时，不再直接拒绝，而是通过 DSH 平台 `ApprovalService`（`@deepseek-ai/dsh-user-approval`）向用户发起一次性授权询问，询问附带确切的 action 与 path。
- 仅 `allowed-once` 视为授权，且只授权本次调用；`rejected`、`cancelled`、`unavailable`（无 answerer）与 session policy `never` 一律落回既有拒绝行为（fail closed）。
- 授权只替换“路径来源信任”：`clean` 带授权路径等价于从该主 checkout 的普通 Session 发起仓库级扫描；`status`/`promote` 带授权路径等价于既有 operator CLI 的显式路径单 operation 语义。全部既有安全门（unbound、archived、active、dirty、in-flight、merge ancestry、schema 校验等）逐项照常执行，拒绝仍是拒绝。
- 省略 `path` 或空字符串 `path`（老 wire 兼容）的调用保持现有解析完全不变：`status`/`promote` 按调用 Session binding，`clean` 按调用 Session 的主 checkout cwd。
- 每次授权询问及其结果通过既有 `approval/asked`/`approval/decided` 审计事件成对写入调用会话日志。
- `skills/ws/SKILL.md` 补充通用操作指引：当调用会话 cwd 不在目标仓库时，用已被受信机制证实的仓库根（如 Pet 的 `pet_context`）作为 `path` 并接受用户授权；不改变 skill 的 ownership boundary。
- `dsh-pet` 侧零代码改动；`dsh-ws` operator CLI、HTTP route、operation schema 均不变。

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `source-workspace-worktree-session`: Agent 显式 `path` 从无条件拒绝改为“用户一次性授权后信任”；授权路径下 `clean` 的仓库级扫描语义与 `status`/`promote` 的单 operation 语义、审计要求和全部 fail-closed 退路。

## Impact

- `packages/worktree-session/src/host/tool.ts`：`targetFor`/`cleanTargetFor` 增加“非空 Agent path → approval 询问”分支；注入 `ctx.approval`。
- `packages/worktree-session/test/`：覆盖授权通过、拒绝、取消、无 answerer、policy `never`、空字符串兼容与安全门不受授权影响。
- `skills/ws/SKILL.md` 与当前 capability spec：同步模型操作说明。
- 依赖前置 change `clean-worktrees-from-main-session`（已实现未归档）：本 change 的 delta 在其 ADDED requirement 之上修订“不得接受模型指定路径”的绝对表述。
- 不改变 `dsh-pet`、`dsh-ws` CLI、HTTP clean route、operation schema、归档生命周期或依赖缓存策略。
