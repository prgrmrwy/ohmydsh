## Context

依据：
- 跨边界协作标准 §7.2 对照表、§3（成员多对多、桥成员转述）、§4（不透明成员名、协作层不按成员控制可见范围）、§8 扩展点。
- 归档 change `2026-10-23-collab-locus-extension-points`：托管成员、`ext`（≤4 KiB、创建后不可改、协作层不解读）、投递方式、调用级守卫、`resolveCaller`/`holds` 同步接口。该 design 的 Q6 给出跨存储顺序原则。
- 2026-10-23/24 与用户多轮确认的模型（替代第一版"每个 Locus 一个托管成员"的方案）：
  1. **星形**：Locus 子会话各自跟进自己的群/话题，彼此不直接往来；需要串联时由人对具体 Locus 说话，Locus 问主会话，主会话转述。**威胁模型是防误泄，不是防串通**（2026-10-24 第 3 轮评审后用户确认）：要挡住的是子会话在正常读写中看到兄弟的正文、再无意带进自己的群；不承诺两个有意配合的子会话无法借条目 ID 是否存在、计数、话题额度等旁路传递信息，因为它们是同一个人的 agent，不是对手。`pet-locus-independent-agent-inquiries` 中的兄弟直询与本模型冲突，由该 change 去掉。
  2. **单代理成员**：协作空间里 Pet 是一个成员 `pet`，按 ext 里的 locusId 路由到具体子会话。协作层不感知入口、代际。
  3. **子会话直接用 `collab_*`**："子会话没有 collab 工具"是跨主会话协作时期的前提，Locus 是协作层要支持的新场景，不再沿用。
  4. **扩展点 B**：协作层给接入方盖戳并按戳过滤读取，只改 dsh-collab。
  5. **两层空间**：Locus 空间 `[session1, pet]` 永远在本机；跨机空间 `[m1-session1, m2-session1]` 另开 change，主会话是桥。
  6. 主会话 → Locus 的路由：回应走 `ref`（取链上最近的戳），主动走正文点名，无法路由交管理面；不做 Locus 名片条目。
  7. request 一对一指定承接方，不引入认领；待办承接方始终是主会话。
  8. 存量只读；dsh-collab 缺失时 fail closed；人的处置经内核 manager 命令代记；主会话可自行标 done。
  9. 首期目标：现有场景全覆盖，迁移前后行为可验证等价。

### 现状（已读代码）

- 台账与待办：`packages/dsh-pet/src/host/ledger/`（`todo.ts` 值模型，`store.ts` 两张表，`track.ts` 登记，`dispatch.ts` 的 `acceptTodo`/`requestTodoExecution` 共用执行目标解析与 Host 组装正文，`ledger-read.ts` 同源投影）。装配在 `src/index.ts` ~508、3628–3671、4113–4140。现行三个台账工具只认 active 子会话（`ledger/caller.ts`）。
- 子会话工具面：`locus/composition.ts` 的 `LOCUS_SAFE_TOOL_NAMES` + Pet 自有工具白名单；`collab_*` 不在其中。
- dsh-collab：`SessionAccess.caller` 已支持托管调用者（`session-provider.ts` ~60）；`Integrations.claims` 收集接入方 `resolveCaller` 结果（`integration.ts` ~90）；`collab_read` 直接返回内核结果（`tools.ts` ~68）；`collab_status` 经 host-index 读全部记录后按调用者推导（`status.ts`）。现行规范"工具调用者可解析为托管成员"已含子会话调用 `collab_send_message`/`collab_read` 的场景。
- 内核：`advanceRequest` 只允许 assignee；manager principal 只能 `admit/rebind/retire`，不能读取；提交记录无时间字段。

### 与 ADR-0006 的关系

Locus 不提取：入口、代际、Delivery、回复权、询问执行都留在 Pet。迁出的只是协作事实（待办、问答记录、结论）。实施时给 ADR-0006 补注记，不改 Decision。

## Goals / Non-Goals

**Goals**
- 台账与待办只有一份真源：Locus 协作空间。
- 子会话用原生协作工具与主会话协作；协作层对 Locus 内部结构零感知。
- 保留"登记不打扰、人决定何时开工"；受理"投递成功才记已受理"；请求执行与受理共用一条链路。
- 协作层不可用时 Delivery 与回复照常。
- 迁移前后行为可验证等价（D9）。

