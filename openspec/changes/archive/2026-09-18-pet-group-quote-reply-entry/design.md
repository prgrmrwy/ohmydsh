## Context

Pet 的统一 locus 准入是**纯函数 + 单一事实来源**：`extractLocusEndpoint(event)` 从一条已经解析的入站事件推导入口身份 `(chatId, threadId?)`，`admitLocusEvent` 再按身份做授权与防线判定。入口身份决定了后续一切：用哪个 locus、哪个 child、回复落到哪里。

当前实现（`packages/dsh-pet/src/host/locus/admission.ts`）的判定是：

```text
thread_id 可用            -> 入口 (chatId, threadId)
无 thread_id 但有 root_id 或 reply_to -> 拒绝 ambiguous-thread
两者都没有                -> 入口 (chatId)
```

这条中间分支的隐含假设是「带引用/回复事实而没有 `thread_id` 的事件 = 丢了字段的话题消息」。本轮在真实租户上测量（脱敏形态）：

| 场景 | `thread_id` | `root_id` | `parent_id` | 入口结论 |
|---|---|---|---|---|
| 群时间线普通发言 | 无 | 无 | 无 | 群本体（现行实现正确） |
| **群时间线引用某条消息发言** | **无** | **= 被引用消息** | **= 被引用消息** | 群本体（现行实现**拒绝**） |
| 群时间线回复引用链中的第二条 | 无 | 引用链根 | 直接父消息 | 群本体（现行实现**拒绝**） |
| 话题内发言 / 话题根消息 | `omt_*` | 无或话题根 | 无或直接父 | 话题（现行实现正确） |

- 该群 `chat_mode: group`（非话题模式）：引用别人的消息时，平台固定给 `root_id`/`parent_id`，**只有话题内消息才带 `thread_id`**。
- 反证原假设：被拒绝的那条消息**不在**任何话题内（同群话题的消息列表里没有它，话题内消息全部带 `thread_id`），所以它不是「丢了 thread_id 的话题消息」，而是群时间线上的引用消息。
- 同期 `dsh.log` 出现 15 次 `admission-rejected:ambiguous-thread`（在 `channel/service.ts` 的低基数词表里归入 `other`，旧日志因此只显示 `inbound ignored: other`），与用户「引用消息再 @bot 没有反应」的反馈逐次对应。

约束：`design.md`（pet-unified-locus-collaboration）明确入口身份是 `(chatId, threadId?)`，并写明「messageId 属于投递，不属于一般入口键」；本 change 是让实现回到该设计原则，而不是为它发明例外。

## Goals / Non-Goals

**Goals:**
- 群时间线的引用/回复消息按群本体入口正常投递，不再静默丢弃。
- 入口判定的事实依据可判定、可测量：thread 归属只由平台 `thread_id` 证明。
- 话题行为逐字不变：话题内消息仍走 `(chatId, threadId)`，回复仍留在原话题。
- 安全边界不变：授权、mention、去重、水位、消息类型、失效与旧关联防线全部原样。

**Non-Goals:**
- 不为群级引用凭空建立话题 locus，也不把引用链根当成话题根。
- 不新增「反查被引用消息属于哪个话题再改投」的状态化路由。
- 不改变「无法确定入口时不串投」的目标本身，只修正判定它的事实依据。
- 不改持久 schema、RPC、管理面与出站回复通道。

## Decisions

### 1. thread 身份只认 `thread_id`，引用事实一律降级为 Delivery 级事实

`extractLocusEndpoint` 的规则收敛为两条：`thread_id` 可用 → `(chatId, threadId)`；否则 → `(chatId)`。`root_id`/`reply_to` 不再参与入口推导。

**理由**：平台的 `thread_id` 是入口级稳定身份，`root_id`/`parent_id` 是消息级引用关系；用后者否决前者，等于把 messageId 提升成入口键，与 design 的入口定义直接冲突。

