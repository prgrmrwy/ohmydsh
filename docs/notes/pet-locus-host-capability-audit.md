# Pet unified locus host-capability audit

This note records the boundary audit for OpenSpec `pet-unified-locus-collaboration`
(task groups 1, 3, 5 and 8). It is deliberately an evidence note, not a cutover
plan. The opening sections preserve the pre-override audit chronologically; the current
conclusion after the reviewed runtime override and real capability probes is recorded in
“Latest verification” below. Do not read the historical “not wired” inventory as current state.

## What is currently safe

- `packages/dsh-pet/src/index.ts` opens the additive `LocusRepository` only to
  provide a caller-bound `pet_context` lookup (`index.ts:194-198,
  426-434`). It does not use locus records as a channel route or as a fallback
  for legacy bindings.
- `ChannelService` receives the legacy `qaDelivery`/`bindCommand` path and no
  `locusController` (`index.ts:985-1003`). `InboundPipeline` enters the unified
  path only when a controller is explicitly injected (`host/channel/pipeline.ts`
  around `158-175`). Therefore current production intake remains legacy rather
  than silently claiming an incomplete unified implementation.
- `host/channel/locus-capability.ts` makes the intended gate explicit: a
  complete controller requires a `perTurnCorrelation` observer; absent or
  invalid composition yields an unavailable diagnostic. The helper is not
  currently wired to production, which is safe because absence preserves the
  existing path.
- The unified admission/controller code has useful standalone fail-closed
  behavior: it rejects ambiguous thread facts, requires a verified bot mention
  for p2p and group messages, keeps control commands allowlist-gated, validates
  active locus/child identity, persists Delivery before queueing, and requires an
  exact per-turn correlation for settlement. These are implementation evidence,
  not Host capability evidence.
- Locus management routes are optional. `createPetRoutes` fails with
  `LOCUS_UNAVAILABLE` when no management port is supplied. `index.ts` now
  supplies one for the read/lifecycle surface only; the actions that need
  external provisioning remain absent and keep reporting unavailable.

## What is not proven / not wired

### Task group 1 — Host seams

`docs/notes/dsh-plugin-integration-pitfalls.md` and
`docs/notes/pet-locus-spike-findings.md` establish important limits, but not an
end-to-end capability: fork-in-process has no proven cwd override; sandbox roots
were inspected as a contract rather than validated by a read/write matrix; the
real topic-group consumer event is still missing; and parent/child acceptance is
not a per-turn settlement proof. The current Host has no adapter in `index.ts`
for a locus child/inbox, sandbox policy changes, or a per-turn observer.

### 后续接口核验修正（不是生产验收）

只读子 agent 对实际 `0.1.2-rc.1` 发布物进一步核验，报告以下接缝
存在，修正“宿主完全不支持”的过宽判断：

- `dsh-subagent/internal` 导出 `queueHostSubagentPrompt`；
  `agent/inbox/claimed` 提供精确 message/turn 对应。
- fork provider 可从无已完成 turn 的 parent 建立空前缀子会话，不必为
  自动主会话虚构业务初始化轮次。
- 同步 `agent/created` observer 可通过 `agent.ctx.get('tools')` 在实际
  child scope 注册工具；同步抛错可否决发布。不能用异步补装冒充首轮保障。
- `setSandboxMode` 和 `sandboxPolicy.resolve` 提供独立 child 策略接缝；
  普通 parent 可经 `sessionController.resolveAgent` 恢复其 preset。

上述代理报告包含针对发布物的内存严格类型检查、真实 fork provider 空
前缀实验和真实 Inbox claim 实验，但没有完整 Host、真实文件写入矩阵、
原生 GUI 或飞书入站验收。当前 `index.ts` 仍未接通这些接口。

### 自动父通知：上游改动已实现（尚未发布）

原缺口：continuation manager 无条件把 `subagent-settled` 正文写入父会话
并可能唤醒它，没有持久关闭接口；事后删除 inbox 条目无法撤销父日志写入。

经用户批准，已在上游源码实现可选的持久策略，而不是修改已安装的 npm 包：

