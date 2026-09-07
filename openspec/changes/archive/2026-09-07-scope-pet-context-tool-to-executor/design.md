## Context

动机见 `proposal.md — Why`。这里只记录塑造实现路径的运行体事实，全部经安装版 DSH（`/Users/bytedance/.npm/_npx/2f3a729d991ac520/node_modules/@deepseek-ai/`）源码核对：

1. **工具作用域由上下文决定，而非由参数声明。** `dsh-tools` 的 `register()` 直接把注册委托给 `ScopedLayers.effect`（`dsh-tools/lib/index.js:2782`），而后者用 `scopeOf(ctx)` 分流：`scope === undefined → layer = this.global`（`dsh-scope/lib/index.js:190-203`）。Host 插件上下文没有 scope，所以 `ctx.tools.register` 在 Host 上下文即等于**全局注册**。`dsh-tools` 自己的重复注册报错文案印证了这套语义：`(for a per-agent variant, register through that agent's `agent.ctx` instead)`（`lib/index.js:2538`）。

2. **agent 上下文才带 scope。** `dsh-agent-loop` 为每个 Agent `createScope(loopCtx, this)` 并 `this.ctx = this.scope.ctx.extend({ agent: this })`（`lib/index.js:381-382`）。`setup` 收到的正是这个 `prepared.agent.ctx`（`lib/index.js:1330`）。

3. **agent 上下文是 fresh fiber，不继承插件 inject 授权。** 这是 Pet 已经踩过的坑：`index.ts:336` 的注释记录了直接读 `scoped.skills` 会抛 `cannot get property "skills" without inject`，故用 `scoped.inject([...], cb)` 在回调体内注册。

4. **resume 支持 `setup`，且会铸造全新 scope。** `ResumeAgentOptions.setup` 存在（`dsh-agent/lib/types/index.d.ts:134`），resume 与 create 共用 `setupAndPublish`（`dsh-agent-loop/lib/index.js:1320-1331`），而 scope 在 Agent 构造时新建。旧 Agent 销毁时其 scoped 注册随之 unwind。

5. **Pet 不是 executor Agent 加载的唯一入口。** 这是本次调查中影响设计的关键发现：官方 `dsh-api-session-controller` 会为**用户打开的任意 session** 调 `ctx.agents.resume({ …, setup: composition.setup })`（`lib/index.js:398-402`、`422-426`），其 `setup` 只装配 preset 与模型选择（`composeAgent`，`lib/index.js:350-363`），**不含 Pet 的任何 scoped 注册**。而 Pet 规范明确要求 executor session "在原生 DSH 列表中可见并可打开"（`openspec/specs/dsh-pet/spec.md:158`）。因此用户从侧栏点开一个 Pet executor，就会得到一个**没有 Pet scoped 组合**的活 Agent——Pet 的 dispatcher 随后 `ctx.agents.get` 拿到的正是这个 Agent（`index.ts:456`，`get` 命中即不再 resume），于是 Invocation 在缺少 Skill allowlist 边界的 Agent 上执行。

事实 5 意味着：**仅在 Pet 自己的 create/resume 两条路径上装 setup 是不充分的**，这也解释了为什么当前 `pet_context` 的全局注册"看起来能用"——它绕过了作用域，从而掩盖了这条缺口。

## Goals / Non-Goals

**Goals:**

- 让 Pet 可信上下文工具的**可见性**与其**授权边界**一致：只有 Pet executor 的工具面含它。
- 让 Pet 的 scoped 组合在 executor **每一次**进入活跃状态时都存在，覆盖 Pet 自建、Pet resume、以及官方 session controller 代 Pet resume 三条路径。
- 无法保证隔离边界时 fail closed，而不是静默降级执行。

**Non-Goals:**

