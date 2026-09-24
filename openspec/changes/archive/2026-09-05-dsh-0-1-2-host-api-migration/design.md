## Context

本仓库 pin `dshVersion: 0.1.1-rc.2`,registry `latest` 为 `0.1.2-rc.1`(2026-09-04 复核)。前一个 change `staged-dsh-and-plugin-upgrade` 完成了阶段一至三(6 个插件升级),其阶段四(运行体迁移)在 4.5 阀门停止并**完整回退**,因此当前部署与仓库状态干净、无中间态。

停止的直接原因已由该 change 的 design「阶段四执行结论」逐项记录:其 spike 只审计 client 半区,实际执行后 8 个自研包中 5 个无法构建。**本变更的起点不是"重做一次升级",而是"解决那 5 个包的 host 半区破坏"** —— client 半区方案、能力基线、后置插件准入都已查清且仍然有效,直接复用。

已知破坏面(前次实测,非推测):

| 破坏点 | 影响包 | 性质 |
|---|---|---|
| `Session.events` 移除 | `dsh-pet`、`worktree-session` | 读取面替代未知 |
| `connection.rpc.handle` 删除第三参数 | `system-clock`、`home-network-model-guard`、`session-links` | **安全边界** |
| `SubagentRuntime.registerContinuableSetup` 移除 | `worktree-session` | 核心路径 |
| `SessionLogOffset` 类型收紧 | `session-links` | 类型面 |
| 3 例测试 `no agent factory registered` | `worktree-session` | 成因未知 |

**关键约束**:`authority: 'loopback'` 不只是代码里的一个参数,它被写进了 `settings-system-clock` 的两条 spec requirement。删掉它编译立刻通过,但那是在无声明的情况下放弃一道已承诺的安全边界。

## Goals / Non-Goals

**Goals:**
- 5 个包适配 `0.1.2` 的 host API,**保持既有功能语义不变**
- 运行体升到 `0.1.2-rc.1`,8 包 peer 同批更新,peer 检查重新通过且不放宽
- 放行 `better-sidebar@0.18.0` 与 `sidebar-qa@0.5.0`
- 把「审计面必须覆盖两个半区」「安全语义类 API 不得静默降级」固化为规范,使同类失误不再重演

**Non-Goals:**
- 不重新设计任何自研包的架构;适配以等价为准,不借机重构
- 不改变任何用户可见行为
- 不放宽 `authority: loopback` 的安全语义 —— 若无等价机制则停下讨论,不默认降级
- 不追求"顺带把其它插件也升到最新"

## Decisions

### D1: spike 必须先跑通构建,才算结论成立

前次失误的根因不是调研不够细,而是**调研的验证标准太弱** —— 只读类型声明就宣布"改动量可接受"。本次 spike 的完成判据改为:**在隔离环境里让 5 个包真的构建通过**,而不是"我认为可以改通"。

**备选**:仍以类型分析为准、执行阶段再验证。**否决理由**:前次正是这么做的,代价是走到 6.5 才发现,已经改了 8 个包的声明和 lockfile。

### D2: 三件事必须同批次,不可拆分

`dshVersion` 升级、host 适配、peer 更新构成一个不可分割的批次:
- 适配代码在旧运行体上**无法编译**(新 API 不存在)
- peer 检查要求 `dshVersion` 与 peer 声明同批变更(`repo-layout` 已固化)

因此不存在"先合适配、再升版本"的中间态。

**备选**:先合入适配代码。**否决理由**:会留下一个既不能编译也不能验证的分支。

### D3: `authority: loopback` 按"意图不变、表达可变"处理

spec 的意图是「该 channel 只对本机回环可用」,`authority: 'loopback'` 只是 `0.1.1-rc.2` 上的表达方式。因此适配的正确形态是**在新运行体上找到等价机制并实际验证边界仍然成立**,而不是删参了事。

三种可能结局,处理方式不同:
1. 新运行体默认即限回环 → 确认并在 spec 中改写表达
2. 有等价机制(如路由层配置)→ 改用该机制
3. **确无等价机制** → **停止**,作为显式决策交由用户处理

**备选**:先删参让编译通过,后续再补。**否决理由**:那会在"已承诺的安全约束"上留一个无声明的缺口,违反仓库 fail-closed 原则,且极易被后来者当作既成事实。

### D4: 复用既有基线而非重建

`baseline.md`(自动化 951 例 + 人工清单)已在前次固定并**实际发挥过归因作用** —— 正是它让 5 包失败得以干净归因。本次直接复用,只需确认覆盖面仍适用。

