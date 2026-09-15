# Pet Locus 独立 child：工作上下文切换记录

本文记录 2026-03-23 的一次**范围收敛**：把「让 Pet Locus 可以真正用起来」从 B035 的完整协作平台中拆出来，作为独立 change 推进；B035 剩余部分整体暂停，不删除、不静默降级、不把已写模块当成已验收能力。

## 为什么切换

最初目标不是做协作平台，而是**正式开始使用 Pet Locus**。B035 的触发故障是：答疑群提问后子会话「只 done 没回复」——child 由 `provider: 'fork'` 创建，继承父会话全部历史，于是继续扮演 GUI 里的主 agent，把结论写成普通 assistant 文本，从未调用 `pet_locus_reply`。Delivery 因 turn 正常结束被 settled，飞书侧没有收到任何内容。

从该故障出发，方案链条是：

```text
不再 fork 父 transcript
→ child 失去背景，需要补偿
→ 公共事实（共享笔记）
→ 公共事实不足时需要问人
→ 协作者发现 + 定向异步询问
→ 跨轮 Delivery 续进、非 steering 队列、G1–G5 runtime 门槛
```

真正修复原始故障的只有第一步。后面几步把 change 扩成 57 项任务，反而挡住了「先用起来」。

所有者 2026-03-23 决定：本期只做独立 child 与可靠回复出口；共享事实**先通过「问父，让父问子」的现有原生路径替代**，不实现持久公共记录。

## 冻结点

- 提交：`a4540c4 fix(dsh-pet): align inquiry legacy expiry semantics`
- 上一提交：`f184a94 feat(dsh-pet): implement independent agent inquiries`
- 工作区 clean，无未提交改动

## B035 暂停时的真实状态

`openspec/changes/pet-locus-independent-agent-inquiries/` 保留原样，仅 1.1 与 8.4 已勾选（2/57）。

### 已有模块级实现（未启用）

| 区域 | 文件 | 状态 |
|---|---|---|
| caller 解析 | `host/collaboration/caller.ts`、`host-identity.ts` | 纯模块 + 单测；生产未开启 |
| 公共事实 | `host/collaboration/context.ts`、`context-store.ts` | 值模型与 CAS 存储完成；`ensure()` 无生产调用方 |
| 公共事实工具 | `host/collaboration/query.ts`、`write.ts`、`tools.ts` | 已实现；依赖 assembly 才能装配 |
| 协作者名单 | `host/collaboration/collaborators.ts` | 缺分页与显式 inquirable 状态 |
| 询问台账 | `host/inquiry/ledger.ts`、`ledger-store.ts` | v13 无期限模型；v12 兼容读取 |
| 调度 | `host/inquiry/scheduler.ts` | 纯内存状态机，无 Agent/Inbox/IO |
| 接受/答复 | `host/inquiry/ask.ts`、`answer.ts`、`tools.ts` | 已实现；answer 存储是拒绝 stub |
| 结果与续进 | `host/inquiry/outbox.ts`、`outbox-store.ts`、`continuation.ts` | 纯决策/存储，无生产调用方 |
| 效果围栏 | `host/inquiry/effect-fence.ts` | 纯模块，生产未 import |
| 重启对账 | `host/inquiry/reconcile.ts` | 已接入启动路径，仅分类诊断 |
| 装配 | `host/collaboration/assembly.ts` | 注册工具但无 dispatcher |
| owner 投影 | `wire.ts`、`locus/management.ts`、`client/settings.tsx` | 类型与可选 callback 就位，生产未注入 |

### 暂停时已知的 P0