- 不改 `resolveTrustedContext` 的授权判定与错误分类（本次只改可见性与安装时机）。
- 不改 Pet executor preset（`presets/dsh-pet-executor`）的组成；`skill-filesystem` 的排除理由与本次无关（见 `packages/dsh-pet/docs/adr/ADR-0001-executor-preset.md`）。
- 不为 Pet 引入 package 私有 Agent composition —— 规范明令禁止（`openspec/specs/dsh-pet/spec.md:206`）。本次是在**既有官方扩展点**上注册，不是新建 preset。
- 不改 Web 半区与管理面路由。

## Decisions

### D1：`pet_context` 改在 scoped agent 上下文注册，与 Skill provider 同构

`registerPetTools` 的调用点从 Host `ctx.effect`（`index.ts:279-282`）移入 `executorSetup`，并按事实 3 用 `scoped.inject(['tools'], toolCtx => toolCtx.effect(() => registerPetTools(toolCtx, …)))`。

- **为何不用 `tools.restrict()`**：`restrict` 只能对**已存在的全局工具**做 allow/deny 掩码，且要求 scoped 上下文（`dsh-tools/lib/index.js:2792-2793`）。用它掩盖一个本不该全局存在的工具，等于要求每个非 Pet Agent 都主动 deny —— Pet 无法枚举也无权干预别人的 Agent。方向错了。
- **为何不加运行时开关（如仅在 Pet 会话时 register）**：注册时机远早于任何调用，Host 无从得知未来哪个 Agent 是 Pet 的；作用域本身就是 DSH 给出的正解。
- 保留 `callerSessionId` 的 fail-closed 兜底（`host/tools.ts:44-53`）。作用域收窄后它在正常路径上不再触发，但它防的是"有 scope 但无 agent 关联"的异常执行，属于独立不变量，不因本次改动而多余。

### D2：Pet 自己的 resume 补 `setup`，与 create 复用同一个 `executorSetup`

`index.ts:460-468` 的 `ctx.agents.resume` 增加 `setup: executorSetup`。这是把已有能力接上，而非新机制（事实 4）。

### D3：用 `agent/created` 观察者兜住"非 Pet 发起的 executor 加载"

针对事实 5，Pet 在 Host 上下文注册 `agent/created` 监听：若新 Agent 的 session id 命中 `repository.findTaskByExecutor`，而其作用域尚无 Pet 组合，则就地在 `payload.agent.ctx` 上安装 `executorSetup`。

- `Agent.ctx` 是公开只读属性（`dsh-agent/lib/types/runtime-types.d.ts:75`），且事件按作用域过滤分发、payload 携带确切 Agent（`runtime-types.d.ts:150-152`），因此这是官方给出的、无需猜测的扩展点。
- **幂等性是必需的**，因为 Pet 自建/自 resume 的 Agent 也会触发该事件，而重复注册同名工具会抛 `tool "…" is already registered in this scope`。这与 `shellEnv` 那次事故同类（`index.ts:298-313` 记录了重复注册中断 Pet 初始化、导致 executor 丢失 `bash` 的实测）。实现上以"该 agent 是否已安装"为准做去重，而非依赖 try/catch 吞错。
- **为何不改为总走 D3、去掉 D2**：`agent/created` 在 publish 阶段才发出，而 `setup` 在**发布前**完成、保证"第一次 prompt 组装前"组合已就位（`dsh-agent/lib/types/index.d.ts:99-105`）。Pet 自己发起时用 `setup` 更强也更早；D3 只作为它管不到的路径的兜底。
- **为何不试图阻止用户打开 executor**：规范要求它可见可打开（`spec.md:158`），且那是用户的正常查看行为。

### D4：fail closed —— 组合缺失时不派发 Invocation

dispatch 在使用一个已存在的 Agent 前，确认其作用域已装 Pet 组合；无法确认或安装失败时抛可诊断 `PetError`，让 Invocation 失败并把 Task 交回 idle（与既有 `verifySkill` 失败处理同风格，`index.ts:517-522` 一带的协调器语义）。宁可一次可见失败，也不要一次无隔离边界的执行。

### D5：删除 `host/context-tool.ts:102-114` 的 `petContextToolDefinition`

