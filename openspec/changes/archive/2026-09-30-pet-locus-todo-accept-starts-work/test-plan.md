## Test Plan

全部 41 个 scenario 均映射到具名测试，无遗漏。测试文件按现有分布归位：正文组装与执行目标解析入新建的 `todo-dispatch.test.ts`，工具面入 `ledger-track.test.ts` / `ledger-tool-scope.test.ts`，路由入 `locus-routes.test.ts`，前端入 `ledger-panel-render.test.ts`，既有不变量回归留在原文件。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 受理同时置状态并投递 | packages/dsh-pet/test/todo-dispatch.test.ts | accept dispatches then advances to accepted | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 投递正文携带待办上下文 | packages/dsh-pet/test/todo-dispatch.test.ts | body states itemId requester time endpoint and evidence | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 证据如实标注为登记时快照 | packages/dsh-pet/test/todo-dispatch.test.ts | body marks evidence as registration-time snapshot | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 证据位于正文末段之后无 Host 文本 | packages/dsh-pet/test/todo-dispatch.test.ts | evidence is final section with no trailing host text | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 证据段不设结束定界符 | packages/dsh-pet/test/todo-dispatch.test.ts | evidence section has start marker and no end marker | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 伪造定界符不能使后续文本脱离证据段 | packages/dsh-pet/test/todo-dispatch.test.ts | forged delimiter stays inside the evidence section | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 正文声明证据来自第三方 | packages/dsh-pet/test/todo-dispatch.test.ts | body declares evidence as third-party input | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 收到过待命简报的主会话被告知待命结束 | packages/dsh-pet/test/todo-dispatch.test.ts | briefed main is told standby has ended | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 未收到待命简报的主会话不被告知解除 | packages/dsh-pet/test/todo-dispatch.test.ts | never-briefed main omits the standby-ended sentence | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 跟进不投给只读子会话也不提权 | packages/dsh-pet/test/todo-dispatch.test.ts | dispatch never targets the child nor mutates permission | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 目标不可达时不置已受理 | packages/dsh-pet/test/todo-dispatch.test.ts | unreachable target leaves the todo open | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 投递失败后可以重新受理 | packages/dsh-pet/test/todo-dispatch.test.ts | accept retry succeeds after a dispatch failure | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 已受理的待办不能再次受理 | packages/dsh-pet/test/todo-dispatch.test.ts | accepted todo rejects a second accept without dispatching | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 终态待办的受理请求在投递前被拒 | packages/dsh-pet/test/todo-dispatch.test.ts | terminal todo rejects accept before the dispatch port is called | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理即开工并向主会话投递带上下文的跟进任务 | 受理不外发飞书 | packages/dsh-pet/test/todo-dispatch.test.ts | accept emits no Feishu body reaction or Delivery | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理投递按队列语义接入主会话且不打断在途工作 | 受理返回投递结果事实 | packages/dsh-pet/test/locus-routes.test.ts | todoAction accept returns a dispatch outcome | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理投递按队列语义接入主会话且不打断在途工作 | 不投递的动作不返回投递结果 | packages/dsh-pet/test/locus-routes.test.ts | done and drop return no dispatch field | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理投递按队列语义接入主会话且不打断在途工作 | 投递结果不写入待办 | packages/dsh-pet/test/locus-routes.test.ts | reread todo carries no dispatch outcome | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理投递按队列语义接入主会话且不打断在途工作 | 目标忙碌时排队不打断 | packages/dsh-pet/test/todo-dispatch.test.ts | running target yields queued via followup not steer | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理投递按队列语义接入主会话且不打断在途工作 | 目标未加载时先恢复 | packages/dsh-pet/test/todo-dispatch.test.ts | unloaded target resumes before dispatch | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 受理投递按队列语义接入主会话且不打断在途工作 | 已排队不等于已处理 | packages/dsh-pet/test/ledger-panel-render.test.ts | queued outcome renders as queued not completed | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话可在登记后请求执行且与所有者受理共用同一链路 | 子会话登记后请求执行 | packages/dsh-pet/test/ledger-track.test.ts | child request-execution dispatches and marks accepted | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话可在登记后请求执行且与所有者受理共用同一链路 | 请求执行与受理走同一链路 | packages/dsh-pet/test/todo-dispatch.test.ts | both entry points share resolution body and outcomes | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话可在登记后请求执行且与所有者受理共用同一链路 | 工具不接受目标选择 | packages/dsh-pet/test/ledger-track.test.ts | request-execution rejects any target selector argument | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话可在登记后请求执行且与所有者受理共用同一链路 | 不能就他人登记的待办请求执行 | packages/dsh-pet/test/ledger-track.test.ts | foreign todo request-execution is refused | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话可在登记后请求执行且与所有者受理共用同一链路 | 请求执行不赋予改写状态的一般能力 | packages/dsh-pet/test/ledger-track.test.ts | request-execution cannot mark done or dropped | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 子会话可在登记后请求执行且与所有者受理共用同一链路 | 请求执行不触发界面导航 | packages/dsh-pet/test/ledger-track.test.ts | request-execution returns no navigation instruction | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 登记后队列继续前进 | packages/dsh-pet/test/ledger-delivery-decoupling.test.ts | backlog advances after registration (existing, re-asserted) | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 回复完成不等于事情做完 | packages/dsh-pet/test/ledger-delivery-decoupling.test.ts | settled delivery leaves the todo open | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 待办状态变化不外发 | packages/dsh-pet/test/ledger-delivery-decoupling.test.ts | status change emits nothing to Feishu | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 模型不能把待办推进到终态 | packages/dsh-pet/test/ledger-tool-scope.test.ts | no model-facing tool can reach done or dropped | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 不经受理直接了结 | packages/dsh-pet/test/todo-dispatch.test.ts | done and drop from open never dispatch | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 受理动作自述会开工 | packages/dsh-pet/test/ledger-panel-render.test.ts | accept hint states dispatch and navigation | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 受理成功后转到执行目标会话 | packages/dsh-pet/test/ledger-panel-render.test.ts | successful accept opens the resolved execution target | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 受理失败不导航 | packages/dsh-pet/test/ledger-panel-render.test.ts | failed accept stays put and shows the reason | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 导航后仍能分辨投递结局 | packages/dsh-pet/test/ledger-panel-render.test.ts | queued outcome survives the navigation | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 缺少导航能力时受理照常完成 | packages/dsh-pet/test/ledger-panel-render.test.ts | accept succeeds without a session opener | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 话题待办跳回原话题 | packages/dsh-pet/test/ledger-view.test.ts | thread todo links to its thread (existing, re-asserted) | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 话题身份不可证时退化 | packages/dsh-pet/test/ledger-view.test.ts | unprovable thread degrades to chat with reason | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 会话已归档时不可跳转 | packages/dsh-pet/test/ledger-view.test.ts | archived child disables the session jump only | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 退役 locus 的待办仍在列表中 | packages/dsh-pet/test/ledger-view.test.ts | retired locus keeps its todo listed and disposable | 🟢 green |

