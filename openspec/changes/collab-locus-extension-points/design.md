## Context

依据：跨边界协作标准第 8 节，以及调研纪要（分支 `ws/collab-pet-locus-collab`，`packages/dsh-collab/docs/2026-10-22-locus-unified-collaboration-exploration.md`）第 6 节。本 change 的基线是刚归档的 `collab-ref-threads`：三种唤醒触发、话题上限 20、`ref`、`purpose`、11 个工具，约定 v3。

### 现状（已读代码）

- **成员来源。** 成员只能经 `invite`/`createSpace` 由全部 provider 的 `claim` 认领，再 `join`（`service/index.ts` 208–263）。`SessionAccess.ordinary` 拒绝 subagent 和非零 delegationDepth（`session-provider.ts` 31–38），工具调用者只会是 `dsh-session` principal（`host.ts` 65）。
- **记录内容。** 消息是 `{id, actor, to, body, needsReply, ref?}`，条目字段是 title/body/requiredAcks。没有给接入方的结构化位置。
- **投递。** `decideDispatch` 按成员 channel 选 provider，指针只含白名单字段。`SessionProvider.deliver` 固定用 `followup`（`session-provider.ts` 114）。
- **Pet 一侧（只读参考，不改）。**
  - `collaboration/caller.ts` 的公开解析 `resolveCollaborationCaller` 是异步的：先做同步的索引快照（非导出的 `snapshot`），再 await 冷身份核验，之后重新快照比对，一致才返回。它不能直接充当同步接口；接入时需要由 Pet 维护一份已异步核验过的内存投影（见 D4）。
  - 询问（`pet-inquiry-runtime-channel` 规范）要求独立轮次、不与 GUI 输入合并、不 steer。
  - Locus 的身份、代际、退役都以 Pet 持久层为真源。

### 与 ADR-0006 的关系

ADR-0006 决定 Locus 不提取为独立插件。它没有限制 Pet 消费外部协作内核，调研纪要第 5 节也这样确认。本 change 只在协作层加接口，Locus 的入口、代际、Delivery、回复权与存储都不动，因此不需要修订 ADR。

将来 Locus 接入时，共享事实迁到台账，就离开了 Pet 的 `domain.transaction()`。这一点由下文 Q6 的 outbox 方案处理；届时由接入 change 判断是否给 ADR-0006 补一条"消费协作内核"的注记。

## Goals / Non-Goals

**Goals**
- 接入方能按自己的绑定接纳、换代、退役成员，台账留痕，但不形成第二份授权真相。
- 条目和消息能携带接入方定义的、协作层不解读的结构化数据。
- 接入方能为唤醒指定投递方式。协作层只负责校验和传递，执行方式由 provider 决定。
- 不使用扩展点时，行为与日志逐字节不变。

**Non-Goals**
- 修改 Pet，或把 Locus 状态迁进台账。
- 跨机、hub、机器身份。
- 新约定版本（v3 不提托管成员；接入方给自己的成员另写说明）。
- 托管成员的可见范围控制（标准第 4 节：协作层不按成员控制可见范围）。
- 给模型工具开放 `ext`/`mode`。

## Decisions

### D1 托管成员：Leader 按空间授权 channel，接入方以 manager principal 管理

**做法。**
- 内核新增事件 `manager/allowed{channel}`、`manager/revoked{channel}`、`member/rebound{name, binding}`，以及命令 `allowManager`、`revokeManager`（Leader）和 `admitMember`、`rebindMember`、`retireMember`（manager）。
- `Principal` 增加 `manager{providerId}`。稳定校验要求该 provider 已注册且 `managed: true`，`actor = manager:<channel>`。
- 收据 scope 新增 `{kind:'manager', channel}`。

**为什么不是第二份授权真相。** 内核反查只看 principal 的地址，而 dsh-collab 只有在接入方 `resolveCaller` 当下认领时，才会为某个会话构造托管 channel 的 principal（D4）。所以：

