# Pet locus 按需建树：拉 bot 零副作用

## Why

把 bot 拉进任何群，当下就会立刻创建一个主会话、一个空子会话和一个 active locus——此时群里还没有人 @ 过 bot。所有者的预期是"子会话跟着 @ 创建或复用"，入群本身不应产生任何持久后果。

真正的代价不是多一个空 session，而是**它固化了尚未表达的归属**：自动建出的 main 是 `mainSource: 'auto'`，所有者随后用 `/bind` 指定真实主会话时，必须走 `replaceAutomaticGroupParent` 改绑路径——产生上下文变更警告，并留下一个无人使用的自动 main。而话题（topic）入口从来没有这个提前触发，首个 @ 才建树。同一套模型出现两种建树时机，`at` 与 `at + bind` 得到的结果也因此不同。

## What Changes

- **拉 bot 进群不再创建任何 session 或 locus**：移除 `im.chat.member.bot.added_v1` 对 provisioning 的调用，该事件不再产生持久后果。
- **整棵 locus 树统一由首个 @ 按需建立**：群与话题走同一条 `ensureForDelivery` 路径，建树时机一致。
- **不引入任何新的持久记录**：不新增"bot 在哪些群"的本地副本。该事实由飞书平台 `im +chat-list` 实时提供，自建副本会随踢出、解散、改名而漂移。
- **不改变** locus 领域模型、权限档位、Delivery 队列、`/bind` 语义或话题层级规则。
- **不改变**任何已建立 locus 的行为：既有记录照常服务，本 change 只影响"尚未建立"这一时刻。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pet-locus-collaboration`: 明确入群不产生持久后果、整棵树由首个 @ 按需建立，并使群与话题的建树时机同构。涉及既有需求「群与话题按层级补齐且继承在创建时固定」与「显式绑定可替换自动关联并警告上下文改变」的适用时机。

## Impact

**代码**

- `packages/dsh-pet/src/index.ts`：移除 `botLifecycleInitializer.ensureAuthorizedChat` 中对 `locusProvisioningController.ensureGroup` 的调用；该分支移除后，原 `locusProvisioningController === undefined` 时的诊断语「first allowlist @ will initialize the locus」成为常态描述。
- `packages/dsh-pet/src/host/channel/bot-lifecycle.ts`：`BotLifecycleInitializer` 接口在失去唯一实现内容后是否保留，由 design 判定。

**不受影响**

- `ensureGroup` / `ensureTopic` / `provisionGroupLocked` 本身不改：按需路径 `ensureForDelivery` 本就转发到同一对函数，`beginProvisioning`/`recordResource`/rollback 补偿完全同源，推迟时机不降低失败安全性。
- 首次判据不变：当前用「无群级记录」判定首次，而群级记录本就是 locus 记录的投影（`findGroup = findLatestMarker + project`），改后「无 locus 记录即首次」判据更纯粹，无需新增记录支撑。

**行为变化**

- 首个 @ 会多出建树耗时，与话题入口现有行为一致，不额外做初始化提示。
- 管理面将出现新状态「bot 在群但尚无 locus」。该状态可由平台 `chat-list` 与本地 `loci` 表联合渲染，本 change 不实现 UI（归 B030/B026）。

**不做**

- 不记录入群时刻。当前无消费者；真需要时 `im.chat.member.bot.added_v1` 可随时再接，届时有明确用途。
- 不处理 bot 被移出/群解散的入口可达性（B029 单独处理）。