- 上游检出：`dsh-v0.1.2-rc.1`，分支 `pet-locus-settlement-policy`。
- 变更：`ContinuableStartSpec.settlementNotice`（默认 `notify`），值写入
  durable descriptor；`notifySettlement()` 在构造消息之前对 `silent`
  直接返回，因此父日志没有写入、也无法被该通知唤醒。
- 边界：只抑制运行时自动结算账目；模型发起的 `send_message`、生命周期
  事件、ownership 释放和子会话自身 Session 不受影响。
- 兼容：写入 descriptor v4，同时保留读取 v3；旧子会话仍可恢复并保持原
  通知行为。v3 记录若声称携带新字段按格式错误拒绝。
- 上游验证：`packages/subagent` 全量 **31 文件 / 778 测试通过**，
  `run-oxlint.ts packages/subagent/subagent` **0 warning / 0 error**。

Pet 侧接入：`host/locus/child.ts` 显式请求 `settlementNotice: 'silent'`，
并要求端口证明该能力；未证明时创建 locus 子会话 fail closed
（`settlement-notice-unsupported`），不先创建再补救。

上游尚无正式 release；本仓已将该改动作为固定 patch/hash 与隔离 launcher override
声明进 `dsh.yaml` 并通过 capability probe。仍未做的是按既定顺序合入后物化到当前 Web，
而不是直接改 `$DSH_HOME` 生成副本。

### 存储一致性：上游改动已实现（尚未发布）

原缺口：locus 关联的多张表按顺序分别写入，崩溃可留下半更新状态；
「出错后尽量改回去」不能撤回读者已经观察到的状态。用户批准后改为
真正的事务，而不是先前设想的单行快照绕法。

- 事务：存储契约新增可选原子批量提交，domain 层暴露为
  `Domain.transaction`。事务体在写队列上登记写入，一次提交同时决定
  介质、内存与变更事件；失败则全都不生效。
  - SQLite：`BEGIN IMMEDIATE` / `COMMIT`，出错回滚。
  - JSON 单文件：登记后一次原子替换整份文件。
  - JSON 每记录一文件：**无法原子，因此不提供该能力**，调用方收到
    `transaction-unsupported` 明确拒绝，不退化为尽力而为的连续写。
- 独占写入：SQLite 后端新增可选 `exclusive`，持有介质的操作系统级写锁，
  竞争者在 **open 阶段**即以 `medium-locked` 失败，避免它基于陈旧读取
  继续动作。所有权由操作系统持有，进程退出（含 SIGKILL）自动释放，
  无需租约、PID 猜测或人工清理残留标记；已用真实进程强杀测试验证。
  默认关闭，多进程共享访问行为不变。
- 上游验证：`packages/storage` **107 测试通过**；
  `packages/storage packages/subagent packages/core/workspace`
  **36 文件 / 881 测试通过**；`tsc -b tsconfig.host.json` 通过；
  `run-oxlint.ts packages/storage` **0 warning / 0 error**。

Pet 侧接入：`host/locus/persistence.ts` 优先走事务提交，操作记录与其
描述的数据同批提交；宿主不支持时保留旧的顺序写入并明确标注二者不等价。
新增测试证明替换后重开介质仍然一致，以及注入失败后介质**没有**残留新
代际、旧代际与入口指针都未改变。

这些改动没有上游正式 release，因此本仓采用锁定 `0.1.2-rc.1` 源码、可审查 patch
hash、隔离 launcher npm overrides 与 runtime capability probe。`dsh.yaml` 已声明同一
storage override；当前 locus domain 版本为 v9。此处只证明 worktree 构建，按部署顺序仍需
合入后物化到现有 Web。

### 生产接入：locus 子会话组装已接通

`host/locus/composition.ts` 在运行时**创建子会话的同步边界**上组装
locus child：安装 caller-bound `pet_context` 到 child 自己的作用域，
并按 locus 授权应用文件策略后**回读核验**。任一环节不可用即抛错，
从而否决发布——发布后再补装会与首轮竞争。

