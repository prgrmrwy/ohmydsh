# DSH 0.1.5-rc.2 扩展点勘察报告

勘察对象：`packages/dsh-pet/compat/subagent/.upstream/`（DSH 0.1.5-rc.2，HEAD `fb2c4b9`）
下文路径均相对 `packages/dsh-pet/compat/subagent/.upstream/packages/`（记作 `P/`）。

---

## 0. 【必读】检出目录不是干净上游 — 官方原生 vs 本仓 patch

`.upstream/` 的工作区**已被本仓 patch 修改**，且修改状态长期保留。
`compat/subagent/build.mjs:116` 执行 `run('git', ['apply', patchFile], checkout)`，
把 `compat/subagent/settlement-notice.patch` 打进检出目录本身。

**被 patch 污染的文件（`git status --short` 实测，穷尽）**：

```
packages/subagent/subagent/src/child-agent.ts
packages/subagent/subagent/src/continuation-activation.ts
packages/subagent/subagent/src/continuation.ts
packages/subagent/subagent/src/descriptor.ts
packages/subagent/subagent/src/index.ts
packages/subagent/subagent/src/types.ts
packages/subagent/subagent/tests/{continuation,list-children,service}.spec.ts
```

**未被污染（工作区读取可信）**：`core/`、`api/`、`workspace/`、`session/`、
`session-query/`、`preset/`、`sandbox/` 等所有其余目录 —— 已用
`git status --short packages/core/ packages/api/ ...` 验证输出为空。

> 读 `packages/subagent/subagent/` 下任何文件，**必须**用 `git show HEAD:<路径>`。
> 直接读工作区会把本仓 patch 误认成官方能力。本报告作者本人先踩了这个坑。

### `settlementNotice` 是本仓 patch，不是官方能力

干净上游中该标识符出现 **0 次**：

```
$ git show HEAD:packages/subagent/subagent/src/types.ts | grep -c settlementNotice
0
$ git show HEAD:packages/subagent/subagent/src/continuation-activation.ts | grep -c settlementNotice
0
```

因此以下全部是**本仓 patch 注入**，官方并不提供：
`ContinuableStartSpec.settlementNotice`、descriptor 的 `'notify' | 'silent'` 校验与持久化、
`continuation-activation.ts` 中 `if (activation.settlementNotice === 'silent') return` 早返回、
以及 `index.ts` 中那句 "Literal proof that this runtime honors …" 能力 marker
（该 marker 正是 patch 为让 Pet 校验自身是否生效而加）。

**结论：patch #1（settlement silent）退不掉**，除非用架构手段消除其前提。

### 该 patch 的真实范围远不止 settlementNotice

`settlement-notice.patch` 共新增 617 行。按新增行统计标识符：

```
$ grep "^+" settlement-notice.patch | grep -oE "withLiveContinuableChildSession|settlementNotice|materializeForAccess|Literal proof" | sort | uniq -c
   4 Literal proof
   2 materializeForAccess
  42 settlementNotice
   6 withLiveContinuableChildSession
```

新增的公开成员（`grep "^+"` 提取 `async` / `readonly` 声明）：

| 成员 | 干净 HEAD | 工作区 |
|---|---|---|
| `withLiveContinuableChildSession` | **0 命中** | `continuation.ts:351`、`index.ts:270` |
| `materializeForAccess` | **0 命中** | `continuation.ts:388` |
| `createIdleContinuable` | **0 命中** | 3 文件 |
| `contextMode` | **0 命中** | 5 文件 |
| `supportsLiveContinuableChildSession` / `supportsIdleContinuableCreate` / `supportsIndependentContinuableCreate` / `supportsSettlementNotice` | **0 命中** | 能力 marker |

验证命令（注意用 `git grep <字符串> HEAD`，**不要**用 `git show HEAD:<file> | sed -n '行号区间'`
—— patch 会移动行号，按行号区间取出的是干净树里恰好在那个位置的**别的**内容）：

```
$ git grep -n "withLiveContinuableChildSession" HEAD -- 'packages/**/*.ts'
（无输出）
```

**干净上游 `SubagentRuntime` 的完整公开 API**（`git show HEAD:.../index.ts`）：
`startContinuable:228`、`sendMessage:246`、`interrupt:295`、`drainContinuableDescendants:309`、
`drainContinuableChildren:326`、`listChildren:349`、`listDescendants:368`、`remoteExportList:386`、
`prompt:413`、`interruptByParent:480`、`registerProvider:509`、`getProvider:532`、`list:540`、`start:556`。

→ **没有任何只读访问器。** 上游的立场不是「提供了授权通道」，而是**根本不提供**；
本仓 patch 自己造了一个。这直接影响 C11 与 F20，详见各节。

### 连带作废：一句被误引为「官方拒绝理由」的注释

`continuation.ts:344-346` 那段 "Generic Session routing **intentionally** cannot resolve a
continuation-owned child…" —— **是 patch 新增的 JSDoc，不是上游表态**：

```
$ git grep -n "Residency is deliberately\|intentionally cannot resolve" HEAD -- 'packages/**/*.ts'
（无输出）
```

同理，E 章调研中引用的 "Measured: two settlements after one restart injected four events
into the parent session a human was using" 也是 patch 内容，干净 HEAD 0 命中。

**但 README 未被 patch**（`git status --short .../README.md` 输出为空），
其 `## Known Limitations` 的 4 条（`:174-177`）是**真实上游内容**，可采信。

---

## A. 创建与组合会话

### A1. `CreateAgentOptions` 完整字段 — `P/core/agent/src/index.ts:62-119`（官方原生）

| 字段 | 行号 | 语义 |
|---|---|---|
| `sessionId: SessionId` | `:64` | 调用方提供的唯一 live agent/session 身份 |
| `parentAgent?: Agent` | `:66` | **运行时**父 Agent；省略即 root。注意这是 runtime ownership，与 durable lineage 无关 |
| `meta?` | `:78-85` | 见下 |
| `inheritedEventCount?` | `:87` | `meta.isSeeded` 时的 fork 前缀精确长度 |
| `seed?: readonly SessionEvent[]` | `:95` | 初始 replay/fork 历史，须从 seq 0 连续、无未闭合 turn/step、无悬挂 tool call |
| `agentOptions?: AgentOptions` | `:97` | provider / model / reasoningEffort / maxTokens（`P/core/agent/src/runtime-types.ts:26-35`） |
| `signal?: AbortSignal` | `:99` | 仅创建期；handle 可见前即 detach |
| `setup?: AgentSetup` | `:118` | 见 A2 |

`meta` 子字段（`:78-85`）：`cwd?` / `parentSession?` / `isSeeded?` / `origin?: 'subagent'` /
`delegationDepth?` / `agentPreset?`。注释（`:71-76`）明确：

> "Mirrors the `cwd`/`parentSession`/`isSeeded`/`origin`/`delegationDepth` fields of
> `CreateSessionOptions.meta` … (the internal-only `createdAt` … is deliberately
> excluded — a factory caller never sets it). This is durable session data, so the
> session boundary validates and snapshots it before asynchronous setup begins."

