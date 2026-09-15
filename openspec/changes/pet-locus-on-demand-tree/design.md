## Context

`im.chat.member.bot.added_v1` 当前经 `botLifecycleInitializer.ensureAuthorizedChat`（`src/index.ts`）调用 `locusProvisioningController.ensureGroup({ chatId })`。因为不带 `parentSessionId`，它走 `mainSource = 'auto'` 分支：解析 default workspace → 创建主会话 → 创建子会话 → 发布 active locus。于是把 bot 拉进任何群，都会立刻产生三个持久对象，而群里还没有任何人 @ 过 bot。

探索阶段核实的三项事实决定了本设计的形状：

**1. 按需建树的完整链路已经存在。** `admission.ts` 已产出 `needsInitialization`，`locus-controller.ts` 的 `resolveLocus` 在无 locus 且该标志为真时调用 `ensureForDelivery`，后者在 `resolution.ts` 中已包含退役检查（`classifyEndpointRetirement`）、provisioning 调用与可用性校验（拒绝非 active、无 child、无 parent 的返回）。`index.ts` 中 `locusProvisioningController === undefined` 时的诊断语「first allowlist @ will initialize the locus」本就在描述这条路径。它不是待建能力，只是被提前触发遮住了。

**2. 两条路径调用同一个函数。** `ensureForDelivery` 的实现是薄转发：`endpoint.threadId === undefined ? ensureGroup(...) : ensureTopic(...)`。两者共用 `provisionGroupLocked` 的 `beginProvisioning` / `recordResource` / rollback 补偿，该机制在 controller 的六处 provisioning 路径中一致使用。因此推迟建树时机**不降低失败安全性**，也不需要把补偿能力另行抽象后传递。

**3. Host 不存在独立于 session 的 chat 级记录。** `LocusGroupRecord` 不是独立表，而是 locus 记录的投影（`findGroup` = `findLatestMarker` + `projectGroupRecord`），且 `mainSessionId` 为必填字段。当前不存在"记了群但没有 session"的状态，首次判据「无群级记录」与「无 locus 记录」本就等价。

## Goals / Non-Goals

**Goals:**

- 入群不产生任何持久后果：不建 session、不建 locus、不写新记录。
- 群与话题使用同一建树时机，消除按入口类型分叉的特例。
- 消除「先自动建再 bind 改绑」这一整类触发场景。
- 保持改动为纯删除：不新增持久概念、不新增接口、不改动 provisioning 与补偿本身。

**Non-Goals:**

- 不记录入群时刻或"bot 在哪些群"。
- 不改变 locus 领域模型、权限档位、Delivery 队列、`/bind` 语义或话题层级规则。
- 不改变任何已建立 locus 的行为；本 change 只作用于"尚未建立"这一时刻。
- 不实现管理面 UI（归 B030/B026），不处理 bot 被移出/群解散的可达性（归 B029）。
- 不为首个 @ 增加"正在初始化"的飞书侧提示。

## Decisions

### D1. 移除 `botLifecycleInitializer`，而非保留为空操作

**决定**：整体移除该 initializer 的 provisioning 调用；若移除后接口再无实现内容，一并移除接口本身。

**理由**：其接口契约写的是 "Ensure only the chat-level structure. Must not create a Delivery or queue work."——当前实现虽未建 Delivery，却建了 main 与 child，已超出该契约。移除后没有任何需要在入群时刻完成的工作，保留一个空壳接口是为假想需求预留结构。

**备选**：
- 保留接口、实现改为空操作 —— 否决：留下什么都不做的接口，读者需要额外推断它为何存在。
- 保留并改为"只记录授权事实" —— 否决，见 D2。

### D2. 不记录"bot 在哪些群"，平台即真相源

**决定**：不新增任何持久记录。

