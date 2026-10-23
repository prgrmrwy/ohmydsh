## Context

依据：
- 跨边界协作标准第 7.2 节对照表：共享事实台账 → 协作空间；待办 → request（飞书来源进结构化附加数据）；受理即开工 → "登记 + 发消息"两步；Delivery、受管 finish、飞书回复权、代际、管理面不动。
- 归档 change `2026-10-23-collab-locus-extension-points`：托管成员（Leader `allow_manager` → 接入方 `admit/rebind/retire`）、`ext`（≤4 KiB、创建后不可改、协作层不解读）、调用级守卫、`resolveCaller`/`holds` 同步接口。
- 2026-10-23 与用户确认的取舍：
  1. 空间在首个 Locus 挂到主会话时，由 Pet 以主会话身份自动建立并授权 `pet-locus`；
  2. 存量只读保留并标为旧版，新写入只走协作层；dsh-collab 缺失时 fail closed；
  3. 保留"待办先堆积、由人决定何时开工"：内核新增 manager 代人处置命令；主会话做完可以自己标完成。
- 2026-10-24 按 ponytail-review 收窄：询问迁移拆出，另开 change（见"范围之外：询问"）；成员同步改为幂等对账，不建 outbox；不新增 Pet 表。

### 现状（已读代码）

- 台账与待办：`packages/dsh-pet/src/host/ledger/`（`todo.ts` 值模型，`store.ts` 两张表 `shared_fact_ledger`/`ledger_item`，`track.ts` 登记，`dispatch.ts` 的 `acceptTodo`/`requestTodoExecution` 共用一次执行目标解析与 Host 组装正文，`ledger-read.ts` 同源只读投影）。装配在 `src/index.ts` ~508、3628–3671、4113–4140。
- 协作层：`packages/collab-kernel/src/service/index.ts`；`advanceRequest` 只允许 assignee，`open → accepted|rejected`、`accepted → done|rejected`。dsh-collab 句柄（`packages/dsh-collab/src/integration.ts`）恰有 `admit/rebind/retire/command/read/registerSessionMode/dispose`，没有 Leader 能力。dsh-collab 已经以 `internal{host-index}` 读取空间（`status.ts:40`）。

### 与 ADR-0006 的关系

ADR-0006 决定 Locus 不提取为独立插件，理由之一是保留 `domain.transaction()` 的跨表原子性。本 change 不提取 Locus：入口、代际、Delivery、回复权都留在 Pet，迁出的只是台账条目。离开 Pet 事务后的一致性见 D6。实施时给 ADR-0006 补一条注记，不改 Decision。

## Goals / Non-Goals

**Goals**
- 台账与待办只有一份真源：Locus 协作空间。
- 保留"登记不打扰、人决定何时开工"，以及受理"投递成功才记已受理"、请求执行与受理共用一条链路。
- 协作层不可用时，Locus 的 Delivery 与回复照常工作，台账与待办明确不可用。

**Non-Goals**
- 询问迁移（另开 change）。
- 不迁移 Delivery、代际、管理面入口管理、只读查阅主会话历史、`pet_collaboration_context`。
- 不回填存量，不提供离线迁移工具。
- 不给 Locus 子会话增加 `collab_*` 工具；不让协作层唤醒子会话。
- 不做跨机、跨 root 自动同步。

## Decisions

### D1 一个主会话一个空间；主会话是 Leader，子会话是托管成员

- `spaceId = pet-locus-<sha256(parentSessionId) 前 16 位十六进制>`，可由 Pet 重算，不需要映射表。"已建立"由读取空间判断（存在、`main` 是 Leader、`pet-locus` 在 `managers` 中），Pet 不另存这一事实。
- `purpose`：`"<主会话标题> 的 Locus：主会话与它的群、话题子会话共享待办。open 的待办等用户决定何时开工。"`（≤200 字符，截断标题）。
- 主会话成员名 `main`，Leader。
- 子会话成员名 `locus-<sha256(locusId) 前 8 位>`。名字跟随 `locusId`，不跟随代际：换代用 `rebind`，退役用 `retire`。这与待办"关联标识而非实例"一致，也满足标准第 4 节的不透明命名。

### D2 建立空间：句柄新增 `establish`，以主会话真实身份执行

句柄新增 `establish(exec, spaceId, cmdId, {name, purpose})`：
1. 从 `exec` 解析调用者，要求是 `dsh-session` 普通会话；否则 `COLLAB_CALLER_UNAVAILABLE`。
2. 以该调用者执行 `createSpace`（cmdId `<cmdId>:create`）；`COLLAB_SPACE_EXISTS` 时继续。
3. 以同一调用者执行 `allowManager({channel: 本句柄 channel})`（cmdId `<cmdId>:allow`）；已授权视为满足。
4. 调用者不是 Leader 时返回 `COLLAB_SPACE_UNAVAILABLE`。

