# 批 C 核验：官方 subagent API 等价性

> ## ⚠ 本文档的第一版结论是错的，已作废
>
> 第一版写「4/4 静态已确认，三项 seam 可退回官方 API」。实施时逐条复核，
> **三项里两项被证伪，第三项拆不开**。批 C 不执行。
>
> 详见文末「实施期复核（权威结论）」。下面保留原始分析作为过程记录，
> **其中 7.1 与 7.3 的结论不成立**，不要作为依据引用。

**状态：批 C 已核验不成立，不执行。** compat 停在批 B 的成果：
1 个上游包 / 32 hunks（起点 7 包 / 72 hunks）。

## 7.1 `startContinuable({ childId })` 可用 — 静态已确认（证据强度高于预期）

### 决定性发现：Pet 自己已经在用这条路径

`src/host/locus/child.ts:957` 的 `runReservedCreate` **已经调用官方 `startContinuable` 并传入 `childId`**：

```ts
result = await this.ports.subagent.startContinuable({
  provider: input.provider ?? DEFAULT_CHILD_PROVIDER,
  label: input.label,
  ...(input.childId !== undefined ? { childId: input.childId } : {}),
  request: { prompt: [...], parent: parentResult.parent },
  settlementNotice: 'silent',
  signal,
})
```

且 `LocusSubagentPort` 的类型声明（`child.ts:70-85`）本身就把 `childId?: SessionId` 列为 `startContinuable` 的合法字段。

`prepublication-staging.ts:1-19` 的模块文档把这条流程写成了规范：

> 1. reserve a fresh, registry-generated child id and its expected composition;
> 2. **pass that exact id to `startContinuable`**;
> 3. the synchronous `agent/created` path claims the reservation once;

**结论**：`spec.childId` 不仅在官方 API 上可用，Pet 代码库里**已有一条走通的实现**。7.1 的原始疑虑（"类型支持 ≠ 该调用链无其它约束"）由此消除。

### 但生产走的是另一条路

| 路径 | 底层调用 | 生产调用点 |
|---|---|---|
| `createChild` → `runReservedCreate` | **官方 `startContinuable`** | **零调用** |
| `createIdleChild` → `runReservedIdleCreate` | patch 的 `createIdleContinuable` | `src/index.ts:1706`（唯一） |

两条路径共用同一套 `reserveCreate` 同步预留逻辑、同一套身份校验与补偿逻辑；差别只在最终调用哪个 subagent API，以及 idle 路径不提交首条 prompt。

**因此批 C 的 7.1/7.2 实施面比预想小**：不是"新写一条官方路径"，而是"让生产从 idle 路径切回已存在的 `createChild` 路径"，并把首条 Delivery 作为 `request.prompt` 传入。

## 7.2 官方 `toolFilter` 持久化 — 静态已确认

- `@deepseek-ai/dsh-subagent@0.1.2-rc.1` `lib/types/types.d.ts:139` `readonly toolFilter?: ToolRestriction`，capability 位于 `:82`。
- 同版本 `lib/types/descriptor.d.ts:78`/`:109` 持久化字段，`TOOL_FILTER_KEYS` 校验 `allow`/`deny` 必须为字符串数组。
- 0.1.5-rc.2 源码一致。

即 durable toolFilter 是官方能力，patch 中相关部分为冗余。

## 7.3 `composeFrom` bind 语义在自定义 preset 下 — 静态已确认（机制层面闭合）

官方文档（`agent-presets` `lib/types/index.d.ts:206`，0.1.2 与 0.1.5 **逐字相同**）：

> Join one agent to the SAME standing composition another already runs on. **It is a bind, not a mount**: the parent's generation is already composed, so the child gets **that exact instance** — the same plugin objects, the same tool registrations, the same prompt sections.

配套（`src/index.ts:236-238`）：

> Read per call rather than cached: … changing the default takes effect on the next session created and **leaves every running session on the preset it was composed from.**

### 机制层面的闭合（追加核验）

初判此项需运行时验证，因为 Pet 用 `dsh-pet-executor` 自定义 preset。进一步读 `agent-presets/src/mount.ts` 后可静态闭合，**且该结论与 preset 是哪一个无关**：

`composeFrom`（`index.ts:455-464`）做的唯一状态变更是：