需要新增的只有针对本次破坏面的专项验收:`authority` 边界、`Session.events` 替代读取、`registerContinuableSetup` 承接后的行为。

### D5: 沿用隔离 Worktree Session

前次已实测有效:升级与回退全程未影响日常 GUI(`~/.dsh` 21 插件、主 checkout `dshVersion` 均未受触碰)。

**一个必须保留的操作约束**:`scripts/sync.mjs` 在 `DSH_HOME` 缺省时回落 `~/.dsh`,而本分支的 `dshVersion` 已改 —— 漏传一次 env 就会把日常运行体升级掉。前次用 fail-closed 包装脚本解决,本次沿用。

### D7: 后置插件放行**并入同一批次**(执行中修订 D6 的次序假设)

原计划把 `better-sidebar@0.18.0` / `sidebar-qa@0.5.0` 放在验收之后作为独立步骤。实测推翻了这个次序:`better-sidebar@0.17.1` 在 `0.1.2-rc.1` 上**启动即崩** —— 它 `import { settingsNamespace } from '@deepseek-ai/dsh-settings'`,而该导出在 0.1.2 已移除,loader 抛 `SyntaxError` 并使整个 profile 无法 boot(不是降级,是完全起不来)。

因此 `0.18.0` 不是「可选收益」而是**运行体升级的必要条件**,必须与 `dshVersion` 同批。D6 的「逐项确认实际激活」要求不变,只是执行点从「验收后」提前到「与升级同批、随即验证」。

### D6: 后置插件放行须逐项验证激活

`sidebar-qa@0.5.0` 的 `selectModel`/`modelCatalog` 由 `dsh-client-ui-model-selection` 提供(**不在** `dsh-api-session-controller` 内)。若该包未随 profile 加载,功能会**静默消失而无任何报错**。因此放行后必须逐项确认实际激活,"无报错"不作为通过依据。

## Risks / Trade-offs

- **[无等价的 loopback 机制]** 新运行体可能确实没有对应约束方式 → D3 第 3 种结局:停止并上报,不默认降级(已入 spec)
- **[破坏面仍未穷尽]** 前次已证明"看起来查清了"可能仍有遗漏 → D1 以实际构建通过为判据,而非分析结论
- **[rc 级运行体]** `0.1.2-rc.1` 非 stable → 隔离环境验收 + 基线比对 + 可回退(前次已验证回退干净)
- **[适配引入行为漂移]** 等价适配可能悄悄改变语义 → 每个包的自有测试必须通过,且不得为适配而修改测试期望
- **[trade-off]** 本变更把"升级"与"适配"绑在一起,批次较大;但 D2 已论证二者不可拆,拆分反而制造不可验证的中间态

## Migration Plan

```
spike   逐项查清 5 个破坏点 + 在隔离环境让 5 包构建通过   ← 门槛,不通过则停
   │    (authority 无等价机制 → 在此停止并上报)
   ▼
适配    5 包 host 半区 + 7 包 client inject + 8 包 peer + dshVersion  (同一批次)
   │    各包 build/typecheck/test 通过,不修改测试期望以迁就适配
   ▼
验收    复跑 baseline.md 并逐项比对;专项验收 authority 边界等三项
   ▼
放行    better-sidebar 0.18.0 + sidebar-qa 0.5.0,逐项确认实际激活
   ▼
回主    隔离环境通过后回主 checkout 物化,确认日常 GUI 全部插件正常
```

回滚:还原 `dshVersion` 与 8 包 peer(同批),前次已验证该回退干净且不波及其它成果。

## Open Questions

- `Session.events` 在 `0.1.2` 的替代读取方式为何?两包的用法不同(取标题与水位 vs 判定 blank session),是否需要不同的替代路径?
- `authority: 'loopback'` 的等价机制是什么?是运行体默认行为、路由层配置,还是确实不存在?**这是本变更唯一可能导致中止的问题**
- `SubagentRuntime.registerContinuableSetup` 的承接 API 为何?`worktree-session` 的 continuable subagent 建立策略是否需要改写形态而非仅换 API?
- `worktree-session` 3 例 `no agent factory registered` 是测试装置问题还是运行体行为变化?
- 后置插件是否应取 spike 时点的更新版本(`better-sidebar` 与 `sidebar-qa` 当前分别为 `0.18.0` / `0.5.0`,届时可能更新)?建议以实际 registry 状态决定,不预先锁定

## Spike 结论(2026-09-05,基于 0.1.2-rc.1 发布物逐文件审读;2.6 构建验证结果见文末)

