# ADR-0007: 三层 locus 改造不得以「退 patch」或「消除打断」立项

- **Status**: Accepted
- **Date**: 2026-09-23
- **Relates to**: `docs/adr/ADR-0006-keep-locus-inside-dsh-pet.md`（同一轮评审的另一半）；`packages/dsh-pet/compat/subagent/README.md`（seam 退役纪律）；`openspec/specs/pet-locus-collaboration/spec.md`；BACKLOG B040 / B042；commit `6329b209`（本轮已修的安全面降级）

## Context

### 提案

把 locus 从当前形态改为三层：

```
今天                                    提案
────────────────────────────────        ────────────────────────────────
用户主会话（auto 时是 Pet 自建的         用户工作现场（用户自己的会话）
standby；bind/qa 时是用户自己              │ 弱关联（仅 Pet 持久记录，无 runtime 边）
正在工作的会话）                         协作主会话（恒为 Pet 自有）
   │ DSH subagent 父子边                    │ DSH subagent 父子边（不变）
locus 子会话（每话题一个）                locus 子会话（不变）
```

`/bind` 的语义随之反转：从「征用用户会话作 main」变为「让协作主旁路观测该工作会话」。

提案当时给出的两条主要理由是：**退掉 `settlementNotice` patch**（因为 Pet 自有的 standby 主会话几乎恒为 idle，上游 `notifySettlement` 会走 `queue` 而非 `steer`），以及**消除子代结算对用户工作的打断**。

### 评审方法与它自身的失误

四轮交叉评审：为现状辩护、攻击现状、独立勘察干净上游、量化维护成本。四方独立取证后交叉核对，冲突处逐条实测裁定。

评审过程本身出过三次同类错误，值得连同结论一起记住：`compat/subagent/.upstream/` 是**已打补丁的工作区**（`build.mjs` 在其上 `git apply` 且当时不还原），于是三位读者先后把本仓 patch 读成上游官方 API，其中一位在承诺用 `git show HEAD:` 复核后仍然引错——因为他按**行号区间**取内容，而 patch 会移动行号。**本 ADR 的每一条上游事实均以 `git grep <字符串> HEAD` 复核。** 该缺陷已在 commit `cced8d72` 修复（构建退出时还原，含失败路径），判据写入 compat README。

### 生产数据（2026-09-23 实测快照）

16 条 locus：`active` 2 / `invalid` 10 / `stopped` 4。

10 条 invalid 的成因**与归档无关**，分两类：7 条「缺少 safe-v1 child composition 证明」，2 条 `child-session-access-failed`，1 条子会话已不存在。

按创建时间排序后成因清楚：

```
2026-09-15 ~ 09-18   9 条   childComposition 全部缺失   ← safe-v1 机制上线前
──────────────────────────────────────────────────────
2026-09-19 ~ 09-22   7 条   childComposition 全部就位   ← 上线后，无一例外
```

即那 7 条是**历史残留，缺陷已修**，不构成新论据。但它们的分布是决定性的：7 条全部挂在**两个被征用的用户工作会话**下，其中 `session-85620d77` 出现 5 次，与仓库内 `.worktrees/at-bot-session-85620d77-…/` 同 id——**「征用用户正在工作的会话作为 locus 主」在生产中真实发生，且是最高频的 parent（≥31.3%）**。

## Decision

**不以「退 patch」或「消除打断」作为三层改造的立项理由。** 两条理由均经实测否证。

三层本身**未被否决**：它指向的设计缺陷是真实的，但必须以自身理由立项，并先回答本 ADR「待决事项」一节列出的问题。

### 理由 1：「退 patch」不成立

四个 seam 在干净上游 0.1.5-rc.2 中出现次数**全部为 0**（`git grep HEAD` 复核），不存在「上游已支持」的退路。而三层只影响其中一个：

| seam | 三层下能否退役 | 依据 |
|---|---|---|
| `settlementNotice: 'silent'` | 取决于协作主是否保持 idle（见理由 3） | `continuation-activation.ts` 干净版 `:833` |
| `contextMode: 'independent-v1'` | 不能。冷恢复需子代**独立于父**重建组合 | 归档 change `shrink-pet-compat-to-minimal` §8 的证伪记录 |
| `createIdleContinuable` | 不能。阻塞项是两阶段建树的失败补偿顺序，与父是谁无关 | 同上；与 B036 同一条 |
| `withLiveContinuableChildSession` | 不能。三层明确保留 main→child 的 subagent 边 | 3 个生产消费点：sandbox policy 的 apply/resolve、启动恢复的 delivery 证明 |

量化结果：

