## Why

`pet_context` 目前注册在 **Host 插件上下文**上（`packages/dsh-pet/src/index.ts:279-282`），而官方 `dsh-tools` 的 `register()` 按上下文有无 scope 决定作用域：无 scope 即落 **global 层**（`@deepseek-ai/dsh-scope` `ScopedLayers.effect`，`scope === undefined → layer = this.global`）。结果是 DSH 里**任意普通会话**的工具面都带上 `pet_context`，模型会误调用并拿到 fail-closed 错误 `This session is not bound to a Pet Task, so no Pet context is available.`（`host/capture.ts:235`）——本次问题即由此实机复现。

同一处代码还暴露出一个更严重的关联缺陷：`dispatch` 在 executor 被 DSH 卸载后走 `ctx.agents.resume(...)` 却**不传 `setup`**（`index.ts:460-468`）。resume 会铸造**全新 agent scope**，因此 Pet 的 scoped Skill allowlist provider 在 resume 后**消失**。当前 `pet_context` 因误在 global 层反而"侥幸"仍可用；若只把工具改为 scoped 而不修 resume，就会把这个隐藏缺陷放大到 `pet_context` 本身。

进一步核对官方运行体后还发现第三条路径：Pet 并非 executor Agent 的唯一加载者。规范要求 executor session 在原生列表中可见并可打开（`openspec/specs/dsh-pet/spec.md:158`），而官方 `dsh-api-session-controller` 为用户打开的任意 session 调 `agents.resume`，其 `setup` 只装 preset 与模型选择（`lib/index.js:398-402`、`350-363`），**不含 Pet 组合**；Pet 的 dispatcher 随后 `agents.get` 命中即直接复用该 Agent（`index.ts:456`），于是 Invocation 在缺少 Skill 隔离边界的 executor 上执行。三条路径需一并覆盖。

## What Changes

- `pet_context` 改为**仅注册在 Pet executor 的 scoped agent 上下文**上，经既有 `executorSetup` 组合安装；不再出现在非 Pet 会话的工具面。
  - agent 上下文是 fresh fiber，不继承插件的 inject 授权，故需 `scoped.inject(['tools'], …)`，与既有 `skills` 注册同构（`index.ts:336`）。
- Pet executor 的 **resume 路径补齐 scoped 组合**：`ctx.agents.resume` 传入与 `create` 相同的 `setup`，使 `pet_context` 与 Skill allowlist provider 在 executor 被卸载后重新加载时同样存在。
- 为 **Pet 之外的 executor 加载路径**补兜底：经官方 `agent/created` 事件识别命中 Pet Task 的 executor Agent，在其自身作用域上幂等安装 Pet 组合，使用户从原生列表打开 executor 后的 Invocation 同样受 Skill allowlist 约束。
- 收紧不变量为可测断言：非 Pet 会话的工具面 MUST NOT 包含 Pet 可信上下文工具；executor 无论由 Pet 创建、由 Pet 恢复，还是由 DSH 自身加载，MUST 具备同一套 scoped 组合；无法确认时 fail closed 不派发。
- 清理 `host/context-tool.ts:102-114` 的死代码 `petContextToolDefinition`：无任何引用，且仍是已被证明会在注册时抛错的 raw JSON Schema 形状，留存会误导后续改动。
- 非破坏性：Pet executor 侧可见行为不变（工具仍在、解析仍按调用 session 反查）；变化是**移除非 Pet 会话的工具面污染**并修复 resume 后的能力丢失。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-pet`：「Pet Agent 获得稳定身份前馈和可信的当前 Invocation 上下文」要求补充可信上下文工具的**注册作用域**约束（只对 Pet executor 发布，非 Pet 会话不可见）；新增「Pet executor 的作用域组合在每次加载时存在」要求，覆盖 Pet 创建、Pet 恢复与 DSH 自身加载三条路径，并规定幂等与 fail-closed 语义。

## Impact

- 代码：`packages/dsh-pet/src/index.ts`（工具注册位置、`executorSetup` 组合、resume 调用、`agent/created` 兜底观察者、dispatch 前置校验）、`packages/dsh-pet/src/host/tools.ts`（注册契约与注释）、`packages/dsh-pet/src/host/context-tool.ts`（删除死代码）。
- 测试：`packages/dsh-pet/test/executor-scope.test.ts` 现有断言只统计 `ctx.tools.register(` 出现次数（第 264 行一带），管不到作用域，需要新增作用域与 resume 回归用例。
- 规范：`openspec/specs/dsh-pet/spec.md` 相关 Requirement 增补。
- 依赖与信任面：不引入新依赖，不改变授权判定逻辑（`resolveTrustedContext` 仍按真实调用 session 反查、仍 fail closed）；本次是工具**可见性**收窄，不是授权放宽。
- 部署：改动落在 local package，需经 `dsh build` 物化后在 Web 侧验证。