- 只读/写授权必须与宿主实际解析结果一致：授 read 却解析出 write，
  或授 write 却降级为 read，都按 `policy-not-verified` 拒绝。
- 查询先判定「是否 locus child」：普通 Pet executor 与其它会话完全
  不受 locus 逻辑影响，也不会被其失败牵连。
- `index.ts` 已组装该 observer、策略适配与 sessions 解析。

验证方式是**真实 loader 执行**而非源码字符串匹配：安装了缺失的
`@deepseek-ai/dsh-storage-sqlite@0.1.2-rc.1`（Pet 的正式依赖，此前
环境缺失），使 `loader-composition`、`executor-composition-paths`、
`acceptance`、`sqlite-composition` 首次真正运行。

这暴露并修复了一个既有缺陷：`executor-composition-paths.test.ts` 全部
8 例此前从未执行，其中两例断言 observer 同步完成注册，而实现通过
`inject` 异步安装。经实测确认 `inject` 回调确实在后续 microtask 才
运行，故按真实行为改为等待安装完成；未放宽「先声明依赖再读取服务」的
安全约束，`executor-scope.test.ts` 对该约束的固定仍然通过。

### Task group 3 — Main/child creation

The standalone locus controller has injected ports for resolution, child
provisioning and Delivery persistence, but `index.ts` constructs none of them.
`LocusRepository` is storage only; it does not create/resume DSH main or child
sessions, enqueue a child inbox turn, ensure read policy, or observe cold
recovery. The production `createQaGroup` callback is the retired QA path and
must not be treated as the unified child adapter.

### 逐轮结算关联已打通（端到端验证）

`host/locus/turn-observer.ts` 把宿主两个独立事实连接成精确关联：

- inbox claim 证明**哪条消息**被**哪一轮**取走；
- turn end 证明**哪一轮**如何结束。

二者按精确 `(childSessionId, turn)` 连接，因此只有「跑了这条 Delivery
的那一轮」结束时才结算。明确不做：不按 FIFO、不按「最老待处理」、不把
子会话活动结束当作轮次、不为未运行即丢弃的消息报告结果。

`test/locus-settlement-integration.test.ts` 是**端到端**验证：真实持久
仓库 + 真实观察器 + 真实控制器，仅以宿主两个事件驱动，断言durable
Delivery 到达 `settled`，并覆盖：

- 两条消息交错、**后接受者先结束**仍各自按自己的轮次结算；
- 同一子会话的初始化/GUI 轮次结束**不消费**待处理 Delivery 的反馈；
- 同一轮次重复上报结束**不改写**已终态记录、不重复打表情；
- 结算最后一条待处理 Delivery 后释放 locus busy 栅栏。

### 逐轮结算已接入生产入口（真实事件验证）

`index.ts` 现在探测 locus 子会话接缝并构造关联观察器，订阅宿主真实事件
（`agent/inbox/claimed` 与 `session/event` 的 `turn/end`），并把关联结果
写回持久 Delivery。

`loader-composition.test.ts` 用**真实 loader + 真实持久层**执行验证：
发出那两个事件后 Delivery 到达 `settled` 且带精确 `turnId`；未认领任何
Delivery 的轮次结束则保持 `queued`。

这次真实执行发现并修复了一个「装了但没生效」的缺陷：观察器已订阅并发出
关联事件，但入口没有消费者把结果写入持久层，Delivery 会永久停在
`queued`。类型检查与源码匹配都无法发现这类问题。

同时修正三处 child 适配缺陷：

- 父会话恢复改走 `sessionController.resolveAgent`，它会重建持久 preset；
  裸 `agents.resume()` 返回的父会话工具组合为空（见集成陷阱记录）。
  控制器缺失时恢复保持不可用，而不是静默降级。
- 子会话可恢复性证明不再只比对 id：同一列表也包含诊断项与一次性子会话，
  运行时报告 kind/mode 时必须同时为 `child` 与 `continuable`。
- inbox 适配优先使用运行时自带的具名 helper，其参数契约由该包拥有；
  未提供时才回退到公开 symbol。

