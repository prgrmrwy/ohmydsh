# B035 独立 agent 与同源协作上下文：实施证据

对应 change：`pet-locus-independent-agent-inquiries`。本文记录实际核验，不把源码阅读、单测通过或规划存在视为真实运行验收通过。

## 实施位置与安全边界

所有者在 apply 阶段明确选择当前 `/Users/prgrmrwy/opensource/ohmydsh` main 主检出实施，不创建 worktree。保留未提交的 B035 提案与 BACKLOG；不自动提交，不手改部署 home，不对现有 Locus/session 执行重建或迁移。独立实验须使用临时介质；部署、实际飞书载体及生产重启另核对目标和授权。

## 1.1 前置基线核对（已完成）

按 manifest、current specs、前置 change、B035 四份 delta、实现证据核对：

- `dsh.yaml:5,89–111`：固定 DSH `0.1.2-rc.1`，Host 使用 `pet-unified-locus-v1` compatibility，显式 storage overrides。
- `packages/dsh-pet/src/host/locus/child.ts:303–311,704–723`：idle continuable 默认 `fork`，要求实际 idle/silent capability。`src/index.ts:1165–1195` 创建时未覆写 provider。新独立模式尚未实现。
- `src/index.ts:666–743`、`src/host/locus/policy-verification.ts:80–123`：当前 child/staging 的 scoped context/read 策略与 live canonical root 核验存在。
- `src/host/locus/management.ts:593–655` 是 owner 全量发现；`src/host/locus/context.ts:339–345` 仍只指导原生 parent send_message，不是 B035 兄弟询问服务。
- `src/host/locus/turn-observer.ts:418–550`：已区分 Host 注入、未决 claim 与明确污染；只授权唯一 clean Delivery。出站工具在 `src/host/tools.ts`；原有发送成功返回不等于 B035 持久多轮回复台账。
- `src/host/spec.ts:50–68,857–877`：domain v9 保留旧历史及统一 Locus 表，无公共事实/询问表。

以上 `src/` 路径相对 `packages/dsh-pet/`；行号为本次核对时定位，修改后以函数/规范标题为准。

### current specs 与前置未归档状态

current `pet-qa-group` 仍是旧 QA 1:1/fork；`dsh-pet` 与 `pet-lark-channel` 仍有旧 channel root/Invocation 条文；current 无 `pet-locus-collaboration`。这是 B035 已明确承认的前置未归档状态，不是本次新发现的行为选择。

前置 `pet-unified-locus-collaboration` 仍为 **57/64**：未完成 `9.6`、`10.1`、`10.2`、`10.3`、`10.5`、`10.6`、`10.8`。其 `10.15` 的 27/27 checkpoint 记录明确排除“有未完成 Delivery 时重启不重放”的子项，不扩大其证据覆盖。`BLOCKED.md` 开头已声明旧阻塞解决，不以历史故障冒充当前阻塞。

前置实际有五份 delta：`dsh-pet`、`dsh-runtime-provisioning`、`pet-lark-channel`、`pet-locus-collaboration`、`pet-qa-group`。其 proposal capability 列表漏列 runtime provisioning，但 impact 和该 delta 存在；前置收尾应显式对齐，不能在归档时丢第五份 delta。本次不修改前置任务或替它接受范围例外。

### B035 四份 delta 的准确边界

| Capability | Delta | 替代/新增范围 |
|---|---|---|
| pet-collaboration-context | 新增 5 requirements | 单 parent 公共事实、owner CAS 确认、按需当前版本读取、挂载/退出生命周期、局部权限分离 |
| pet-agent-inquiries | 新增 6 requirements | 同源最小列表、目标重验、scoped 装配、非 steering 异步询问、效果限制、持久预算与恢复 |
| pet-locus-collaboration | 3 MODIFIED + 1 ADDED | 双向发现、独立上下文、跨轮 Delivery，以及显式空闲重建 |
| dsh-pet | 2 ADDED 窄覆盖 | 子组合配置继承不再意味着复制 transcript；公共/发现/问答工具的 scoped 例外，不开放父的 child context/reply |