```ts
const standing = standingMountFor(parentCtx)
if (standing === undefined) return undefined
this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key))
```

即把 child 的 scope key **parent 到那个 standing mount 的 key** 上。而 `standingMountFor`（`mount.ts:243-251`）按 `scopeParentOf(agentKey)` 去 `livePresetMounts()` 里匹配**已存在的 mount 实例**：

> The agent's own key is parented to its preset's standing key, so the mount is found by matching that parent rather than by walking up from the agent — **the mount is not under the agent's fiber**.

两个结论：

1. **child 绑的是一个具体 mount 实例的 key，不是 preset id。** 父后续 `mountPreset` 另一个 preset 会产生**新的** standing mount（新 key）；已绑定的 child 仍指向旧 mount，因此组合不变。
2. **mount 不在 agent 的 fiber 之下**（文档明述），所以父 agent 侧的组合变更不会顺着 fiber 传导到已绑定的 child。

这套机制对任何 preset 一致 —— bind 的对象是"某次 mount 产生的实例"，自定义 preset 与出厂 preset 在这一点上没有分支。故本项**不需要运行时验证**。

实施阶段仍会在 8.6 的端到端里顺带覆盖该场景（父切换 preset 后 child 工具面不变），作为回归而非准入。

## 7.4 `attestLocusComposition` 独立于 patch — 静态已确认

`src/host/locus/composition.ts:71-78` 记录的生产事故（出厂 standard preset 在 own 层注册 `subagent`，穿过 `LOCUS_SAFE_TOOL_FILTER`，子代委派给持有 `bash`/`lark-cli` 的孙代）有两点关键事实：

1. **该事故发生在 patch 已上线之后** —— 即 `independent-v1` 并未防住它；漏洞在 own 层，而 patch 改的是继承面。
2. 实际护栏是 `attestLocusComposition`（读 child 真实暴露的工具面，与 `LOCUS_SAFE_TOOL_NAMES` + `LOCUS_CALLER_BOUND_TOOLS` 比对，不符则拒绝发布 `safe-v1`）与 `dsh-pet-executor` preset，**两者都是 Pet 自有代码，不在任何 patch 内**。

**结论**：移除 `independent-v1` 不削弱该护栏。但 tasks 8.4 要求的"提交前 diff 复核这两处零改动"必须严格执行 —— 这是本批次退化风险最高的点。

## 待确认事项清单（tasks 4.b）

| 项 | 状态 |
|---|---|
| 7.1 `spec.childId` 可用 | ✅ 静态已确认（Pet 已有走通实现） |
| 7.2 官方 `toolFilter` + 持久化 | ✅ 静态已确认 |
| 7.3 `composeFrom` bind 在自定义 preset 下一致 | ✅ 静态已确认（bind 到 mount 实例 key，与 preset 身份无关） |
| 7.4 attest 独立于 patch | ✅ 静态已确认 |
| 5.1–5.4 storage 自持 | ✅ 全部实测通过（见 batch-b 文件） |

**无「阻塞」项，无「需运行时验证」项。coding 前置条件已全部满足。**

唯一剩余的判断题不属于核验范畴：`settlementNotice` 已按用户决定固定为 silent（早返回），`inject` 方案已在 design Open Questions 中排除。

## 对实施的输入

- 8.1 的实际工作是**切换生产调用点**（`src/index.ts:1706` 从 `createIdleChild` 改为 `createChild`），而非新建路径；首条 Delivery 作为 `request.prompt` 传入。
- 需确认切换后 `prepublication` 的 `claimed` 状态检查（`src/index.ts:1713`）仍成立 —— 官方 `startContinuable` 同样在返回前触发 `agent/created`，该注释已述明。
- 需保留 child 自有 title 设置逻辑（`src/index.ts:1719` 起），否则 DSH 回退标题生成器会用 caller-bound delivery header 命名，导致侧栏全是 `## 当前 unified locus 投递（caller-`。

---

# 实施期复核（权威结论）

开始实施 §8 时逐条复核，推翻了上面的静态结论。

## 8.1 `createIdleContinuable` — **不可退**

官方 `SubagentStartRequest.prompt` 是**必填**（`types.ts:149`，非可选）：