**替代方案（否决）**：
- *保持现状（拒绝）*——把最常见的提问方式变成静默丢弃，且用户无法从任何界面得知原因；实测已证明其前提假设错误。
- *用 `root_id` 合成话题入口*——引用链根与话题根是两个不同概念，会把普通群回复投递到不存在的话题、或建立错误的话题结构。
- *反查被引用消息是否属于已知话题，若属于则改投该话题*——需要持久保存 messageId→threadId 映射（违反「不保存拉取历史内容」的边界），且用户在群时间线里提问却被答到话题内，与用户所处的视线位置不符；事件本身也不提供该证据。

### 2. 身份事实失败关闭，可选事实降级

- `thread_id` 非空但无法归一化（空白、控制字符）→ 仍拒绝（`invalid-thread`）：这是入口身份事实被污染，无法证明入口。
- `root_id`/`reply_to` 无法归一化 → 视为「无此引用事实」，消息照常按群入口投递：它们是**可选**的上下文事实，不应有权否决整条消息——这正是本次故障的成因模式。
- `chat_id` 无法归一化 → 仍拒绝（`invalid-chat`）。

### 3. `ambiguous-thread` 词汇随判据一起移除

端点推导的拒绝理由收敛为 `invalid-chat` / `invalid-thread`，准入拒绝理由表删除 `ambiguous-thread`。保留一个永不产生的拒绝原因会让下一个读日志的人以为存在一条可触发的分支。

### 4. `replyTarget.rootMessageId` 只随 thread 携带

`root_id` 只有在话题内才是「话题根消息」。群级引用消息的 `root_id` 是引用链根，写进回复目标会同时污染两处语义：持久层把它记为 Delivery 的 `rootMessageId`，child prompt 又把它渲染成「当前 thread 根消息」。因此群级投递只保留 `replyToMessageId`（直接引用/回复的那条消息），不再携带 `rootMessageId`。

出站行为不变：群级投递本来就是用触发消息 id 调 `im +messages-reply`（不带 `--reply-in-thread`），所以「bot 引用 @bot 那条消息回复」是既有语义；话题投递本来就带 `--reply-in-thread`，保持不变。

## Risks / Trade-offs

- [话题消息的事件若真的丢失 `thread_id`，新规则会把它投给群本体入口] → 本轮测量显示该形态不存在（群内所有话题消息都带 `thread_id`，而带引用无 thread 的消息确实在话题之外）；且后果是同一群人、同一个 bot 的可见答复，不跨群、不越权，Owner 可在管理面看到入口；相比「用户提问被永久静默丢弃」是更小的代价。判定入口仍不使用猜测值：`thread_id` 缺失就是缺失。
- [引用事实被忽略，child 少了一条上下文提示] → 直接引用的那条消息仍以 `replyToMessageId` 进入 prompt 的 `replied message` 行；child 也一直可以按需读取原始消息。引用链根对回答质量没有额外价值。
- [旧日志/诊断里不再出现 `ambiguous-thread`，历史对比断层] → 在 `docs/notes/dsh-plugin-integration-pitfalls.md` 记录该词汇的历史含义与本次实测形态，使旧日志仍可解读。

## Migration Plan

1. 代码与测试在 `packages/dsh-pet` 内完成，跑 `npm run typecheck`、范围 vitest 与仓库级检查。
2. 经主仓 `dsh build` 物化到部署目录（`~/.dsh/plugins/dsh-pet`），重启 `dsh web` 后生效；本 change 不改持久数据，回滚只需回退代码重新构建（既有 locus/Delivery 记录不含新字段，双向兼容）。
3. 验收以真实群为准：群时间线引用一条消息并 @bot，确认得到引用回复；再在同一群的话题内 @bot，确认回复仍在原话题。

## Open Questions

- 无阻塞项。是否把「引用事实」升格为 child prompt 的显式一行（例如「本条消息引用了另一条消息」）留待有真实回答质量证据时再定，本 change 不加。