B035 三个 MODIFIED 标题均与前置逐字匹配：`关联具备双向发现且不过度披露`、`上下文按实际子会话绑定并允许按需问主会话`、`投递与结算关联独立于会话运行状态`。合计 14 ADDED、3 MODIFIED、55 scenarios。

归档顺序：前置未完成项诚实完成或取得 owner 范围处理决策 → 前置五份 delta 同步 current specs/归档 → 重核 B035 与新 current 标题和完整行为 → B035 实施、验收完成后同步/归档。本次可进入 G1–G5 调查，不必为了调查先假归档前置；B027 通用错误文字、B028 模型 fallback 不顺带纳入 B035。

## 实施前自动化基线

在任何实现代码修改前运行：

| 命令 | 实际结果 |
|---|---|
| `npm test` | 122 项：121 通过、1 skip、0 失败 |
| `npm run test --workspace=dsh-pet` | 108 文件、1669 测试全部通过 |
| `npm run typecheck --workspace=dsh-pet` | Host 与 client tsc 均通过 |
| 两 change 的 `openspec validate <name> --strict` | 均通过；仅证明规划结构有效 |

前三项为同一顺序 job，最终 exit 0。UI 测试已有 React act/createRoot 警告；本次不把既有警告归为 B035 回归或顺带修复。现有 loader tests 在缺少真实 subagent/atomic/policy 服务的 fixture 中有预期 unavailable 日志，不能据其全绿宣称固定 runtime 的 G1–G5 完成。

## 宿主源码调查（尚不等于门槛通过）

检查的是当前会话指定的自包含 launcher：`packages/dsh-pet/compat/subagent/.launcher-builds/eb586fe8ead9f58d0e54a8a2f527c2947acf1c1d685a9e78330716cb81b653d5-58844649-a3be-4ae2-b6c1-aa63ebcacbca/`。

- G1：官方 spawn `lib/index.js:30–38` 不继承父上下文，prepare 返回空配置。compat subagent `lib/types/continuation.js:367–432` 先同步解析模型、写 descriptor，再准备 seed；仅有这个函数存在不是多轮/冷恢复证明。
- G1 组合缺口：`continuation.js:992–1019` 在新建和恢复都调用 `applyChildComposition`；`child-agent.js:157–158` 无条件 `composeFrom(childCtx,parent.ctx)`；官方 agent-presets `lib/index.js:1533–1539` 从 parent **当前 live** standing 绑定 child。child header 虽保存 preset，恢复组合仍采样父当前组合。B035 要求恢复自身配置，不能直接换 spawn 后忽略这个分歧。应在新独立模式窄路径恢复持久 preset 配置；不改变旧 fork 语义，不额外许诺锁住所有 Skill/插件文件字节版本。
- G3：`followup` 是 next-turn 路径，不等于排他 origin；当前 inbox claim 会先取 next-step 消息。需在真实交错序列证明非 steering 和唯一执行片段，保留 GUI mixed fail closed。
- G4：runtime 有 `tools.guard()` 和 `tools/execute` 拦截，不能宣称全无接缝；guard 发生在 preparation，后续异步 wrapper/执行边界仍需测试，不能把 prompt-only/read 文件沙箱当成效果限制。

### G3–G5 接缝细化