无引用，且其形状（raw JSON Schema）正是 `test/executor-scope.test.ts:280-289` 断言会抛 `must be a value schema object` 的那种。留着是把一个已知错误示范摆在正确实现旁边。

### D6：与同日上游 workspace-resident / preset mount 演进合并后的最终形态

提交前 rebase 到最新 `origin/main` 时，上游已新增 workspace-resident Task，并明确 `meta.agentPreset` 只记录名称、实际 preset 必须在 `setup` 中 mount。最终实现因此将原先统称的“Pet 组合”拆成三个正交部分：

1. `executorSetup` 只用于 Pet create/resume：先 mount 该 session 持久化的 preset，再安装 scoped surface；
2. `installPetScope` 为幂等纯注册：所有 Pet 管理的 root executor 都获得 `pet_context`，仅专用 Pet Workspace executor 获得 allowlist provider；workspace-resident executor 保留 `standard` preset 与目标 workspace Skills；
3. `agent/created` 观察者只调用 `installPetScope`，因为原生 session controller 已按 `agentPreset` projection mount preset，重复 mount 既多余又可能破坏组合。

Pet 自身 resume 通过 `sessionQuery.observeSession(..., { projectionMode: 'all' })` 读取 `agentPreset` projection（header 仅作无 selection event 时的回退），不从当前 Pet 设置猜测；这样用户在 session 空白期切换 preset 后，恢复时仍与持久化事实一致。若 projection、preset 或 scoped surface 无法证明，dispatch fail closed。

`includeAllowlist` 作为 Task 形态从 coordinator/create seam 显式传入，不靠 preset 名反推，因而合法的自定义 Pet preset 不会被误当成 resident。组件级 WeakSet 只在对应注册成功后写入，允许半安装失败安全重试而不重复已成功的注册。

## Risks / Trade-offs

- **D3 的幂等去重写错 → 重复注册抛错，中断 executor 加载**（历史同类事故已发生过一次）。→ 以显式"已安装"标记做去重并在测试中覆盖"同一 agent 两次事件"与"Pet 自建 agent 也收到事件"两种情形。
- **D3 时序：`agent/created` 是 publish 期事件，同步监听失败会 veto publication**（`dsh-agent/lib/types/index.js:334-343`）。→ 监听体内不做 fallible I/O；组合安装是纯注册。异步失败只被 warn 记录，故不能把它当成唯一保障——这正是保留 D4 的原因。
- **`pet_context` 从全局消失，可能有其它东西正依赖它全局可见。** → 已检索：仓库内仅 `skills/send-cr` 提及，且其规范明确写了"在普通会话中运行（无 `pet_context`）"的降级路径（`openspec/specs/send-cr-skill/spec.md:33-34`），即本改动正是它假设的形态。
- **上游 DSH 若改变 scope 语义或 `agent/created` 契约，D1/D3 需回归。** → 依据集中在少数官方 API，且已在本文件登记确切文件行号，便于升级时复核。

## Migration Plan

1. 实施与单测在 `packages/dsh-pet` 内完成（`npm test`、包内 build/typecheck）。
2. `node scripts/sync.mjs`（或 `dsh build`）物化，并验证连续第二次运行无变化（仓库幂等约定）。
3. 重启 DSH 后按验收点检查：普通会话工具面**不含** `pet_context`；Pet 会话内 `pet_context` 可用；关闭并重开 DSH 让 executor 卸载后再触发 Invocation，确认能力与 Skill 边界仍在；从侧栏直接点开 executor 后再触发 Invocation，确认 Skill catalog 仍只含 Pet 允许清单。
4. 回滚：本改动集中在 `packages/dsh-pet` 与 spec，`git revert` 后重新 `dsh build` 即恢复；无持久化状态迁移，Task/Invocation 数据不受影响。

## Open Questions

- D4 的"确认已装组合"以何为判定信号最稳（Pet 侧自维护的 agent 标记 vs 读取工具面），留待实施时以实际 API 可得性定；两种都不改变本设计的分层与任务划分。
