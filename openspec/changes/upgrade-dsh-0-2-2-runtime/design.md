## Context

- 现状：`dsh.yaml:5` pin `0.2.1-rc.5`，生产 3080 自 2026-11-05 起运行该版本。上一轮升级 change 已归档到 `openspec/changes/archive/2026-11-06-upgrade-dsh-0-2-1-runtime/`。
- 目标：`@deepseek-ai/dsh@0.2.2-rc.1`（npm latest=next）。以下证据都来自 0.2.2-rc.1 npm 发布物，经 lead、协作会话和第 1 轮评审者分别核对：
  - `dsh-agent-loop/lib/index.js:670-671`：`preStep` 先 claim inbox，再读 `model.current()` 固定本步 selection；`:685` 才进入 `agent/pre-step`；`:1000-1001` 中 `agent/request` 的返回值只要与 selection 不同就抛错。
  - `:103-110`：`claim()` 领取全部 next-step，加 next-turn 队首**一条**，然后对每条同步 emit `agent/inbox/claimed`，返回后 `:671` 才读 selection。`dsh-agent/lib/types/runtime-types.d.ts:215-216`：普通 followup 独占自己的回合。
  - `:746-748` 与 `runtime-types.d.ts:293-296`：pre-step `reject` 让回合以 blocked 结束，已领取的消息就此消费。
  - `:564-569`、`:199-200`：`send()` 先 `inbox.splice`，其中同步 emit `agent/inbox/inserted`，然后才 `wakeDriver()`；`:618-622`：维护阶段只置 `wakeRequested`；`:605`：维护结束后才启动 driver。`runMaintenance` 是公开接口（`runtime-types.d.ts:193-201`），不可嵌套（`:587`）。
  - `:789-798`、`:827-831`：`agent/turn-stopping` 返回后若 next-step 有消息则当前回合继续；队列有工作时直接开下一回合，不经过 idle。因此停止边界不是可提交下一回合选择的边界（第 1 轮 C2，评审者用真实 `turn()` 复现）。
  - `:1565-1579`：子会话的 setup、enter、`agent/created` 都在工厂自己的 `runMaintenance` 内。`dsh-subagent/lib/index.js:1800-1830` 创建返回后，首条消息才经 `:2242` → `:1595-1596` 以 followup（或 steer）投递，此时子会话已空闲。
  - `dsh-session/lib/index.js:1580-1601`：`session/event` 派发期间禁止重入 append，因此不能在该监听里 `model.select`（它会 append `model/selection`，`dsh-agent/lib/types/model-selection.js:88-91`）。`claimed` 在 splice 的 append 完成后才派发，可以 append。
  - `dsh-api-session-controller/lib/index.js:704-719`：`selectModel` 先 await `resolveAgent`、`requireModel`、`resolveCallConfig`，再同步 `agent.model.select`，最后后台 `ctx.agentDefaultModel.saveSelection`。`agentDefaultModel.saveSelection/currentSelection` 是 `dsh-agent-default-model` 的公开服务（0.2.1-rc.5 与 0.2.2-rc.1 的 `types/index.d.ts:42,50`）。
  - `agent.model.select` 在 0.2.0-rc.2、0.2.1-rc.5 的 `dsh-agent` 类型中不存在；`runMaintenance`、`agent/inbox/inserted` 都存在。
  - `dsh-system-prompt/lib/types/index.d.ts:114-122`：`system-prompt/assemble` 改为不含 `tools` 的 `PromptPresentation`。`dsh-subagent/lib:1806` 在 setup 中先写 `subagent/descriptor`，`experimental-agent-team/lib:873-896、1185-1187` 据此不接纳普通子会话，所以 fresh 裁判子会话不会注册 Team 工具。
  - `dsh-base/cordis.patch.yml:292-294`：顶层 insert 中的官方行 `id: fs-observation-policy` 为 `disabled: true`。评审者用目标 `cordis-plugin-include@1.1.0` 的 `applyPatches` 实测：同 id/name 加 `disabled: false` 的整行覆盖后恰有一条启用行；`scripts/sync.mjs:1863-1874` 对 plain fragment 原样拼接。
  - 根 `package.json:25` 的 `engines.node` 为 `>=22.0.0`，`scripts/bootstrap.mjs:21,60` 据此检查；0.2.2 要求 Node ≥ 24.9。
