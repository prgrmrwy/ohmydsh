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

### D1 AUTO：判断在消息入队时，提交在该消息被领取时
- **触发**：`agent/inbox/inserted`，只看 `source.kind === "user"` 的实时插入。
- **空闲**：在同步回调里调 `agent.runMaintenance(signal => judge(message, signal))`。driver 会等维护结束才开始回合，所以首个回合一定能拿到结果。主会话和子会话的首条消息都走这里（子会话首条消息在工厂维护结束后才投递，见 Context）。
- **运行中**：`runMaintenance` 同步抛错，表示已有活动工作。只有 next-turn 消息启动后台判断，不阻塞当前回合；next-step 消息属于当前回合，不判断。
- **提交**：在 `agent/inbox/claimed` 的同步回调里，领取到有就绪结果的消息时，调用 `agent.model.select(target)`。这时 `:671` 还没读取 selection，所以本步一定生效。因为只在消息真被领取时提交，A/B 两条 followup 各自对应自己的回合（C1）；续步只领取 next-step 消息，不会触发下一回合的提交（C2）。结果没就绪就不改选择，迟到的结果丢弃。
- **校验前移**：判断阶段就算好目标 effort（需要异步 `resolveModelInfo`），并做与 `selectModel` 相同的 `resolveCallConfig` 校验。提交时只同步核对模式、世代和当前 provider/model 是否与判断时一致，不一致就丢弃。
- **取消**：`agent/inbox/discarded` 或会话 cancel 时中止判断，不停用 AUTO（M2）。

被否决的方案：
- 在 `agent/pre-step` 里 select：selection 已经固定，本步赶不上。
- pre-step `reject` 后再重排 inbox：会留下 blocked 空回合，消息也被消费。
- 继续在 `agent/request` 里改写：会抛错，而且已弃用。
- 在 `agent/turn-stopping` 里提交下一回合：当前回合可能继续，也可能漏掉晚到的消息（C2）。
- 在 `agent/created` 里开维护：它本身已在工厂维护内，嵌套必抛（M3）。
- 在 `claimed` 里调官方 `selectModel`：它要先 await 三次，真正写入时本步 selection 早已读完。

### D2 写入方式：主会话 `agent.model.select` 加后台保存默认，子会话只 `select`
`selectModel` 的有效动作就是「`agent.model.select` 加后台 `saveSelection`」。主会话在 `claimed` 里同步做前者，再调用公开服务 `ctx.agentDefaultModel.saveSelection` 做后者，失败只告警。子会话只 `select`，不写默认。插件不再注册 `agent/request` 监听；子会话实时门禁移到 `agent/pre-step`：它每步都执行、在请求之前、可以抛错，并且带 `modelSelection`。这样上游删除已弃用钩子时，门禁也不会静默消失。applied 判定沿用 `request/header` 与 `session.requestHeader()` 比对。

**行为变化（M1）**：0.2.2 在 step 2 及以后没有可在本步生效的接缝，所以 effort 每个用户回合设定一次。用户在回合中途手动切换，会保持到本回合结束；下一个用户回合按当时的模型重算。用户已于 2026-11-06 确认可以接受（旧版也是「谁最后设置以谁为准」，差别只在 AUTO 重设的间隔从每步变为每回合）。

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

- [运行中排队的 followup 判断来不及] → 本回合沿用当前选择，迟到结果丢弃，不应用到别的回合。当前回合通常远长于 Jev 期限（≤ 8000 ms），实际很少发生。
- [空闲时用户回合最多推迟一个 Jev 期限] → 与 0.2.1 在 pre-step 中等待的延迟相同；超时按失败类别处理。
- [其它插件在用户消息入队时已占用维护阶段，`runMaintenance` 抛错] → 该消息走运行中路径（若在 next-turn），否则本回合不判断。隔离验收中记录是否出现。
- [子会话首条消息以 steer 投递（next-step）] → 空闲入口不区分队列，只要子会话空闲就进入维护判断；隔离验收以真实 fresh 子会话确认首条消息投递时子会话空闲。
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
   2. 离线复制 `~/.dsh/sessions`、`~/.dsh/plugins/dsh-pet/sqlite`、`~/.dsh/profiles/web`、`~/.dsh/state`、`~/.dsh/storages`，生成 sha256 清单，路径写入 tasks。
   3. 在隔离 `DSH_HOME` 中，用这份副本以 0.2.2 打开、继续写入、重启；再停止全部写入方，恢复快照，以 0.2.1 启动，确认读回正常。
   4. 结果写入 `checking/summary.md`。
5. **切换**：经用户批准后合入；从主 checkout `dsh build`，连续第二次无变更；由用户决定启动或重启，之后用 `dsh history` 核验。
6. **回滚**：
   1. 由用户停止 0.2.2 Host，确认全部写入方已停止。
   2. 另存失败时的数据副本。
   3. 恢复第 4 步的快照，`git revert` 回 0.2.1-rc.5 的精确配置，`dsh build`。
   4. 核验之后再启动旧 Host。
   恢复快照会丢失切换后的数据，执行前告知用户。

## Open Questions

- 官方 Web UI 发送用户消息时，空闲是 followup（next-turn），运行中是哪种（followup 或 steer）。只影响运行中路径是否判断；隔离验收中用真实 UI 记录。