- 接入方退役了绑定、但还没写 `retireMember`：成员已经无法行动。台账落后只影响展示，不会放大权限。
- 台账已退役、接入方还认为绑定有效：内核反查到 `gone`，拒绝。

两边任何一边说"否"都是否。权限只能是两份事实的交集，不会是并集。

**备选方案。**
- *接入方直接调 `invite` + 代为 `join`*（被否）：被邀请者必须是可认领的普通会话；换代时成员名变化，未完成的 request 会悬空。而且每个 Locus 子会话都要 Leader 逐个邀请，与"接入方按自己的绑定管理"相违背。
- *只在 `dsh.yaml` 声明、不按空间授权*（用户否决）：会绕过空间内其它成员的知情。
- *由接入方代 Leader 执行授权*（用户否决）：接入方的权力过大。

**托管成员不当 Leader、不自助进出。** Leader 管邀请和关闭，是人类代理（标准第 6 节）。托管成员的生命周期跟着入口走，入口退役时空间不能失去 Leader；它自己 `leave` 也会与接入方绑定不一致。Leader 仍可 `markGone`，这是"空间不想要它"的出口，因此接入方之后不能复活它。

**换代保留成员名（用户选定 rebind）。** 旧地址进入 `previousBindings`，并纳入地址唯一检查。收据 scope 按成员名，所以换代前发出的命令重试仍命中。

**撤销同时退役。** 撤销后若托管成员仍是 active，会出现"无人管理的成员"。在同一提交里退役它们，状态才是闭合的。

### D2 `ext`：创建时写入、不可修改、不解读

**为什么创建后不可改（用户选定）。** 可改就要定义"谁能改"，例如同 channel 的其它成员是否能改作者的回复去向，这会引入按 channel 判断的写权限规则。不可改时，归属始终是作者，作者的绑定 channel 就是来源。后续证据用一条带 `ext` 的消息 `ref` 原记录补充。

**规则。**
- 4 KiB 上限，按存储行规范化（`store/canonical.ts`）计量。
- 必须是对象，这样接入方能用自己的命名空间键。
- 不进入投影和指针，以免接入方数据被当成给模型的内容。dsh-collab 的 `collab_read since/overview` 会原样返回记录（它们本来就返回全部事件），这与标准第 4 节一致：空间内显式登记的内容对所有成员可见。

**写入纪律。** 标准第 4 节写明原始对话不进入空间。`ext` 只承载引用（来源 id、消息 id），协作层不做语义校验，纪律由接入方负责。

### D3 `mode`：消息属性，由收件人 provider 决定是否支持

**做法。**
- `mode` 写在 `message/sent` 上，并复制到 `delivery.mode` 与 `pointer.mode`。
- 发送时在串行事务内同步调用收件人 provider 的 `supportsMode`，不支持就拒绝，不静默降级。否则请求方会以为"已按独立轮次排队"，实际却只是 followup。
- 只允许与 `needsReply:true` 同用，因为只有它会产生唤醒。
- 格式 `<channel>:<name>`。在 dsh-collab 中，句柄只能使用、也只能注册本 channel 前缀，避免一个接入方劫持另一个接入方的方式。

**为什么不用 provider 级配置。** 同一个收件人既要收普通唤醒，也要收询问。方式由发送者按消息选择，provider 只声明能力。

**与防循环的关系。** 唤醒触发、话题计数都不变，mode 不是新的唤醒来源。

**备选（被否）：** 把 mode 当成一种独立的"询问"条目类型。这会让内核知道询问语义，违背"只存储不解读"。

### D4 dsh-collab 接入方 API：中继 provider + cordis 服务

**服务。** 插件以 `ctx.provide('dshCollab', …)` 发布接入服务，与 dsh-memex 的做法相同：无条件提供，不放进 `inject`。接入方以可选 inject 消费，避免未加载 dsh-collab 时接入方整体不可用。