- 第 3 轮补充核对（0.2.2-rc.1）：
  - 重试：`agent-loop:841-842` 每次 attempt 重新 `prepareRequest`；`:929-939` request-error 返回 retry 后直接 continue，不再经过 preStep。每次 attempt 都经 `:877` 的 `preparedCall.stream` 或 `llm.stream`，两者都进入 `llm/stream` waterfall（`dsh-llm/lib/index.js:2254-2262、2402`）。loop 请求带 `sessionId` 与 provider/model/reasoningEffort（`agent-loop:1085-1090`），且带 `markAgentLoopRequest` 标记。listener 抛错原样抛出，不转为 finish chunk（`dsh-llm:2387-2395` 注释）。
  - 取消：`dsh-api-session-controller:955-965` 的普通取消为 `agent.cancel({kind:"user"}, {keepInbox:true})`；`agent-loop:579-585` 在 keepInbox 时既不清 inbox，也不清 `wakeRequested`；维护结束后 `:605` 仍会唤醒。pre-step `reject` 让 `turn()` 直接 `return false`（`:746-748`）；`kick` 结束时只有 `wakeRequested` 才重新唤醒（`:651-664`），而 `wakeDriver` 开始时会把它重置为 false（`:624-630`）。
  - 恢复：`agent-loop:1733-1767` 以持久事件为 seed 恢复，不派发 `agent/inbox/inserted`，也不自动唤醒待处理消息；之后由新的插入唤醒。
  - `agent/turn-stopping` 是 serial、会被 await，带当前回合 signal（`dsh-agent/runtime-types.d.ts:422-426`）；`Inbox.nextStep/nextTurn` 为只读公开属性（`:68-70`）。
  - 插件 cap 由 `SettingsStore.read()` 同步读文件（`packages/dsh-auto-model-routing/src/settings.ts:39-41`）；`policyEffort` 是同步函数（`src/routing.ts:20`）。
  - 官方 `requireModel` 检查目录成员身份（`controller:529-540`）；`resolveModelInfo` 与 `resolveCallConfig` 不检查（`dsh-llm:2079-2087、2107-2117`）。
- 约束：`staged-upgrade-execution`（基线、devbox 清洁候选、备份恢复次序 `:113-122`）、`runtime-api-migration`（真实历史备份副本 `:96-107`）、`repo-layout`（运行体 peer/engines 区间）；`docs/architecture/dsh-plugin-integration-pitfalls.md`；Worktree Session 的依赖修改须先 `ws promote`。

## Goals / Non-Goals

**Goals:**
- 本仓在 0.2.2-rc.1 上全部 local package 都能 build/typecheck/test，隔离预览中功能与 0.2.1 基线等价，唯一例外是 spec 里写明的 AUTO 回合内手动切换行为变化。
- AUTO 主会话和子会话的路由在 0.2.2 上真正生效：用户回合 step 1 的 selection 就是判断结果，不触发运行体抛错，不依赖已弃用的 `agent/request`。
- 显式恢复文件观察策略；Web Fetch 行为变化有书面记录。

**Non-Goals:**
- 第三方插件的可选升级、商店发版与商店 PR、启用 0.2.2 新功能（apply_patch、forge、liveshare、PTC VM）。
- 修改 AUTO 的判断算法、预设或 UI。
- `superagent` profile 的观察策略（sync 不物化该 profile，由 managed-superagent-host change 处理）。

## Decisions

### D1 AUTO：判断在入口计算并缓存，提交在批次被领取时
「批次」是运行体开启新回合时一次领取的消息，即 next-step 全部加 next-turn 队首一条；其用户消息 id 列表就是缓存键的主体（spec「用户回合与 Jev 输入」）。