### 管理面已接入生产路由（真实路由验证）

`index.ts` 现在组装 `createLocusManagementPort` 并传入 `createPetRoutes`，
管理动作的审计身份由 Host 提供（`locusIdentity`），浏览器请求体中的 actor 一律拒绝。
`connection.requestRejection()` 只证明该浏览器持有当前 DSH Host 的 authority-bound
cookie，并不携带人员主体或飞书 open_id；因此它不能证明默认 Q&A 的“本人群主”。
默认 Q&A 创建会在副作用前通过固定 `dsh-pet` profile 执行已验证的
`lark-cli auth status --json --verify`，只接受 ready/available/verified 的
`identities.user.openId`，且该精确 open_id 还必须在 allowlist 中。用户登录缺失、
profile app 不一致、身份未验证、open_id 缺失或不在 allowlist 均 fail closed；不会
信任 request body、allowlist 首位或设置页文案。

已接通：所有者视图、endpoint/parent/child 三向发现、durable stop/archive/
scope 生命周期转换。**未接通**：bind、default Q&A、rebuild —— 它们需要真实
群/子会话provisioning适配器，未组装时路由继续报不可用，而不是半创建一个
无人拥有的飞书群。

会话与工作区元数据取自 Host 注册表；无法解析时保持缺失，不从 id 猜测，
因此「不存在」与「无标题」可区分。

`loader-composition.test.ts` 用**真实 loader + 真实路由 + 真实持久层**
验证 5 项：视图解析真实标题、三向发现同源一致、停止后仍是可见的停止
标记（这是拒绝自动复活的依据，而非隐藏历史）、外部创建动作明确拒绝、
请求体 actor 被拒且权限未被改写。

这轮真实执行又发现两处替身与真实运行时不一致，并修正一处实现缺陷：

- 测试替身缺 `workspaceRegistry.get` 与 `sessionTitle.get`，真实注册表
  都有；补齐后才真正验证了解析路径。
- 我最初从 `session.header.title` 读标题，而 header 没有该字段——读它会
  让**每个会话都无名**（曾导致所有群显示同一个兜底名）。已改为
  `ctx.sessionTitle.get(session)`，仓库对此的源码约束测试同时守住。

### 飞书链路已接线并显式门控

`index.ts` 现在组装：durable locus 解析（`resolution.ts`）、子会话投递桥接
（`child-delivery.ts`）、统一 channel 能力，并且只有门槛全部关闭时才把
controller 交给 `ChannelService`（此时它是**独占**路径，旧绑定/Invocation/
QA 查询都不参与）。

门槛写成显式判断并输出诊断，缺口对所有者可见，而不是隐含在「没接线」：

1. 子会话接缝（父会话解析 / continuable 创建 / inbox）；
2. 逐轮关联观察器；
3. **运行时能否抑制子会话自动向父会话汇报**。

第 3 项在官方 `@deepseek-ai/dsh-subagent@0.1.2-rc.1` 中缺失；已通过
下文的隔离 root launcher + npm transitive override 方案解决。Pet 只在实际
运行时实例发布 `supportsSettlementNotice: true` 时放行；未使用该 launcher
的官方运行时仍 fail closed，不会把“能传未知字段”误判成能力存在。

locus 解析层已可用并经端到端验证：已有活跃代际正常解析；**停止端点收到
普通消息时明确拒绝**，不自动新建替代代际、不入队。新端点在缺少
provisioning 适配器时报不可用，而不是自动创建。

本轮真实执行又发现两处替身与真实运行时不一致：共享桩缺
`agents.resume`（导致子会话探测停在父会话解析，**掩盖了后续所有门槛**），
以及缺 `workspaceRegistry.get` / `sessionTitle.get`。补齐后门槛诊断才真正
指向通知抑制这一实际缺口。

### Task group 5 — Channel interaction（历史记录）

