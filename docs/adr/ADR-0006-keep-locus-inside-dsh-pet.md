# ADR-0006: locus 关联能力保留在 dsh-pet 内，不提取为独立 DSH 插件

- **Status**: Accepted
- **Date**: 2026-09-23
- **Relates to**: `docs/adr/ADR-0004-consolidate-locus-specs-into-pet-locus-collaboration.md`（locus 规范收敛为单一 `pet-locus-collaboration` 主 spec）；`openspec/specs/pet-locus-collaboration/spec.md`；归档 change `2026-09-22-shrink-pet-compat-to-minimal`；BACKLOG B036/B039

## Context

`packages/dsh-pet/src/host/locus/` 已是 18,548 行、32 个文件的完整子系统，实现「一个外部入口 ↔ 一棵 DSH 会话树」的持久关联：endpoint 寻址、代际（generation）、串行 Delivery 队列、逐轮结算关联、权限核验、代际切换通知、启动恢复。

该模型在概念层面并不专属飞书——「入口」「工作现场」「协作现场」「子会话按话题分裂」对任何 IM 或工单系统都成立。因此反复出现一个问题：**是否应把 locus 提取为独立的 DSH 注册插件，使它成为一套通用关联方案，由 Pet（或其它插件）作为消费者接入？**

本 ADR 记录该问题的一次完整评估与否决，以免每次看到 `controller.ts` 中大量 `chatId` 字段访问时重新推导。

### 实测耦合度（2026-09-23）

对 `src/host/locus/*.ts` 统计 `chatId|threadId|lark|Lark|飞书|openId|mention` 的出现次数：

| 分层 | 文件数 | 行数 | 代表模块 |
|---|---|---|---|
| **零提及** | 11 | 3,147 | `turn-observer`、`resolution`、`child-delivery`、`switch-notice`、`reconcile`、`startup-recovery`、`expiry-scheduler`、`prepublication-staging`、`project-read-guard`、`policy-verification`、`context-repository` |
| 1–20 次 | 18 | ~9,000 | `child`(1/1711)、`repository`(3/951)、`composition`(2/352)、`dsh-port`(7/463)、`management`(9/1100)、`hierarchy`(13/300) |
| 40+ 次 | 3 | ~6,700 | `controller`(107/1977)、`persistence`(55/4056)、`admission`(44/658) |

三项结构性事实：

1. **整个 locus 目录只有 1 处 import channel 层**：`admission.ts:11` 的 `LarkInboundEvent` 类型。
2. **飞书副作用被隔离在一个 11 行的可选端口** `LocusLarkPort`（`controller.ts:239` 的 `readonly lark?:`）。缺少它只影响建群与自动换群，不影响关联、投递、结算、恢复。
3. `controller.ts` 的 107 次提及**绝大多数是 `endpoint.chatId` / `endpoint.threadId` 的字段读取**，不是 lark-cli 调用。`LocusEndpoint = { chatId, threadId? }` 本身就是一个两级地址抽象。

**即 ADR-0004 那轮统一 locus 改造事实上已经完成了约 85% 的平台解耦。** 当前问题不是「要不要抽象」，而是「要不要把这层已经干净的边界物化成 package 边界」。

### 被忽略的不对称：存储耦合远深于平台耦合

| 维度 | 耦合程度 |
|---|---|
| locus ↔ 飞书 | **浅**：1 个类型 import + 1 个 11 行可选端口 |
| locus ↔ Pet 持久层 | **深**：`persistence.ts` 4,056 行（占目录 22%）；`dsh_pet` domain v15（`PET_DOMAIN_NAME`/`PET_DOMAIN_VERSION`）；7 张表（`locus`、`locus_indexes`、`locus_deliveries`、`locus_operations`、`locus_permission_audit`、`locus_switch_notices`、`deliveries`）；Pet 自持 SQLite backend（`src/host/storage/`，2026-09-22 刚从上游 patch 迁出）与其跨表事务、`PRAGMA locking_mode = EXCLUSIVE` |

提取插件必须处置这一层，而两条路都不可接受：

- **把 persistence 一起搬走** → Pet 只剩壳，"独立插件"名不副实；
- **定义持久化端口让 Pet 注入** → 新增一层抽象，且正是 `docs/notes/dsh-plugin-integration-pitfalls.md` 记录 11 次的那类「声明了但没接通」风险面。

### 抽象正当性检验