`ResumeAgentOptions`（`:125-144`）字段更少：`resumeSessionId` / `parentAgent?` /
`agentOptions?` / `signal?` / `setup?` —— **没有 `meta`**，即 resume 不能改 header。

### A2. `setup(agentCtx, agent)` 契约 — `P/core/agent/src/index.ts:100-118`（官方原生）

执行时机（`:101-112`）：factory 铸出 `agentCtx` 之后、**插入并公告 session 与 agent 之前**。

> "Everything registered through `agentCtx` (scoped tools, prompt sections/variables,
> `restrict()`, listeners, awaited child plugins) exists before `session/created`,
> `agent/created`, `agent/session-start`, and the first prompt assembly."

**能做**：scoped 工具注册、prompt section/variable、`tools.restrict()`、监听器、
await 子插件、preset mount。
**不能做**：驱动 agent。契约原文（`:114-116`）：

> "**Setup composes, it never drives**: the callback is trusted same-process code and
> receives the full scoped context, so this is a **contract rather than a runtime
> restriction**. Drive the agent only after creation resolves."

即：这是**约定而非强制** —— 没有运行时拦截，违约不会报错。

抛错后果（`:111-112`）：setup throw/reject、commit throw、owner disposal
**回滚整个事务，两个 id 都不公开**。可返回 `AgentSetupCommit`（`:36-42`），其同步
`commit()` 在所有 await 结算后、publication 前调用，用于在精确提交点复验。

已公告再失败的补偿（`:176-181`）："every agent or session creation announcement that
began is paired by `agent/disposed` or `session/disposed` during rollback."

### A3. 创建时挂载 agent preset（官方原生）

`meta.agentPreset` **只是 durable 记录，不执行挂载**。真正挂载靠 setup 里调
`agentPresets.mount(agentCtx, id)`。官方模板 `P/api/session-controller/src/agent.ts:374-390`：

```ts
async composeAgent(presetId: string | undefined): Promise<{ agentPreset?: string; setup: AgentSetup }> {
  const presets = this.ctx.get('agentPresets')
  if (presets === undefined) return { setup: (_agentCtx, agent) => { this.installSelection(agent) } }
  const resolvedId = (await presets.resolve(presetId)).id
  return {
    agentPreset: resolvedId,
    setup: async (agentCtx, agent) => { this.installSelection(agent); await presets.mount(agentCtx, resolvedId) },
  }
}
```

调用点 `:479-487` 把 `composition.agentPreset` 写进 `meta`、`composition.setup` 传给 `setup`
—— **两者必须由调用方自己配对**，运行时不代劳。

`mount()` — `P/preset/agent-presets/src/index.ts:414-427`：解析 preset → 确保 standing mount →
`bindScopeParent(agentKey, standing.key)`。要求 `agentCtx` 必须有 scope（`:416-418`）：
> "refusing to compose an unscoped context; the scope key is what joins an agent to its preset"

`composeFrom(agentCtx, parentCtx)` — `:455-464`，**子 agent 继承父能力的官方方式**，同步、
无 IO、无失败模式。注释（`:434-439`）解释为什么不是按 id 重新 mount：

> "It is a bind, not a mount: the parent's generation is already composed, so the child
> gets that exact instance … Re-resolving the parent's preset by id instead would re-read
> the roster, and a composition file edited since the parent started would hand the child a
> DIFFERENT generation than the one its parent's history was produced under."

未挂 preset 的代价 — `:215-223` 是**告警而非致命**（注释 `:203-206` 说明为何不能 veto：
同步 `agent/created` listener 抛错会否决 publication，而裸 agent 是合法的）：
> "its tools, prompt sections, and skill catalog resolve against the empty global layer"

权威真相源是 **`agentPreset` projection 而非 header** —— `P/preset/agent-presets/src/session.ts:12-13`：
> "Reconstruction reads the `agentPreset` Session projection, never the header alone."

因为 blank 会话可改 preset 并记 `agent-preset/selected` 事件（`:22-28`）。

### A4. `ctx.tools.restrict()` 确切语义 — `P/core/tools/src/index.ts:1061-1088`（官方原生）

**scope 要求**（`:1062-1065`）—— 必须在 agent scope 下调用：
```ts
throw new Error('tools.restrict() requires a scoped context (agent.ctx): a context-global
  restriction would mask every agent — deny the tool for the intended agent instead')
```

其余校验：空 filter 拒绝（`:1068-1070`，理由 "an empty filter is almost always a
materialized-empty-config bug"）；不得命名 `run_code`（`:1075-1077`）；不得命名未知全局工具（`:1078-1082`）。

**约束哪一层** — `:1127-1132` 是关键：

> "A restriction filters what a scope inherits — the global layer and every ancestor layer
> on its chain — and **never what its OWN layer registers**. That exemption is what a
> per-child capability filter has to keep intact: the delegation runtime registers a
> child's structured-output tool into the child's own layer, and a filter naming the
> capabilities the child may use must not strip the machinery it answers through."

**无法被约束的工具**（穷尽）：
1. **本 scope 自己注册的工具** —— `view()` 实现 `:1168-1173`，`own` 层在 filter 之外。
2. **`run_code`（PTC 传输）** —— `:1174-1181`，"Presentation infrastructure is resolved
   last and outside capability filtering"；且 `restrict()` 显式拒绝命名它（`:1075-1077`）。

多层求交：`:1162-1164` "Restrictions intersect across the whole chain: any scope on it may
mask an inherited name for everything nested inside it."

历史教训（`:1134-1138`）——preset 把工具移到 agent 平面后，"a child's filter silently
stopped constraining anything it was given"，因为豁免集被误读成「全局层」而非「非我层」。

### A5. `SessionHeader` 字段与校验 — `P/core/session/src/types.ts:93-130`（官方原生）

**整个 header 不可变**：`P/core/session/src/index.ts:133` `return deepFreeze(...)`；
`Session.header` 声明为 `readonly`（`P/core/session/src/index.ts:464`），注释（`:456-462`）：
> "Detached, deep-frozen creation metadata … Kept out of the event log — it is a storage
> concern, not replayable conversation state."

校验规则全部在 `validateSessionHeader`，`P/core/session/src/index.ts:92-134`：

| 字段 | 校验行号 | 规则 |
|---|---|---|
| `version` | `:100-102` | 必须 `=== SESSION_FORMAT_VERSION`（当前 `3`，`types.ts:88`） |
| `id` | `:103-105` | 必须与 session id 相等 |
| `createdAt` | `:106-110` | 非负 safe integer |
| `cwd?` | `:111-116` | string 且 **`isAbsolute()`** — 相对路径直接抛错 |
| `parentSession?` | `:117-119` | string |
| `isSeeded` | `:120-122` | **必填** boolean |
| `origin?` | `:123-125` | **只能是 `'subagent'`**，无其它取值 |
| `delegationDepth?` | `:126-129` | 非负 safe integer |
| `agentPreset?` | `:130-132` | string |
| `seedLength` | `:97-99` | 存在即抛错（历史字段禁用） |

各字段语义要点：
- `origin`（`types.ts:112-116`）："Coarse product classification … This is **presentation
  metadata, not proof that the child is continuable**."
