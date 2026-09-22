# 批 C 核验：官方 subagent API 等价性

**状态：4/4 静态已确认。批 C 准入闸放行。**

三项误判 seam（`createIdleContinuable`、durable `toolFilter`、`contextMode:'independent-v1'`）可退回官方 API。

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