- patch 617 行新增中，`settlementNotice` 独占部分约 15–20%；`continuation.ts` 的 259 行几乎全属另外三个 seam；
- `hostRuntimeCompatibility` 机制、740 行工具链、21 个外部进程、26 个校验闸门、2.2 GB 构建体系——**节省 0%**，因为它们是存在性成本，不随 patch 体积缩放；
- patch 43 天内 8 次修改，**75% 源自本方 locus 能力演进**，DSH 升版重新推导仅占 12.5%；
- 三层需新增生命周期级联代码，净代码量估算为 **+124 行**（patch −216，新增 +340）——**改造之后代码更多，不是更少**。

### 理由 2：「消除打断」不成立——`inject` 三重否决

上游原生提供三个投递原语（`core/agent-loop/src/agent.ts:137-147`，未被 patch 触及），其中只有 `inject` 传 `wakeup: false`，结构性不唤醒 driver；且上游自己已在 `notifySettlement` 的 teardown 分支使用它。这一度看起来是比架构改造便宜三个数量级的第三条路（一个 hunk）。

**它不成立，且有三条独立的否决理由：**

1. **不保证送达**——官方注释明写 idle 会话不被唤醒，消息悬挂至有人 `followup`/`steer`；而结算是子代生命周期的终局账目，丢失即永久丢失。
2. **仍进模型上下文**——`inbox.ts:111-115` 的 `claim()` 会把 `next-step` 队列整批取走。`inject` 不打断，但**不是不污染**：用户下次自己开始工作时，积压的结算通知会一次性进入他的模型上下文。而 Pet 的立场是「结果已通过飞书汇报给真实受众，父不是受众」——inject 解决了打断，没解决「父不是受众」。
3. **会钉住 activation**——上游 README Known Limitations 原文：「Pending injected context retains an Activation ... keeps the child and its live ancestors resident until a waking delivery claims it」。即它会**阻止子会话的闲置释放**，而那正是 subagent child 相对普通会话最大的运行时优势。

### 理由 3：「协作主保持 idle」与「协作主承担统筹」内在冲突

`settlementNotice` 能否退役，取决于协作主是否恒为 idle：上游按 `parent.status === 'idle' ? 'queue' : 'steer'` 选择投递路径。但提案同时把协作主描述为「统筹子会话」的协作 agent——**一旦它跑轮次，`status` 就不是 idle，`steer` 分支重新激活**。

实测印证这不是理论担忧：归档 change 的多 locus 验收记录中，两个父会话在观测窗口内分别新增 **12 / 33 事件**，原文标注「父会话确实在活跃工作，而非恰好空闲」。且一个群的所有话题共享同一个 group main，N 个话题即 N 条结算流指向同一个 main——**打断概率随规模上升**。

三种取向的代价：

| 取向 | `settlementNotice` | 「协作」价值 |
|---|---|---|
| A. 纯 standby | 可退役 | ≈0，退化为「换个 main」 |
| B. 活跃 + preset 锁死 | **应改为官方 `notify`**（它此时真是受众） | 成立，须证明锁死的 preset 够用 |
| C. 活跃 + preset 可扩 | 不可退役 | 安全保证回到原点，不应采纳 |

取向 B 下有一个反直觉的结果：协作主若真是结算通知的受众，`silent` 不该被删除，而应**退役成官方默认的 `notify`**——耦合从「必须抑制」变成「正是所需」。**这才是三层对 patch 的真正收益，而不是「少一个 seam」。**

## Consequences

**正面**

- 避免了一次以错误理由驱动的改造：估算 40–64 人日、触及 46 源文件 / 57 测试文件、跨 6 个子系统，且会撞上两个未修前置（见下）。
- 两条被提案正确识别的缺陷得到分离处置：其一已即时修复，其二获得独立解法方向，都不必等待架构改造。
- 「不能用 X 论证」这条结论本身是可复用的：`compat/subagent/README.md` 的 seam 退役纪律已记录同族判据——判定 seam 可退时，必须指出**是哪次架构变更消除了它的前提，以及该变更是否已落地**。

**负面与未决**

- 提案指向的第二条缺陷**仍未修复**：用户归档自己的工作会话时，该动作被 runtime 父子边劫持，代价是 locus 目录中 10 个文件 140 处 archived 特判。`resolution.ts` 的注释是最好的自述：「nothing in the runtime refuses to resume an archived Session, so without this fact an endpoint whose main session the owner archived would keep serving and the archival would silently have no effect」。对应 BACKLOG **B042**（P1，未实现）。
- 三层若将来立项，两个前置必须先解决：**B040**（provisioning 失败后同一 endpoint 永久阻塞至 Host 重启）与**持久层语义迁移能力**——`migrate-state-version.mjs` 明述 v2→v15 全部 13 次跳变都是纯加表，「No existing row is converted, cleared, or rewritten」，三层将是该 domain 史上第一次语义性数据转换。