审计面覆盖两个半区:host 半区结论为 S-H1…S-H5,client 半区确认沿用前次 S1/S2 映射并补充类型面迁移(S-C1)。

### S-H1: `Session.events` → `snapshotEvents()` / `seq`(两包同一替代路径)

`0.1.2` 的 `Session` 不再暴露 `events` 数组,读取面改为显式方法(`dsh-session/lib/types/index.d.ts`):
- `snapshotEvents(fromSeq?, toSeqExclusive?)` — 不可变全量/区间快照(内部有缓存,append 前复用);
- `seq` — 下一个事件的 seq = 日志长度(水位);
- 另有 `eventAt(seq)` / `ownEvents()` / `isOwnSeq(seq)`。

两包用法映射(同一替代路径,无需不同处理):
- `dsh-pet` 取标题:`latestSessionTitle(session.events)` → `latestSessionTitle(session.snapshotEvents())`;取水位:`session.events.length` → `session.seq`。
- `worktree-session` 判定 blank:`session.events.some(e => e.type === 'turn/start')` → `session.snapshotEvents().some(...)`;`tool.ts` 标题反查同 dsh-pet。

### S-H2: `authority: 'loopback'` 的等价机制 —— 存在,为「连接级 Host fence + 浏览器认证」,且本部署下边界不弱于旧版

逐字节审读两版 `dsh-client-connection` 发布物的实现:

- **旧版(0.1.1-rc.2)**:`register(owner, channel, handler, options)` 中 `options.authority === 'loopback'` 的效果是对该 channel 以 `trustedHosts=[]` 执行 `isTrustedApiRequest`(Host 头必须是 loopback:localhost/[::1]/127.0.0.0-8),非回环一律 403。即 per-channel 的 loopback 限定。
- **新版(0.1.2-rc.1)**:`register()` 不再接受 options,但**每个 channel 的 handler 前都强制执行 `requestRejection(req)`** = `isTrustedApiRequest(req, this.trustedHosts)`(失败 403)**加上** `browserAuth.isAuthenticated(req)`(失败 401)。`trustedHosts` 来自 connection 插件配置,schema 默认 `[]`。
- **本部署实况**:profile 未配置任何 `trustedHosts`(隔离与日常 profile 的 cordis.yml/patch 均无该键),故运行时 `trustedHosts=[]` —— 所有 RPC channel 与旧版 loopback channel 走**完全相同的 Host fence 判定**(同一个 `isLoopbackHostname`),且额外多了一层浏览器会话认证(401)。**边界不弱于旧版,机制存在,变更不中止。**
- **语义差异须记录**:约束的作用域从 per-channel 变为 connection 级 —— 若未来部署配置了 `trustedHosts`,旧版下 loopback channel 仍保持仅回环,新版下这些 channel 会随之接受受信 host。该约束写入 `dsh.yaml` 审查记录与 spec 表达(「部署不得配置 trustedHosts,否则该边界随之放宽」)。

三个插件的适配形态:删除第三参数(该表达已不存在),边界由运行体连接层承接;验收改为对实际 HTTP 面做非回环反例实测(基线 E1)。

### S-H3: `registerContinuableSetup` → `agent/created` scoped 事件监听(需改写调用形态)

`0.1.2` 移除了 `SubagentActivationSetupRegistry` 公开注册面;continuation manager 改为内部经 `agents.create/resume` 的 `setup` 回调组装 child(`applyChildComposition`),**不再提供部署插件向所有 continuable child 创建上下文注入的公开 seam**。

承接路径:`@deepseek-ai/dsh-agent` 的 cordis 事件 `'agent/created'`(publication 时同步派发,同步 listener 抛错可 veto publication;在 `agent/session-start` 与首次 prompt 组装之前)。`installSubagentInheritance` 本身自过滤(parentSession 无绑定即 no-op),因此改写形态为:root 级 `ctx.on('agent/created', ({agent}) => ...)`,对命中绑定的 child 安装 guard/context,并以 `'agent/disposed'` 承接原 disposer 清理。时序差异(创建前 vs 发布时)对本包语义无影响:child 在 `agent/session-start` 前不会执行工具,guard 安装点仍先于一切工具调用。

### S-H4: `SessionLogOffset` 收紧为 branded number

`0.1.2` 中 `SessionLogOffset` 是 `BrandedNumber<'SessionLogOffset'>`,裸 `number` 不再可赋值;同名构造函数 `SessionLogOffset(value)` 完成 brand。`session-links` 的 `persistence.readFrom(id, 0)` → `readFrom(id, SessionLogOffset(0))`(从 `@deepseek-ai/dsh-session` 导入)。

