## 1. 固化当前缺陷为失败测试

先让缺陷可复现，避免"改完看起来对了"。每条都应在改动前 FAIL、改动后 PASS。

- [x] 1.1 在 `packages/dsh-pet/test/executor-scope.test.ts` 增加用例：在真实 `ToolRegistry` 上以 **Host（无 scope）上下文**调用 `registerPetTools`，断言该工具出现在**全局**工具面 —— 即当前实现的行为，用于证明 `ctx.tools.register` 在 Host 上下文等于全局注册（依据 design D1 / 事实 1）。该用例在实施后改写为断言"scoped 注册不污染全局"。

  实现在新文件 `test/tool-scope.test.ts`（5 例），驱动**真实** `ToolRuntime` + `createScope`，而非手写替身——本缺陷的成因正是对该契约的错误假设。实测确认三点上游语义：(a) 无 scope 上下文注册落 global 层；(b) scoped 注册对全局与另一 agent 均不可见；(c) 直接读 `scoped.tools` 抛 `cannot get property "tools" without inject`，坐实 design 事实 3。`ToolRuntime` 需先 `plugin(SystemPrompt)`（其 `static inject = ["systemPrompt"]`），否则 `ctx.tools` 为 undefined。
- [x] 1.2 增加用例：mock 一个 `agents.resume` 记录其收到的 options，驱动 dispatcher 走"agent 未加载 → resume"分支，断言 resume 收到了 `setup`（当前 FAIL，见 `index.ts:460-468`）。
- [x] 1.3 增加用例：模拟"Pet 之外的加载者"——先在不带 Pet 组合的作用域上发布一个 session id 命中 Pet Task 的 Agent，再驱动 dispatch，断言系统不会在无 Pet 组合的 Agent 上派发（当前 FAIL，见 design 事实 5）。

  1.2/1.3 实现在新文件 `test/executor-composition-paths.test.ts`，按三条加载路径分组，驱动**真实 plugin entry**（`src/index.ts`）而非部件子集——只有这样才能回归"接线"缺陷。基线实测：path 1 PASS、path 2 FAIL（`resumed` 为空，即 resume 未收到 setup）、path 3 FAIL（在无 Pet 组合的 agent 上照常派发）。两个缺陷已可复现。

## 2. 工具作用域收窄（D1）

- [x] 2.1 把 `registerPetTools` 的调用从 `index.ts:279-282` 的 Host `ctx.effect` 移入 `executorSetup`，用 `scoped.inject(['tools'], …)` 在回调体内注册（agent ctx 是 fresh fiber，直接读 `scoped.tools` 会抛 `cannot get property "tools" without inject`；与 `index.ts:336` 的 `skills` 注册同构）。
- [x] 2.2 更新 `host/tools.ts` 的文件头注释与 `registerPetTools` 的 JSDoc：说明它 MUST 接收 **scoped agent 上下文**，并写明"传 Host 上下文会落 global 层"这一具体后果，防止回归。
- [x] 2.3 保留并解释 `callerSessionId` 的 fail-closed 兜底（`host/tools.ts:44-53`）：作用域收窄后它不再是主防线，但仍覆盖"有 scope 无 agent 关联"的异常执行。
- [x] 2.4 改写任务 1.1 的用例为最终形态：在 scoped 上下文注册后，断言该工具**只**出现在该 agent 的工具面，且**不**出现在全局工具面与另一个无关 agent 的工具面。

  `test/tool-scope.test.ts` 覆盖：不污染全局、对本 scope 可见、对无关 agent 不可见、scope 释放后不残留；并保留一例**正向固定上游契约**（Host 上下文注册确实落全局），使未来若有人改回 Host 注册，失败信息直接说明原因。

## 3. Pet 自身 resume 补齐组合（D2）

- [x] 3.1 在 `index.ts:460-468` 的 `ctx.agents.resume` 调用中传入 `setup: executorSetup`（`ResumeAgentOptions.setup` 为官方既有能力）。
- [x] 3.2 让任务 1.2 的用例转 PASS，并补一条：resume 得到的 agent 其作用域同时具备 `pet_context` 与 Pet Skill allowlist provider（覆盖 delta spec 的两条 resume 场景）。

  path 2 用例断言 resume 收到的 `setup` **与 create 用的是同一函数引用**，因此"两种能力都装上"由该函数的单一实现保证，无需分别断言两次注册。删除 `setup: executorSetup` 后该用例实测 FAIL，确认其确实在守这条线。

## 4. 非 Pet 加载路径的幂等兜底（D3）