以下为接线前的状态，保留作为对比：
`host/channel/locus-controller.ts` was not a production route. No complete
`LocusChannelCapability` was read from a Host service, no `petLocusChannel`
provider was registered by this package, and no observer was passed to
`createLocusChannelCapability`. Consequently the channel still parsed
legacy events and can create legacy chat `Task`/`Invocation` records. The
legacy route also does not use the unified endpoint/thread key, so it is not an
acceptable substitute for the new topic semantics.

The locus child context branch is likewise only a storage adapter today. The
ordinary `agent/created` observer selects agents through `repository` Tasks and
explicitly skips `qa-chat`; a unified child that has no legacy Pet Task is not
automatically composed with `pet_context` by this path. Do not claim task 5/6
completion from the standalone locus tests.

### 旧模型退出：不得静默接管（已实现）

`host/locus/retirement.ts` 把一个入站 endpoint 判定为三种情况之一，并且
**不允许把第三种折叠进第二种**：

1. 有当前统一 locus → 正常服务；
2. 两个模型都无记录 → 允许建立；
3. **旧模型曾绑定过** → 拒绝，并说明需所有者显式重建。

把第 3 种当成第 2 种，会用全新 default 身份接管旧群；当成普通错误，则
所有者得不到唯一有效的处置指引。旧表读取失败按「无法证明」处理，同样
拒绝接管。

旧行只投影 endpoint 与粗粒度形态：**不暴露** workspace、session、Task
字段，因此无法从中恢复旧执行身份。群内回执说明历史保留、需重建，且不
泄露本入口之外的任何标识。

已接入 `resolution.ts`（建立前先证明不是退休关联），并在生产入口以
`asRetiredAssociationStore(repository)` 只读接线。

### 固定源码补丁 + 根 launcher override（已隔离验证）

`packages/dsh-pet/compat/subagent` 以固定上游源码提供带
`settlementNotice` 的 `@deepseek-ai/dsh-subagent`。补丁现在是 323 行、
3 个源文件，额外发布一个字面量能力标记 `supportsSettlementNotice: true`：
旧运行时会静默忽略未知字段，所以 Pet 只有看到**实际加载的运行时实例**
持有该标记时才放行，不能仅凭“字段可以传进去”猜测支持。

被跟踪的只有可复核来源；`lib/`、上游检出与 launcher 依赖根均忽略。
`build.mjs` 仍执行补丁哈希校验、可应用性检查和能力自证；Typert 首次拒绝
了缺显式类型的公开 marker，修为 `readonly ...: true = true` 后才通过，
没有绕过生成器。

**Pet 的 `compatDependencies` 直接覆盖主包仍不可行**：profile 与 DSH 主包是
两个依赖根，装进 profile 的副本不会替换主包传递依赖。可行方案不是 fork
223 个包，而是一个隔离 root package；当前已进一步从每机 `DSH_BIN` 收敛为
`dsh-pet.hostRuntimeCompatibility` 声明：

1. root 精确依赖官方 `@deepseek-ai/dsh@0.1.2-rc.1`；
2. npm `overrides` 把主包所需 Subagent/Storage 传递依赖指向 reviewed 补丁产物；
3. 仅 `scripts/dsh-server-bin.mjs` 为长期 Host 准备/选择该依赖根；官方一次性 CLI
   仍走 `dshVersion` 精确版本。

已执行的隔离验证：

- `npm ls` 显示 base、fork、driver、SDK、web-app 和所有工具共用同一个补丁
  subagent，**无双副本**；
- `require.resolve()` 命中补丁目录，版本与补丁 SHA 标记正确；
- 实际 `SubagentRuntime` 实例的 `supportsSettlementNotice === true`；
- 加载代码包含 `silent` 早退，descriptor 的 `silent` 持久化、`notify`
  默认形态不变；
- `scripts/dsh-server-bin.mjs` 无显式覆盖时按 Pet 声明返回该 launcher 的真实
  `lib/bin.js`；
- 官方 CLI 对现有 web profile 成功执行 `--dump-config`，且未构建/加载 launcher；
- launcher 以共享锁、bounded process group、sibling staging 和原子 publish
  固化构建，失败保留旧成品；fingerprint 含 checkout canonical path。

