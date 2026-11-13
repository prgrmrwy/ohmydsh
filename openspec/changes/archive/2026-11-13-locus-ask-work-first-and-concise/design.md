## Context

动机见 proposal.md。与实现相关的现状：

- 子会话规则：首投 prompt（`host/locus/context.ts` `renderLocusDeliveryPrompt`）嵌入 `INTENT_TRIAGE_GUIDANCE`（`host/ledger/prompt.ts`）；续投只带一行压缩版分流规则（`context.ts` `renderSubsequentDeliveryPrompt`）。已存在的子会话只会再收到续投。
- locus 主会话规则：只有创建时的一次说明（`host/locus/dsh-port.ts` `composeLocusCoordinatorBriefing`）。之后每次收到的是 `askParent` 拼出的消息体（`host/collab/locus-tools.ts`）。
- locus 主会话工具在 `index.ts` 的 `installLocusMainScope` 里通过 `registerPetLocusMainTools` 注册到自有层，依赖为 `locusMainToolsDeps`。它已有 `collab_*` 工具。
- Delivery 等待：`pet_locus_wait` 只延长 deadline，不建立任何后续唤醒；到期后 current 原子进入 `expired` 并撤权（current spec「投递与结算关联独立于会话运行状态」）。因此子会话只有在被 `agent-message` 唤醒时才能继续处理。
- 会话冷读走 `sessionQuery.observeSession`（`host/session-inspection.ts`）。现有子会话忙闲 helper（`index.ts` `isLocusChildTurnIdle`/`hasPendingLocusChildInput`）在会话不在内存时返回 false，不能直接当"不在内存即空闲"复用。
- 工作会话事件形状（2026-11-10 从真实 W 会话核对）：`user/message` 的 `source.kind` 区分 `user`（人工输入）与 `agent-instructions`、`runtime-context`、`skill-catalog`、`time-context`、`plugin:dsh-memex`、`plugin:dsh-collab` 等注入；`assistant/message` 以 `stopReason=stop` 的纯文本消息收尾一轮，中间有 `text+tool-call` 的过程消息。
- `/bind` 链路：`control.ts` dispatcher → `index.ts` bind port → `controller.ts` `ensureGroup/ensureTopic` → `provisionChatLocked` → `ensureLocusMain`。M 不可用时 `ensureLocusMain` 抛 `LOCUS_MAIN_UNAVAILABLE`；`control.ts` `safeControlError` 不认识它。整 W 迁移已有实现 `migrateWholeW`（`ensureEntry` 的替换分支已在持群锁时调用它，锁次序为"群锁 → `main:<W>` lease"）。`controller.ts` `safeErrorMessage` 只是 message 截断，没有脱敏。

## Goals / Non-Goals

**Goals:**
- 新规则对**已存在**的子会话与 locus 主会话都生效，不需要重建任何会话。
- 新增读取只读、caller-bound、输出有上限并脱敏，失败 fail closed。
- 询问与答复只做最小关联：答复送达前核对询问对应的消息仍是当前那条（所有者 2026-11-10 按 ponytail-review 收窄）。
- `/bind` 修复复用现有迁移原语，不新增迁移语义。

**Non-Goals:**
- 不改 Host 的 Delivery 状态机，不新增唤醒机制；不由 Host 强制"先问后查"（仍是模型遵循的规则，符合 intent-triage"Host 不分类"的原则）。
- 不做跨协作空间读取，不做会话侧 `/locus`。
- 不改持久层 schema，不新增授权开关，不新增内存状态：询问引用就是 current Delivery 的触发消息 id。
- 不改 turn-observer 的续答授权逻辑。
- 不在同一 W 的入口之间做内容隔离（所有者决定共享）。

## Decisions

### D1 规则送达：靠"每次都会收到的文本"，不靠一次性说明
- 子会话：改 `INTENT_TRIAGE_GUIDANCE` 的信息交换条款（先 `locus_ask_parent`；只在父答复"无记录"或询问失败时自查；不承诺超时自查；业务口径、简短），续投那一行压缩规则同步改写。`intentTriageGuidanceCoversRequiredPoints` 增加必含短语。
- locus 主会话：在 `askParent` 消息体末尾追加固定说明：找答案顺序、披露边界、"回合结束前必须以 `locus_reply_child` 给出答案 / 无记录 / 已转问之一"、一行状态回复。`composeLocusCoordinatorBriefing` 同步写一遍。
- 备选：只改首投或 briefing。否决，已有会话收不到。