- [x] 4.1 实现 `agent/created` 观察者：在 Host 上下文注册，命中 `repository.findTaskByExecutor(session.id)` 时，在 `payload.agent.ctx` 上安装 `executorSetup`。监听体内 MUST NOT 做 fallible I/O（同步监听失败会 veto publication）。
- [x] 4.2 实现幂等：以显式"该 agent 已安装"标记去重，MUST NOT 依赖 try/catch 吞下 `tool "…" is already registered in this scope`。这与 `shellEnv` 重复注册事故同类（`index.ts:298-313` 记录了它曾导致 executor 丢失 `bash`）。

  去重标记为 `composedAgents`（`WeakSet<object>`，键为 agent 的 scoped context），置于 `executorSetup` 入口，因此**三条路径共用同一道幂等闸**，而非只在观察者里补。用 Weak 容器避免钉住已销毁 agent 的上下文。
- [x] 4.3 观察者内的异步失败只记 warn，不抛；真正的把关由任务 5 的 fail-closed 承担。
- [x] 4.4 测试：Pet 自建的 agent 也会收到该事件 → 不重复注册、不报错；同一 agent 两次触发 → 幂等；非 Pet session 的 agent → 不安装任何 Pet 组合。

  幂等用例断言两次 `agent/created` 后 `injected` 恰为 `['skills','tools']`（而非仅"不抛异常"），否则重复注册会被静默放过。观察者用例在**任何 dispatch 之前**断言组合已装，避免被任务 5 的迟到修复掩盖——初版正是这样误判，删除观察者仍 PASS，收紧后才如实 FAIL。

## 5. fail closed（D4）

- [x] 5.1 在 dispatch 复用一个**已存在**的 Agent（`ctx.agents.get` 命中）前，确认其作用域已具备 Pet 组合；判定信号在实施时按实际可得 API 选定（design Open Questions）。

  Open Question 结论：采用 **Pet 侧自维护标记**（`composedAgents` + `isComposed(agent)` 读 `agent.ctx`），不读工具面。理由：`ToolRuntime.schemas(scope)` 需要 scope key，而 Pet 手上只有 `Agent`，其 scope key 并未公开；自维护标记同时天然复用为幂等闸，只有一个真相源。
- [x] 5.2 无法确认或安装失败时抛可诊断 `PetError`，使该 Invocation 失败并将 Task 交回 idle，语义与既有 `verifySkill` 失败处理一致；MUST NOT 静默降级执行。

  实际落点与预期略有差异并已确认为正确：coordinator 对 dispatch 抛错的既定处理是把 Invocation/Task 置 `recovering`（`coordinator.ts:342-351`，"dispatch 结果不确定，交由持久事件裁决"），而非 `idle`。沿用该既有语义而不是为本次新增一条分支，避免出现两套失败模型。
- [x] 5.3 让任务 1.3 的用例转 PASS，并补一条断言：失败后 Task 回到 idle、后续 Invocation 仍可运行。

  按 5.2 的实际语义，断言改为：**未派发**（`followups` 数量不变）且 Task 为 `recovering`、`diagnostic` 含 "Pet scope"——即失败可见且可诊断，而非静默降级。

## 6. 清理死代码（D5）

- [x] 6.1 删除 `host/context-tool.ts:102-114` 的 `petContextToolDefinition`；先 grep 全仓确认零引用。

  全仓 grep 确认除自身定义外仅本 change 的规划文档提及。原位置留一条注释说明真正的定义在 `host/tools.ts`，以及被删常量为何是错误示范，避免同样的重复定义再次出现。
- [x] 6.2 确认 `test/executor-scope.test.ts` 中断言 raw JSON Schema 形状会抛 `must be a value schema object` 的用例仍保留（它守的是 `defineTool` 契约，与被删的常量无关）。

## 7. 验证与物化

- [x] 7.1 `packages/dsh-pet` 包内 build / typecheck / test 全过。

  `npm run typecheck` 通过；`npm run build`（host tsc + client tsdown）成功；`vitest run` **37 文件 / 592 例全过**。过程中修了两处受本改动影响的既有测试：(a) `executor-scope.test.ts` 用正则数 `ctx.tools.register(` 出现次数来限制工具数量，会把新增的**注释文字**误计为第二次注册——改为先剥离注释再计数；(b) `loader-composition.test.ts` 的 agent 替身没有 `ctx`、`create` 也不执行 `setup`，而真实 `agents.create` 必定在发布前 await `setup`，该替身描述了 DSH 不可能产出的 agent——补齐 `ctx` 与 `await options.setup?.()` 使其忠实，而非放宽产品侧的 fail-closed 判定。