- `delegationDepth`（`:117-122`）："Persisted so a recursion budget survives restart and
  resume — a runtime-only depth would reset a resumed child to top-level." 读取逻辑
  `P/subagent/subagent/src/depth.ts:28-36`：取 `max(header, runtime)`，运行时只能**加深不能降低**。
- `agentPreset`（`:123-129`）："Durable because the preset decides the session's tools and
  prompt: a resume that restored a different composition would replay history the model
  can no longer act on."

**可变性总结**：header 字段**创建时一次写定，之后全部不可变**（deep-frozen）。
唯一可事后改变的是「会话实际运行的 preset」，但那走 `agent-preset/selected` 事件 +
projection，**不改 header**。

---

## B. 会话之间的关系

### B6. 官方表达「会话 A 与 B 有关系」的机制（穷尽，均官方原生）

| # | 机制 | 位置 | 语义 | 持久? |
|---|---|---|---|---|
| 1 | `header.parentSession` | `types.ts:105-106` | **fork/seed 血缘**："The session this one was forked from (seed lineage)" | 是 |
| 2 | `header.origin: 'subagent'` | `types.ts:112-116` | 粗粒度产品分类，**非能力证明** | 是 |
| 3 | `header.delegationDepth` | `types.ts:117-122` | 递归预算 | 是 |
| 4 | subagent descriptor | `P/subagent/subagent/src/descriptor.ts` | **mode/continuation 能力的权威**（见下） | 是（事件） |
| 5 | Agent registry runtime ownership | `P/core/agent/src/index.ts:214-215`, `458-470`, `579-580` | `entry.owner`；`isOwnedBy(id, owner)`。注释 `:214`："Runtime creator-agent ownership; **independent of durable session lineage**" | **否（纯内存）** |
| 6 | Workspace `sessionIds` | `P/workspace/workspace/src/spec.ts:25` | 目录归属账本，数组序即显示序 | 是 |
| 7 | Session projection | `P/session/session-projection/src/index.ts:233-291` | 按 key 从事件折叠出派生状态 | 是（可重放） |
| 8 | scope 父子绑定 | `P/core/scope/src/index.ts:72` `bindScopeParent` | 工具/prompt 的继承链；由 agent-presets 独占持有（`preset/.../index.ts:393-399`） | 否 |

**权威分工**（重要）：`origin` 只做导航分类，真正的 mode/能力判定在 descriptor。
`P/subagent/subagent/src/child-agent.ts`（干净版同段）注释：
> "Navigation classification only; the descriptor remains the authority for mode and
> continuation capability."

### B7. `header.origin === 'subagent'` 全树使用点（穷尽，`git grep` 于干净树）

**Host 侧（官方原生，未被 patch）**：

| 位置 | 后果 |
|---|---|
| `P/core/session/src/index.ts:123` | header 校验：只允许 `'subagent'` 或 undefined |
| `P/api/session-controller/src/agent.ts:85` | **`hasApiSessionSubagentOwner()` 第一判据 → 泛化 Session 路由全线拒绝** |
| `P/api/session-controller/src/history.ts:339-343` | 以 `kind:'session'` 地址访问 subagent 会话 → 抛 `session/agent-busy`，`'subagent Sessions require their durable parent address'` |
| `P/api/session-controller/src/history.ts:346-350` | 父子地址不匹配 → `subagent/unauthorized` |
| `P/api/session-controller/src/commands.ts:553` | fork 时回溯祖先找 workspace |
| `P/acp/acp/src/index.ts:249-251` | ACP `session/resume` **拒绝**：`'session is not resumable'` |
| `P/acp/acp/src/index.ts:309` | ACP `listSessions` **过滤掉** |
| `P/client/file-upload/src/index.ts:232-238` | **拒绝文件上传**：`'subagent conversations do not accept file uploads'` |
| `P/session/session-persistence-jsonl/src/format.ts:181` | 持久化格式识别 |
| `P/client/ui-workspace/src/client/tree.ts:146` | **UI 树中不可见**（`sessionVisible` 返回 false） |
| `P/client/ui-{subagent,workspace}/src/client/subagent-lineage.ts:29,32` | 走父 header 目录重建血缘 |
| `P/api/session-controller/src/client/sessions/{manager,service}.ts:719,734,617,626` | 客户端按 subagent 传输路由 |

**subagent 包内（已被 patch 触及的文件，但这些行经 `git show HEAD:` 复核为官方原生）**：
`list-children.ts:91,189,275`（枚举直接子会话时的判据）、`control-types.ts:25,47`
（"Only a candidate whose durable header has `origin: 'subagent'` is interpreted"）、
`tool-subagent/src/index.ts:625`。

**`hasApiSessionSubagentOwner` 的把守面**（`P/api/session-controller/src/agent.ts`）：
`liveAgent():395`、`resolve():190,211`、`resumeObserved():421,427`、
`createOrAdopt():445,453`、`ensureSession():259,244,250`。
统一失败为 `:97-103`：
```ts
return new RemoteError('session/agent-busy', `session "${sessionId}" is owned by subagent routing`,
  { reason: 'use subagent delivery for this child session' })
```

### B8. 插件自行维护关联 — 官方推荐机制（均官方原生）

**（a）`ctx.storageDomain` — 官方持久化扩展点。**
`P/storage/storage-domain/src/index.ts:103` `async open<S extends DomainSpec>(spec: S): Promise<Domain<S>>`。
官方自用范例即 workspace 本身：`P/workspace/workspace/src/spec.ts:68-76` `defineDomain({name, version, global, tables})`。
提供 zod 校验的 table + global singleton、版本号、以及两写事务的 `pendingMutation` 恢复标记（`spec.ts:33-41`）。
**这是插件存「IM 群 ↔ 会话树」映射的官方位置。**

**（b）`domain/changed` 事件 — 官方变更订阅。**
`P/storage/storage-domain/src/events.ts:37-47`：
> "A domain record or the global singleton changed, emitted once per write **strictly
> after the backend acknowledged durability**. Events of one domain arrive in its
> write-chain order."

官方消费范例 `P/api/workspace-controller/src/feed.ts:59` `ctx.on('domain/changed', ...)`。

**（c）Session projection — 官方「从会话日志派生状态」扩展点。**
`P/session/session-projection/src/index.ts:233-291` `register(definition)`，返回 disposer。
范例见 `P/preset/agent-presets/src/session.ts:35-44`。
注意共享 key 计数语义（`:194-199`）：N 个 preset 注册同一 key 即计数 N，最后一个卸载才消失。

**结论：官方明确支持插件自持关联**，提供了持久化（storageDomain）、变更推送（`domain/changed`）
和日志派生（projection）三件套。官方**未**提供的是「会话↔外部实体」的现成关联表 —— 需自建 domain。

---

## C. 读取与观测（不唤醒 / 不占槽位 / 不消耗轮次）

### C9. 可用的只读 API（均官方原生）

**（1）`ctx.sessionQuery.observeSession(id, options)` — 主力 API。**
`P/session-query/session-query/src/index.ts:139-144`：
```ts
observeSession(sessionId: SessionId, options: SessionObservationOptions = {}): Promise<SessionObservation>
```
返回 `SessionObservation`（`P/session-query/session-query/src/observation.ts:17-41`），是
`Disposable` 租约，字段：`source: 'live'|'prepared'`、`header`、`inheritedEventCount`、
`events`、`cursor`、`revision?`、`projections?`、`retain()`。