1. **accepted 询问无生产消费者**：scheduler 仅被构造，没有 dispatcher、Inbox claim、segment runner；`index.ts` 只做启动对账。
2. **生产 answer 必然失败**：`assembly.ts` 注入拒绝型 `answers.put`，schema 无 answer body 表，但仍注册 answer 工具。
3. **无结果 hand-back / continuation worker**：`openInquiryContinuation()`、`markDelivered/refuse/retain` 无生产调用方；observer 只处理 Locus Delivery。
4. **G4 围栏未接入**：`effect-fence.ts` 无 tool-body 前的真实 Host seam，`close()` 无法撤销执行中的 body。
5. **v12→v13 迁移可能阻断启动**：v12 `inquiry_results` 可能持久化 `failure: "expired"`，当前 v13 parser 拒绝该值，而迁移只 restamp 版本不检查行；restamp 后 domain open 可能失败。

### 暂停时已知的 P1

- `continuation.ts` 的 9 键 exact-key parser 无法直接消费真实 `DeliveryRecord`（缺少 `senderOpenId` 等字段），且未校验顶层 `rootMessageId` 与 `feedbackTarget.rootMessageId` 一致
- `already-open` 在重验 requester/permission/anchor 之前即返回旧 segment id
- scheduler 目标缺 locus generation/membership 重验；取消只删除内存证据
- `ask.ts` 授权 fence 在 `store.accept` 之前结束，存在撤销竞态；无 caller 幂等键
- `answer.ts` 缺 body 时可能误报已记录；body 与 ledger 分裂写入
- `resolveInquiryOrigin` 无法推导 `inquiry-result`/嵌套 origin，未知 child 被标为 local+unknown
- `contextStore.ensure()` 无生产调用，首挂缺 revision-0 记录
- owner identity 硬编码 `undefined`；management 未传 `ownerProjection`；context-only parent 可能缺席 `ownerByParent`
- 独立 child 的 mode/model/preset/cwd/read 元数据未进 schema
- outbox identity 含 `createdAt`，重试重生成时间会误判 `RESULT_EXISTS`
- reconcile 的 result 入队与 ledger needs-review 分裂，崩溃窗口留下 executing + pending failure

### 验证证据的边界

- Pet 全量：131 文件通过、2312 passed、31 skipped（修复前的既有基线）
- 本次修复定向回归：`locus-turn-observer.test.ts` 37/37、`locus-reply-tool.test.ts` 5/5；覆盖 Delivery → `agent-message` → `pet_locus_reply` 原目标发送，以及单独 agent-message 无权、GUI steer/来源不明/第二 Delivery fail closed
- 本次修复 `npm run typecheck --workspace=dsh-pet` 通过
- 仓库 `npm test`：124 passed、1 skipped；本次修复后未改仓库级源码
- 本次修复 `openspec validate pet-locus-independent-child --strict` 与 `git diff --check` 通过
- **但**：`DSH_PET_TEST_RUNTIME` 探针为诊断用途，不建立 Agent/Session/模型/飞书链路
- **且**：`DSH_PET_TEST_ATOMIC_DOMAIN=1` 下事务组失败（`TRANSACTION_UNAVAILABLE`），当前 runtime 无可用 transaction seam
- 本次代码改动后的首次 `dsh build` 已完成：仅原子重装 `dsh-pet`；第二次 `dsh build` 输出 `no changes — deployment already matches manifest`，部署物化已验证幂等
- **仍未做**：Host 重启和真实答疑群复测；不能把本地回归等同于飞书实机验收。为避免中断当前 GUI/答疑群，本轮没有自动重启

命令级全绿不等于 runtime 验收；部署已物化，真实问父验收仍未完成。

## 本期承接范围

新 change：`pet-locus-independent-child`。

只做三件事：

1. 新建/重建 locus child 不再 fork 父 transcript（`child.ts` 的 `DEFAULT_CHILD_PROVIDER` 是根因，三处创建路径共用）
2. 创建前证明 provider 独立；无法证明时 fail closed；不引入 `contextMode` 持久化，也不静默改造旧 child
3. 真实验收：答疑群提问后确实收到飞书回复；父子 `agent-message` 只作为上下文，不撤销原 Delivery 回复目标