- [x] 7.2 仓库级 `npm test` 与 `npm run check:artifacts` 全过。

  `npm test`：97 例中 96 通过、1 跳过（既有 skip）、0 失败。`check:artifacts`：tracked paths comply。
- [x] 7.3 `node scripts/sync.mjs` 物化，并连续运行第二次确认无变化（仓库幂等约定）。

  首次运行遇到 2 个失败（`dsh-pet` 部署刷新失败、`@byted/dsh-traex-bridge` 移除失败）。**已用 git stash 验证其与本改动无关**：把全部改动 stash 后重跑，两个失败完全相同。根因是 BACKLOG **[U005]** 记录的已知问题——`~/.dsh/profiles/web/.npmrc` 不受 sync 管理，而该文件此刻缺失，导致 profile 的 pnpm 继承用户级内网 registry，公共包 404。按 U005 记载的确切内容补回该文件（两行缺一不可）后 sync 成功（3 change applied），第二次运行输出 `no changes — deployment already matches manifest`，幂等成立。已核验部署产物 `~/.dsh/profiles/web/node_modules/dsh-pet/lib/index.js` 含本次三处修复。
- [x] 7.4 重启 DSH 后实机验收四点：(a) 普通会话工具面不含 `pet_context`；(b) Pet 会话内 `pet_context` 正常返回当前 Invocation 快照；(c) executor 被卸载后再触发 Invocation，能力与 Skill 边界仍在；(d) 从原生侧栏点开 executor 后再触发 Invocation，Skill catalog 仍只含 Pet 允许清单。

  验收证据（2026-09-07）：Host 确认由旧 PID 93236 切换为新 PID 64589，启动晚于修复产物物化时间。(a) 普通会话 `session-f61b599e-0209-4261-b805-ff15e8808859` 的真实 `request/header` 含 30 个工具、`pet_context=0`，且没有 `NOT_A_PET_SESSION`；该会话甚至位于 Pet workspace，证明可见性按 scoped 绑定而非 cwd/AGENTS.md。(b) Pet executor `session-61920947-b4da-4fda-a4f0-266e79df5478` header 含且只含一个 `pet_context`，成功返回数据库实际绑定的 `task-005ecc43-e476-4f4a-8a84-177b83631aa8` / `inv-ea724c62-ce1d-40e9-8f3f-a2c8546bbd4b` / source snapshot。(c) resume 路径由反向回归测试直接证明：删除 `setup: executorSetup` 后 path 2 用例明确 FAIL；完整包 592 例通过，避免为了实测卸载而破坏当前会话。(d) 用户先从原生侧栏打开上述 executor，再回原来源 `session-268d842a-849d-44bb-b317-8f46163f455e` 发起第二次 Invocation；同一 Task、同一 executor 新增 `inv-41c1aa10-32a0-4a44-ba14-3d168f1f8f45`（queuePosition 1），`pet_context` 第二次成功且返回新 snapshot，Invocation 最终 `succeeded`；Host 日志无 `missing its Pet scope` 或 `could not scope externally loaded executor`。期间一次从 executor 页面直接点 Pet 创建了嵌套 Task `task-a7eeed0a...` / executor `session-886ed5d1...`，调用成功但不作为 (d) 证据。
- [x] 7.5 更新 `dsh.yaml` 中 `dsh-pet` 条目的 note，追加本次作用域修正与三条加载路径的结论（该 note 是定制的审查记录真相源）。

  已追加：scoped 注册的强制要求与「无 scope 静默落 global」这一上游语义、三条加载路径各自的修法、观察者不做 fallible I/O 的理由、fail-closed 落点，以及幂等闸位置并点名与既有 shellEnv 事故同型。改后校验 YAML 可解析，且 sync 仍报 `no changes`（note 不影响物化）。

## 8. 归档

- [x] 8.1 `openspec validate "scope-pet-context-tool-to-executor" --strict` 通过。
- [x] 8.2 确认 `openspec/specs/dsh-pet/spec.md` 已反映最终行为后归档 change。

  已按 delta 智能合并到主规范：原 Requirement 的全部既有场景保留，新增普通会话工具面不可见场景，并新增覆盖 create / Pet resume / DSH 自身加载、幂等与 fail-closed 的完整 Requirement。逐项比对 8 个关键条款全部 MATCH，`openspec validate --strict` 通过。