- `dsh-agent-loop` 的 `followup` 使用 next-turn；`Inbox.claim` 先取全部 next-step 再取一条 next-turn。直接运行固定 runtime 的 Inbox（synthetic Session/message，不触及真实历史）观察到 `[GUI next-step, Inquiry next-turn]` 同次 claim，后续 Delivery 留在队列。这要求 Pet 同时实施自身可运行队列和 pre-step 来源重验；不能仅依赖 followup 或用 agent.status idle 充当原子预留。
- `tools.guard` 对 global/ancestor/own scoped 工具均可拒绝；`tools.restrict` 不限制本层工具，不能单独用它实现询问隔离。询问限制应是常驻 scoped guard 查询当前精确 segment，不临时改 shared sandbox policy。`tools/execute` contract 只允许 signal 替换，参数冻结；不能以任意参数改写推导风险。
- preparation guard 之后还有可 await 的 execute wrapper，最终 `dispatchToolBody` 再 live resolve 工具。需要测试暂停 wrapper 后撤权/HMR 同名注册替换的窗口；若要对该窗口作最后无 await 校验，窄候选是 dsh-tools 在实际 resolve 后、bodyInvoked 前重验 monotonic guard，并使 guard 可识别实际定义；旧全局工具语义保持原样。
- `concludeTurn()` 不是取消同一 response 后续工具。origin/restriction 必须保持直到整个 turn drain；answer/显式完成设置 terminal fence 后，同轮尚未开始的效果调用应拒绝。
- inbox splice 可作为持久接受/移除证据，claim 通知本身是 live event。pre-step 拒绝后不一定产生 user/message；不能仅扫描 user/message 推断是否已经 claim。Session.append 也不是磁盘提交，必须核验实际 flush/checkpoint。
- 当前 child queue 在接受后才返回内部 UUID；如果 DB bind 前 crash，不按问题文本匹配猜身份，保留 needs-review。无需为了宣称 exactly-once 新建危险重放；保留具体不确定原因属于规范允许结果。
- 当前 `src/host/tools.ts` 的 replyExact 缺少持久发送意图；`src/host/lark.ts` 检查返回 message_id 但丢弃。需在 Pet 记录发送前 intent、返回 platform ID/成功 outcome；外呼与提交之间丢确认留 unknown，不重发。

## 已执行的固定 runtime 诊断探针

新增两份 opt-in 测试（必须显式 `DSH_PET_TEST_RUNTIME`；默认跳过，绝不偷换本地依赖）：

- `packages/dsh-pet/test/independent-runtime-probe.test.ts`：实际 spawn prepare、child options resolver、真实 Cordis/Loader/AgentPresets scopes 与临时空 preset。三项证明：空 seed；显式模型快照可保持；**当前缺口** cold composition 选 parent 新 preset，而旧 warm child 仍为原 preset。
- `packages/dsh-pet/test/inquiry-runtime-probe.test.ts`：实际 Inbox、ToolRuntime、Cordis/scope，工具只累加内存计数。四项证明：next-turn 不在 next-step 提前消费；**当前缺口** GUI next-step 可与 inquiry co-claim；scoped guard 能拒 global 与本层工具；**当前缺口** preparation 后等待 wrapper 期间撤权，最终 body 仍执行一次且 guard 只检查一次，下一次新调用才被拒。

父 agent 独立运行两份测试：**2 文件、7/7 PASS**；随后 Pet host/client typecheck、OpenSpec strict 和 diff whitespace 检查全部 exit 0。PASS 表示这些当前行为可复现，两个标记 CURRENT GAP/DIAGNOSTIC 的观察通过恰恰证明不能按原样发布。不是完整 AgentLoop、真实 model 请求、冷 session 恢复、文件沙箱或飞书验收。测试不触及生产 home/凭据/真实历史。

## caller resolver 模块进展

`src/host/collaboration/caller.ts` 实现共享身份解析，不注册工具、不开模型、不写状态。Host 提供实际 caller，resolver 同步读取 lossless child/反向/parent/endpoint 当前索引，cold inspect caller 与固定 parent，随后再核对身份/归档/关系。结果冻结且不含 endpoint、权限、局部资料或历史；它不是 bearer capability，派发仍须重验。

`test/collaboration-caller.test.ts` 初次运行以 missing module 明确 RED；实现后 GREEN。独立静态审阅发现两项真实接缝误拒（pending switch notice 将 active sibling 投影为 switching；busy 变化递增 revision/updatedAt），补两条 RED 测试后修复：排除匹配 switching sibling但仍拒 switching caller；身份 fingerprint 不包含非身份 revision/timestamp。另外覆盖真实 durable repository 重开、丢失 child index、归档 sibling 和 parent dangling reverse index。

最终范围测试 **34/34**，host/client typecheck、check:artifacts、OpenSpec strict、diff whitespace 均通过。期间还跑过全部 Pet regression（在最终两次小范围补充前），exit 0；最终变更已范围重验。该模块尚未连接 Host cold identity adapter/scoped tools，2.3 不勾完成；不因局部模块进展绕开 G1–G5。