**不唤醒的确切保证** —— `observation.ts:61-62`：
> "Unpublished Session restored from the balanced log; **never entered into the store**."

即冷读构造的是**未发布 Session**，不进 store、不建 Agent、不占运行槽、不消耗轮次。
`:26-27` 另有零拷贝保证："a consumer that reads only the header, cursor, or projections
never copies the log."

选项（`:44-49`）：`signal?`、`projectionMode?: 'all' | 'none'`。
缓存语义（`:69-78`）：按 session id + persistence 实例 + `stat` revision 缓存；
LRU 有界；**活跃租约 pin 住的条目不被驱逐**，"a lease's cut stays valid for the lease
lifetime even after a newer revision lands"。

→ **header（含 cwd）、已持久化消息内容、projection 快照，一次调用全拿到。**

**（2）`sessionController.inspect()` → `inspectApiSession()`。**
`P/api/session-controller/src/agent.ts:112-137`，是 (1) 的薄封装：
```ts
using observation = await ctx.sessionQuery.observeSession(sessionId, { ...signal, projectionMode: 'none' })
if (observation.header.cwd === undefined) throw new ApiSessionNotFound(...)
return { meta: observation.header, inheritedEventCount: ..., events: [...observation.events] }
```

**（3）标题。** `P/session-query/session-query/src/index.ts:218,231,249`：
`readTitle()` / `readTitleSnapshot()` / `readTitleSnapshots()`。
标题真相是日志事件 `session/title`（`P/session/session-title/src/index.ts:77`）+
projection（`:268`）；`:283` 取 `events.findLast(e => e.type === 'session/title')`。

**（4）其它只读。** 同文件：`readSession():183`（含 replay 校验）、`listSessions():173`、
`listEvents():267`、`filterEvents():278`、`readSurface():308`、`traceSession():325`（血缘）、
`traceEvent():338`、`readEvent():353`。

**（5）纯内存读 live session。** `ctx.sessions.get(id)` → `session.header` / `snapshotEvents()`，
官方用法见 `P/api/session-controller/src/commands.ts:542-545`。不唤醒，但只对已 attach 的会话有效。

### C10. `inspect()` vs `observeSession()`

| | `inspect()` / `inspectApiSession` | `observeSession()` |
|---|---|---|
| 位置 | `agent.ts:112-137` | `session-query/src/index.ts:139-144` |
| 层次 | Host API（RemoteError 域） | 底层 service |
| projection | 硬编码 `'none'`（`:120`） | 调用方选 `'all'｜'none'` |
| 返回 | 普通对象 `{meta, inheritedEventCount, events}`，**events 已复制** | `Disposable` 租约，**需 `using` / `dispose()`** |
| `cwd === undefined` | **视为 not-found 抛错**（`:122-124`） | 原样返回 |
| 失败模式 | `SESSION_QUERY_SESSION_NOT_FOUND` → 翻译成 `ApiSessionNotFound`（`:130-135`）；其余原样抛 | 抛 `SessionQueryError` |

关键差异：`inspect()` 把「无 cwd」也判为 not-found，而 `observeSession()` 不会 ——
若需观测无 cwd 的会话，必须用后者。

### C11. `sessionController.resolveAgent()`

`P/api/session-controller/src/agent.ts:170-172` → `resolve():183-222`：

1. `:187-188` 查 live agent（`liveAgent()`，其中 `:395` 做 subagent 归属检查）。
2. `:189-192` 查已 attach session；若 `hasApiSessionSubagentOwner` 为真 → **直接失败**。
3. `:194-198` 按 sessionId 去重并发 resume。
4. `:200-221` 失败分类：`ApiSessionNotFound` → `session/not-found`；
   `ApiSessionSubagentOwnership` → `session/agent-busy`；否则竞态复查后 → `gateway/internal`。

`resume():400-412` → `resumeObserved():414-435`：
- `:418-420` header id 不符或 **无 cwd** → not-found
- `:421-423` **`hasApiSessionSubagentOwner` → 抛 `ApiSessionSubagentOwnership`**
- `:424` `composeAgent(this.presetForObservation(observation))` —— 从 **projection** 读 preset
  （`:504-509`；`:505-507` 若无 projection 直接抛 `'Agent activation requires a projected Session observation'`）
- `:430-434` 调 `ctx.agents.resume({resumeSessionId, agentOptions, setup: composition.setup})`

**对 `origin === 'subagent'` 的处理：有显式拒绝。** 判据 `:80-90`：
```ts
export function hasApiSessionSubagentOwner(ctx, session, agent): boolean {
  if (session.header.origin === 'subagent') return true       // :85
  const parentId = session.header.parentSession
  if (parentId === undefined || agent === undefined) return false
  const parent = ctx.agents.get(parentId)
  return parent !== undefined && ctx.agents.isOwnedBy(agent.id, parent)   // :89
}
```
注意 `:86-89`：即使 `origin` 未设，只要 `parentSession` 指向的父 agent **运行时拥有**该 agent，
同样被判为 subagent 路由所有。

**关于「拒绝理由」—— 上游没有写过任何理由。**

`continuation.ts:344-346` 那段 "Generic Session routing **intentionally** cannot resolve a
continuation-owned child…" 读起来像上游表态，**但它是 patch 新增的 JSDoc**：

```
$ git grep -n "intentionally cannot resolve\|Residency is deliberately" HEAD -- 'packages/**/*.ts'
（无输出）
```

同样，`withLiveContinuableChildSession()` 与 `materializeForAccess()` **在干净上游全树 0 命中**，
是 patch 新增的成员（见第 0 节）。干净上游 `SubagentRuntime` 的 14 个公开方法里
**没有任何只读访问器**。

因此准确表述是：
- **官方确实拒绝**泛化 Session 路由解析 subagent child —— 判据 `agent.ts:85` 是原生的（该包未被 patch）；
- **但官方没有给出任何替代授权通道**，也没有解释为什么。「上游提供了授权通道」是本仓 patch 造成的错觉。

**读取子会话转录的官方原生办法：`ctx.sessionQuery.observeSession(childId)`。**
`session-query` 包**未被 patch**，且其中**没有任何 origin/subagent 门禁**：

```
$ grep -rn "origin" packages/session-query/session-query/src/*.ts
（无输出 —— 无门禁）
```

即 C9 的只读观测对 subagent child **同样有效**，且是官方原生、不唤醒、不建 Agent、不占运行槽。

对比之下，patch 出来的 `withLiveContinuableChildSession()` 走 `materializeForAccess()`
会**冷恢复**该子会话，**建立 Agent、占运行槽位**（只是不注入消息）。
**纯只读观测应当用 `observeSession()`，而不是那条路径。**

**preset 与工具是否完整**：完整，但**责任在调用方**。`ctx.agents.resume()` 本身
（`P/core/agent/src/index.ts:407-413`）只做持久化加载 + 调用 `setup`，**不挂任何 preset**。
preset/工具/model selection 全部由 `composeAgent()` 构造的 setup 完成
（`agent.ts:374-390`）。裸调 `ctx.agents.resume()` 而不传等价 setup，会得到一个
「tools、prompt sections、skill catalog 全部解析到空全局层」的会话
（告警见 `P/preset/agent-presets/src/index.ts:218-222`）。