- **三个判断入口**（只计算，不写选择）：
  1. **空闲入口**：任一插入后，队列里只要还有没判断的用户消息，就在同步回调中 `runMaintenance`，判断预测批次。driver 等维护结束才开始回合，所以首个回合一定有结果。这个入口同时覆盖三种情况：恢复后残留的消息（M4，不必在每个恢复的会话上调 Jev）、取消后残留的消息，以及子会话首条消息（创建返回后以 followup 投递，此时子会话空闲）。Jev 返回后重新预测，批次变了就在同一期限预算内重判。
  2. **停止边界入口**：运行中回合 T 的 `agent/turn-stopping` 中，为 next-turn 队首 await 判断。这里只计算，所以 T 被续步也不会提前切换（C2）。T 续步后再次停止时上下文已变，按指纹重判。之所以在这里而不是插入时判断 B，是为了让「上一轮」上下文取到 T 的完整回复，与 0.2.1 在 B 的 step 1 取上下文一致。这里的等待与 0.2.1 在 B 的 pre-step 等待 Jev 的延迟相同。
  3. **晚到入口**：在停止边界监听返回后才插入、或维护被其它插件占用时，启动后台判断，来得及就用。
- **提交**：在每个回合第一次 `agent/inbox/claimed` 的同步回调里，用「回调前记录的待处理 id − 回调时队列」求出整个批次。领取会先把整批消息移出队列，然后才逐条派发 claimed（`:103-110`），所以第一次回调时批次已确定。用户消息键与上下文指纹完全匹配就同步调用 `agent.model.select`；这时 `:671` 还没读 selection，本步一定生效。续步的领取不提交。A、B 两条 followup 各自对应自己的回合（C1）。
- **effort 在提交时计算**：缓存 depth 和模型能力，提交时按当时同步读取的 cap 用 `policyEffort` 计算（M5）。预先校验与官方 `selectModel` 等价，包含目录成员身份（S4）。
- **取消**（C5）：
  - 维护被官方取消时，把预测批次标为「已取消」。维护结束、运行体照常唤醒并领取后，AUTO 最外层的 `agent/pre-step` 直接返回 `reject`：这批消息不进模型，回合以 blocked 结束。`turn()` 直接返回 false，`kick` 不会因为 `wakeRequested` 再开回合，其余排队消息保留且不被自动执行。这与 0.2.1 取消「在 pre-step 等 Jev 的回合」的结果一致：那时该批消息已被领取，随回合中止；可见差别只是回合结束原因从 aborted 变为 blocked。
  - 停止边界入口用 T 的 signal，T 被取消时随之中止。
  - 晚到入口自持中止控制，在消息被丢弃、会话 dispose 或模式切换时中止。
  - 批次已被领取、丢弃或会话 dispose 后才返回的结果，不论成败一律丢弃，不写 disabled。

**显式行为变化**（两项，都写进 spec）：
1. 回合中途手动切换的 effort 保持到本回合结束（M1，用户已于 2026-11-06 确认）。
2. 停止边界监听返回之后、新回合开始之前插入的用户消息，若后台判断来不及，就沿用当前选择，记 `judgment-late`。0.2.2 在这段时间没有可等待的接缝；要消除这个缺口，需要上游提供「回合开始前可等待」的钩子，这条记入 Open Questions。

被否决的方案：
- 在 `agent/pre-step` 里 select：selection 已经固定，本步赶不上。
- 继续在 `agent/request` 里改写：会抛错，而且已弃用。
- 在 `agent/turn-stopping` 里提交下一回合：当前回合可能继续（C2）；本方案在那里只计算。
- 在 `agent/created` 里开维护：它本身就在工厂维护内，嵌套必抛（M3）。
- 恢复时在 `agent/created` 里 await Jev：Host 启动时会给每个有残留消息的恢复会话都调一次 Jev，而这些消息未必会再执行；改由下一次唤醒时的空闲入口处理。
- 在 `claimed` 里调官方 `selectModel`：它要先 await 三次，真正写入时本步 selection 早已读完。
- 取消时清空整个队列：会丢掉用户排队的其它消息，与官方 keepInbox 语义冲突。

### D2 写入方式与逐请求门禁
主会话：在 `claimed` 中同步 `agent.model.select`，再在后台调用公开服务 `ctx.agentDefaultModel.saveSelection`；保存失败只告警。前置校验（目录成员、`resolveCallConfig`）在判断阶段完成。主会话 provider/model 不变，图像准入查询的目标不变（`controller:844-848`），所以省略 `serializeImageAdmission` 不引入新缺口。

子会话：只 `select` route，不写默认；提交时同步核对 cap。

