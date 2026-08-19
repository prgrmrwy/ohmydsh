# Design: subscriptions-sandbox-shim

## Context

动机见 proposal.md。已核实的关键事实(本地 rc.6 安装,与 rc.7 逐字节对比过):

- DSH core 在**组合期**静态把 `sandbox_permissions`/`justification`(enum `["workspace-write","danger-full-access"]`)铺进 `bash`/`write`/`edit` 的工具 schema(`dsh-tool-fs`、`dsh-tool-bash`、`dsh-tool-pwsh`),在**执行期**才做严格更宽检查(`dsh-sandbox` 的 `approveEscalation`:`WIDER_MODES[effectiveMode].includes(mode)` 失败即抛 `not strictly wider`)。
- `dsh-plugin-subscriptions` 的 `toResponsesTools` 把 `tool.parameters` **原样**转发给 OpenAI Responses/Anthropic wire;DeepSeek 原生 provider 同样原样转发——schema 对所有 provider 逐字节相同,差异纯在模型行为。
- 当前部署 `danger-full-access` + `approval: never`:任何带升级参数的调用无合法路径(不更宽 → 执行期报错;更宽 → approval 不可用),即"schema 广告的所有值在此部署都是陷阱"。
- agent-loop 构造的 LLM 请求是 `deepFreeze` 的(含 tools),且 `llm/stream` waterfall 的 fallback 闭包持有原 `options`——**中间件链只能包装输出流,无法替换请求**;链上已有 `dsh-session-title`、`dsh-session-checkpoint-policy`、invariant(global prepend)等 listener,veto 会跳过它们。
- `BlockAssembler` 对 `block-end` chunk 直接采用 `chunk.block`(`assemble()` 优先 `partial.block`),且会话派生历史(`deriveMessages`)只投影带 `surfaceOp` 的 `assistant/message` 事件,chunk 原始事件不参与派生——重写 `block-end` 的 arguments 会进入持久化消息,resume 不会复活原始参数。
- 适配器注册经 `ctx.llm.registerAdapter` → `llm/adapters-updated` 事件广播(首次注册与 HMR `replace` 都会触发);`ctx.llm.registration(provider)` 是公开方法,可拿到注册记录中的 adapter 实例。

## Goals / Non-Goals

**Goals:**
- 不改 DSH 源码、不 fork 不 vendor `dsh-plugin-subscriptions` 的前提下,让 GPT/Codex(及可配置的 grok/claude)在 `danger-full-access` + `approval: never` 部署下工具调用不再因升级参数失败。
- 两层清洗:schema 层(消除诱因)+ 返回参数层(硬保证)。
- 对 DeepSeek 等非目标 provider 零影响;对订阅插件的认证/目录/用量等功能零改动。

