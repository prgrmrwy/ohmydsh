# Pet 飞书关联模型 v2（已被替代，不实施）

> **SUPERSEDED**：本草案已由 [pet-unified-locus-collaboration](../pet-unified-locus-collaboration/proposal.md) 替代。
> 本目录的 design、delta specs 与 tasks 仅保留讨论历史，不再作为实施依据；未实施、不作完成归档。

> 本期是关联模型的整体重设计，不只是放开一个 1:1 校验。完整目标架构见
> [系统架构设计](design.md)：核心理念 → 系统上下文 → 领域关系 → 组件职责 →
> 端到端流程 → 生命周期 → 上下文与权限 → 一致性与恢复 → 迁移。
>
> **评审状态**：本稿早先将部分技术推断写成了结论。`design.md` 已区分目标、证据与
> G1–G6 实施前门槛；下文及 delta 中旧的权限映射、目录发现和最近使用策略尚需同步闭合。
> OpenSpec 结构校验通过不代表这些问题已经验证，不应据此直接执行旧任务清单。

## 核心架构主张

**以协作现场为入口，以持续工作为单位，以原生 DSH session 为执行载体。**

- **locus 是地址**：统一群本体与话题，不再让 chat 粒度决定所有绑定。
- **binding 是关系**：每段活跃关联有唯一执行归属，源会话可以向多个入口分发独立 child。
- **route 是兜底**：没有精确绑定时选择 workspace，不覆盖绑定，也不把失效当成未绑定。
- **Task 是工作生命周期**：单次回答完成不结束服务；归档释放关联，历史仍保留。
- **统一管理，不强行统一执行**：QA 用 fork child/inbox；workspace 路径保留 root executor/Invocation。
- **授权与上下文分开**：知道目录不等于可写；控制命令由 Host 裁定，Agent 只处理被交付的工作。

这使源会话与飞书群形成可解释的多对多关系，同时保留每个活跃 locus 的唯一服务者。
普通 Pet 轮盘的 Invocation/Snapshot 模型继续存在，不在本期被 locus 取代。

## Why

Pet 的答疑绑定当前以**群**为单位、且与源会话严格双向 1:1：一个源会话至多一个群，
一个群至多一个源会话。真实工作不是这个形状——一个核心需求会话在开发阶段有工作群，
进入测试后每个 meego issue 各自拉群，需要各有一个子代理跟进；反过来，一个大群里
同时跑多个话题，不同话题对应不同工作会话。两种诉求今天都被挡死：前者被
`qa:<sessionId>` scope key 拒绝（`bind.ts:124` 固定回执「该会话已有答疑群」），
后者因 `chat_bindings` 以 `chatId` 为主键而无从表达。

同时，绑定后的子代理**没有权限档位**：它继承源会话的全部工具面，spec 只能以
「能力可以让渡给群成员，边界不可以」这一条 prompt 级行为约束兜底。fan-out 之后
这条约束要在 N 个独立 child 上各自正确执行 N 次，必然失效。

## What Changes

- **BREAKING** 绑定主体从 chat 下沉为**绑定位点（locus）**：`chatId` 或
  `chatId + threadId`。群本体与群内话题是同一种东西的两个实例，不做特例。
- **BREAKING** 拆表：`chat_bindings` 拆为 `chat_routes`（群的兜底 workspace 路由）
  与 `agent_bindings`（locus 绑定，同一 chat 可多行）。补丁字段
  `qaPriorWorkspaceId` 及 `/unbind` 的「还原 or 删行」分支随之删除。
- 关系形态改为 `session 1—N locus 1—1 agent`：一个源会话可挂多个 locus；
  locus 与 agent 保持 1:1（结算匹配依赖它，放宽会把表情打到别人的问题上）。
- 新增 locus 权限档位：`read`（宿主 sandbox 硬边界）与 `write`（解除硬边界后
  回到 prompt 级目录约束）。默认 read，由 allowlist 成员经群内命令提权/降权。
- 命令面拆分：`-b/--bind` 只负责建立关联，`-s/--scope read|write` 只负责授权。
- 执行根改为**与 sw 同构的自然语言锚定**：child 从继承历史中认定父会话的工作目录、
  首轮回报、Host 校验后落库。删除 `wsStatus` / worktree adapter 与 Pet 对
  `dsh-worktree-session` 的可选耦合，使无 worktree / `ws` / `sw` 三种场景归一。
- `pet_context` 按 Task 形态分流：`qa-chat` 读 locus，其余仍读 Invocation+Snapshot。
  连带修复 `index.ts:455-467` 记录的 `NO_CURRENT_INVOCATION` 事故。
- 固化既有但未成文的约束：`/bind` 候选排除子代理会话（深度两层封顶）。
- Q&A 轮盘点击**保留复用语义**（命中既有 locus 则跳转飞书并标明复用）；
  增开新群走群内 `-b` 或面板显式入口。

## 目标模型

### 什么是 locus