### S-H5: `no agent factory registered` 3 例 —— 测试装置问题(已定位并修复)

错误消息在两版 `dsh-agent` 中同文(create/resume 早于 factory 注册时抛出)。实测定位:`dsh-agent-loop` 的 `inject` 在 0.1.2 新增了 `sessionProjections`(由新包 `@deepseek-ai/dsh-session-projection` 提供)。`agent-loop-context.test.ts` 的 harness 未组入该插件,AgentLoop 因依赖不满足永不加载,factory 永不注册。**是测试装置的组合缺一个新插件,不是运行体行为变化**;harness 补 `ctx.plugin(SessionProjection)` 后全部通过,生产部署由 dsh-base bundle 自带该插件、不受影响。

### S-C1: client 半区 —— 沿用 S1/S2 映射,补类型导入迁移

服务映射不变(见前次 S1/S2)。补充:本仓库 14 处 `import type ... from '@deepseek-ai/dsh-client-runtime/client'` 的类型面迁移已核对 0.1.2 发布物:
- `ClientContext` → `Context`(`@deepseek-ai/cordis`;0.1.2 官方客户端包内部即如此别名);
- `SessionId` → `@deepseek-ai/dsh-session`(type-only,浏览器安全);
- `SessionListState`/`ConversationSnapshot`(sessions 面) → `@deepseek-ai/dsh-api-session-controller/client`;
- `ConversationNode`/`AssistantBlock`/`ToolResultNode`(conversation 面) → `@deepseek-ai/dsh-client-ui-conversation/client`。

`@deepseek-ai/dsh-client-runtime` npm 版本止于 `0.1.1-rc.2`(前次 S3 已证),各包 inject/peers/devDeps 中该项按上述实际承接包替换,不写 `^0.1.2-rc.1`。

### S-C2: 执行中新发现的破坏点(前次与本次 spike 均未预估,按 spec「审计发现的破坏面超出预估」补记)

以下五项在 2.6 实际构建/跑测阶段才暴露,已逐项适配并补记为调研产出:

1. **`ConversationSnapshot` 的节点面易主**(`session-links`):0.1.1-rc.2 的 `sessions.binding().session` 快照直接带 `nodes`;0.1.2 把节点装配移到 `uiConversation`,`ConversationSnapshot` 只剩 `views`/`activeTargets`,`ConversationNode[]` 改由 `chat` view target 的 `legacy.nodes` 承载。适配:Panel 用 `ctx.get('uiConversation').binding(id).target('chat')` 组一个只读 `{nodes}` 面喂给既有 collector,折叠与水位语义不变。
2. **`ToolResultNode.callView` 移除**(`session-links`):host 计算的 render intent 不再随节点下发。适配:`producedFromNode` 改按节点自身的调用头(`call.name` + `call.argsRaw`)判定,采用 0.1.2 官方 `dsh-client-ui-deliverables` 的 `mutationPath` 同一词汇表(`write`/`edit`/`str_replace_editor`),「镜像官方 deliverables 词汇」这一既有语义不变,只是官方词汇的载体变了。
3. **`connection.api.host.*` 代理面移除**(`dsh-pet`):`dsh-host-apiproxy` 在 0.1.2 线不存在(npm 版本止于 `0.1.1-rc.2`)。目录选择/列举改走 typed Remote 命名空间 `remote.directoryPicker`(`pick`/`list`,`RemoteResult` 信封,无 `result` 包裹),由 `dsh-api-workspace-controller` 提供;仍经 `ctx.get` 惰性读取,组合缺网关时降级为「本部署不支持目录选择」。
4. **DSW 主题令牌词汇表变更**(`dsh-pet`):0.1.2 删除 `--dsw-alias-brand-primary`、`--dsw-alias-label-primary-foreground`、`--dsw-font-s-14`、`--dsw-alias-bg-layer-2`、`--dsw-alias-button-primary-fill/hover`。按等价外观重映射(徽标改用 label-primary/bg-layer-1 反相对,主按钮改用官方 composer 同款 `button-info-fill/hover`,正文字体显式 14px/22px + `--dsw-font-family`)。**该破坏由 dsh-pet 既有的「只引用运行体真实定义的令牌」测试自动抓到**,不是靠肉眼。
5. **`CallId` 更名为 `ToolCallId`**(`worktree-session` 测试装置)。

另有一处 npm 布局差异(非运行体破坏):0.1.2 的 peer 图使部分运行体包被装到 `packages/<pkg>/node_modules` 而非工作区根,`dsh-pet` 三个「从磁盘读取安装物」的元测试改为同时探测两个根。