**Non-Goals**
- 询问迁移（问答正文进空间、唤醒子会话跑独立轮次）另开 change。
- 跨机空间另开 change；本 change 只保证不假定 spaceId、成员地址全局唯一。
- 不回填存量，不做离线迁移。
- 不给子会话建空间、邀请、成员管理的工具。
- 不做 Locus 名片条目。

## Decisions

### D1 一个主会话一个空间；成员恰为 `main` 与 `pet`

- `spaceId = pet-locus-<sha256(parentSessionId) 前 16 位>`，Pet 可重算；"已建立"由读空间判断（存在、`main` 是 Leader、`pet-locus` 已授权、`pet` 为 active）。
- `purpose`：`"<主会话标题> 的 Locus：主会话与它的群、话题子会话共享待办与结论。open 的待办等用户决定何时开工。"`（≤200 字符）。
- `main`：主会话，普通成员，Leader。
- `pet`：`pet-locus` 托管的代理成员，地址为 `pet:<parentSessionId>`（本机内唯一；跨机 change 再加机器身份）。建立空间后 `admit` 一次，之后不 rebind、不 retire。Locus 全部退役时成员仍在，待办仍可处置。

**备选（被否）**：每个入口一个托管成员。需要 admit/rebind/retire 对账与过渡状态判断（第一版评审 M3）；协作层要感知入口；跨机时"两个 Pet 同处一空间"与"Pet 跟随主会话"矛盾。

### D2 建立空间：句柄 `establish`，以主会话真实身份执行

句柄新增 `establish(exec, spaceId, cmdId, {name, purpose})`：
1. 从 `exec` 解析调用者，要求是 `dsh-session` 普通会话；否则 `COLLAB_CALLER_UNAVAILABLE`。
2. 以该调用者 `createSpace`（cmdId `<cmdId>:create`）；`COLLAB_SPACE_EXISTS` 时继续。
3. 以同一调用者 `allowManager({channel: 本句柄 channel})`（cmdId `<cmdId>:allow`）；已授权视为满足。
4. 调用者不是 Leader 时 `COLLAB_SPACE_UNAVAILABLE`。

Pet 随后以 manager 身份 `admit({name:'pet', address:'pet:<parentSessionId>'})`（cmdId 由 parentSessionId 确定）。三步都幂等，中断后重试补齐。

**时机**：主会话 scoped 面安装时已有 active Locus 而空间未建立；或新 Locus 首次挂到已加载的主会话。主会话未加载时不为建空间恢复它，期间子会话的协作工具返回"协作空间尚未就绪"（dsh-collab 侧表现为 `COLLAB_CALLER_UNAVAILABLE`，因为 Pet 的 `resolveCaller` 在空间未建立时不认领）。

**接缝验证**（tasks 3.1）：dsh-collab 的调用者解析在模型轮次之外、以 Host 当前持有的主会话 agent 作 exec 时必须成立；不成立则回到本节重审。

### D3 扩展点 B：戳、可见投影、写目标授权、cmdId 命名空间（只改 dsh-collab）

`IntegratorAdapter` 增加：
- `resolveCaller(agent)` 返回值从 `string | undefined` 扩为 `string | { address: string; stamp?: Ext } | undefined`。`stamp` 是 ≤1 KiB 的 JSON 对象，由接入方从执行会话派生，模型不可指定。
- `visible?(stamp, subject, lookup): boolean`，同步、只查内存。`lookup.recordAt(seq)` 由 dsh-collab 从已完整重放的状态提供，返回该 seq 处的业务主体（`{kind:'item', item}` 或 `{kind:'message', message}`）或 `undefined`，供接入方沿 `ref` 链判断（实施中发现：只给消息本身无法执行 D5 规则 1，接入方自建异步索引会让未触发投递的消息在窗口期内漏显示）。`subject` 不是提交记录，而是**业务主体**：`{kind:'item', item}`、`{kind:'message', message}`、`{kind:'statusText', name}`。结构事件（空间、成员、Leader、manager、dispatch、completion）不经此判断。
- `recipients?: readonly string[]`：带戳调用者允许的 `to` 集合。

dsh-collab 对带戳的托管调用者的行为：

**写入盖戳**：`collab_create_item`、`collab_send_message` 的 `ext` 固定为戳（工具仍不接受模型传入 `ext`）。

**cmdId 命名空间**（评审 C3）：内核收据按成员名 `pet` 查找，多个子会话共用。插件把带戳调用者的每个写命令 cmdId 改写为 `<sha256(规范 JSON(stamp)) 前 16 位>:<模型给的 cmdId>` 后再交内核。同一子会话的重试仍命中自己的收据；不同子会话同名 cmdId 互不干扰；换代后同一 locus 的新会话戳不变，仍能重放。模型看不到也不能指定前缀。