---

## D. 消息投递与打断

### D12. 三个原语 + 底层 `send` — `P/core/agent-loop/src/agent.ts:128-147`（官方原生，已 `git show HEAD:` 复核）

```ts
send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
  const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
  const resolvedTarget = wakingAfterAbort ? 'next-turn' : target
  this.inbox.splice(resolvedTarget, Infinity, 0, [message])
  if (wakeup) this.wakeDriver(wakingAfterAbort)
}
followup(input) { this.send(input, 'next-turn', true)  }   // :137-139
steer(input)    { this.send(input, 'next-step', true)  }   // :141-143
inject(input)   { this.send(input, 'next-step', false) }   // :145-147
```

接口声明与完整契约在 `P/core/agent/src/runtime-types.ts:215/222/231/241`（`Agent` 接口的
declaration merging，**全部是公开 API**）：

| 原语 | 行号 | target | wakeup | 消费时机 | 打断当前轮? | 唤醒 idle? |
|---|---|---|---|---|---|---|
| `followup` | `:222` | next-turn | **true** | 独占自己的一轮 | 否（排队） | **是** |
| `steer` | `:231` | next-step | **true** | **当前轮最近 step 边界** | **是** | **是** |
| `inject` | `:241` | next-step | **false** | 最近的后续 pre-step | 否 | **否** |
| `send` | `:215` | 调用方指定 | 调用方指定 | 同上 | 取决于参数 | 取决于参数 |

契约原文：
- `followup`（`:218-221`）："Queue an ordinary follow-up turn and wake the driver. The item
  becomes the sole ordinary message of its own turn."
- `steer`（`:224-230`）："Submit steering for the nearest step. An idle driver starts a turn;
  a running driver consumes it at its next step boundary. A rejected step leaves steering
  parked in the inbox until the next wake; cancellation or disposal may discard pending steering."
- `inject`（`:233-240`）："Queue model-facing context for the next pre-step **without waking
  the driver**. A running driver claims it at the nearest later step boundary; **idle drivers
  leave it pending until follow-up or steering wakes them**. It may miss a request whose
  pre-step already claimed its batch. Cancellation or disposal may discard pending context."

`send` 的边界语义（`:204-214`）："Waking input submitted after active cancellation is queued
for the next turn … A wake submitted while already idle always opens its turn boundary, even
when its message is cleared before the driver claims (cancel-convergence wake latch)."

Inbox 两条队列定义：`P/core/agent/src/runtime-types.ts:48-52` `nextTurn` / `nextStep`。

**谁能调用**：`Agent` 接口上的公开方法，**无 scope 校验、无 ownership 校验、无调用方限制**
（见 D14）。

### D13. `notifySettlement` —— 官方原生版本

干净上游 `git show HEAD:packages/subagent/subagent/src/continuation-activation.ts`，
`notifySettlement` 位于 **`:823`**（工作区因 patch 偏移到 `:855`）：

```ts
/** Tell the durable direct parent how this Activation ended. */
private notifySettlement(activation: Activation, terminal: ActivationTerminal): void {
  if (!activation.announced) return
  try {
    const parent = this.ctx.agents.get(activation.parentSession)
    if (parent === undefined) return
    const message = createSettlementMessage(activation.childId, terminal)
    if (this.closingTeardownFor(parent) !== undefined) {
      parent.inject(message)                                              // 父正在拆除 → inject
      return
    }
    this.sendWaking(parent, message, parent.status === 'idle' ? 'queue' : 'steer')   // :833
  } catch (error: unknown) {
    this.ctx.logger.warn(`subagent "${activation.childId}" settlement notice was not delivered to its parent: ` + errorChain(error))
  }
}
```

**投递条件**：仅当 `activation.announced` 为真；父 agent 仍 live。
**投递内容**：`createSettlementMessage(childId, terminal)`。
**路径选择（`:833`）**：父 `idle` → `'queue'`；**父非 idle → `'steer'`，即插进父当前轮次**。
唯一例外是父正在 closing teardown → 用 `inject`。

`sendWaking` — `:308-...`（干净版行号）：优先走父自己的 Activation inbox；
否则 `delivery === 'steer' ? parent.steer(message) : parent.followup(message)`。

调用点：`:816` `this.notifySettlement(activation, activation.observer.terminal(failure))`，
发生在 activation 拆除流程中（`finishDisposal`）。

**官方有无抑制开关：没有。** 干净上游中 `settlementNotice` 出现 0 次。
本仓 patch 加入的 `'silent'` 早返回是私有能力（见第 0 节）。

### D14. 「保证不打断当前工作」的官方路径 —— **有：`agent.inject()`**

**是公开 API**：声明在 `Agent` 接口上（`P/core/agent/src/runtime-types.ts:241`），
通过 `declare module './types.ts'` 合并（`:163-164`）。任何持有 `Agent` 引用的代码都能调。

**无任何调用方限制**：实现 `P/core/agent-loop/src/agent.ts:145-147` 只有一行
`this.send(input, 'next-step', false)` —— **无 scope 校验、无 ownership 校验、无 initiator 校验**。
对比 `tools.restrict()`（`P/core/tools/src/index.ts:1062-1065` 强制要求 agent scope）
和 `subagents.sendMessage()`（干净版 `index.ts:246`，强制 adjacency 校验），
`inject()` **刻意没有**这类把关。

**不打断的保证由哪段代码给出**：`send()` 中 `if (wakeup) this.wakeDriver(...)`
（`agent.ts:134`）。`inject` 传 `wakeup: false`，**该分支根本不执行** —— 不存在唤醒路径。
消息只落进 `inbox.nextStep`，等驱动自己走到下一个 pre-step 才认领。

**官方 Host 插件的现成范例**（这正是官方推荐姿势）
—— `P/jobs/tool-jobs/src/index.ts:278-299`：
```ts
ctx.jobs.onJobDone((snapshot, owner) => {
  if (snapshot.reported || owner === undefined) return
  const message = createUserMessage({
    content: [{ type: 'text', text: fitCompletionNotice(snapshot) }],
    source: { kind: 'plugin', plugin: 'tool-jobs', form: 'notice', summary: completionSummary(snapshot) },
  })
  const spent = spentWakes.get(owner) ?? 0
  if (delivery === 'wakeup' && owner.status === 'idle' && spent < wakeBudget) {
    spentWakes.set(owner, spent + 1); owner.followup(message); return    // 仅 idle 才唤醒，且有预算
  }
  owner.inject(message)                                                   // 默认：绝不打断
})
```
其它官方调用点：`P/hooks/hooks-claude-code/src/index.ts:209,286`、
`P/hooks/hooks-codex/src/index.ts:191`、`P/interaction/user-approval/src/index.ts:180`、
`P/plan/plan-mode/src/index.ts:430`、`P/extensions/cordis-host-runner/src/index.ts:1153`。

消息构造：`createUserMessage()` — `P/llm/llm/src/message.ts:204`。
插件来源类型 `{ kind: 'plugin'; plugin: string } & ContextFormed` — `:104`。
`form: 'notice'` 的 `summary` 有 120 字符上界（`:114` `CONTEXT_SUMMARY_MAX_CHARS`，
`:121-125` `boundContextSummary()`）。