**理由**：`lark-cli im +chat-list --as bot` 已实时返回 bot 所在群及其 `chat_id` / `name` / `chat_mode` / `owner_id` 等完整字段（实测返回 20 个群）。自建副本是复制平台已有事实，且必然随踢出、解散、改名而漂移——B029 正在处理的就是这类不同步。入群时刻当前没有任何消费者；真需要时 `im.chat.member.bot.added_v1` 可随时再接，届时有明确用途、知道该记什么字段。

**对管理面的影响**：locus 关联图所需数据现已齐备，由平台 `chat-list` 与本地 `loci` 表联合渲染三种状态——已建立 locus（显示完整关联链）、bot 在群但无 locus（显示"等待首个 @"）、有 locus 但 bot 不在群（入口不可达，B029）。第二种状态是本 change 后的新常态，且比现状"入群即冒出空 session"表达得更准确。

### D3. 首次判据沿用"无 locus 记录"，不引入新状态

**决定**：不新增"已入群未建树"的显式状态位。

**理由**：见 Context 第 3 点——群级记录本就是 locus 投影，移除提前触发后「无 locus 记录即首次」判据不变且更纯粹，不需要额外记录支撑。`ensureForDelivery` 内部已先 `readCurrent` 再决定是否 provisioning，形状本就是"首次检测 + 首次保障"。

### D4. `/bind` 在无 locus 时直接建立，不走改绑

**决定**：尚未建立 locus 的入口收到 `/bind` 时，直接以指定主会话建立 locus，`mainSource` 记为显式来源；不发送上下文变更警告。

**理由**：这是本 change 的核心收益。当前流程是"入群自动建 main(auto) → bind → `replaceAutomaticGroupParent`"，改绑会产生上下文变更警告并遗留一个无人使用的自动 main。移除提前触发后不存在需要被替换的自动归属，因而也不存在来源变化——此时发送"从 S0 切换到 S1"的警告是错误的，没有发生过 S0。

**兼容性**：已存在 `mainSource: 'auto'` 的 locus 收到 `/bind` 时，改绑路径与警告**保持不变**。本 change 不迁移、不追溯改写既有记录。

### D5. 首个 @ 的延迟不做特殊处理

**决定**：不为首条消息增加"正在初始化"的飞书侧回执。

**理由**：话题入口一直是这个行为，从未因此产生问题；群改为一致是消除特例而非引入新风险。建树失败时既有补偿与诊断路径照常工作。若后续实测表明延迟确实影响体验，再单独处理。

## Risks / Trade-offs

**[首个 @ 的端到端延迟增加]** → 该延迟从入群时刻挪到首条消息，总耗时不变，且与话题入口现有行为一致。建树与投递同在一次 `handleAdmission` 内完成，补偿路径不变。验收时记录实测耗时，异常再单独处理。

**[首次建树失败会连带首条消息未被处理]** → 当前实现下 `resolveLocus` 捕获 `ensureForDelivery` 抛错后返回 `undefined`，controller 以 `locus-unavailable` 诊断拒绝该次投递，不发布半成品。风险是用户看不到明确原因。本 change 不扩大该行为，但需在验收中确认诊断可见。

**[管理面短期内出现"群在但无 locus"的空档]** → 这是预期的新常态而非缺陷。UI 侧渲染归 B030/B026；在其完成前，管理面只是不展示该群，与"展示一个空 session"相比信息量不减。

**[既有自动 main 不会被回收]** → 本 change 不追溯清理已经由入群自动创建的 main/child/locus。它们继续按既有规则服务与改绑。若需清理，属于独立的数据治理工作。

## Migration Plan

无数据迁移：本 change 不改变持久结构、不新增字段、不修改既有记录。

部署即生效：移除调用后，新入群的 chat 不再预建；已存在的 locus 不受影响。

回滚：恢复被移除的调用即可，无需数据修复。

## Open Questions

- `BotLifecycleInitializer` 接口在移除 provisioning 调用后是否还有其它实现内容或调用方？实施首步需确认；若确无，按 D1 一并移除接口与其装配。
- 是否存在依赖"入群即有 locus"的测试或管理面代码路径？实施时以搜索为准，不预设。