**中继 provider。**
- `managedChannels` 在启动时由配置确定，内核的 provider 列表在构造 `CollabService` 时固定，所以必须在启动时为每个 channel 注册中继，接入方之后再 attach。
- 没有接入方时，中继不认领、presence 为 `unreachable`、deliver 抛错。这样接入方未加载时，消息照常提交但不记账唤醒（presence 采样在事务前，见 `samplePresence`），不会有悬空的唤醒。

**调用者解析与在途调用的失权（评审 C1）。**
- `SessionAccess.caller` 改为返回 `{channel, address}`：先检查对象身份、归档与排除名单，再判断普通会话；否则同步询问各接入方的 `resolveCaller`。
- 普通会话被接入方认领时一律拒绝，防止接入方把一个普通会话"改名"成托管成员。
- 每次调用都重新计算，不缓存（D1 交集语义的前提）。
- **只在入口解析不够。** 内核在提交前会 await presence 采样和空间队列，入口时的判断可能在这期间失效。
- **第 1 轮修法（地址级 `holds`）不够。** 第 2 轮评审 C1 指出，"地址仍被持有"不等于"发起调用的那个执行对象仍然有效"：
  - Host 可能换了 agent 对象；
  - 句柄可能 dispose 后又重新 attach，新句柄仍承认同一地址（ABA）。
- **最终做法：调用级守卫。**
  - 插件在入口创建一个同步函数，捕获执行 agent 对象、解析出的地址和接入代际；
  - 内核在该命令最后一个 await 之后、提交或返回数据之前调用它，二者之间没有 await（内核"调用级守卫在提交与读取边界重验"）；
  - 守卫在被调用时重新执行入口的全部条件，并要求接入代际不变。
- **为什么让内核调用宿主给的函数，而不是由内核自己检查。** 内核不依赖宿主（不知道 agent、归档、代际），这样它仍是宿主无关的独立库。插件不能在 await 内核之后再补查，因为那时写入已经发生。
- **适用范围。** 普通会话调用也带守卫，这样顺带封住了现有实现中"入口通过后被归档或加入排除名单仍能提交"的窗口。内核只强制托管 channel 与 manager 的调用必须带守卫，普通调用不带时行为不变，旧测试不受影响。
- **收据重放也经过守卫。** 失效的调用者连旧结果也拿不到；有效的新执行对象可以重放同一 cmdId。
- **同步约束。** `resolveCaller` 与 adapter 的 `holds` 都是同步接口，前提是接入方维护一份已异步核验过的内存投影。Pet 现有的 `resolveCollaborationCaller` 是异步的，不能直接接上（见 Context）。这是 Locus 接入 change 的验收点；本 change 用测试替身覆盖语义。
- `collab_status` 只经 host-index 读取，不走内核成员读取。所以对托管调用者，它在返回前再同步调用一次 `resolveCaller` 比对。

**句柄。**
- 托管命令：`admit`/`rebind`/`retire`。
- 带 `ext`/`mode` 的成员命令：`command`/`read`，调用者从 `exec` 解析，不收地址。
- `registerSessionMode`。
- 句柄不给 Leader 能力。

**普通会话收件人的方式。** `dsh-session` provider 的 `supportsMode` 查询注册表。带 mode 的投递在完成全部原有核验后交给 handler，不调用 `followup`。Pet 的询问 handler 将来就挂在这里，由它负责独立轮次、Delivery 等接入方语义。

**工具面。** `collab_space` 加两个 action 与可选参数 `channel`，其余不变，`collab_*` 仍是 11 个。

### D5 内核内部

