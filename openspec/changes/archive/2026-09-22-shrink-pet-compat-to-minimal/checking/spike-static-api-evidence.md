# Spike 静态核验：官方 API 正面证据

方法：`npm pack @deepseek-ai/<pkg>@0.1.2-rc.1` 取**已发布产物**（不安装、不污染环境），读其 `lib/types/*.d.ts`；对照 `dsh-v0.1.5-rc.2` 的未打补丁源码（`compat/subagent/.upstream` 的 `git show HEAD:`）。

## 逐项证据

### 1. 调用方预留 child 身份 — 官方 0.1.2 已有

`@deepseek-ai/dsh-subagent@0.1.2-rc.1` `lib/types/continuation.d.ts:61-79`：

```ts
export interface ContinuableStartSpec {
    readonly provider: string;
    readonly label: string;
    /**
     * Optional caller-reserved child identity. Omission preserves the manager's
     * UUID allocation; supplying one lets a durable parent record provisioning
     * before child materialization without a second identity handshake.
     */
    readonly childId?: SessionId;
    ...
}
```

官方文档**逐字描述了 Pet 的用例**："让持久化的父记录能在子代实体化之前登记 provisioning，**无需二次身份握手**"。而 `createIdleContinuable`（~110 行 patch）解决的正是这个"二次握手"。

0.1.5 原版 `continuation.ts:108-109` 的实现侧确认：

```ts
const childId = spec.childId ?? brandString<SessionId>(randomUUID())
this.activations.assertChildIdAvailable(childId)
```

另有 `holdOwnership(parent, childId)`（`:134`）—— "创建期间父不得结算"这一保护官方自带。

### 2. `toolFilter` + 冷恢复持久化 — 官方 0.1.2 已有

- `lib/types/types.d.ts:82` `readonly toolFilter: boolean`（capability）
- `lib/types/types.d.ts:139` `readonly toolFilter?: ToolRestriction`（请求字段）
- `lib/types/descriptor.d.ts:78` / `:109` 持久化字段；`TOOL_FILTER_KEYS` 校验 `allow`/`deny` 必须为字符串数组，非法结构 loud fail

同级还有 `persona?: string`（`:147`）与 `agentOptions?: AgentOptions`（`:118`，含 provider/model/reasoningEffort）。

### 3. 父改 preset 不波及存活子代 — 官方 0.1.2 已有

`@deepseek-ai/dsh-agent-presets@0.1.2-rc.1` `lib/types/index.d.ts:206-215`：

> **It is a bind, not a mount**: the parent's generation is already composed, so the child gets **that exact instance** — the same plugin objects, the same tool registrations, the same prompt sections. Re-resolving the parent's preset by id instead would re-read the roster, and a composition file edited since the parent started would hand the child a **DIFFERENT generation**…

0.1.5 的同一段文档**逐字相同**（`api-catalog.ts:172` 亦复述）。

补充（`agent-presets/src/index.ts:236-238`）：

> Read per call rather than cached: … **leaves every running session on the preset it was composed from.**

### 4. `settlementNotice: 'silent'` — 官方**确实没有**（唯一真实缺口）

唯一的抑制开关是 `announced`（`continuation-activation.ts:80`），其语义（`:76-79`）：

> Whether **any delivery to this child was ever accepted**. A materialization rolled back before its first acceptance is a child the caller was told **does not exist**, so its teardown **owes the parent no settlement account**.

赋值点两处（`continuation.ts:314` / `:473`），均在 `submitAdmitted(...)` **成功之后**。

即该开关表达"这个子代从未真正存在"，而 Pet 的场景是"子代真实存在、完成了工作、只是汇报走别的渠道"。**语义不匹配，无法复用。**

投递路径（`continuation-activation.ts:823-840`）：

```ts
if (this.closingTeardownFor(parent) !== undefined) { parent.inject(message); return }
this.sendWaking(parent, message, parent.status === 'idle' ? 'queue' : 'steer')
```

父非 idle → `steer`；`steer` 文档："a running driver consumes it **at its next step boundary**"。

## 曾考虑并排除的替代方案

| 方案 | 排除理由 |
|---|---|
| 复用 `announced` | 语义是"子代不存在"，非"已汇报到别处" |
| 让父非驻留（`parent === undefined` 分支） | Pet 自己持有 live parent 引用（`child.ts:683`/`:870`）；且父是用户在用的主会话，不应被卸载 |
| `closingTeardownFor` 分支 | 条件为"父正在收尾"，长驻健康父不可达 |
| 在 `sendWaking` 拦截 | 父为普通 root agent 时 `resident.get()` 返回 undefined，直接走 `parent.steer()`，无中间对象 |
| 父侧事后清理 `subagent-settled` | steer 已在 step 边界被消费，清掉的是记录不是打断 |
| 全局把 `steer` 换成 `inject` | 二者唯一差别是 `wakeup` 标志（`agent-loop/src/agent.ts:141-148`，目标边界同为 `next-step`）；只消除唤醒，消息仍进入进行中轮次 |

## 结论

五项中 **3 项为误判**（官方 0.1.2 就有）、**1 项为架构选择失误**（storage，可插件级自持，见 batch-b）、**1 项成立**（`settlementNotice`）。

证据方法本身值得复用：**读被 patch 那个包的已发布 `.d.ts`，其文档注释常直接写明设计意图与适用场景**，比读源码更快给出答案。