**写目标授权**（评审 R1-C2、R2-C2、R3-C1、R3-M2）：内核只认成员，不认戳。插件在入口对带戳调用者做目标检查，不满足时以 `COLLAB_ITEM_NOT_FOUND`（条目类）或 `COLLAB_BAD_REF`（ref）拒绝，与不存在不可区分，不泄露 revision。规则是**子会话只能改自己的东西，主会话的条目对子会话完全只读**：
- `collab_revise_item`：目标条目的 `ext` 戳必须等于调用者的戳。
- `collab_ack_item`、`collab_advance_request`：目标条目的 `ext` 戳必须等于调用者的戳。主会话的条目（含 `requiredAcks:['pet']` 或 `assignee:'pet'` 的）子会话不能确认、不能推进：`pet` 是共享成员名，一次 ack 或 progress 说不清是哪个 Locus 做的，而且会被兄弟看到（第 3 轮 C1）。主会话要某个 Locus 确认或承接什么，发消息（`needsReply`），Locus 回消息。经 `pet_locus_track` 登记的待办 `requiredAcks` 为空、`assignee` 为 `main`，子会话不能通过这两个工具推进该类待办；经原生 `collab_create_item` 创建的其它自有条目（例如子会话自己建的、`assignee:'pet'` 的 request），仍按本节戳检查及内核 ack/assignee 规则处理。
- `collab_create_item`、`collab_send_message` 的 `ref`：被引用记录必须是**自己写的**（戳相等）或**主会话发给自己的消息**（作者 `main`、`to:'pet'`、路由目标为本 locus）。不允许 ref 主会话的公开条目或主会话发给别的 Locus 的消息。各 Locus 新开的独立话题额度互不影响；但主会话发给不同 Locus 的消息若各自 `ref` 同一条公开记录，其 ref 链仍共享根，额度耦合按防误泄、不防串通的决定接受（第 3 轮 M2、第 4 轮 M2）。
- 检查在入口基于当前状态执行，并随调用级守卫在提交前重验（与地址、戳一起捕获）。收据重放路径同样经过此检查：无权的调用者连旧结果也拿不到。
- `collab_send_message` 的 `to` 对带戳调用者只允许接入方声明的收件人集合（Pet 声明 `['main']`），其它值 `COLLAB_BAD_RECIPIENT`。

**读取 = 可见投影，不是删记录**（评审 C1、C4）：
- 插件对带戳调用者**先用完整日志重放出内核状态**（`reduce` 不缺依赖，`ref`、话题计数、dispatch/completion 配对都完整），再对结果做投影：
  - `overview`（评审 R2-C1：按**白名单**输出，不照搬全状态）：只输出 `spaceId`、`serviceId`、`status`、`leader`、`convention`、`purpose`、`lastSeq`、`members`（每个成员只输出 `name`、`kind`、`status`、`binding.channel`、`managedBy`、`statusText`；`statusText` 对不可见者置空；不输出 `wakeCount`、`joinSeq` 等计数，第 3 轮 M1）、`items`（仅可见条目）、`messages`（仅可见消息）、`deliveries`/`pendingDeliveries`/`inFlightDeliveries`（仅唤醒源可见的）、`presence`。`itemSeq`、`topicOf`、`topicWakes`、旧日志的 `requests`/`decisions` 等派生索引一律不输出。
  - `since`：每条提交记录保留 `seq`、`at`，`events` 经过滤：业务事件按主体可见性保留，`dispatch/*` 只在其唤醒源可见时保留，`member/statusText` 只在可见时保留，其余结构事件保留；过滤后事件为空的记录输出为 `{seq, at, events: []}`，保留 seq 连续性，游标语义不变。`receipt` 对带戳调用者不输出。
  - `collab_status`：`pending.*` 与 `next` 按投影后的条目与消息推导，并且只把带戳调用者按写目标授权**能执行**的动作列入（主会话写的 `requiredAcks:['pet']` 或 `assignee:'pet'` 条目不产生 `ack`/`advance_request` 建议，第 4 轮 S1）。
- 普通调用者不经投影。`convention` 不投影。

**为什么不直接删记录**：评审 C4 指出删记录后合法日志会因 `dangling ref` 重放失败；C1 指出一条提交里业务事件与 dispatch 混在一起。投影在完整状态之上做，就没有这两个问题。