**本轮已兑现（与三层解耦）**

- commit `cced8d72`：`.upstream/` 构建后还原，消除「把 patch 读成官方 API」的系统性误判源。
- commit `6329b209`：显式绑定 main 时校验 preset。这修掉的正是提案识别的第一条缺陷——locus child 的工具面派生自父会话已挂载的 preset，而 `resolveMainParent` 此前校验了 id、archived、非子会话、workspaceId，**唯独没有 preset**，使安全性在 bind 路径上从结构保证降级为运行时否决。**该缺陷不需要三层即可修复。**

## 待决事项（三层若要立项，须先回答）

1. **工作现场是否需要协作工具。** `assembly.ts` 的 `eligible()` 通过「有 locus 行作 parent」或「有 context 记录」判定是否安装协作面。今天 `/bind` 的用户会话天然是 parent，工具自动装上；三层下它退为弱关联，默认不再具备。这是设计选择，不是阻塞——若工作现场只是被观测对象，本就不需要。
2. **协作主的职能与 preset 边界**（理由 3 的取向选择）。这是三层唯一可能自我瓦解的地方：preset 一旦被推着变宽，子代组合源又不可控，缺陷只是换了位置。
3. **双向能力的替代**。`spec.md` 要求子会话「可通过宿主原生消息能力询问 caller-bound 主会话」，而冷读 `inspect()` 只能单向拉取**已持久化**的历史——问不了一个还没被写下来的问题。三层下子会话询问的是协作主（它不知道用户的工作），而非真正知道答案的工作现场。
4. **协作主的常驻代价**。普通会话在上游**无任何闲置驱逐机制**（`idleTimeout|evict|reclaim|ttl` 全树零命中），而 subagent child 是 idle + 空 inbox + 无子孙即自动释放。每个飞书群多一个常驻会话的代价需要量化。

## Alternatives considered

**按提案实施三层。** 未否决，但不得以本 ADR 驳回的两条理由立项；须先回答「待决事项」四条，并解决 B040 与持久层迁移能力两个前置。

**把子会话也改成普通 session（取消 subagent 边）。** 否决：`origin` 字段在 session header 上不可变且受校验，存量 child 无法原地转换；且普通会话无闲置驱逐，而 subagent child 有。此外 `hasApiSessionSubagentOwner` 的判据不止看 `origin`——只要 `parentSession` 指向的父 agent 在运行时拥有该 agent（`isOwnedBy`），同样被判归 subagent 路由，所以「不设 origin 即可被泛化路由解析」不成立。

**改走 `inject`。** 否决，三条独立理由见理由 2。

**什么都不做。** 部分否决：提案识别的两条缺陷是真的。其一已在本轮修复（`6329b209`），其二转 B042 独立处置——可订阅 `workspace-controller` 的 archived feed 解决，不需要架构改造。

**先清理 10 条 invalid locus。** 否决：它们在 `locus_indexes`（23 行）与 `locus_deliveries`（23 条）中仍被引用，手删会留下悬空索引；更重要的是 `retirement.ts` 依赖 invalid 行作为「旧模型曾绑定过」的证据，删除后那些飞书群下次 @ bot 会被当作全新入口自动建树，而不是提示所有者重建。**invalid 是设计内的退休标记，不是垃圾。**

## 一处已撤回的论据（保留以免重犯）

评审中一度认为三层与 `collaboration/caller.ts:98` 的显式不变量冲突——该行注释写着「Locus is two levels, not a nested collaboration hierarchy」，据此判定三层会让 9 个 caller-bound 协作工具全体 fail-closed，并将其列为致命阻塞。

**该论据不成立，已撤回。** 逐行复核后：`:98` 与 `:103` 两条判据查的都是 **`loci` 表内的 parent/child 关系**，而三层中协作主在该表内**只有 parent 身份、没有 child 身份**（与工作现场的关联是 Pet 自己的记录，不写入这两个字段），子会话仍是叶子。**loci 表里仍然是两层**，协作主与用户主会话是平级兄弟，多出的是一级兄弟节点而非嵌套层级。

教训：**把概念上的「层数」当成了数据模型的层数。** 「三层结构」这个名字本身带来了误导，而判据实际查询的对象没有被核对。凡是引用一条不变量来否决方案，必须读它**实际查什么**，不能停在注释的措辞上。