## Host identity / 公共事实值模型进展

`host/collaboration/host-identity.ts` 衔接实际 `sessionController.inspect` 的 meta 形状（指定 runtime dsh-api-session-controller/lib/index.js:2669–2682），读取 id/parentSession，不使用 live Agent fallback，也不消费返回的 events。注意官方 inspect 自身可能 snapshot/read 事件，这个 adapter 不宣称底层 metadata-only I/O。archive 缺失/损坏/读失败及 await 中归档 fail closed。20 条新测试；真实 durable repository 重开测试现已串过此 adapter，但 sessionController 本身仍为 shape-faithful fixture，不冒充真实冷 session 验收。

`host/collaboration/context.ts` / `test/collaboration-context.test.ts` 新增纯公共事实值模型和 58 条测试。parent-bound unknown revision0；下一 revision 完整替换三个公共字段，带 owner/source/time/当前及未来同源成员共享范围确认。严格有界运行时验证、复制并深冻结、版本冲突/overflow 拒绝。null 表示未知，空字符串/数组明确撤回，不回填局部字段或旧版本。`VerifiedOwnerContextConfirmation` 只是经过 Host 鉴权后的可信事实输入，形状本身不提供鉴权；纯函数不是持久 CAS/事务/审计，不可单独对模型开放。

父 agent 重读实现，补 accessor/稀疏/decorated array 测试（context 最终59条），并独立执行 4 文件（context/caller/host-identity/旧 locus-context）：**127/127**；Pet host/client typecheck、额外新测试 TypeScript 编译（ES2024 lib）、artifact 检查、OpenSpec strict、diff whitespace 均 exit0。未改 schema/介质/部署/真实历史。2.3 仍缺生产装配，2.7/2.8 仍缺事务 store 和 owner 路由，不提前勾完成。

## 公共事实事务存储 / additive schema v10

新增 `context-store.ts`，当前+完整修订通过 Domain 自身串行 transaction 的 callback 内 CAS 和同一 applyBatch 提交；跨 repository 实例不能同时消费相同 revision。ensure 并发幂等但不是 lifecycle 授权；owner auth 尚未接入。读时校验当前与对应审计一致；审计保留、已有修订禁止覆盖、丢失当前不得 reset。纯模型导出 `parseCollaborationContext` 供 schema 实际运行时校验。

`spec.ts` additive v10 增加 `collaboration_contexts`/`collaboration_context_revisions`，保留所有旧表/行；离线 migration CLI 扩到 v2..v9→10，只 restamp、有备份/锁/显式确认，不猜旧模式/不处理真实日志。本轮只用 temp db 跑测试，未执行生产迁移。Host legacy helper allowlist 同步含9，不新增自动迁移调用路径。

`vitest.collaboration-runtime.config.ts` 显式验证指定 runtime 的 storage/domain/cordis package identity、版本、realpath containment 和 compat SHA，以实际 patched Domain + 内存介质执行；绝不为测试伪造 transaction。首次 config 误写官方版本而被 provenance fence 拒绝，读真实 manifest 后改为 `0.1.2-rc.1-locus-atomic.1`，没有弱化检查。

验证：实际 atomic store **7/7**，包括第二笔 batch 写失败 bytes 不变、current/audit 不变与跨实例 CAS；额外 store test TypeScript 编译通过。全量 Pet **1843 passed/13 skipped**（固定 runtime suites 正常显式跳过，另行 opt-in 执行）；typecheck通过。schema/migration新旧4组 **152 tests** 由子 agent 跑过，并包含于父全量。独立只读审阅确认实际 Domain enqueue→callback→applyBatch→内存发布顺序符合 CAS，不把外部鉴权缺失当作已完成。

仓库 `npm test` 本轮 **120 pass/1 fail/1 skip**：未修改的 `tests/pet-compat-build-lock.test.mjs` 两 waiter stale recovery 观察到 enter/enter/exit/exit。单独重跑 **3/3 pass**，只能证明偶发，不算全量已绿。静态线索：stale boolean 判断与后面的 observed owner 不是同一快照，fresh mkdir/owner.json 窗口可能被 unknown reclaim；构建之前需专项复现并修复，不能直接忽略失败或仅靠多次重跑。artifact/strict/diff单独检查通过。