**Locus（绑定位点）是飞书里一条消息进入 Pet 后，能够被唯一识别、独立绑定、独立授权
并由固定 Agent 持续处理的最小会话入口。** 它不是新的飞书实体，而是 Pet 对既有
chat / thread 的统一抽象：

- 群本体或单聊是一个 locus，以 `chatId` 标识；
- 群内每个话题也是一个 locus，以 `chatId + threadId` 标识；
- 不同 locus 可以绑定同一个源 session，也可以各自绑定不同 session；
- 每个 locus 只对应一个固定 Agent，并独立持有 Task、上下文、read/write 档位与生命周期。

选择 locus 而不是 chat 作为绑定主体，是因为 **chat 太粗、thread 单独建模又会重复**：
chat 无法表达一个大群里多个话题分别跟进不同问题；而将群与话题做成两套模型，会让
绑定、授权、归档、失效、路由和反馈规则各复制一遍。locus 把二者统一成同一种入口，
区别只在键是否包含 `threadId`。

```
飞书空间                           Pet locus
────────────────────────────────────────────────────
单聊 oc_p2p                     →  locus(oc_p2p)
普通群 oc_group                 →  locus(oc_group)
话题群 oc_topic 的群本体          →  locus(oc_topic)
  ├─ 话题 omt_a                 →  locus(oc_topic, omt_a)
  └─ 话题 omt_b                 →  locus(oc_topic, omt_b)
```

```
今天（双向 1:1，群维度）                改后（session 1—N locus 1—1 agent）
─────────────────────────           ─────────────────────────────────────────

源会话 ──1:1── 群                              ┌── 核心需求 session ──┐
  ↑                                       fork │        fork │        │ fork
  再 bind 第二个群 → 固定拒绝                    ▼             ▼        ▼
  同群第二个话题   → 无从表达               child_0        child_1    child_a
                                       (read/write↕)  (read/write↕)  (read↕)
                                             │1:1          │1:1        │1:1
                                        ┌────┴────┐   ┌────┴────┐ ┌────┴──────────┐
                                        │ 工作群   │   │meego 群 │ │ 大群 · 话题A   │
                                        │ chatId  │   │ chatId  │ │chatId#thread  │
                                        └─────────┘   └─────────┘ └───────────────┘
                                          locus          locus         locus

不变量：宽度放开（一个 session 任意多 locus），深度封顶（child 不可再被 bind）；
       一个 locus 恰好一个 agent（终态反馈的可判定性依赖它）。
话题与群本体是同一种 locus 的两个实例；档位（read/write）是 locus 的属性，
运行时可切，不需重建 child。
```

## Capabilities

### New Capabilities
- `pet-locus-binding`: 绑定位点模型本身——locus 键的构成与解析、`session 1—N locus 1—1
  agent` 的关系不变量、占用与释放判据、locus 权限档位与授权路径、爆炸半径的如实呈现。

### Modified Capabilities
- `pet-qa-group`: 废除群与源会话双向 1:1，改为源会话侧可 fan-out；绑定与授权命令拆分；
  执行根来源改为继承历史认定而非 worktree 插件查询；补充深度两层封顶 Requirement；
  Q&A 复用语义在多 locus 下的重述。
- `pet-lark-channel`: 路由主体从 chat 改为 locus；话题维度的入站判定与 fail-closed 语义；
  allowlist 豁免判据明确为群级；命令识别扩展到 `-s`。
- `dsh-pet`: `pet_context` 的形态分流与 locus 数据源；`isForkChildTaskForm` 从
  「一律不 compose」收窄为「不装 preset 与 allowlist provider，但装 context 工具」。

## Impact

**数据模型（非 additive，v1 以来首次）**：`chat_bindings` 拆为两张表，
`PET_DOMAIN_VERSION` 5 → 6，需要真实迁移路径而非 additive 重印。

**代码**：`host/spec.ts`、`host/repository.ts`、`host/channel/route.ts`、
`host/channel/pipeline.ts`、`host/qa/*`（occupancy / bind / action / delivery /
command / prompt）、`host/context-tool.ts`、`host/capture.ts`、`wire.ts`、
`client/settings.tsx`、`index.ts`。

**删除**：`host/worktree-status.ts`、`host/worktree-adapter.ts` 及
`resolveWorktree` 相关装配；绑定行上的 `qaExecutionRoot` / `qaBranch` /
`qaRepositoryRoot` / `qaPriorWorkspaceId` 字段。

**宿主依赖**：新增对 `@deepseek-ai/dsh-sandbox-policy` 的 `setSandboxMode` 使用
（可选探测，缺席时权限档位不可用而非 Pet 无法加载）。

**已验证的约束**（详见 `docs/notes/pet-locus-spike-findings.md`）：
fork child 无法指定 cwd；`workspace-write` 的可写根等于 session cwd，因而在
`sw`（兄弟目录）与 `ws`（子目录）两种 worktree 布局下都无法正确圈定受管执行目录——
`write` 档因此**不是**沙箱级的目录保证，必须如实声明。