「可以问父」无需新建能力：`host/locus/context.ts:343` 已指导使用原生 `send_message` 询问 caller-bound main session，`:339` 已固定 `pet_locus_reply` 为唯一业务出口，`:345` 已禁止自动回传结论。

## 本期明确不做

- 公共事实的生产 lifecycle（`contextStore.ensure` 保持无调用方）
- inquiry 的 ask/answer/scheduler/continuation/outbox（保持 fail-closed）
- 协作者名单工具
- owner projection / owner route
- G3/G4/G5 runtime 门槛

这些代码留在仓库中不启用，作为后续 change 的基础。

## 恢复 B035 的前置条件

1. 独立 child 与回复出口已真实验收
2. runtime 具备可用 atomic transaction seam
3. runtime 具备隔离 queued-turn claim 接缝
4. v12→v13 迁移的 `expired` 兼容性已修复并有真实介质测试
5. 公共事实与 inquiry 在装配层解耦，使前者可独立发布

在此之前不得归档 B035，也不得因单测通过而勾选 G1–G5。

## 2026-03-24 第二轮范围收敛：串行 Delivery 队列

在「独立 child + 首次回复出口」验收后，真实答疑群复现了新故障：Delivery turn 问父后结束，父回答在后续 turn 到达，`pet_locus_reply` 因原 Delivery 已随 `turn/end` 结算被拒绝，飞书无正文（详见本文件冻结点之后、`design.md` Context 一节记录的精确日志序列）。所有者据此进一步收敛边界：每个 locus 维护单一 current Delivery 的持久串行队列，`turn/end` 永不结算业务请求，完成只经统一 `pet_locus_finish`/`pet_locus_wait`。

### 明确延后（本期不做）

- **`/new`、`/skip` 等管理面清理命令**：本期不注册任何新命令。未来如需实现，只应作为「保留同一 child session、清理已超时或明确卡住的 current/backlog 后继续调度」的逃生通道，而非 session 重建；具体命令名、可强制取消的未超时项范围、backlog 清理边界均不在本 change 预先定死，需要真实需求出现后另开 change 设计。
- **原生 `send_message` 的 request/reply pair/correlation**：本期不拦截、不追踪 `send_message` 的语义配对。已知取舍：若 current A 问父后超时、B 成为新 current，父对 A 的迟到回复可能进入同一 child 处理 B 的 turn，Host 路由仍只使用 current B 的触发消息，但文字可能影响模型理解——所有者接受该低概率语义风险以换取实现面收敛。未来增强必须依赖 runtime 提供不可伪造的 opaque metadata 或受信调用接缝，不得用 sender、正文、时间或 FIFO 猜测 answer 关联。
- **完整 B035 公共事实/inquiry/answer store/result outbox/continuation segment**：本轮改动完全未触碰 `host/collaboration/*`、`host/inquiry/*`（除 `effect-fence.ts` 的禁止工具名单同步重命名 `pet_locus_finish`/`pet_locus_wait` 外）；这些模块继续保持"已实现但无生产调用方/fail closed"的既有状态，本 change 不声称满足 B035 的 G3（公共事实持久层）、G4（效果围栏生产接入）、G5（result outbox/continuation runtime 门槛）中的任何一项。

### 本轮实现范围（回顾）

- Delivery 持久状态机与原子 CAS（current/backlog/finishing/终态）
- 统一 `pet_locus_finish`/`pet_locus_wait` 工具，移除 `pet_locus_reply`（无兼容别名）
- 串行 dispatcher（`dispatchNext`）+ deadline scheduler，超时复用同一 child session 推进
- 跨 turn 来源安全（current capability 而非 sticky turn proof）
- 启动恢复对齐新模型：current 按身份保留、`finishing`收敛为 `unknown-terminal`、backlog 硬上限过期

### 本轮验证证据