`.launcher/` 被 gitignore，Pet 不再要求 `.env.local DSH_BIN`。旧机器残留的当前
checkout 历史值会由 `bin/dsh` 精确识别并迁移忽略；人类显式 `DSH_BIN` 不受影响。

仍拒绝的替代方案：外部 shim 会同时破坏真实父子消息；直接修改 npm 缓存
不可审查且升级即失效。上游一旦发布该能力，应删除 override 与本目录。

### Task group 8 — Breaking cutover（已实现，待合入后物化）

生产 `ChannelService` 现在强制 `requireLocus`，统一 capability 缺失即 fail closed；不再接线
`QaDelivery`、legacy `bindCommand`、旧 Q&A create route 或
`invocation_channel` settlement。旧表与旧 session/history 仍原样保留，但只作历史与明确
retirement 识别，不参与新执行。命中可识别旧入口会给出有界显式重建提示，不用 default
身份接管。`scripts/cutover-backup.mjs` 提供 SQLite online backup + integrity check，具体停流、
快照、回滚顺序见 `docs/notes/pet-unified-locus-cutover.md`。当前仍遵守用户指定的部署顺序：
先完成 worktree、合入，再在 main checkout 物化和验证现有 Web。

## Verification performed

Latest worktree verification (before main-checkout materialization):

- `npm run build` in `packages/dsh-pet`: passed; patched storage was up to date, Host and client bundles built. The pre-existing tsdown `define` option warning remains non-fatal.
- `npm test` in `packages/dsh-pet`: 97 files / 1474 tests passed.
- root `npm test`: 101 passed / 1 skipped.
- root `npm run check:artifacts`: passed.
- strict OpenSpec validation: all 3 current changes passed.
- isolated patched DSH launcher check: up to date.
- real macOS Seatbelt effects: read-only denied writes; workspace-write allowed only the selected ordinary/ws/sw root; sibling/parent writes were denied; cold-provider read-only remained denied (`enforcement: full`).
- real `lark-cli event list/schema`: confirmed `im.chat.member.bot.added_v1` (V2 envelope, operator open_id) and flat `im.message.receive_v1` (thread/root/reply fields). A bounded redacted capture received one real bot-added event and proved `schema=2.0` plus string event/chat/operator-open-id fields; no identifier was retained. Topic-message capture remains open: the first two bounded windows received zero matching events. Both consumers reached the ready marker.
- cutover rehearsal: online backup + integrity check passed; offline rollback additionally proved stopped-gate → preserve v9 → restore compatible v8 snapshot without replay/down-migration, while retaining locus/Delivery forward state, session logs and external-group marker.

Historical verification below records earlier implementation stages and is superseded by the latest results where counts or blockers differ.

- `npm run build:host` in `packages/dsh-pet`: passed.
- `npm run build:client` in `packages/dsh-pet`: passed (tsdown emitted the client bundle; it reports a pre-existing unsupported `define` option warning).
- The current focused locus/adjacent suite passes: 17 files, 240 tests (including durable Delivery close/reopen/rebind/settlement and lifecycle/route hardening regressions).
- `openspec validate --changes pet-unified-locus-collaboration --strict`: passed.
- Earlier staged failures below are retained as history only. Full Host + client `npm run typecheck`
  now passes, SQLite loader composition resolves, and the latest package run is 97 files / 1471 tests
  passing. The remaining acceptance boundary is post-merge materialization in the existing Web plus
  real Feishu event samples, not missing TypeScript packages or an unproven storage seam.
- `pet-locus-multi-binding` remains superseded; `restore-blocked-composer-height` is a separate active change.

The reviewed runtime override now supplies the required silent idle child, transactional
storage and exclusive SQLite owner; production composition proves locus resolution, child/inbox,
Delivery persistence, caller-bound context/reply, sandbox policy and exact per-turn observation
before enabling unified work. If any gate becomes unavailable, the only safe behavior is the
implemented fail-closed unavailable state — never a guessed unified route and never the retained
legacy channel.