两步不原子；中断后用同一 cmdId 重试补齐。句柄只能授权自己的 channel，不能邀请、关闭、转交或授权其它 channel。

**何时调用**：Pet 以 Host 当前持有的主会话 live agent 作为 `exec.agent` 调用，时机为：
- 主会话的 scoped 面安装时，它已有 active Locus 而空间未建立；
- 新 Locus 首次挂到已加载的主会话时。

主会话未加载时不为建空间去恢复它；在此之前子会话的台账工具返回"协作空间尚未就绪"（D7）。dsh-collab 照常核验该 agent 是 Host 当前对象、普通会话、未归档、不在排除名单。**这在模型轮次之外发生，实施第一步先验证 dsh-collab 的调用者解析在此场景下通过**（tasks 2.1）。

### D3 Pet 的 adapter：同步投影，不经协作层唤醒子会话

Pet 实现 `IntegratorAdapter`（channel `pet-locus`）：
- 维护两份从 Locus 索引派生的内存集合（评审 M3）：**调用集合** `sessionId → {spaceId, member, locusId, generation}`，只含当前 active、当前代际的 child，`resolveCaller`/`holds`/`claim` 只读它；**保留集合**，含所有尚未终结的绑定（active 与 `switching` 等过渡状态），只用于对账判断是否 retire。在 Locus 绑定/换代/退役的 domain 事务提交后、以及启动时从 Locus 索引冷读后更新。现有异步的 `resolveCollaborationCaller` 只用于构建投影。
- `resolveCaller(agent)`：agent 是投影中的 child 且是 Host 当前对象时返回 sessionId；否则 `undefined`。
- `holds`、`claim`：投影中存在。
- `presence`：恒为 `unreachable`。本 change 中子会话只由飞书 Delivery 驱动，协作层不能唤醒它；`unreachable` 使内核提交消息时不记投递意图（既有"接入方离开后不可投递"语义），发送方在总览中看到真实的不可达。
- `deliver`：抛错（`COLLAB_CHANNEL_DETACHED`）。正常情况下因 presence 为 `unreachable` 不会被调用；万一被调用，记为投递失败而不是假成功。
- 不声明 `modes`。

因此待办终态的结束通知（作者是子会话）不会产生投递意图；子会话下次读台账时看到终态。

### D4 待办 = request；ext 携带固定来源

`pet_locus_track` 的工具契约不变（不接受目标参数，Host 从唯一 current Delivery 派生全部事实）。实现改为以子会话真实执行身份调用 `handle.command(exec, spaceId, cmdId, {op:'createItem', input})`：

| 字段 | 值 |
|---|---|
| `itemId` | `todo-<uuid>`，Host 生成 |
| `kind` | `request`，`assignee: 'main'`，`requiredAcks: []` |
| `title` | 证据摘要的显示形式（首行，≤200 字符，超出截断）；只用于协作工具展示，Pet 不从它解码 |
| `body` | 规范 JSON `{"summary":…,"detail":…}`（`canonicalJson`），两字段按现有 `registerTodo` 的校验与规范化后原样写入；Pet 只从这里解码证据 |
| `ext` | `{ pet: { kind: 'todo', locusId, generation, endpoint: {chatId, threadId?}, triggerMessageId, requestedBy } }` |
| `cmdId` | `track-<toolCallId>` |

登记不唤醒任何人。登记前仍先调用现有 `registerTodo` 做校验，校验失败与现行一样拒绝。

**证据快照不可变**（评审 M1）：主会话作为普通成员可以 `reviseItem` 改 title/body。Pet 的投影因此从该条目的 `item/created` 事件读取证据（body 解码），只从折叠状态读取 `progress`。管理面、台账工具、跟进正文共用这一个投影函数。不限制协作层的通用修订能力。

**时间**（评审 C1）：`createdAt` 取 `item/created` 所在提交的 `at`；`statusChangedAt` 取最近一次改变该条目 `progress` 的 `request/progressed` 所在提交的 `at`，没有则等于 `createdAt`。`at` 由 D5 的内核改动提供。Pet 只在自己建立的空间里读待办，这些空间建立于本 change 之后，所以每条提交都带 `at`；投影遇到缺失 `at` 时视为该空间不可读（fail closed），不用读取时间顶替。

**状态映射**

| Pet 待办 | request `progress` | 谁能推进 |
|---|---|---|
| 待处理 | `open` | — |
| 已受理 | `accepted` | Pet 代人（投递成功后）；主会话自己 |
| 已完成 | `done` | Pet 代人；主会话自己（须先 accepted） |
| 已放弃 | `rejected` | Pet 代人；主会话自己 |