- `ChannelProvider` 增加可选的 `managed?: boolean` 与 `supportsMode?(mode): boolean`。
- `CommandContext` 与 `ReadContext` 增加可选的 `guard?: () => boolean`。托管 channel 与 manager 的调用缺少守卫时以 `COLLAB_FORBIDDEN` 拒绝（fail closed）。
- manager 命令分两阶段（评审 M1）：事务外只做 principal 校验，以及"没有现成收据时认领一次"；进入串行队列后，从当前状态重新判定收据、授权、关闭、目标状态、唯一性，最后调用守卫；句柄给的守卫会检查接入代际与 adapter 是否仍持有新地址。预备阶段的结果不被沿用。
- presence 样本按绑定匹配（第 2 轮评审 M5）。换代保留成员名，所以按成员名保存的样本可能属于旧地址。样本改为关联采样时的 `{channel, address}`；事务内发现唤醒接收方的绑定与样本不一致时，以 `COLLAB_BINDING_CHANGED` 零提交拒绝，调用方用原 cmdId 重试并重新采样。
  - 没有选择"离开队列自动重新预备"：那需要在服务内循环，并为循环设上限。
  - 没有选择"事务内重新采样"：那违反"不在串行事务内 await provider"。
  - 只有命令确实要为该成员判断唤醒时才拒绝，与唤醒无关的换代不影响命令。
- 未获授权的 manager 得到 `COLLAB_NOT_MEMBER`（授权检查先于关闭检查），dsh-collab 再把它与不存在、存储失败统一映射为 `COLLAB_SPACE_UNAVAILABLE`。这样没有授权的接入方无法探测空间是否存在、是否关闭（评审 M2）。
- `claim` 只遍历非托管 provider；`admitMember` 与 `rebindMember` 只调用 principal 对应的 provider，认领放在进入串行事务之前的 `prepare` 阶段，与 `invite` 相同。
- `reduce`：
  - `manager/allowed` 与 `manager/revoked` 维护 `managers`；
  - `member/rebound` 把旧 `{channel, address}` 推入 `previousBindings`，再写新 binding；
  - 旧日志的 `managers` 为 `[]`。
- 地址唯一检查改为同时查当前绑定与 `previousBindings`。
- `leave` 自动接手跳过 `managedBy` 成员。
- `wakeRecipients` 不变（新事件都不唤醒）；`decideDispatch` 从 `message/sent.message.mode` 复制到 delivery 与 pointer。
- 授权表新增五个命令，"公开命令与授权表一致"的类型测试会覆盖。

## 调研纪要第 6 节开放问题的回答

1. **空间是整个多 root/child 的共享边界，还是各 root 有内部现场？** 按标准第 3 节，按事情划分空间，成员多对多，不嵌套。"A 的 Locus"是一个空间，成员是 A 和 A 的托管子会话；跨 root 的事另开空间，由桥成员转述。本 change 只保证一个托管 channel 可以在多个空间各自获授权。
2. **群和话题内容哪些适合进空间？** 原文不进（标准第 4 节）。进入的是提炼后的结论、请求、进度。来源用 `ext` 保存引用（D2），体积上限 4 KiB 从结构上阻止整段搬运。具体字段由接入 change 定义。
3. **托管成员怎样进入、退出、换代，同时避免双份授权真相？** 见 D1、D4：Leader 授权 channel → 接入方 `admit`/`rebind`/`retire` → 每次调用都由接入方实时解析调用者，权限是两份事实的交集。
4. **request 能否统一表达自记工作与待承接事项？是否需要依赖和 claim？** 能。自记工作用作者自己维护、无 `requiredAcks` 的 `other` 条目（约定 v3 已写明）；待承接事项用 request。依赖、claim、ready 属于边界之内的分工，交给 Agent Teams（标准第 1 节）。本 change 不加。
5. **通用通知与需要续进原工作的询问怎样区分？何时允许唤醒？** 唤醒时机仍只有三种触发。"询问"是一条带 `mode` 的需回复消息（D3）。是否独立轮次、怎样关联原工作和续进，由收件人 provider 或接入方 handler 决定。原工作的关联放在 `ext`，回答 `ref` 到问题。协作层只保证不能静默降级为普通 followup。
6. **台账与 Pet 原子 domain 的交界。** 不做跨存储原子提交。接入方先在自己的事务里记下"将要写入台账的命令、确定的 cmdId 与载荷"，提交后再调用句柄。因为 Pet 先提交、后写台账，不会出现"台账写成功而 Pet 回滚"。恢复时以谁的身份重试，要按命令种类区分（评审 M4）：
   - **托管命令**（`admit`/`rebind`/`retire`）：以 manager principal 执行，不依赖任何会话。重启后的后台恢复可以直接用原 cmdId 和载荷重放，由收据给出确定结果。
   - **成员内容命令**（经 `command(exec, …)` 写入、带 `ext` 的条目或消息）：身份只能来自真实执行会话，本 change **不提供**后台以成员身份写入的能力，也不伪造 exec。可行的恢复路径是：等该成员下一次在有效会话中执行时（换代后的新会话也可以，收据按成员名命中），用原 cmdId 和载荷重试，得到原结果或首次提交。身份已失效（成员已退役或被 `markGone`）的待办，由接入方标记为"需人工处置"，不自动重试。
   - 确定的 cmdId 解决的是重复写入；它不提供恢复时的写入权限。接入 change 必须覆盖三种崩溃点：Pet 提交后、台账提交前；台账提交后、结果记回前；重启时原身份已失效。