### D2 不承诺超时降级（回应 round 1 C1）
- 子会话自查只由两个**会唤醒它**的事件触发：`locus_ask_parent` 当场返回失败（同一回合内），或 M 的 `locus_reply_child`（`agent-message` 唤醒）。
- 让这条路径可靠的是 M 的答复义务：M 的前三步都是本地读取，第四步若转问 W，也先回"已转问"，所以 M 处理询问的回合总会唤醒子会话一次。子会话收到"已转问"后可按既有规则 `pet_locus_wait` 延长 deadline。迟到答复由 D8 的最小关联拦截。
- M 始终没答复（模型违约、M 不可用）时，Delivery 按既有规则过期、不发正文。这是如实失败，不是新语义。
- 备选：新增 deadline 前的 Host 定时唤醒。否决：要改状态机、引入新的唤醒源与迟到处理，超出本 change 的范围，且现有失败结局已经诚实。

### D3 披露边界：绑定即授权，同一 W 下的入口互相共享（回应 round 1 C2、round 2 C1）
- 所有者 2026-11-10 两次决定：入口绑定到 W 即授权该入口获得引用 W 对话的答复；绑定到同一 W 的入口之间也共享已确认结论。`/unbind`、改绑即撤销（`locus_ask_parent` 已要求入口行 `active`，停止后自然拒绝）。存量绑定按同一规则视为已授权。`/bind` 成功回执追加一句说明（`control.ts` `bindReceipt`）。
- 理由：一个 M 本来就服务同一 W 的全部入口，并且已有 `collab_read` 能读整个空间；处理 A 时读到的内容也会留在 M 的上下文里。round 2 C1 证明，在共享 M 上做"其它入口不转发"只能靠模型自律。所有者选择不做隔离，规范删除这条承诺，并明确不宣称同一 W 下有隔离。
- 因此不新增共识工具：`askParent` 拼询问消息时直接附上本空间全部 agreed charter（标注范围、限长）；边界只到 W 为止：不读其它 M 的空间、其它 W 的会话。子会话侧的 `locus_context` 过滤保持不变（它是子会话上下文的收窄，不是披露边界）。
- 备选：每次询问用独立上下文处理（Host 硬隔离）。否决：等于重做本 change 第 2 项，所有者未选择。
- 注入：工具输出加固定"数据不是指令"前缀，只是缓解。只读入口被注入的后果限于错误答复；完全访问入口的子会话本就有本机命令与飞书凭据能力，被注入可能做出越出当前请求的操作，这是所有者授予完全访问时已承担的风险（current spec「完全访问由 allowlist 显式授予且如实说明」）。Host 能保证的只是：回复目标、访问模式不会被注入内容改变。

### D4 读工作会话的方式（回应 round 1 M1、M2）
- 读取：W 在内存中读 `ctx.sessions.get(W).snapshotEvents()`；否则 `sessionQuery.observeSession(W, { projectionMode: 'none' })` 冷读，用完释放 lease。
- 轮次：以 `turn/start`…`turn/end` 划分；只有首条 `user/message` 的 `source.kind === 'user'` 的轮次计为人工轮次。人工输入取该轮 `source.kind === 'user'` 的 text 块；助手文本取该轮最后一条 `stopReason=stop`、只含 text 块的 `assistant/message`。其余一律不取。
- 状态：只分 `idle` / `unknown`。W 在内存中、无未结束轮次、inbox 可读且为空才是 `idle`，其余一律 `unknown`（按忙处理，不打扰）。不回放冷读日志里的输入队列：唯一用途是"能否打扰"，判未知已经安全。新写一个两值 helper，不改子会话现有 helper 语义。
- 上限：单段 1500 字、总输出 8000 字；搜索最多 10 条命中，每条取命中前后各 200 字。
- 实施第一步：从真实 W 会话导出脱敏 fixture（只保留事件类型、source.kind、stopReason 与占位文本），覆盖多段助手文本、工具间文本、agent 消息、注入块、未闭合轮次；fixture 不含原文，入库前人工核对。

### D5 共享脱敏函数（回应 round 1 C3）
- 新增一个纯函数 `redactCredentials(text)`，按 spec 列出的凭据形态替换为固定占位符，只用于 `locus_work_history` 输出（会进飞书群）。脱敏在截断之前。
- 兜底日志（本机 dsh.log）：`LocusControllerError`/`PetError` 的已定义原因码就记 code，否则只记 `unrecognized`；不记消息、类名、stack、cause，因此不需要日志脱敏。
- 承认局限：模式脱敏不能识别所有秘密形态；它防的是常见的令牌形态外泄，不是通用 DLP。