**为什么在 dsh-collab 而不是内核**：内核"只存储不解读"，可见性是接入方语义。dsh-collab 已为托管调用者做身份解析，是自然位置。

**为什么不在 Pet 包一层工具（方案 A）**：用户选 B，子会话用原生工具、与主会话同一套词汇。

### D4 Pet 代理：戳、可见规则、presence、deliver

- **路由表** = 现有 Locus 绑定表。内存投影 `sessionId → {parentSessionId, locusId, generation}`，只含 active、当前代的 child；在绑定事务提交后与启动冷读后更新。
- **`resolveCaller(agent)`**：agent 是投影中的 child、是 Host 当前对象、且其主会话空间已建立 → `{ address: 'pet:<parentSessionId>', stamp: { pet: { locusId } } }`；否则 `undefined`。所有子会话解析到同一地址，戳不同。
- **戳中的 `locusId` 是入口的稳定身份**（AMD-2，第 2 版）：现行代码每次换代、重建都分配新的 locus 记录 id，`replacesLocusId` 链在内存仓库的重建路径上不补、持久层也不保证前驱可达，所以不能靠追链得到稳定身份（评审复核指出）。改为直接取**入口本身**：`locusId = 'locus-' + sha256(规范化入口键)` 的前 16 位十六进制，入口键即 `normalizeLocusEndpoint` 给出的 `chatId`（+`threadId`）键。入口是 Locus 索引的键，跨代、重建、冷启动都不变，计算是纯函数、不读历史记录。同一主会话下若两个**不同**入口算出同一值（64 位碰撞），Pet 对两者都不认领（fail closed）。入口改绑到别的主会话时属于另一个空间，戳在各自空间内独立。待办 ext 中另记登记时那一代的记录 id 与 `generation`，仅作审计。
- **`holds`、`claim`**：`address` 形如 `pet:<parentSessionId>` 且该主会话有空间记录。
- **`visible(stamp, subject, lookup)`**（纯函数，按主体；沿 ref 链只用 `lookup.recordAt`，Pet 不维护自己的 seq 索引）：
  - `item`：作者为 `main`，或 `item.ext.pet.locusId === stamp.pet.locusId`。主会话修订子会话条目后作者不变，可见性不变。
  - `message`：`message.ext.pet.locusId === stamp.pet.locusId`；或作者为 `main` 且 `to === 'pet'` 且 D5 路由结果恰为本 locus。**无法路由的消息对任何 child 不可见**，只在管理面可见（评审 C1）。
  - `statusText`：只对 `main` 的状态文本可见；`pet` 的状态文本（任一子会话写的）对所有子会话不可见，`collab_set_status` 因此没有传话用途（评审 C1）。
- **`presence`**（评审 M1）：表示"本地代理能否接收并登记"，与是否有 active child 无关：Pet 已接入且该主会话的空间已建立 → `reachable`；否则 `unreachable`。零 active child 时终态通知照常投递给代理并登记到历史 locus。
- **`deliver(target, pointer)`**：读取到 `pointer.toSeq` 的新记录，对每条唤醒源（发给 `pet` 的 `needsReply` 消息、作者为 `pet` 的 request 终态）按 D5 路由，写入 Pet 的收件登记（内存 + 结构化日志；本期不持久）。**不开模型轮次，不产生飞书出站**。

### D5 收件路由规则

发给 `pet` 的消息或 request 终态通知，目标 Locus 按顺序确定：
1. **ref 链上最近的戳**：沿 `ref` 向前追溯，取离本记录最近的带 `ext.pet.locusId` 的记录。
2. **正文点名**：正文中**恰好一个**形如 `locus-<16 位 hex>` 的不透明名，且等于本主会话下某个入口（含已退役）的戳 `locusId`；即点名与戳是同一个值，不另设名字；多个、零个或不属于本主会话则不匹配。子会话发消息的 `to` 只能是 `main`，所以本规则只对主会话发的消息起作用，子会话不能借点名把消息转给兄弟。
3. **无法路由**：登记为 `unroutable`，管理面可见，对任何 child 不可见。

request 终态通知只用规则 1（request 本身带戳）。路由是纯函数 `route(message, recordAt)`，`visible` 与 `deliver` 共用；`visible` 中的 `recordAt` 来自 dsh-collab，`deliver` 中的 `recordAt` 由 Pet 从 `readManaged` 的结果构建。

### D6 待办 = request；工具面