## 已复现并修复：compat build stale 回收竞态

后续专项固定调度复现了上一节的失败原因：old stat 返回之后另一 waiter 删除 dead owner 并建立新目录，原逻辑随后重新 readOwner 得到 undefined，将旧 stale 布尔值错误用于新目录并删除它。回归 helper `tests/fixtures/pet-lock-race.cjs` 拦截 fs.statSync 调度点，原锁源码稳定 RED（assert thief=false 实际true），修复后 GREEN；不依赖运行概率。

`compat-build-lock.cjs` 保留首次 owner/token/PID/inode快照，在同 token reclaim guard 内重验目录和死亡状态。无 owner/格式损坏不是死亡证明，因此有界拒绝、不自动删除；遗留 claim 的等待也现在遵守 timeout。`compat/subagent/README.md` 说明先确认全部构建已停止再手工恢复这些未知残留。原生 token 继承路径不变，未修改 runtime patch SHA。

测试改用 mkdtemp 内原样 source copy，锁/日志/清理都只触及测试临时目录，不再删除真实 builder lock。最终 **6/6**（确定性竞态、双进程互斥、死 owner 恢复、ownerless拒绝、遗留claim超时、双 waiter stale回收）。全仓库复跑 **124 pass/1 skip/0 fail**，artifact/strict/diff检查通过。没有构建或部署 runtime；本修复会改变下次合法构建的 fingerprint。

## 公共查询、scoped tool 与 owner HTTP slice

`query.ts` 在同一个 `readForCollaborationCaller` 最终身份 fence 内读取当前公共 record；父/child 共用同一 parent revision，退役/无关 caller/缺失 record/corrupt parent fail closed，不读 audit 或下载 references。`tools.ts` 只注册无参数 `pet_collaboration_context`，必须从实际 Agent scope 注册；scope test 证明 global/ordinary scope 无泄漏，也不附带 `pet_context`/`pet_locus_reply` child-local surface。

`collaboration/routes.ts` 是一个独立 owner-only exact route factory：真实 DSH Connection cookie/origin fence 后，再要求 Host 提供 target-parent 的 `{kind:'local-owner',actorId}`。现有生产 `locusIdentity: host:dsh-pet` 只是插件标签，不能升级为 browser owner；因此 index 中只计算 `collaborationOwnerIdentity() === undefined` 的空 route，不挂载新编辑接口，直到真实 Connection/browser owner authorization 接缝明确。这是 fail-closed，不是静默削弱。route 测试实际使用 Connection+WebServer+HTTP，55/55；query/scope 44/44，loader regression 41/41。

新增的生产 wiring 当前只创建 store/identity，未注册 collaboration tool，也未用旧 actor 标签给 owner 权限；待接缝决策/实现后再装配。现有 Host typecheck、route/query/scope/loader 测试全部通过。

## 规范修订：公共事实改为范围内自主写入

所有者审阅后取消了“owner 逐条确认”的要求：公共事实不授予任何能力（不改文件、外呼、凭据、执行根或沙箱），也不对用户公开，只是同源范围内 agent 之间的共享笔记，因此不按 Locus read/write 分级，也不需要人工确认。规范、design、proposal、tasks 已同步修订，strict 校验通过。

实现随之改名并补齐写入面：`confirmCollaborationContext` → `updateCollaborationContext`，状态 `confirmed` → `authored`，`confirmedBy/At` → `authoredBy/At` 并新增 `authoredByLocus`（parent 或 child+locusId+generation）；`explicitConfirmation` 整个移除且作为未知键拒绝。store 的 `confirm` → `update`，CAS/原子批/审计语义不变。新增 `write.ts` 的 `updateCollaborationContextForCaller`：在 caller resolver 的同一 fence 内派生写入者身份与代际，模型无法指定 parent/作者/时间/范围；REVISION_CONFLICT 原样上抛以便重读，其余统一安全拒绝。`tools.ts` 增加独立的 `pet_collaboration_context_update`，与只读工具分开注册，读写可分别授予。