```ts
export interface SubagentStartRequest {
  readonly prompt: ContentBlock[]   // 必填
  readonly parent: Agent
}
```

而 Pet 的 locus 创建是**两阶段**的，顺序由事务决定：

```
① createChildSession → 拿到 childId（不投递任何内容）
② 建飞书群
③ commitProvisioning → 原子提交 group + locus 行
④ child.commit()     → 此刻 locus 才算发布
⑤ 之后首条真实 Delivery 才经 inbox 投递
```

在 ③ 之前 child 必须已存在但**不能开始工作**——群还没建、locus 行还没提交，
此时让 child 跑起来，它会面对一个尚不存在的协作现场。

用官方 `startContinuable` 就必须在 ① 投递一条 prompt。造一条占位 prompt 会
污染子代 transcript，而这正是当初写 idle 的理由（patch 注释原文：人造初始化
prompt 与真实工作在 child 自己的 transcript 里无法区分）。

**原核验 7.1 的缺陷**：只验证了「能指定 `childId`」，**没验证「能不能不投递内容」**。
前者成立不蕴含后者。

## 8.3 `contextMode: 'independent-v1'` — **不可退**

`composeFrom` 与 `independent-v1` 解决的不是同一个问题：

| | `composeFrom`（官方） | `independent-v1`（patch） |
|---|---|---|
| 组合来源 | **父的** standing mount 实例 | child **自己 mount 一份** |
| 依赖父存活 | 是（需要 `parent.ctx` 的活 mount） | 否（只需 preset 名字） |
| 冷恢复 | 父可能已不在或已换 preset | 按 header 记录的 preset 重建 |
| 防静默回落 | 无 | 挂错即 `throw`，不降级 |

patch 的实现（`child-agent.ts` hunk）：

```js
const mounted = await presets.mount(childCtx, agentPreset)
if (mounted.id !== agentPreset || child.session.header.agentPreset !== agentPreset) {
  throw new Error('independent subagent child preset does not match its durable header')
}
```

**原核验 7.3 的缺陷**：读到官方文档 "It is a bind, not a mount… the child gets
that exact instance" 就判定等价。那句话是对的，但它回答的是**「已存活 child
会不会被父的后续变更污染」**；locus child 冷恢复需要的是**「能否独立于父重建
自己的组合」**——后者 `composeFrom` 不提供。

## 8.2 durable `toolFilter` — **官方确有，但拆不干净**

官方 `descriptor.d.ts:78`/`:109` 确实已持久化 `toolFilter`（原核验无误）。
但在 patch 里它与 `independent-v1` 共用 descriptor **v5**——v5 这个版本号正是
为 `contextMode` 引入的。保留 8.3 就无法单独摘除 8.2 的 hunks。

## 结论与决定

三项里两项证伪、第三项耦合，**批 C 不执行**。

批 A + 批 B 已将 compat 从 **7 个上游包 / 72 hunks** 收敛到 **1 个包 / 32 hunks**，
收益的大头已经兑现。批 C 剩余收益是同一个包内的 hunks 数，而代价要触及
descriptor 版本与冷恢复语义，性价比不成立。

### 顺带否决的替代方案

曾评估「重排 provisioning 顺序」以消除 8.1 的阻碍：`childSessionId` 由
`prepublication-staging.ts:202` 自行生成，早于任何创建动作，因此 locus 行
**技术上可以**先于 child 提交。但这会把不变量从「locus 已发布 ⇒ child 一定存在」
改成「locus 已发布 ⇒ child 可能尚未创建」，影响 `agent/created` 组合时机、
`findByChildSession` 反查、崩溃恢复判据与管理面的可见状态。为同包内约 10 个
hunks 改动事务顺序与恢复语义，风险不成比例。

## 方法论教训（已写入 spec）

本次三处误判形状相同：**读了官方 API 的一半，把它当成了全部**。

讽刺的是本 change 的核心主张正是「打 patch 前必须出示官方不支持的正面证据」，
而这里犯的是它的镜像错误：**查了一半就判定可以退 patch**。

因此 `pet-compat-minimization` 增加一条要求：判定「官方已支持、可移除 seam」时，
证据必须覆盖该 seam 服务的**全部语义**，而非仅签名兼容；不能用「存在形近 API」
推定等价。