- `npm run typecheck --workspace=dsh-pet` 通过；`npm run build --workspace=dsh-pet` 通过
- Pet 全量 `npx vitest run`：2333 passed / 31 skipped / 11 failed。11 项失败经 `git stash` 逐条比对干净 HEAD，确认与本轮改动无关，是既有 `dsh-scope`/`ToolRuntime` 工具可见性基础设施缺陷（`collaboration-assembly`/`collaboration-tool-scope`/`inquiry-tool-scope`/`tool-scope` 中与 Delivery 模型无关的用例），未在本 change 范围内修复
- 仓库 `npm test`：124 passed / 1 skipped / 0 failed；`npm run check:artifacts`、`git diff --check`、`openspec validate pet-locus-independent-child --strict` 均通过

### 真实飞书验收（2026-09-15）

10.3 部署与重启、10.4 跨 turn 问父、10.5 话题落位、10.6a 串行 backlog **均已通过**，逐项证据（deliveryId、时间戳、终态字段）记于 tasks.md 对应条目。10.6b（wait 硬上限）与 10.6c（到期自动推进）经所有者确认改以单测替代真实验收——前者效果在飞书界面不可见，后者默认租约 1 小时且代码中无可调短的配置项。

核查 10.6c 的覆盖情况时发现一处**真实测试空白**：到期 CAS 与 finish 后推进各有测试，但连接两者的定时器本身（原 `index.ts` 内联的 `scheduleCurrentDelivery`）位于 Host 闭包内，`grep` 确认无任何测试触碰。定时器装错延迟、`wait` 后漏 re-arm、CAS 失败仍推进队列，此前都不会被发现——而这几处恰是本轮改动碰过的地方。已将其原样抽取为 `host/locus/expiry-scheduler.ts`（注入时钟与定时器，逻辑不变），补 9 例测试并用三次变异确认覆盖有效。教训：「有相关测试」不等于「关键路径被覆盖」，定时器、回调、事件这类需要外部触发的接缝尤其容易被漏掉，值得单独复查。

最有价值的部分是：**验收暴露了三个本地测试无法发现、只有真实链路才会命中的缺陷**。

1. **`expired` 行的 schema 自相矛盾**：`acceptDelivery` 在接受时即写入 `outboundResult: 'none'`，而新加的校验规则禁止 `expired` 行携带任何 `outboundResult`。后果是任一 Delivery 过期后，**下次重启** domain 校验失败、Pet 整体降级、路由消失（`/dsh-pet/api/*` 返回 404）——这正是所有者报告的「pet 看不到 locus」。校验发生在 domain open 而非写入时，所以写的时候毫无征兆。
2. **`wait` 误报过期**：`waitDelivery` 把「请求期限已被现有租约覆盖」判为 `deadline-expired`。租约刚建立时还剩近一小时，child 说「再等 30 分钟」请求的是更短的期限，于是必然失败；child 据此认为 Delivery 已死，放弃回复改用 `no-reply`。
3. **child↔parent 回复指引单向**（DSH 平台层，非 Pet）：`continuableInitialPrompt` 只告诉 child「你的 parent id 是 X，用 `send_message` 回」；父侧收到的却是裸的 `Agent <id> sent a message:`，既无可回复的 agent id，也无「普通 assistant 文本不会送达」的说明。父用文本作答即**静默失败**——父以为答了，child 等到超时。这让「不 fork 父历史、缺上下文就问父」的设计前提不成立，是阻塞级缺陷。已在 `settlement-notice.patch` 中对称补齐 `parentFacingAgentMessage`，只用于 `sendToParent`，`steer`（parent→child）保持原样。

前两个各配了**反向验证过**的回归测试（临时撤掉修复后，测试确实失败并复现原始报错）；第三个经 pinned commit 全量重建验证，patch sha256 已在 `build.mjs` 与 `build-launcher.cjs` 两处同步更新。

方法论教训：这三个缺陷都不是"逻辑写错"，而是**跨越边界的不一致**——写入方与校验方对同一字段的期望不同、语义命名与实际含义不符、双向协议只实现了一侧。这类问题在单测里各自都是对的，只有真实端到端链路才会暴露。