**登记**：`pet_locus_track` 保留为登记入口（它负责从唯一 current Delivery 派生飞书来源，这些事实协作工具拿不到）。实现改为以子会话真实执行身份调用 `collab_create_item` 的同一内核路径（经句柄 `command(exec, …)`），输入：

| 字段 | 值 |
|---|---|
| `itemId` | `todo-<uuid>` |
| `kind` | `request`，`assignee: 'main'`，`requiredAcks: []` |
| `title` | 证据摘要首行 ≤200 字符，仅展示 |
| `body` | 规范 JSON `{"summary","detail"}`，按现有 `registerTodo` 校验 |
| `ext` | 戳 `{pet:{locusId}}` 与来源 `{pet:{kind:'todo', generation, endpoint, triggerMessageId, requestedBy}}` 合并 |
| `cmdId` | `track-<toolCallId>` |

**读取**：`pet_locus_ledger_read` 退役。子会话用 `collab_read`，经 D3 过滤后只看到自己登记的待办与主会话的记录。现行"同源子会话读到彼此登记的结论"场景按用户决定收窄为不可见（星形），写进 `pet-locus-intent-triage` delta。`dispatch.ts` 中三处指引模型调用 `pet_locus_ledger_read` 的失败文本改为指引 `collab_read`；这是退役带来的明确差分例外，D9 的失败路径比较对这三条文本只比较失败原因、状态不变、不投递，不比较指引句（评审 M2）。

**请求执行**：`pet_locus_request_execution` 保留，校验 `ext.pet.locusId` 等于调用者的戳。

**子会话工具面**：`LOCUS_SAFE_TOOL_NAMES` 之外，Pet 自有白名单加入 `collab_status`、`collab_read`、`collab_create_item`、`collab_revise_item`、`collab_ack_item`、`collab_send_message`、`collab_set_status`、`collab_advance_request`。不加入 `collab_space`、`collab_invite`、`collab_member`（子会话经代理身份调用时内核本来就会因不是 Leader 拒绝，但不放进白名单可免去一次无意义调用）。只读档与 shell 档子会话工具面相同：协作写入不改文件，不算越权。

**状态映射与证据快照、时间**：与第一版相同：待处理/已受理/已完成/已放弃 = `open/accepted/done/rejected`；证据从 `item/created` 事件读（主会话 revise 不改登记快照）；`createdAt` 取创建提交的 `at`，`statusChangedAt` 取最近 `request/progressed` 提交的 `at`；缺 `at` 视为空间不可读。

### D7 内核：`at` 与 `disposeManagedRequest`；读取在 dsh-collab

- **`at`**：`ServiceOptions.now?: () => number`（缺省 `Date.now`）；每条新 `command`/`completion` 提交写入毫秒整数 `at`；收据重放不写新提交；旧日志无 `at` 照常重放；受校验和覆盖。
- **`disposeManagedRequest({itemId, progress})`**（manager 命令）：目标须为 request，作者须为本 channel 托管成员（即 `pet`）；转换 `open → accepted|done|rejected`、`accepted → done|rejected`；事件 `request/progressed`，actor `manager:<channel>`，不唤醒。
- **句柄**：`disposeRequest`（调上述命令）、`readManaged(spaceId)`（经 host-index 读全部记录，要求本 channel 在 `managers` 中，否则 `COLLAB_SPACE_UNAVAILABLE`；返回前检查接入代际）。

### D8 受理即开工、人的处置、主会话自行推进

- 受理/请求执行：`readManaged` 读状态 → 校验 open → Host 组装正文并投递（链路不变）→ `disposeRequest(accepted)`，cmdId `accept-<itemId>-<attemptId>`；写入失败记日志不重投，可再次受理。
- 完成/放弃：`disposeRequest`，不投递、不唤醒。
- 主会话自行推进：它是 assignee，按内核规则 `collab_advance_request`。终态通知发给作者 `pet`，经 D4/D5 路由到登记的 Locus 并登记，不开轮次。
- **注意力问题**：主会话的 `collab_status` 会列出它承接的 open 待办。登记不唤醒它，`purpose` 写明"open 的待办等用户决定何时开工"。`memberTrust: true` 的唤醒说明仍会说"可直接承接"；本 change 接受这一点并在验收中观察，若主会话自行受理的情况多于预期，再由后续 change 加空间级"需用户确认"标记。

### D9 迁移前后等价

