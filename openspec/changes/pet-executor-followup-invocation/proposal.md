## Why

Pet Task 结算后，**executor 会话里本人直接输入的消息不产生任何 Invocation**：`pet_context` 只能按 `running|waiting-user` 解析当前 Invocation（`src/host/capture.ts` 的 `resolveTrustedContext`、`src/host/repository.ts` 的 `findCurrentInvocation`），而 Invocation 目前只有两条创建路径——来源会话里的能力手势（`POST /invocations` → `PetCoordinator.accept`）与入站 channel 消息（`acceptConversation`）。

后果是这个会话变成死胡同：模型被 standing instructions 要求先读可信上下文，却只拿到 `NO_CURRENT_INVOCATION`；而这一轮里它既没有授权快照，也没有**结构性**的动作闸门（bash、文件工具都不校验 Invocation，只有提示词在约束）。实测复现：`task-ecf66b4f-589d-49f4-ab8f-5c0d157d1494` / `session-26ecffef-db58-42b0-aeb7-847c63494fc8`——`ws` Invocation 结算为 `succeeded`、Task 回到 `idle` 后，用户在该会话回复上一轮遗留的决策问题，模型连调三次 `pet_context` 全部报错，只能停手。

这同时是对既有规范的欠实现：`openspec/specs/dsh-pet/spec.md` 的「每次主动调用在发起位置捕获独立快照」要求“系统 SHALL 在用户主动调用能力**或提交新 Pet 请求时**创建 Pet Invocation”，而 Prompt 与设计（`openspec/changes/archive/2026-09-03-add-dsh-pet/design.md`）一直把该会话描述为“会承载多次串行 Invocation、完成一次调用不等于结束整个 Task”。缺的是第三种发起位置，不是一条新的授权主体。

## What Changes

- 新增第三条 Invocation 发起路径：**root executor 会话里的真人直输消息**。当 Task 的串行槽空闲时，该消息在模型第一步之前被登记为一次**会话内直输 Invocation**（不绑定 Skill，`capabilityId` 为 `session-message`），snapshot 按该 Task **自己固定的来源 scope** 在登记时刻重新捕获，因此模型依然无从改绑目标。
- 识别规则：只认客户端提交的 user message（携带 `rpcId`）、Pet 未派发过、且不是 host 注入上下文或渠道投递；locus child 与 qa-child 会话一律不适用。
- 时序与竞态：优先在消息进入 executor 会话 inbox 时登记；若串行槽仍被占用则不登记，由该消息自己被 claim 的那一轮（`agent/inbox/claimed`）重试；`pet_context` 在“登记进行中”时短暂等待，避免模型第一步先于登记落库。
- 串行语义不变：会话内直输 Invocation 占用同一个串行槽，Task 状态、面板可见性与 `pump` 排队规则与既有 Invocation 一致；运行中到达的真人消息不抢占当前调用。
- 空闲且无法登记时（Task 已归档、来源事实无法重建、槽被占用）保持 fail closed，但语义变为可诊断：明确指出“本轮不属于任何 Invocation”、禁止沿用上一条快照执行有副作用操作、并给出继续工作的路径；配套修正 executor standing instructions，并要求需要用户决策时**在调用内**提问（`ask_user_question` / 等待批准），不得“纯文本提问后结束调用”。
- 本次不做：不为 locus child / qa-child 引入该路径（它们各有自己的上下文与投递语义）；不放宽 `pet_context` 的目标解析（仍零参数、caller-bound）；不新增授权主体、不引入 Pet 私有 Agent composition；不改动渠道对话式 Invocation 的既有行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `dsh-pet`: 扩展「每次主动调用在发起位置捕获独立快照」，把 executor 会话内的真人直输列为第三种发起位置，并规定其 snapshot 必须从该 Task 固定的来源 scope 重建；新增「会话内真人直输登记为 Invocation」需求（识别、登记时机、排除规则、串行与失败语义）；扩展「Pet Agent 获得稳定身份前馈和可信的当前 Invocation 上下文」，补空闲期行为、继续路径说明与调用内提问规则。

## Impact

- `packages/dsh-pet/src/host/coordinator.ts`：新增会话内直输登记入口，复用既有 slot/pump/settle 语义。
- `packages/dsh-pet/src/index.ts`：executor 会话的 inbox/turn 观察者，接入真人消息识别与登记。
- `packages/dsh-pet/src/host/capture.ts`、`repository.ts`：从 Task 固定来源重建 snapshot 与空闲态诊断。
- `packages/dsh-pet/src/host/context-tool.ts`、`tools.ts`：空闲态诊断与“登记进行中”等待。
- `packages/dsh-pet/executor-instructions.md`、`src/wire.ts`（会话内直输 `capabilityId` 与错误/诊断字段）。
- `packages/dsh-pet/src/client/`：面板展示会话内直输 Invocation 与空闲提示。
- 测试：`packages/dsh-pet/test/` 新增回归（识别、排除、时序、串行、fail closed），并跑仓库 `npm test`、`npm run check:artifacts`、`node scripts/sync.mjs` 幂等校验。
- 不修改 DSH core；不改动 locus/qa-child 的投递与授权语义；不引入新的 provider 或凭据访问。