7. **与 ref 工作对齐。** 已基于归档的 `collab-ref-threads`：`ext`/`mode` 不参与 `ref` 校验和话题推导；`mode` 不绕过话题上限；托管命令不产生消息，不计数。

## Risks / Trade-offs

- **[接入方 adapter 是信任边界]** `resolveCaller` 返回什么，dsh-collab 就把调用者当作哪个成员。→ 只有宿主配置声明的 channel 才能 attach；即便如此，也只能映射到该 channel 已被 Leader 授权、且由它自己接纳的成员；普通会话不能被认领；归档与排除名单先于 adapter 检查。接入方本身是本机已审查的插件，与 provider 处在同一信任层。
- **[`supportsMode` 在串行事务内同步调用]** 慢的 provider 会阻塞该空间。→ 规定为同步布尔方法（中继与 `dsh-session` 都只查内存表），抛错视为不支持，不会使空间进入 `failed`。
- **[守卫在串行事务内同步调用]** 与 `supportsMode` 相同，要求只查内存；抛错视为失效，命令失败，但空间不进入 `failed`。
- **[`COLLAB_BINDING_CHANGED` 需要调用方重试]** 只在采样与提交之间恰好换代时出现，窗口很小。错误码表明可以安全地用原 cmdId 重试；模型工具原样返回它，句柄调用方由接入方决定是否重试。
- **[模式判断与投递之间的竞态]** 发送时支持，投递时已注销。→ 投递失败，不降级（场景已覆盖），结果与其它投递失败相同，列为 failed。
- **[托管成员数量]** 一个 Locus 有很多群，presence 采样会为每个成员调用接入方。→ 采样已经按命令执行一次并去重。接入方的 presence 应是内存查询，这是接入 change 的验收点。
- **[回滚]** 回滚到旧内核时：
  - 旧内核忽略 `manager/*` 与 `member/rebound`（`reduce` 的 switch 没有分支），托管成员显示为 active，绑定停在最初地址；
  - 旧插件没有中继 provider，也不会构造非 `dsh-session` principal，所以托管成员无法行动，presence 为 `unreachable`；
  - 但旧内核的 Leader 自动接手可能选中托管成员，使空间失去可行动的 Leader。

  → 缓解：迁移说明要求回滚前 Leader 不离开、或先撤销托管授权。该风险只在已使用扩展点的空间出现，现在没有任何接入方。

## Migration Plan

1. 内核与插件同批发布。未配置 `managedChannels` 时只注册 `dsh-session` provider，行为不变（有场景覆盖）。
2. `dsh build` 后重启 Host。旧空间照常重放（`managers` 为空）。
3. Locus 接入 change 再在 `dsh.yaml` 的 overlay 配置中加 `managedChannels: [pet-locus]`。
4. 回滚：恢复旧包后 `dsh build` 并重启。已使用扩展点的空间按上文风险处理。

## Open Questions

- 托管成员是否需要在 `collab_status` 里看到"联系人"。本期返回空数组，由接入方自己提供。等 Locus 接入时按实际需要再定。
- 接入方给自己的成员写的工作说明，是否要合进将来的约定 v4。本期不做。