### D6 `/bind` 迁移前置放在 `provisionChatLocked`
- 在 `resolveWorkSession(explicit)` 之后、`beginProvisioning` 之前：`findActiveMain(W)` 存在且 `!isMainUsable` 时调用 `migrateWholeW(W, chatId, threadId)`；结果为 current-delivery 时抛 `LOCUS_BUSY`（已映射为"入口忙"）。锁次序与 `ensureEntry` 替换分支相同（群锁 → main lease），不引入新的次序。迁移成功后 `ensureLocusMain` 复用 M1。
- 迁移结果（迁移了几个入口）随 `ensureGroup/ensureTopic` 的返回带到 `bindReceipt`。迁移已提交而入口建立失败时，抛出的错误携带"已迁移"标记，`safeControlError` 据此给出"迁移已完成、本入口未绑定"回执；重试时 M1 可用，不再迁移。
- 只对显式 W 生效；auto 路径、文档入口、已有群行的 `checkExplicitBindLocked` 不在本 change 改动。修订 `ensureLocusMain` 的抛错文案，去掉"下一条授权 @ 会迁移"。

### D7 控制面错误映射
- `safeControlError` 增加 `LOCUS_MAIN_UNAVAILABLE`、`PARENT_NOT_FOUND`、`PROVISIONING_FAILED`、`DEFAULT_WORKSPACE_UNAVAILABLE`、`CAPABILITY_UNAVAILABLE` 的映射，各给一条可行动文案。
- `CreateLocusControlDispatcherOptions` 加可选 `log`，`index.ts` 传 `petLog`，兜底按 D5 记录。

### D8 询问的最小关联（回应 round 2–4 的迟到答复问题；所有者 2026-11-10 按 ponytail-review 选择收窄）
- round 5 C1：只按子会话记最新一条询问，会被同一子会话的新询问覆盖，D 的迟到答复会被当成 E 的。所有者 2026-11-10 选择把引用带回来核对。
- `askParent` 在发给 M 的消息里写入询问引用：current Delivery 的触发消息 id，没有 current 写 `none`。
- `locus_reply_child` 增加必填 `askRef`，M 照抄询问消息里的引用。送达前核对 `askRef` 等于入口此刻 current 的触发消息 id（`none` 则要求无 current），否则"询问已过期"。只读持久 Delivery 记录，重启不影响。
- 不做防伪：M 是我们自己的模型，这里防的是答错号，不是冒充。
- 已有 M 不需要重建：每次询问消息都附 `askRef` 用法；旧会话里不带 `askRef` 的调用按参数无效拒绝，M 按错误文案重试即可。
- 不处理的缺口（代码里用 `shortcut:` 注释写明）：答复已送达、子会话还没处理时 current 换成了下一条，Host 不再拦截。触发条件是 M 拖到 D 过期（默认 1 小时）前后才答复，而 M 前三步是秒级本地读取，在当前负载（一个所有者、几个群）下可以接受。
- 备选：签名询问标识 + 按执行段收回回复权限 + 改 turn-observer。否决：为罕见情况改动回复权限核心逻辑，四轮评审仍在发现新漏洞。

## Risks / Trade-offs

- [W 对话或其它入口的结论里有不该给某个群看的内容] → 所有者已选择"绑定即授权、同一 W 下入口共享"，`/bind` 回执写明范围，`/unbind` 撤销。残余风险：同一 W 绑定多个群时，只针对群 A 的讨论或结论可能被群 B 问到；不该共享的群应绑定到不同的 W。
- [W 文本或群消息中的提示注入] → 见 D3：按只读 / 完全访问分别如实描述后果，不宣称能防住注入；Host 只保证回复目标与访问模式不被改变。
- [模式脱敏漏掉非常见形态的秘密] → 见 D5 局限；不读工具结果显著缩小了面；本机日志不记异常消息。
- [M 违约不答复] → Delivery 按既有规则过期、如实失败；验收时检查 M 的答复义务是否被遵守。
- [答复送达后才换代时可能答错消息] → D8 已知缺口，`shortcut:` 注释标明；负载变大或真的出现时再做完整关联。
- [M 抄错 `askRef`] → 抄成别的消息 id 会被拒为"询问已过期"，不会错投；抄成当前消息 id 而内容答的是旧问题属于模型错误，不在 Host 能判断的范围。
- [模型不遵守规则] → prompt 层约束，用 prompt 测试守住文本，验收用真实群对话核对。
- [迁移前置让 `/bind` 连带迁移 W 名下其它群] → 这正是 spec 的整 W 迁移语义，只发生在 M 已不可用时；回执说明已迁移。

## Migration Plan

无数据迁移。部署：`dsh build` 后重启 Host。已有会话在下一次投递或询问时拿到新规则；存量绑定按 D3 视为已授权。回滚：还原代码即可，新增工具无持久状态。