## Coverage Notes

**新建测试文件**：`packages/dsh-pet/test/todo-dispatch.test.ts` 承载执行目标解析、正文组装与投递语义。放在一起是因为这三者是 D3/D4/D8/D9 的同一条链路，分文件会让"两个入口共用一条链路"这条断言无处安放。

**共享 fixture —— 假投递端口**。D9 定义的 `TodoDispatchPort { resolve, resume, followup }` 必须可伪造，否则 idle/running/archived/resume 失败/`followup` 抛错这五条路径只能靠真实 DSH 时序触发，测试会变慢且不稳定。假端口需记录调用序列，这是下面两类断言的基础：

- **"投递前被拒"类**（终态待办、他人待办）：断言的不是"返回了错误"，而是**假端口从未被调用**。只断言返回值无法区分"拒绝在投递前"与"投递了再回滚"，而这正是 review round 3 的 blocking 发现。
- **`dispatched` vs `queued`**：由投递**前**读到的 `status` 决定，不由 `followup` 返回值决定（`followup` 是同步 void）。假端口据此分别返回 `idle` / `running`。

**注入测试只测结构，不测模型行为**（D8 的三层定位）。恶意证据用例（伪造起始标记、Markdown 代码围栏、形似段落结束的文本）断言的是"该文本仍位于正文末段之内、指令段字节不变"，**不是**"模型没有照做"。后者无法确定性断言，写成测试就是假绿灯。

**既有测试的重断言**（登记解耦与跳转两组既有场景）：这些 scenario 在 `pet-locus-intent-triage` 已归档时就有覆盖，本 change 未改其行为。仍列为 🔴 red 并要求重跑，是因为本 change 改动了同一批模块（`store.ts` 的 advance 分支、`settings.tsx` 的动作面），需要证明没有回归——现有测试通过即可翻绿，不必新写。

**「请求执行不触发界面导航」是 Host 侧断言，不是组件交互测试**（review round 6 的 S2）。子工具路径按设计就没有 GUI 上下文，所以不能用组件测试去"观察它没导航"。可机械断言的形式是：工具路径的返回值不含任何导航指令、且不触达任何 GUI 接缝——因此它归在 `ledger-track.test.ts` 而非 `ledger-panel-render.test.ts`。

**导航相关三条的断言对象是 `sessionOpener` 的调用**（成功时以回执里的 `executionTarget.sessionId` 调用一次、失败时零调用、opener 缺失时受理仍成功）。注意断言的是**目标 id 与回执一致**，而不是"等于 parentSessionId"——后者会把 D3 要消除的硬编码重新写进测试，将来解析规则变化时测试会误报绿。

**工具面回归（不在上表，但为 tasks 强制项）**：新工具必须注册在 executor 的 **scoped** agent 上下文并加入 `composition.ts` 白名单。无 scope 会静默落 global 层使普通会话看到该工具，这是本仓库已实机复现过的陷阱。`ledger-tool-scope.test.ts` 须固定"普通会话工具面不变"，该断言覆盖的是整个工具面而非单个 scenario，故不占上表行。