与第一版相同：抽 `TodoBackend` 接口，`legacy` 与 `collab` 两个实现；现有 `ledger-*`、`todo-*`、`intent-triage-*` 测试对两个实现参数化运行，断言不改；等价测试同一流程两边各跑一遍，同一假时钟，只归一化 itemId；先注入一处差异确认测试抓得到。被本 change 明确改变的行为（主会话自行推进、兄弟不可见、`pet_locus_ledger_read` 退役及其三条指引文本、协作层不可用、旧版只读）不进差分，各自单测。
- 投影与授权用例：公开条目 `ref` 隐藏条目后 A 的 `overview`/`status` 仍可读；B 的 `needsReply` 消息与其 dispatch 同提交，A 的 `since` 该记录事件为空；A 对 B 条目的 revise/ack/advance/ref 一律 `COLLAB_ITEM_NOT_FOUND`/`COLLAB_BAD_REF` 且不泄露 revision；A、B 同名 cmdId 互不干扰且各自重试幂等；零 active child 时 main 终结旧待办仍登记。

### D10 降级与存量

- 能力门：dsh-collab 存在且 attach 成功。否则 `pet_locus_track`、`pet_locus_request_execution` 返回协作层不可用；子会话的 `collab_*` 因 Pet 不认领而 `COLLAB_CALLER_UNAVAILABLE`；管理面显示不可用；Delivery、回复、代际不受影响。
- 旧待办只读：标旧版，照常展示与跳转，不提供动作；子会话经 `collab_read` 看不到旧版（它不在空间里），管理面合并展示。
- 服务消失/重现：dispose 句柄、清空投影；重现时 attach、重建投影、补建空间与 `pet` 成员。

## Risks / Trade-offs

- **[建空间不在模型轮次内]** → 用户已确认；`purpose` 写明来源；tasks 3.1 先验证接缝。
- **[兄弟不可见是行为收窄]** → 用户选定的星形；规范明写；管理面仍看全部。
- **[不防隐蔽信道]** 两个有意配合的子会话仍可借条目 ID 是否已被占用、`lastSeq` 增量、错误码时序等传递少量信息。→ 有意的取舍：子会话是同一个人的 agent，防的是误泄不是串通；规范在"兄弟子会话读不到彼此登记的结论"的要求文字中写明这一边界。若将来 Locus 服务于互不信任的受众，再评估按 Locus 拆空间。
- **[主会话可能自行受理]** → 见 D8；验收观察，后续加标记。
- **[ext 中的入口身份对空间普通成员可见]** → 默认只有主会话；跨机 change 须换成本机可解析的不透明句柄。
- **[可见投影与写授权在 dsh-collab 做，依赖接入方 `visible` 正确]** → Pet 的 `visible` 与路由是纯函数，单测覆盖每种主体；主会话不经投影，作为对照；投影在完整重放之上做，不改内核状态。
- **[cmdId 改写]** 带戳调用者的 cmdId 被插件加前缀，内核收据里是改写后的值；`dsh-collab-salvage` 不解释 cmdId，不受影响。
- **[日志只增不缩]** → 日志只含登记事实，规模随待办数增长；Pet 读取用 `readSince` 游标，终态条目冻结；快照不做。
- **[无法路由的消息]** → 登记为 `unroutable` 交管理面，不猜。
- **[回滚]** 回滚 Pet：旧版只读本地表，空间里的新待办对旧版不可见（不丢失）。回滚内核：事件类型不变。回滚 dsh-collab：子会话的 `collab_*` 因无托管解析而不可用，工具面仍在（Pet 白名单）但调用被拒。

## Migration Plan

1. 同批发布 collab-kernel、dsh-collab、dsh-pet。
2. `dsh.yaml` 中 dsh-collab 增加 `managedChannels: ['pet-locus']`。
3. `dsh build` 两次（第二次无变化），重启 Host。
4. 各主会话下次加载时建立空间并接纳 `pet`。
5. 回滚：恢复旧包、去掉 `managedChannels`，`dsh build` 并重启；空间日志保留。

## 与进行中 change 的关系

`pet-locus-independent-agent-inquiries`：其"兄弟直询"（tasks 4.7、`pet-agent-inquiries` 的"子会话发现主会话与兄弟""兄弟忙时排队"）与协作者名单中的 `sibling` 关系与星形模型冲突，应在该 change 中去掉；其询问存储将来改为本 change 空间里的 `ref` 消息（询问迁移 change）。本 change 的 tasks 0.1 记下这一依赖，不改该 change 的已完成项。

## Open Questions

- `ext.endpoint` 跨机后是否改为本机不透明句柄：留给跨机 change。
- 主会话自行受理的频率：验收后决定是否加空间级"需用户确认"标记。