| 候选消费者 | 现状 |
|---|---|
| Pet 换用 Slack / 企微 | 无真实需求 |
| 另一个 DSH 插件复用关联模型 | 不存在第二个消费者 |
| 向 DSH 社区贡献 | `dsh.yaml` 既定原则是不 vendor 远端源码，反向输出同样不在本仓职责内 |
| 让 locus 更易测试、更易修改 | **不需要提取即可获得**（见 Decision 第 2 条） |

### 边界即将被改写

当前正在推进的架构调整（三层结构：用户工作现场 → locus 协作主会话 → locus 子会话；`/bind` 从「征用用户会话作 main」反转为「关联观测对象」）会改变 locus 的核心实体：

```
今天：{ endpoint, mainSession, childSession, generation }
之后：{ endpoint, 协作主会话, 被观测工作现场, 子会话集合, generation }
```

此刻提取，等于把一个即将被改写的形状固化成 package 公开 API，落地时需再改一次。

## Decision

**locus 保留在 `dsh-pet` 内，不提取为独立 DSH 插件。**

同时确立两条配套立场：

1. **不提取，但也不退化平台解耦。** locus 核心对飞书的依赖应保持在当前水平或更低；新增代码 MUST NOT 在 `turn-observer`、`resolution`、`delivery` 路由、`switch-notice`、`reconcile` 等零提及模块中引入平台概念。

2. **「零飞书依赖」的收尾作为既有工作的约束顺带完成，不单独立项。** 剩余项：`admission.ts` 的 `LarkInboundEvent` 改为平台中立的 `InboundMessage`；`controller.ts` 的 `chatId`/`threadId` 重命名为 `spaceId`/`threadId`（纯改名）；`persistence.ts` 的列名与索引键（**触及 v15 schema，需迁移**）。其收益是**测试不再需要飞书替身**——该仓库已因替身与真实系统不一致连续踩坑三次（`dsh-plugin-integration-pitfalls.md` 第 7 节：`sessionController.inspect` 假形状、context anchor 的 `authorization`、`tokenStatus`），而非「支持另一个平台」。

## Consequences

**正面**

- 避免在没有第二个消费者时付出抽象成本，并避免固化一个即将被改写的 API 边界。
- 保留 locus 与 Pet 持久层的直接耦合，因而保留 `domain.transaction()` 的跨表原子性。经端口注入的持久化无法提供同等保证（JSON 每记录一文件后端已明确拒绝 `transaction`）。
- 平台解耦的**测试收益**照常兑现，且无需 package 边界。

**负面与风险**

- locus 无法被其它 DSH 插件复用。接受：当前无此需求。
- `dsh-pet` 继续是一个大 package（locus 一个子系统即 18.5K 行）。接受：`AGENTS.md` 要求的「定制可独立启用/禁用/升级/移除」在 **dsh-pet 整体**这一粒度上成立；locus 独立后 Pet 只剩空壳，并不真正具备可禁用性。
- 「零飞书依赖」收尾若长期不做，`controller.ts`/`persistence.ts` 的平台命名会继续扩散。缓解：立场 1 禁止在零提及模块中引入平台概念，使扩散面有界。

**重新评估的触发条件**（满足任一即应重开此决策）

1. 出现**第二个真实消费者**——另一个 DSH 插件或另一个平台接入，且有具体使用场景而非设想；
2. 三层结构落地并稳定运行后，核心实体形状不再变动；
3. Pet 持久层本身被重构为可注入端口（届时最大障碍消失）。

## Alternatives considered

**立即提取为 `packages/dsh-locus`，Pet 作为首个消费者。** 否决：无第二消费者；存储耦合需先解决而方案本身即新增风险面；三层结构会改写公开 API。

**只提取零飞书依赖的 11 个文件（3,147 行）作为 `dsh-locus-core`。** 否决：这 11 个文件是**叶子**（`turn-observer`、`switch-notice`、`reconcile` 等），彼此不构成完整能力；真正的关联语义在 `controller.ts` 与 `persistence.ts`，而它们正是耦合最深的两个。产物将是一个无法独立表达任何能力的工具集合。

**先完成「零飞书依赖」再决定是否提取。** 否决：解耦收益（测试质量）不依赖提取即可兑现；而把它作为提取的前置步骤，会把一项低成本改进绑定到一个已被否决的目标上。故改为立场 2——作为既有工作的约束顺带完成。

**维持现状且不记录。** 否决：该问题已在三轮讨论中重复出现，而推导所需证据（耦合度实测、存储/平台耦合的不对称、边界将被改写）不存在于仓库任何位置，每次都需重新推导。
