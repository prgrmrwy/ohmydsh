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

### D1. 只移除 `index.ts` 的装配，保留 `BotLifecycleInitializer` 接口与 `BotLifecycleIntake`

**决定**：只在 `index.ts` 不再向 `PetChannelServiceDeps` 传入 `botLifecycleInitializer`；不删除 `bot-lifecycle.ts` 中的接口、`BotLifecycleIntake` 类或事件解析。

**核实依据**（原开放问题 1 已确认）：`botLifecycleInitializer` 在 `PetChannelServiceDeps` 中是可选字段（`readonly botLifecycleInitializer?: BotLifecycleInitializer`），`service.ts` 的构造逻辑是 `deps.botLifecycleInitializer === undefined ? undefined : new BotLifecycleIntake({...})`——不传即不构造，整条订阅链路（事件解析、去重、allowlist 校验）自然停用，不需要删除任何类型或类。`BotLifecycleIntake` 本身（事件解析 `parseBotAddedEvent`、去重、`BotLifecycleOutcome`）是独立于 provisioning 调用的完好能力，删除它是缩小 D1 范围之外的额外改动，不在本 change 内。

**意外证据**：系统已存在"群保持待建立"这一正常状态——当入群事件的 `operatorOpenId` 不在 allowlist 时，`service.ts` 现有诊断语就是「该群保持待建立，首次 allowlist @ 可补齐」。本 change 不是引入新状态，只是让这条既有路径成为唯一路径。

**备选**：
- 删除 `ensureAuthorizedChat` 的唯一调用者所在分支后一并删除接口 —— 否决：接口与 `BotLifecycleIntake` 在生产代码中零调用方之外（仅 `service.ts` 一处装配），删除属于未经请求的范围扩大，且会连带删除仍然正确的事件解析/去重逻辑。
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

**[首次建树失败会连带首条消息未被处理，且同一 endpoint 需重启 Host 才能恢复]** → 当前实现下 `resolveLocus` 捕获 `ensureForDelivery` 抛错后返回 `undefined`，controller 以 `locus-unavailable` 诊断拒绝该次投递，不发布半成品，端到端测试已验证。**实施阶段发现比最初评估更严重**：`failProvisioning` 只把操作标记为 `failed`，而该 phase 仍计入 `findBlockingProvisioningOperation` 的阻塞集合；唯一把 `failed` 转为 `compensated`（解除阻塞）的代码路径是 `reconcileStartup`，只在 Host 启动时运行一次。因此同一 endpoint 建树失败一次后，**运行期间永久阻塞，必须重启 Host 才能重试**，不是"稍后重试即可恢复"。这是 provisioning 补偿机制的既有特征（旧模型下群/话题各自的建树失败同样命中同一阻塞），本 change 把群的触发路径从入群挪到首个 @ 并不改变、也不扩大这一行为——只是首次真实端到端测试才发现它。已转入 BACKLOG B040 留待独立设计（不在本 change 范围内修复）。

**[管理面短期内出现"群在但无 locus"的空档]** → 这是预期的新常态而非缺陷。UI 侧渲染归 B030/B026；在其完成前，管理面只是不展示该群，与"展示一个空 session"相比信息量不减。

**[既有自动 main 不会被回收]** → 本 change 不追溯清理已经由入群自动创建的 main/child/locus。它们继续按既有规则服务与改绑。若需清理，属于独立的数据治理工作。

## Migration Plan

无数据迁移：本 change 不改变持久结构、不新增字段、不修改既有记录。

部署即生效：移除调用后，新入群的 chat 不再预建；已存在的 locus 不受影响。

回滚：恢复被移除的调用即可，无需数据修复。

## Open Questions

两项原有开放问题已在规划阶段核实，结论并入 D1：

- `BotLifecycleInitializer` 除 `ensureAuthorizedChat` 外无其它成员，但它是 `service.ts` 的可选依赖；不传即整条链路自然停用，接口与 `BotLifecycleIntake` 均保留。
- 代码搜索确认：`findGroup`/`requireActiveLocus` 在 controller 之外零调用方；测试侧仅 `channel-service.test.ts`、`bot-lifecycle.test.ts`、`locus-real-event-shapes.test.ts` 涉及 bot-added 事件，且均不依赖建树结果——`channel-service.test.ts` 现有用例断言的正是「starts a separate bot-added consumer only while enabled and never creates business work」。不存在需要因本 change 而改的既有依赖。

无遗留开放问题。