逐请求门禁（C4）：插件不再注册 `agent/request`，改为注册 `llm/stream` 监听，用 async generator 在 `yield* next()` 之前完成核验。核验对象是 loop 请求且 `sessionId` 为已有 route 的受管子会话，内容为：精确绑定记录完整、parent 一致、请求 provider/model/effort 等于 route，以及当前目录、允许列表、captured allowlist 与 cap。不通过就抛错，adapter 不被调用。每次 attempt（含重试）都经过这里，而且它不是弃用接口。这个监听同时接管原来 `agent/request` 中的 fail closed 检查（`requireBindingRecord`、parent 不匹配、`status === 'failed'`）。子会话图像首消息的准入与 0.2.1 相同（当时同样是创建后再改路由），隔离验收中用一条带图首消息的 fresh 子任务确认。

applied 判定沿用 `request/header` 与 `session.requestHeader()` 比对。

### D3 auto-model-routing 兼容下界抬到 `0.2.2-rc.1`
`agent.model.select` 只在 0.2.2 存在。保留双路径会让旧路径在 0.2.2 上出错，测试也翻倍。只改该包的 `engines.dsh` 与 dsh peer 下界，理由按 repo-layout 记录在 package README/CHANGELOG。商店 0.7.0 在 0.2.2 Host 上会失效；本 change 不发版，收尾时明确提示。其它 local package 的下界不变，除非审计发现它们用了 0.2.2 才有的 API。

### D4 memex 裁判：删除过期的工具投影
删掉 `judge-boundary.ts:22-25` 的 `system-prompt/assemble` 监听。0.2.2 的 fresh 裁判子会话不会注册 Team 工具（见 Context），精确身份、冻结请求、`tools.guard` 和 `verifyJudgeRequest` 照旧是权威门禁，`dsh-memex-evaluation:198` 不受影响。用目标真实组合复跑 `test/eval-judge-runtime.test.ts` 中启用 Team 时的成功路径，并保留污染注入时首请求零调用的断言。成功路径不通过就停在未通过，不能以全拒绝或全 unknown 收尾。

### D5 文件观察策略：整行覆盖 patch，不新增包行
新增 `patches/fs-observation-policy.yml`（plain patch），内容为 `id: fs-observation-policy`、`name: '@deepseek-ai/dsh-fs-observation-policy'`、`disabled: false`，并在 manifest 中加一个 `type: patch` 条目。评审已实测覆盖语义成立，sync 不需要扩展。不另写「官方行缺失」检查：每次升级候选验收重跑 `--dump-config`，断言恰有一条启用行（写入 note 与 spec）。

### D6 Web Fetch 接受新行为
不加限制。在 `dsh.yaml` 运行体版本附近写明「0.2.2 起 Web Fetch 可访问非公网地址，信任面扩大，2026-11-06 由用户接受」。

### D7 pin、依赖与 Node
用 `scripts/check-update.mjs --rewrite-to 0.2.2-rc.1` 改写 `dshVersion` 与同族 provider pin（`dsh.yaml:29-30` skill-filesystem、`:41-42` mcp-client）及其 integrity。local package devDependencies 改为 `^0.2.2-rc.1`，peer 尾段同步改为 `|| ^0.2.2-rc.1`。根 `package.json` 的 `engines.node` 改为 `>=24.9.0`，并在 bootstrap 测试中断言 Node 24.8 被拒。先 `ws promote` 再 `npm install` 更新根 lockfile。

### D8 其余逐项复核（结论写入会被版本控制的 `checking/summary.md`）
- dsh-pet：`ctx.tools.schemas(scope)` 在按步骤启用工具后的结果（`src/index.ts:741/1216/1280/1938`），Locus 工具上限读回等价性测试必须仍然通过。
- sidebar-session-provider-icon：`sessionProjections.register` 改为异步，按官方要求在启动时持有返回值。
- connection patch：检查官方 connection 行的 `inject` 是否已含 `webServer`，已含则删除 fragment。
- noPet 官方模块名册按 0.2.2-rc.1 重新生成。
- `packages/dsh-auto-model-routing/scripts/host-capability-probe.mjs` 是针对 0.2.0-rc.2 精确 pin 的历史探针（`docs/host-capability-report.md:13`），不修改。
- 会话存储：release notes 写明「读取兼容旧版本并以新版本格式写入」，按 Migration Plan 的恢复演练确认能否回读。

## Risks / Trade-offs