工具参数一度使用 `nullable`，被实际 Tools DSL 在定义期拒绝；改用该 DSL 支持的 `oneOf` 联合，使“未知”仍可表达，而不是逼模型编造值。

同时修复了我上一轮引入的真实缺陷：`wire.ts` 声明了协作上下文路由但生产不挂载，违反“声明的路由必须恰好注册一次”，导致 `route-validation`/`wire-locus` 两个 suite 失败。按修订后的定位（该面是可选查看/纠正面）撤回声明，两个 suite 恢复 31/31。

## 协作者名单（原“协作者目录”）

`collaborators.ts` 的 `listCollaborators` 按实际执行 session 解析范围：主会话得到自己当前的 child，child 得到父与兄弟并排除自己。返回身份、关系、可辨识名称与可达状态，不含 endpoint、workspace、权限、锚点或历史；退役与归档成员直接不列出，仅未加载的成员保留并标 `needs-restore`，描述失败标 `unknown` 而非 `available`。新增 scoped `pet_collaborators`，无目标参数，与读写工具分开注册。12 tests + 工具作用域 3 tests 通过。

命名更正：所有者指出“目录”会被误读为文件夹，而它其实只是一个查询方法。规范、design、proposal、tasks 中指代成员列表的“目录”统一改为“名单”，指代文件系统的“工作目录”保留；代码模块 `directory.ts` → `collaborators.ts`，类型 `CollaboratorDirectory` → `CollaboratorRoster`。

实现期间遇到一次真实不变量拒绝：话题 locus 必须带所属群 locus，测试 fixture 构造有误；已改用另一主会话的独立群入口表达“同群异父”，而不是放宽不变量。

## independent-v1 兼容补丁已实施（未构建、未验收）

tracked `settlement-notice.patch` 扩展为同时携带 settlement notice 与 independent-v1：opt-in `contextMode`、descriptor v5 的 `contextMode`+`agentPreset` 成对严格校验（v3/v4/one-shot 保持旧行为）、首个 await 前捕获模型/preset/child metadata、provider 必须 `inheritsParentContext=false` 且不得返回 seed、两条冷恢复路径都传 descriptor 字段、独立组合改为 await 挂载子会话自己保存的 preset 并核对持久 header（不匹配即失败，绝不回退父组合）、projection stateVersion 2→3。

父 agent 独立验证（非仅采信子 agent 报告）：`shasum` 得到 `2149e66c762ba60d501c70e3ee1863fc40be856e1733312393335487735290e0`，与 build.mjs 和 build-launcher.cjs 中的钉值一致；在固定提交 `a66e4702` 上 `git apply --check` 与 `apply` 均干净通过；打补丁后上游 subagent `tsc --noEmit` exit 0；随后把 scratch `.upstream` 还原到固定状态。仓库全量 124 pass/1 skip/0 fail，artifact 检查通过。

**这不是 G1 通过**：本轮没有运行 builder、没有生成新 runtime、没有部署。真实 Agent 冷恢复、实际工具/Skill/模型快照、GUI 打开与发送实路、已删除 preset 的拒绝行为，都必须在授权环境另行验证；在那之前 1.2/1.3 保持未勾选。注意现有固定 diagnostic runtime 仍是旧产物，一旦重建就不再是此前探针的同一被测对象。

G1–G5 任务保持未勾选，直到满足各项真实验收条件。以上发现用于细化测试与窄兼容实现，不授权弱化规范。

## 询问副作用围栏与调度器（Pet 侧半程）

`host/inquiry/effect-fence.ts`（53 tests）：询问轮只允许白名单内工具，未知工具一律拒绝；白名单之下另有不可覆盖的硬底线，含 write/patch/shell、外呼、委派，以及 `pet_locus_reply` 与公共事实写入——后两者携带的是**被询问方自己的权限**，询问轮不得借用。关键语义是 `run()` 在 await 窗口之后、调用工具正文之前**再验一次**，正是探针记录的运行时缺口所在；`close()` 之后所有调用（含已挂起的）一律拒绝。拒绝原因稳定，不回显参数或内部状态。