**读取**：子会话的台账读取经 `handle.read(exec, spaceId, 'since')` 取记录，用内核导出的 `reduce` 推导，只投影 `ext.pet.kind === 'todo'` 的 request，字段与现有 `LedgerReadItem` 相同（不暴露 `endpoint`）。管理面经 `readManaged`（D5）。

### D5 内核：一条命令 + 提交时间；读取在 dsh-collab 完成

**提交时间 `at`**（评审 C1）：内核目前的提交记录不带时间（`CommitRecord` 只有 seq/events/receipt）。新增：`ServiceOptions.now?: () => number`（缺省 `Date.now`）；每条 `kind:'command'` 与 `kind:'completion'` 新提交写入 `at`（毫秒整数），在串行事务内、提交前取一次。收据命中的重放返回原结果，不写新提交，所以时间不刷新。旧日志没有 `at`，照常重放；`at` 受现有 sha256 校验覆盖。这是给所有接入方的通用事实，不是 Pet 专用字段。

**备选（被否）**：把时间放进 ext。主会话直接 `advanceRequest` 时 Pet 不在路径上，写不进 ext，`statusChangedAt` 无从得到。

**`disposeManagedRequest({itemId, progress})`**（manager 命令，授权表新增一行）：
- 目标必须是 `kind:'request'`，作者是本 channel 托管的成员（含已退役），否则 `COLLAB_FORBIDDEN`。
- 转换：`open → accepted|done|rejected`，`accepted → done|rejected`；`open → done` 只对 manager 开放，对应"不经受理直接完成"。
- 事件仍为 `request/progressed`，actor `manager:<channel>`，不唤醒任何人。旧内核可原样重放。

**句柄 `disposeRequest`** 调用上述命令，守卫只检查接入代际。

**句柄 `readManaged(spaceId)`** 不改内核：dsh-collab 以已有的 `internal{host-index}` 读取 `readSince(0)`，推导状态后要求本句柄 channel 在 `managers` 中，否则返回 `COLLAB_SPACE_UNAVAILABLE`（与不存在不可区分）。返回深拷贝的提交记录，返回前检查接入代际。

**为什么加内核命令**：Pet 本地覆盖会让待办状态有两份真相；让人的处置唤醒主会话去 advance 则违背"保护人的注意力"。这是用户选定的方案。

**主会话自己推进**：主会话作为 assignee，按内核既有规则推进；它本人就是执行者，自行受理不需要投递。由 `pet-locus-intent-triage` delta 明确。

### D6 受理即开工与一致性

所有者受理与子会话请求执行仍共用 `dispatch.ts` 的一条链路，只改读写：
1. 经 `readManaged` 取得条目，校验 `progress === 'open'`；请求执行另校验作者是调用者自己的成员名。不满足在投递前拒绝。
2. 执行目标解析、Host 组装正文、按队列语义投递，回执三种结局不变。
3. 投递成功后 `disposeRequest(accepted)`，cmdId `accept-<itemId>-<attemptId>`（评审 M4）：`attemptId` 在一次受理操作开始时生成，同一操作内的重试复用它，两次独立受理不共用。写入失败记结构化日志，不重投；待办仍显示待处理，可再次受理（与现行一致）。两次受理同时到达时，第二次在第 3 步被 `COLLAB_BAD_TRANSITION` 拒绝，回执与现行"状态写入失败"相同；与现行实现相同，不加锁。所有者完成/放弃同理使用 `<op>-<itemId>-<attemptId>`。

不另发协作消息唤醒主会话：Host 跟进投递已经是"显式发消息"那一步，且带有规范要求的正文结构。

**成员同步 = 幂等对账**：Pet 用投影与空间成员（`readManaged`）比对，调用集合里有而空间里没有的 `admit`，代际不同的 `rebind`；只有空间里 active、却不在**保留集合**里的成员（绑定已被 Pet 持久确认退出或替代）才 `retire`。处于 `switching` 等过渡状态的 child 只暂时不能调用，不 retire。cmdId 由 `locusId + generation + op` 确定，重复执行命中收据。触发时机：attach 成功、空间建立后、每次 Locus 绑定事务提交后、启动时。崩溃后下一次对账自然补齐，不需要持久待发表。空间尚未建立时跳过。

**成员内容命令**（登记待办）在工具调用中同步执行，失败直接返回给模型。

### D7 降级与可用性

能力门：dsh-collab 服务存在且 `attach('pet-locus')` 成功。否则：
- `pet_locus_track`、`pet_locus_request_execution`、台账读取返回明确的"协作层不可用"，不写任何记录；
- 管理面显示"协作层不可用"，旧版待办照常列出；
- Delivery、`pet_locus_reply`/`finish`、代际与入口管理不受影响。

dsh-pet 以可选 inject 消费 `dshCollab`；服务消失时 dispose 句柄、清空投影；重新出现时 attach、重建投影、对账。

### D8 存量