**必须接受的三条代价**（官方明写，`runtime-types.ts:233-240`）：
1. idle 会话**不会被唤醒** —— 消息悬挂到有人 `followup`/`steer` 为止；
2. **可能错过**已认领批次的那次请求（"It may miss a request whose pre-step already claimed its batch"）；
3. cancellation 或 disposal **可能丢弃**待处理的注入内容。

> 即：`inject()` 保证「不打断」，但**不保证送达**。需要必达时只能 `followup()`（会开新一轮，
> 但在**对方自己的**会话里开，不插入他人正在进行的轮次）。

---

## E. 生命周期

### E15. `workspaceRegistry.archiveSession()` — `P/workspace/workspace/src/index.ts:243-254`（官方原生）

```ts
archiveSession(sessionId: SessionId): Promise<void> {
  return this.enqueueOperation(async () => {
    // The chain slot serializes against every other registry write, so this
    // check-then-write pair cannot interleave with another archive.
    if (this.requireState().archivedSessionIds.includes(sessionId)) return   // 幂等
    if (!(await this.sessionKnown(sessionId))) throw new WorkspaceUnknownSessionError(sessionId)
    const state = this.requireState()
    await this.setState({ ...state, archivedSessionIds: [...state.archivedSessionIds, sessionId] })
  })
}
```

**实际做的事**：仅把 id 追加进 domain global 的 `archivedSessionIds` 数组。
**没有级联** —— `git grep archivedSessionIds` 全树无任何按 parentSession 展开的逻辑。
归档一个会话对其子会话**零影响**。

**不影响账本**（`:226-229`）：
> "Archiving never touches workspace accounting — an archived session keeps its
> `sessionIds` slot so unarchiving restores its position."

**不删数据**：`delete()` 的注释（`:190-192`）"Delete one workspace registration while
retaining its directory and every session log"，archive 更轻。归档后
`observeSession()` / `resolveAgent()` 全部照常可用 —— 归档只是**显示层过滤**
（`P/client/ui-workspace/src/client/tree.ts:146-148`）。

**`sessionKnown()`（`:262-267`）**：live → header 索引 → 重新列举持久化。
注释 `:257-260`："Only a definite miss returns false — a failing `sessionPersistence.list()`
propagates so storage faults never masquerade as an unknown session."

**unarchive：源码中未找到实现。** 全树 `grep -rn "unarchive\|Unarchive"` 无结果。
但 schema 注释（`spec.ts:48`）和 UI 注释（`tree.ts` 及 `index.ts:229`）**反复提到
"unarchiving must restore the position"**，说明这是已规划、未实现的能力。
→ **官方未表态/需自行实现**（可直接写 domain state，但没有官方方法）。

### E16. 可订阅的事件与 feed（穷尽，官方原生）

**归档/取消归档**：**没有专用事件**。唯一通路是 `domain/changed`
（`P/storage/storage-domain/src/events.ts:37-47`），按 `change.domain === 'workspace'` 且
`change.table === ''`（global singleton）过滤。官方消费范例
`P/api/workspace-controller/src/feed.ts:95-118`：
```ts
private changed(change: DomainChanged): void {
  if (change.domain !== 'workspace') return
  if (change.table === '') {
    if (change.operation !== 'put') return
    const state = workspaceDomainState.parse(change.value)
    ...
    const nextArchived = state.archivedSessionIds.map(String)
    if (!sameStrings(this.archived, nextArchived)) {
      this.archived = nextArchived
      this.publish({ type: 'archived', archivedSessionIds: [...state.archivedSessionIds] })   // :116
    }
```
另有 Host API 侧 feed：`WorkspaceFollowIncrement` 含
`{ type: 'archived'; archivedSessionIds }`（`P/api/workspace-controller/src/types.ts:123`），
`follow(signal)` 产出 baseline + 增量（`feed.ts:82-93`）。

**标题变更**：无专用 cordis 事件。真相是日志事件 `session/title`
（`P/session/session-title/src/index.ts:77`），订阅 `session/event` 并按
`event.type === 'session/title'` 过滤。

**Session 事件**（`P/core/session/src/index.ts:38-82`）：
| 事件 | 行号 | mode | 要点 |
|---|---|---|---|
| `session/created` | `:49` | emit | 同步抛错**否决**并回滚 |
| `session/disposed` | `:59` | emit | 含 publication rollback |
| `session/event` | `:71` | emit | **post-commit 追加流**；监听器失败被容纳，不影响已提交追加 |
| `session/flush` | `:80` | parallel | await 全部监听器，无 veto |

**Agent 事件**（`P/core/agent/src/runtime-types.ts:246-404`）：
`agent/created`(`:258`)、`agent/disposed`(`:267`)、`agent/status`(`:277`)、
`agent/inbox/{inserted,claimed,discarded}`(`:285,296,304`)、`agent/session-start`(`:316`)、
`agent/pre-step`(`:330`, waterfall)、`agent/request`(`:347`, waterfall)、
`agent/request-error`(`:363`, waterfall)、`agent/assistant-stream`(`:373`)、
`agent/turn-stopping`(`:391`, serial)、`agent/error`(`:403`)。

**preset 事件**：`agent-preset/selected'(sessionId, agentPreset)` —
`P/preset/agent-presets/src/types.ts:81`，发射点 `index.ts:227-230`。
注释 `:225-226`："The durable record is the commit point. Its public notification carries
only the stable identity needed by clients, never the live Session."

**subagent 事件**（`P/subagent/subagent/src/index.ts:140-173`）：
`subagent/provider-added`(`:146`)、`subagent/provider-removed`(`:152`)、
`subagent/start`(`:163`)、`subagent/end`(`:172`)。后两者 scope-filtered，
"keys the carrier by the delegating parent, so a parent-scoped listener observes only its
own delegations."

**归档订阅的精确形态**：`archiveSession` → `setState` → `DomainGlobal.set` →
`P/storage/storage-domain/src/domain.ts:197`：
```ts
this.emitChanged({ domain: this.name, table: '', key: '', operation: 'put', value })
```
即收到的是 `{ domain: 'workspace', table: '', key: '', operation: 'put', value: <整个 WorkspaceDomainState> }`。

**陷阱**：workspace global 的 `put` 是**整体快照**，`archiveSession` / `insertBefore` /
`create` / `delete` 触发同一个事件，**必须自己 diff**（`events.ts` 模块注释：
"carrying the new snapshot … — **never the old value** (a diffing consumer keeps its own
previous snapshot)"）。官方 diff 范例 `P/api/workspace-controller/src/feed.ts:95-118`。

**第四条通道：`ctx.sessionProjections.onChanged(listener)`** —
`P/session/session-projection/src/index.ts:301`，listener 签名 `:100-105`
`(session, key, value, seq) => void`。`:96` 注释：变化判定用 **`Object.is`** ——
即**同值重复写不会触发**。订阅标题即筛 `key === 'title'`。