- [停止边界之后才插入的用户消息] → 后台判断来得及就用，否则沿用当前选择并记 `judgment-late`（显式行为变化）。隔离验收记录实际出现频率。
- [停止边界入口 await Jev 会推迟当前回合的结束与下一回合的开始，最多一个 Jev 期限（≤ 8000 ms）] → 与 0.2.1 在下一回合 pre-step 中等待的总延迟相同，只是等待的位置前移了。
- [空闲时用户回合最多推迟一个 Jev 期限] → 与 0.2.1 相同；超时按失败类别处理。
- [维护被其它插件占用] → 走晚到入口；spec 有对应场景。
- [被取消的批次在历史中显示为 blocked 回合，而不是 aborted] → 不进模型、不留 user/message，与 0.2.1 的用户可见结果一致；验收时截图确认 UI 无异常提示。
- [批次求差依赖「领取先整体移出、再逐条派发」的运行体实现] → 用真实 `ReactLoopInbox` 的测试锁定；升级复核清单加入这一项。
- [`select` 会持久化，并延续到之后的回合] → 非用户回合沿用当前选择，与持久化语义一致；子会话 route 本就固定。
- [商店 0.7.0 在 0.2.2 Host 上失效] → 收尾时提示用户尽快走 publish 流程。
- [0.2.2 单向存储格式迁移] → 按 Migration Plan 离线快照与恢复演练；恢复快照会丢失切换后的新数据，切换前须告知用户。
- [checking 证据再次丢失] → 合入前把结论汇总进会被版本控制的 `checking/summary.md`。

## Migration Plan

1. **基线**：在现役 0.2.1-rc.5 上跑 `npm test`、`npm run check:artifacts` 与各 local package 的 build/typecheck/test，并记录人工验收项的现役结果（staged-upgrade `:46-90`）。
2. **实现**：在 worktree 中完成代码和 manifest 改动；`ws promote`，安装依赖，跑全部测试。
3. **隔离候选**：`dsh build` → `ws prepare-preview` → `dsh`，按分组（裸运行体 → local package → remote 插件）验收，复跑基线人工项（AUTO 主/子路由、Pet Locus、memex 召回与 eval、观察策略、btw、better-sidebar 各 tab 等）。再按精确 commit 在 devbox 跑清洁构建 gate。
4. **备份与恢复演练**（生产切换的准入条件）：
   1. 由用户执行 `dsh stop`，停止日常 Host 及其内的 Pet SQLite 写入方，并确认没有残留 Host 进程。
   2. 先用目标运行体 `--dump-config` 列出实际数据根（session-persistence-jsonl 的 `root`、attachment-local、各插件存储），再离线复制这些根，至少包括 `~/.dsh/sessions`、`~/.dsh/attachments`、`~/.dsh/plugins/dsh-pet/sqlite`、`~/.dsh/profiles/web`、`~/.dsh/state`、`~/.dsh/storages`；生成 sha256 清单，路径写入 tasks。
   3. 在隔离 `DSH_HOME` 中用这份副本以 0.2.2 打开、继续写入、重启，按 runtime-api-migration `:96-107` 逐项断言：generation 保留与原子发布、lease 排他、中断后的 generation 选择，以及 Session 身份与标题、workspace/cwd、父子 lineage、模型/provider、assistant 内容、tool call/result、带图片附件的消息、继续提交。之后停止全部写入方，恢复快照，以 0.2.1 启动，按同一组断言确认读回。
   4. 结果写入 `checking/summary.md`。
5. **切换**：经用户批准后合入；从主 checkout `dsh build`，连续第二次无变更；由用户决定启动或重启，之后用 `dsh history` 核验。
6. **回滚**：
   1. 由用户停止 0.2.2 Host，确认全部写入方已停止。
   2. 另存失败时的数据副本。
   3. 恢复第 4 步的快照，`git revert` 回 0.2.1-rc.5 的精确配置，`dsh build`。
   4. 核验之后再启动旧 Host。
   恢复快照会丢失切换后的数据，执行前告知用户。

## Open Questions

- 官方 Web UI 在运行中发送用户消息走 followup 还是 steer：前者由停止边界入口判断，后者属于当前回合、不判断，两者都已有规定行为。隔离验收中用真实 UI 记录实际分布。
- 上游是否愿意提供「回合开始前可等待」的钩子，以消除 `judgment-late` 缺口；不阻断本 change。
