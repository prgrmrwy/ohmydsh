## Why

群聊里「引用一条消息 + @bot」是提问前最自然的动作，但 Pet 统一 locus 准入把它**静默丢弃**：`extractLocusEndpoint` 把事件里的 `root_id`/`reply_to`（平台字段 `root_id`/`parent_id`）当作「可能存在话题」的证据，只要没有 `thread_id` 就返回 `ambiguous-thread` 并结束，用户侧表现为「@了 bot 但毫无反应」。

判据来自实机测量（2026-09-16，答疑群 `oc_<32 hex>`）：

- 入站事件形态。用户引用话题根消息并 @bot 的那条消息，原始字段为 `thread_id: None`、`root_id` 与 `parent_id` **同时**等于被引用消息 id。这不是异常事件，而是**普通群（`chat_mode: group`）里的引用/回复**在该平台的固定形态：引用别人的消息时平台给 `root_id`/`parent_id`，给话题内消息才给 `thread_id`。
- 反证「它是丢了 thread 的话题消息」这一原假设。用 bot 身份读同一租户：该消息**不在**任何 `omt_*` 话题内（同群那个话题的全部消息都带 `thread_id`），它是群主时间线上的一条引用消息；同时段 15 条群时间线消息里，凡有引用的都只有 `root_id`/`parent_id`，凡在话题内的都带 `thread_id`。
- 故障现场自证。`dsh.log` 同期出现 15 次 `admission-rejected:ambiguous-thread`（拒绝原因在 `service.ts` 归入 `other`，因此旧日志只显示 `inbound ignored: other`），与用户反馈的「直接在群聊中直接引用消息再 at bot 就没有反应」逐次对应；而在话题里直接发言（事件带 `thread_id`）则一切正常。

原判据的错误在于把「消息级引用事实」当成了「入口身份证据」。`design.md` 早已写明入口身份是 `(chatId, threadId?)` 且「messageId 属于投递，不属于一般入口键」——实现却用一个 messageId 去**否决**入口，等于把 messageId 提升为入口键。本期修正这一处判据。

## What Changes

- **入口身份只由 `thread_id` 证明**：`extractLocusEndpoint` 不再因 `root_id`/`reply_to` 的存在而拒绝；无 `thread_id` 时一律落到群本体入口 `chatId`。
- **引用/回复事实降级为 Delivery 级事实**：`root_id`/`reply_to` 只用于出站回复目标与上下文，不得派生、改变或否决入口。
- **可选事实缺失或被污染时降级而非拒绝**：无法归一化的 `root_id`/`reply_to` 视为「无此事实」；无法归一化的 `thread_id` 仍 fail closed（`invalid-thread`）。
- **移除 `ambiguous-thread` 词汇**：端点推导与准入拒绝理由表中不再存在该原因；`invalid-endpoint` 继续承担真正的入口解析失败。
- **`rootMessageId` 语义收紧**：`replyTarget.rootMessageId` 只在该入口确有 thread 时携带（此时 `root_id` 才是话题根消息）。群级引用消息的 `root_id` 是引用链根、不是话题根，不再被写进回复目标，也不再在 child prompt 里被渲染成「当前 thread 根消息」。
- **回复行为不变**：群级投递仍以触发消息 id 调 `im +messages-reply`，因此「bot 引用 @bot 那条消息回复」的既有语义原样保留；话题投递仍带 `--reply-in-thread` 留在原话题。
- 非破坏性：不改持久 schema、不改 RPC/管理面、不改话题 locus 行为，安全边界不放松（非 allowlist 发送者、失效/旧关联、去重水位与消息类型防线全部原样）。

**明确不做**：不放宽「无法确定入口时不串投」的目标，只修正判定它的事实依据；不把引用链根当作话题根，也不为群级引用凭空创建话题 locus。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pet-locus-collaboration`：把「群与话题按层级补齐且继承在创建时固定」中「消息无法确定 thread 归属时 MUST NOT 冒充群本体」的判据改为**可判定且经实测**的形式——thread 归属只由平台 `thread_id` 证明；`root_id`/`parent_id` 等引用事实 MUST NOT 被读作 thread 证据，也 MUST NOT 单独导致拒绝；只有无法归一化的 `thread_id` 才失败关闭。对应补入群主时间线引用消息的正常场景与「引用事实不改变入口」的场景。

## Impact

- `packages/dsh-pet/src/host/locus/admission.ts`：端点推导规则与拒绝理由词汇表。
- `packages/dsh-pet/src/host/channel/locus-controller.ts`：`replyTarget.rootMessageId` 仅随 thread 携带。
- `packages/dsh-pet/test/locus-admission.test.ts`、`packages/dsh-pet/test/locus-real-event-shapes.test.ts`、`packages/dsh-pet/test/fixtures/real-lark-events.ts`：把「缺 thread_id 必须拒绝」的用例改为「必须落到群入口」，并补真实形态的引用消息样例。
- `docs/notes/dsh-plugin-integration-pitfalls.md`：记录本轮实测的字段形态与「把 messageId 当入口键」的识别信号。
- `openspec/specs/pet-locus-collaboration/spec.md`：归档时并入上述需求修订。
- 用户可见影响：群主时间线上的引用/回复消息从「静默丢弃」变为「按群入口正常投递并回复」；话题内消息行为不变。