**订阅方式**：`ctx.on(event, handler)`（返回 disposer，是 effect）。
scope 过滤机制见 `P/core/scope/src/scoped-events.generated.ts:10-39` —— 该文件是
**官方 scope-filtered 事件的权威全集**（38 项），`session/*` 与 `subagent/*` 的 resolver
为 `null`（仅做 carrier 存在性检查）。

### E17. 普通会话的闲置释放 / 驱逐

**没有。** 全树在 `core/agent/src/`、`core/agent-loop/src/`、`api/session-controller/src/`
搜索 `idleTimeout|evict|reclaim|unload|idleMs|releaseIdle|ttl|TTL` 无任何命中
（仅匹配到 `settle`/`unload` 的无关词义）。

Agent 生命周期**完全由所有权驱动**，不由闲置驱动。`AgentHandle`
（`P/core/agent/src/index.ts:160-163`）的 `dispose()` 是**能力**（`:148-153`）：
> "The disposer is a CAPABILITY: among consumers, only the holder can tear this agent down.
> The registered factory provider is also a structural owner … provider unload stops and
> drains every live handle it made."
> "`dispose()` stops the loop, awaits its exit, unregisters the agent, removes its session
> from the store, and finally unwinds its scoped world."

**代价由谁承担**：由**持有 handle 的所有者**承担。常驻一个 agent 会一直持有：
live `Session`（含全量内存事件日志，`P/core/session/src/index.ts:447` `private log: SessionEvent[]`）、
agent 注册表条目、整个 scoped context 世界（工具注册、prompt section、监听器、preset 绑定）。
**没有任何机制会自动回收它** —— 谁创建谁负责 dispose。

对比：只有 subagent child 有自动释放（见 E18）。**这是 subagent child 与普通会话的
最大运行时差异之一。**

#### Web GUI 场景：handle 被当场丢弃，Host 无任何释放端点

`ApiSessionAgentController` 的三个创建/恢复点（`P/api/session-controller/src/agent.ts:430`、
`:462`、`:479`，**该包未被 patch**）全部写成：

```ts
return (await this.ctx.agents.resume({ resumeSessionId, agentOptions, setup })).agent
//     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  AgentHandle
//                                                                     当场丢弃，只留 .agent
```

即 **`AgentHandle` 未被任何对象持有**，而 `dispose()` 是只有 handle 持有者才具备的能力
（`core/agent/src/index.ts:148-158`："exposed only to the consumer owner that created it"）。

且 `P/api/session-controller/src/index.ts` 的 `@Remote` 表中
**没有任何 close / dispose / release / evict 端点**（已 grep 验证，无命中）。
`:149-151` 监听 `session/disposed` 转发成 `api-session/removed` —— 是**观察者，不是回收者**。
Client 侧 `manager.dispose()` 只销毁浏览器端视图对象与 SSE 流，**不发 Host 端 dispose RPC**。

→ **Web 打开的每个会话，其 Agent 在 Host 进程生命周期内永久常驻**，
直到 agent-loop 插件 fiber 卸载（进程退出或 HMR）。

内存随事件数单调增长且无上界：`Session.log` 是普通数组、`append` 只 push
（`P/core/session/src/index.ts:447`）；**compaction 也不缩短它** ——
compaction 的 `replace` 只从 derivation 删除被遮蔽节点，原始 log 一条不删。
所有以 `Session` 为 key 的 `WeakMap`（attachments、projection cells）都因 Agent 仍在
registry 而被强引用，一个字节也不释放。

这不是官方声明的限制 —— `core/agent/README.md`、`core/agent-loop/README.md`、
`core/session/README.md`、`api/session-controller/README.md` 四处
`## Known Limitations` **均未提及内存/驻留/GC**。属**官方未表态**。

### E18. subagent child activation 的释放与恢复（官方原生）

**释放触发条件** —— `P/subagent/subagent/src/continuation-activation.ts`，
`settlementState()`（工作区 `:767-775`，逻辑未被 patch 改动）：
```ts
if (activation.inbox.closing !== undefined) return 'closed'
if (activation.poke !== observation) return 'retry'
if (activation.inbox.hasPending || activation.ownedChildren.size > 0) return 'wait'
return 'ready'
```
即：**agent idle + inbox 空 + 无存活子孙** → `'ready'` → 释放。

`watchSettlement()`（`:709-764`）循环：`await agent.whenIdle()` → 取锁判定 → `'ready'` 时
记录 `finalSeq`、`flushFinalState()`、复查 seq 未变（`:731-733`，变了则 `'retry'`）→
在 `runMaintenance()` 内调 `dispose(activation, true)`（`:737-740`）。
用 `runMaintenance` 的理由（`:734`）："The task starts synchronously, so idle ownership and
Inbox closure share one turn."

最终 `finishDisposal()`：子孙优先释放、`activation.handle.dispose()`，尾部顺序为
`resident.delete(childId)`（干净版 `:815`）→ `notifySettlement(...)`（`:823`）→
`releaseOwnership(childId)`（`:817`）→ `observer.settle(failure)`（`:818`）。

> **行号说明**：本节行号已换算为**干净 HEAD**。工作区因 patch 整体下移约 32 行
> （例：`notifySettlement` 干净 `:823` / 工作区 `:855`）。
> 干净 HEAD 关键行：`drain():327`、`drainDescendants:342`、`drainChildren:392`、
> `watchSettlement:678`、`runMaintenance:705`、`settlementState:735`、`hasPending 判据:741`。

**释放后如何恢复**：靠**冷恢复** —— 每次投递（`sendMessage`）在目标非 resident 时自行冷恢复。

> 注意：先前版本在此引用的 "Residency is deliberately NOT a precondition…" 一段
> **是 patch 新增的注释**，干净 HEAD 0 命中，已删除。该机制本身（非 resident 是轮次间常态）
> 依然成立 —— `settlementState`（干净 `:735,741`）的三条判据在干净树中完整存在 ——
> 但**上游从未就此写过设计说明**。

**谁能重新激活**：只有**精确 live 直接父 Agent**。干净上游中这条约束由 `sendMessage`
（`index.ts:246`）与 `interruptByParent`（`:480`）的 adjacency 校验给出。
patch 新增的 `materializeForAccess` 也复用同一套 `authorizeLineage`，但该访问器本身非官方。

---

## F. 扩展点总结

### F19. 官方明确支持的扩展点

**服务注册（Service 注册到 `ctx`）**
- `ctx.storageDomain.open(spec)` — `P/storage/storage-domain/src/index.ts:103`；
  `defineDomain` / `domainTable` 范例 `P/workspace/workspace/src/spec.ts:68-76`
- `ctx.sessionProjections.register(def)` — `P/session/session-projection/src/index.ts:233`
- `ctx.tools.register(def)` / `.restrict(filter)` / `.guard(g)` —
  `P/core/tools/src/index.ts:1027` / `:1061` / `:1100`
- `ctx.agents.setFactory` / `.create` / `.resume` / `.enter` / `.withInitiator` —
  `P/core/agent/src/index.ts:388` / `:407` / `:458` / `:324`
- `ctx.agents.isOwnedBy(id, owner)` — `:579`
- 可选服务读取用 `ctx.get('name')`（见 `P/packages/AGENTS.md` 约定），
  可选注册用 `ctx.inject(['svc'], cb)`