**Non-Goals:**
- 不修 DSH core 的静态 schema 广告问题(那是 upstream issue #7 的范畴,本 change 是部署侧缓解,上游修复后应移除)。
- 不做会话模式感知的"智能"剥离(适配器层拿不到 standing mode;需要时用配置开关整体启用/禁用)。
- 不新增 provider、不改模型目录、不动 token 存储。

## Decisions

### D1:拦截层 = 包装适配器实例的 `stream` 方法,而非 `llm/stream` 中间件

在 `llm/adapters-updated` 时,对配置内的 provider 路由,取 `ctx.llm.registration(provider).adapter`,用 WeakSet 幂等地把其 `stream` 方法包成:`async *stream(options) { yield* stripChunks(original.call(adapter, stripSchema(options))); }`。

- 备选 A:`llm/stream` 中间件——请求是 frozen 且 fallback 闭包持有原对象,只能包装输出流;要改请求必须 veto 重派发,会跳过 session-title/checkpoint/invariant 等既有 listener,且丢失 preparedCall 的 registration 绑定。**仅作为降级路径**:若适配器包装因 DSH 升级失效,可退化为"中间件输出-only 剥离"(仍能硬保证调用成功,只是 schema 层继续诱使模型填参)。
- 备选 B:fork 插件改 `toResponsesTools` + translator——违反 repo-layout 的"remote 不 vendor"约定,且上游每次更新都要手工合并。放弃。
- 备选 C:AGENTS.md / preset 规则——D001 已实证 GPT 在明确指令下仍会填参,只能降概率。不作为主方案。
- 采纳理由:一处包装同时覆盖出站与入站;不动注册表结构(registration() 只读);无加载顺序依赖(adapters-updated 在注册后必然触发);对上游插件零依赖(不 import 其模块,只认 provider 路由名)。

### D2:出站剥离 = 克隆请求,不改原对象

`stripSchema(options)`:若 `options.provider ∈ providers` 且 `options.tools` 中任一 tool 的 `parameters.properties` 含两键,则构造新对象 `{...options, tools: [...克隆后的 tools]}`(messages/system/signal 等复用原引用,不触碰);否则返回原对象。`callConfigEquals` 只比对 config 字段,不受 tools 变更影响。

### D3:入站剥离 = 只重写 `block-end` 的 tool-call arguments

`stripChunks(stream)`:遍历 chunk,仅当 `chunk.type === 'block-end' && chunk.block?.type === 'tool-call'` 时:`JSON.parse(chunk.block.arguments)` → 删除 `sandbox_permissions`/`justification` → 有变化才 `JSON.stringify` 回写;解析失败或未变 → 原样透传。不重写 `tool-call-delta`(碎片 JSON 不可靠;`block-end` 是权威收口,assembler 直接采用 `chunk.block`)。不改变 block 的 index/type/id/name 形状,不触发 `llm/stream` invariant 的配对校验。

### D4:provider 路由与开关可配置

```ts
z.object({
  providers: z.array(z.string()).default(['codex', 'grok']),
  stripSchema: z.boolean().default(true),
  stripOutput: z.boolean().default(true),
})
```

- 默认只作用 codex/grok(Responses 系,issue #7 实证);claude 可加入(其 Anthropic 翻译同样转发 parameters,模型行为未实证,默认不纳入)。
- 两开关允许降级形态(如 `stripSchema: false` 的"仅硬保证"模式)。

### D5:部署形态约束 = 配置级整体开关,不做运行时感知

本 shim 的语义是"该部署永不使用 sandbox 升级通道"。在 `read-only`/`workspace-write` + `approval: ask` 的受限部署里,合法的升级重试会被误剥,导致写操作死锁——因此该形态**必须禁用本定制**(manifest `enabled: false`)。此约束写入插件 README 与 manifest note。

## Risks / Trade-offs

- [`ctx.llm.registration()` / adapter 实例属 DSH 内部面,升级可能改名或重构] → 所有对 llm 内部的访问收敛到单一模块;DSH 升级后回归验证;失效时降级到 D1 备选 A(中间件输出-only)。
- [上游插件更新后 provider 路由名或 chunk 形状变化] → 只依赖 `codex`/`grok` 路由名与 Responses `block-end` 形状(协议级稳定);更新上游后跑一次回归会话。
- [包装 async generator 的 return()/throw() 语义错误导致资源泄漏] → 用 `for await ... yield` 包装,外层提前关闭时内层 generator 由 `for await` 的 finally 自动 return,委托语义。
- [DeepSeek 请求误命中] → 路由严格按 `options.provider` 精确匹配;单测覆盖非目标 provider 透传。
- [replay 复活原始参数] → 已核实:派生历史只投影重写后的 `assistant/message`;仍以"resume 会话"场景入 spec 与测试。
- [受限部署误启用导致升级通道被剥] → README + manifest note 明确部署形态约束;`enabled` 开关是唯一闸门。

## Migration Plan

1. 实施 tasks 后 `node scripts/sync.mjs`(或 `dsh build`)安装新包 + `dsh restart`;
2. 验证:codex 会话跑 `bash`/`write`(不再 `not strictly wider`);deepseek 会话回归(工具 schema 不变);resume 会话后参数仍清洗;
3. 回滚:`dsh.yaml` 中该定制 `enabled: false` → sync → restart;上游 D001 修复后按同一路径移除。

## Open Questions

- claude 是否纳入默认作用域:未实证其模型行为,默认不纳入,留配置(不改变 specs/方案/任务拆分)。
- 是否同步给 `dsh-sandbox-notes` skill 补一段 shim 说明:低优先,作为 tasks 的可选收尾。