- `ledger_item` 中的旧待办只读保留：管理面标"旧版"，照常展示与跳转，不提供受理、完成、放弃；子会话台账读取一并返回并标注来源。
- 新登记只进台账。旧表不删，Pet domain 不新增表、不升版本。

### D9 迁移前后等价：同一流程跑两遍

用户要求迁移前后功能正常，所以验收以"差分"为主，而不是只写新场景：
- 在 Pet 的存储接缝处抽出一个窄接口 `TodoBackend`，有两个实现：`legacy`（现有 `SharedFactLedgerStore`）和 `collab`（句柄 + 内存 collab-kernel 与内存 file store）。生产只装 `collab`，`legacy` 实现同时用于只读旧版条目。
- 等价测试 `todo-migration-equivalence.test.ts` 用同一组脚本化流程（登记、读取、受理空闲/忙碌/不可达、请求执行、所有者完成与放弃、拒绝路径）分别驱动两个实现，比较工具返回、跟进正文、回执、管理面视图。两个实现注入同一个假时钟，因此时间不需要归一化；只归一化 itemId。证据文本不归一化。
- 并发与重试用例（评审 M4）：两个受理都通过 open 检查、都投递成功后再放行状态写入，两边都应一个成功、一个"已投递但状态写入失败"；同一受理操作内的命令重试返回原收据。
- 生命周期交错用例（评审 M3）：child 处于 `switching` 时 dsh-collab 重接并对账，之后恢复 active，成员未被 retire，读写成功。
- 证据边界用例（评审 M2）：摘要超过 200 字符、摘要含换行、详情含 `\n` 与 JSON 特殊字符、详情为空、摘要达 512 上限，逐字段比较。
- 被本 change 明确改变的行为（主会话自行推进、协作层不可用、旧版只读）不进差分，由各自场景单测覆盖。
- 现有 ledger/todo 测试（`ledger-*.test.ts`、`todo-*.test.ts`、`intent-triage-*.test.ts`）在 apply 期间保持通过：只改它们的存储夹具，不改断言；若断言必须改，按 anvil 的 spec drift 规则先改规范。
- 真实 Host 上再跑一次同一流程的人工验收（tasks 末组）。

**为什么不做双写影子比对**：双写意味着生产期间两份真源，正是本 change 要消除的；差分测试在 CI 里就能给出同等证据。

## 范围之外：询问

询问迁到 `ref` 消息问答另开 change（或并入 `pet-locus-independent-agent-inquiries`）。理由：执行状态、交接、工作锚点、续进、守卫、恢复、无答复结果都必须留在 Pet，迁出的只有问答正文，收益主要是可见性，而改动面最大。分开发布便于各自回滚。届时 D3 的 adapter 再声明投递方式并实现 `deliver`；用户已接受问答正文对空间成员可见，该结论留给那个 change 使用。

## Risks / Trade-offs

- **[建空间不在模型轮次内]** 用 Host 持有的主会话 live agent 作 `exec`，台账显示主会话"自己"建了空间、授权了 `pet-locus`。→ 用户已确认；`purpose` 写明来源是 Pet；实施先验证（D2）。
- **[ext 中的入口身份]** `ext.endpoint` 含 chatId，空间普通成员可经 `collab_read` 看到。空间普通成员默认只有主会话。→ 跨 root 的事另开空间（标准第 3 节），`purpose` 写明。
- **[主会话自行开工]** 主会话的 `collab_status` 会把 open 待办列为 `pending.requests`，可能自行受理。→ 登记不唤醒它；`purpose` 写明；规范如实写出。
- **[主会话发给子会话的消息无人接收]** presence 为 `unreachable`，消息照常提交但不投递，发送方在总览中可见。→ 如实呈现，不假成功。
- **[回滚]** 回滚 Pet：旧版只读本地表，台账中新写的待办对旧版不可见（仍在空间日志里，主会话可读）。回滚内核：事件类型不变，可重放。

## Migration Plan

1. 同批发布 collab-kernel、dsh-collab、dsh-pet。
2. `dsh.yaml` 中 dsh-collab 增加 `managedChannels: ['pet-locus']`。
3. `dsh build` 两次（第二次无变化），重启 Host。
4. 各主会话下次加载时建立空间并对账当前 child。
5. 回滚：恢复旧包、去掉 `managedChannels`，`dsh build` 并重启；空间日志保留。

## 与进行中 change 的关系

`pet-locus-independent-agent-inquiries` 不受本 change 直接影响；它的询问存储将来若改为台账消息，以本 change 的空间与成员名为基础。

## Open Questions

- `ext.endpoint` 是否改为只存 Pet 侧不透明句柄、入口身份留在 Pet domain：更符合标准第 4 节，但偏离 7.2 的"飞书来源放进结构化附加数据"。本期按 7.2 存进 ext。