**事件订阅（`ctx.on`，返回 disposer）**
- Session：`session/created` `session/disposed` `session/event` `session/flush` — `P/core/session/src/index.ts:49,59,71,80`
- Agent：11 项，`P/core/agent/src/runtime-types.ts:258-403`
- Storage：`domain/changed` — `P/storage/storage-domain/src/events.ts:44`
- Preset：`agent-preset/selected` — `P/preset/agent-presets/src/types.ts:81`
- Subagent：`subagent/{provider-added,provider-removed,start,end}` — `P/subagent/subagent/src/index.ts:146,152,163,172`
- Tools / system-prompt / llm / skill / goal / settings 等另有各自 `interface Events`
  （全集索引：`grep -rn "interface Events" --include=*.ts`，33 处）
- scope 过滤事件权威全集：`P/core/scope/src/scoped-events.generated.ts:10-39`

**Host API**
- `ctx.sessionQuery.*` — observeSession / readSession / listSessions / readTitle* /
  listEvents / filterEvents / readSurface / traceSession / traceEvent / readEvent
  （`P/session-query/session-query/src/index.ts:139,183,173,218-249,267,278,308,325,338,353`）
- `ctx.sessions.get(id)` + `session.header` / `snapshotEvents()`
- `ctx.workspaceRegistry.*` — create / get / list / delete / insertBefore /
  archiveSession / resolveByPath / archivedSessionIds
  （`P/workspace/workspace/src/index.ts:157,170,180,198,209,243,276,232`）
- `agent.inject() / steer() / followup() / send()` — `P/core/agent/src/runtime-types.ts:241,231,222,215`
- `agent.cancel() / whenIdle() / runMaintenance()` — `:183,191,202`
- `ctx.agentPresets.{resolve,mount,composeFrom,composedPreset,list,roots}` —
  `P/preset/agent-presets/src/index.ts:343,414,455,475,248,486`
- `ctx.subagents.*`（干净上游 14 个公开方法）— `startContinuable:228`、`sendMessage:246`、
  `interrupt:295`、`drainContinuableDescendants:309`、`drainContinuableChildren:326`、
  `listChildren:349`、`listDescendants:368`、`remoteExportList:386`、`prompt:413`、
  `interruptByParent:480`、`registerProvider:509`、`getProvider:532`、`list:540`、`start:556`
  （`git show HEAD:P/subagent/subagent/src/index.ts`）。
  **注意：其中没有任何只读访问器**；`withLiveContinuableChildSession` 是本仓 patch，不在此列。
- 读取 subagent child 转录：用 `ctx.sessionQuery.observeSession(childId)`（官方原生，无 origin 门禁）

### F20. 官方明确拒绝 / 有意不支持

| # | 被拒绝的事 | 源码位置 | 拒绝原文 |
|---|---|---|---|
| 1 | 用泛化 Session API 解析 `origin==='subagent'` 的会话 | `P/api/session-controller/src/agent.ts:85` + `:97-103` | `'session "…" is owned by subagent routing'`, `reason: 'use subagent delivery for this child session'` |
| 2 | ~~同上，设计意图~~ **已作废** | ~~`continuation.ts:344-346`~~ | 该注释是**本仓 patch 新增**（`git grep "intentionally cannot resolve" HEAD` 0 命中）。上游拒绝该路由但**从未解释理由，也未提供替代通道** |
| 3 | 以 `kind:'session'` 地址读 subagent 历史 | `P/api/session-controller/src/history.ts:339-343` | `'subagent Sessions require their durable parent address'` |
| 4 | ACP resume / list 中出现 subagent 会话 | `P/acp/acp/src/index.ts:249-251`, `:309` | `'session is not resumable'`；list 直接过滤 |
| 5 | 向 subagent 会话上传文件 | `P/client/file-upload/src/index.ts:232-238` | `'subagent conversations do not accept file uploads'` |
| 6 | subagent 会话出现在 UI 工作区树 | `P/client/ui-workspace/src/client/tree.ts:146` | `session.origin !== 'subagent'` |
| 7 | 在非 agent scope 上调 `tools.restrict()` | `P/core/tools/src/index.ts:1062-1065` | "a context-global restriction would mask every agent — deny the tool for the intended agent instead" |
| 8 | 用 `restrict()` 约束本 scope 自注册的工具 | `P/core/tools/src/index.ts:1127-1132`, 实现 `:1168-1173` | "**never** what its OWN layer registers. That exemption is what a per-child capability filter has to keep intact" |
| 9 | 用 `restrict()` 约束 `run_code` | `:1075-1077`, `:1174-1181` | "restrict end-capability tools instead"；"outside capability filtering" |
| 10 | 注册或 shadow `run_code` 名字 | `:1044-1046` | "reserved for the PTC mode presentation transport" |
| 11 | 空 filter `restrict({})` | `:1068-1070` | "an empty filter is almost always a materialized-empty-config bug" |
| 12 | `origin` 取 `'subagent'` 以外的值 | `P/core/session/src/index.ts:123-125` | `'session header origin must be "subagent"'` |
| 13 | header 用相对 `cwd` | `P/core/session/src/index.ts:113-115` | `'session header cwd must be an absolute path'` |
| 14 | 事后修改 header | `P/core/session/src/index.ts:133` `deepFreeze`；`ResumeAgentOptions` 无 `meta`（`core/agent/src/index.ts:125-144`） | deep-frozen，resume 无法改写 |
| 15 | 创建时由调用方设 `createdAt` | `P/core/agent/src/index.ts:72-74` | "the internal-only `createdAt` … is **deliberately excluded** — a factory caller never sets it" |
| 16 | 在 `setup` 里驱动 agent | `P/core/agent/src/index.ts:114-116` | "Setup composes, it never drives" — 但明说是**契约而非运行时限制** |
| 17 | 无 scope 的 context 挂 preset | `P/preset/agent-presets/src/index.ts:416-418` | "refusing to compose an unscoped context" |
| 18 | 观测子会话时顺带塞消息 | `P/subagent/subagent/src/continuation.ts:380-382` | "must **never inject a message of its own** to get there" |
| 19 | 仅凭 `origin` 判定子会话能力 | `P/core/session/src/types.ts:114-115`；`P/subagent/subagent/src/control-types.ts:25` | "presentation metadata, **not proof that the child is continuable**" |

### 官方未表态 / 需自行实现

1. **unarchive / restore** —— 无实现（E15）。schema 与 UI 注释均预设其存在，但无方法。
2. **普通会话的闲置驱逐** —— 无任何机制（E17）。常驻代价由 handle 持有者全额承担。
3. **「会话 ↔ 外部实体（IM 群/话题）」关联表** —— 无现成结构，但官方提供了自建所需的
   全部原语：`storageDomain`（持久化）+ `domain/changed`（变更推送）+ `sessionProjections`（日志派生）。
4. **`inject()` 的送达保证** —— 官方明确**不保证**（`runtime-types.ts:233-240`：
   可能错过已认领批次、可能被 cancellation/disposal 丢弃、idle 时不唤醒）。
   需要必达者须自行在插件侧做补偿。
5. **抑制 subagent 结算通知** —— 官方无开关（D13）。本仓靠 patch 实现。