`host/inquiry/scheduler.ts`（26 tests）：目标忙时排队而非 steering；等待答复不占运行槽，但原工作仍计为在途，两个判定分离；A、B 互问可同时推进，无调度死锁；答复在请求方忙时排队而非打断；溢出确定性地拒绝最新一条，不重排已接受顺序。混入 GUI 输入的认领即使目标空闲也拒绝派发。

父 agent 独立复跑两模块 **79/79**，typecheck 通过。两者都不构成 G3/G4 通过：围栏只约束经它路由的调用，调度器只约束经它调度的片段。

## 已确认的 G3 阻断项：认领是纯删除

两个子任务各自独立指出同一问题，我核对运行时源码确认属实：`Inbox.claim('next-turn', turn)` 会把待处理的 `next-step` 与队首 `next-turn` 一次取走，且 `claim` 是纯删除（`mutate(..., [], false)` 后发 claimed 通知）。因此 Pet 侧只能**检测**混合来源，无法退回；若据此拒绝该片段，被卷走的用户 GUI 输入将没有重投路径而丢失。

结论：安全的非抢占询问队列**必须**有一个窄运行时接缝——允许只认领队首 next-turn 而不清空 next-step，并以能力标记供 Pet 探测、缺失即 fail-closed。这属于已规划的 G3 门槛与既有补丁流程，不改变产品语义，已按同一流程实施中。在该接缝成立并验证前，1.5/1.6/4.2/4.3 保持未勾选。

## G3 接缝已实施：隔离认领（未构建）

tracked 补丁新增 opt-in `Inbox.claim(target, turn, { isolateQueuedTurn })`、`AgentOptions.isolateQueuedTurnClaim` 与 `AgentLoop.supportsIsolatedQueuedTurnClaim`。隔离时对 `next-step` 零操作（连零宽 splice 都没有，否则会写出多余持久事件），且要求确有排队询问——否则空批次会结束该轮，把用户输入永久搁置。默认路径逐字不变。

派生过程中发现并修复两个真实问题：隔离空队列导致用户输入饿死；只隔离首次认领时，第二步待处理输入仍会混回同一轮。

父 agent 独立验证：SHA `4b70988900e69aaf806a8c5e4d8c517bd17479e95ce25131ea87dc02e688c941` 与两个 builder 钉值一致；固定提交上干净应用共 9 文件；读过 inbox 实现确认语义；上游 `packages/core/agent` + `agent-loop` **441/441** 通过；scratch 还原。

**交付缺口（已核实并修复）**：当前 launcher 只覆盖 subagent 与四个存储包，`dsh-agent` 解析到未打补丁的官方构建——`grep isolateQueuedTurn` 在现役 launcher 的 dsh-agent 中 0 命中。补丁本身原本是死代码。因此 builder 扩展为发布并覆盖 `dsh-agent`/`dsh-agent-loop`，并把它们纳入依赖存在性证明、结构与真实 Inbox 实例校验。`.gitignore` 增加 `agent-artifacts/`（与既有 storage-artifacts 同类，生成物不得入库）。

仓库守护测试 `tests/pet-locus-runtime-override.test.mjs` 原断言写死旧的单次 `npm ls` 参数顺序而失败；已更新为覆盖全部被覆盖包，并补充接缝关键行为（`isolateQueuedTurn`、能力标记、非空队列要求）与新忽略项断言——是加强而非放宽。仓库全量 124 pass/1 skip。

`inquiry-runtime-probe.test.ts` 仍钉旧构建，这是正确的：它记录的是那个构建的实际行为。原 “CURRENT GAP co-claim” 用例改名为 **BASELINE**，并注明重建后默认路径仍应合批、而询问派发必须使用 opt-in，避免日后被误读为“缺口仍在”。

**仍未构建、未部署**：接缝存在于补丁而非现役 runtime，因此 Pet 侧必须 fail-closed（无能力即不可询问）。1.5/4.2 在重建并验证前保持未勾选。
