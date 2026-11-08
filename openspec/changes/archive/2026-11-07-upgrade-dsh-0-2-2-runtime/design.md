## Context

- 现状：`dsh.yaml:5` pin `0.2.1-rc.5`，生产 3080 自 2026-11-05 起运行该版本。上一轮升级 change 已归档到 `openspec/changes/archive/2026-11-06-upgrade-dsh-0-2-1-runtime/`。
- 现状 AUTO（`packages/dsh-auto-model-routing/src/policy-host.ts`）：
  - 主会话在用户回合 step 1 的 `agent/pre-step` 中 await Jev（`:113-146`），在每次请求的 `agent/request` 里改写 effort，并 await 官方 `selectModel`（`:179-209`）。
  - 子会话在其 step 1 的 `agent/pre-step` 判断，在每次请求的 `agent/request` 里改写 route 并核验门禁（`:211-219`）。
  - 绑定窗口由 `tools/execute`（`:75-86`）与 `agent/created`（`:87-110`）建立。
- 目标：`@deepseek-ai/dsh@0.2.2-rc.1`（npm latest=next）。以下证据都来自 0.2.2-rc.1 npm 发布物，并经 lead、协作会话和评审者分别核对：
  - `dsh-agent-loop/lib/index.js:671`：`preStep` 读 `model.current()`，固定本步 selection；`:685` 才 await `agent/pre-step` waterfall；`:742` 的 `turn()` await 整个 `preStep` 后，才进入 `step()`；`:842` 用 `decision.selection` 准备请求，同一步的重试也复用它；`:1000-1001` 中 `agent/request` 的返回值只要与 selection 不同就抛错。这就是 AUTO 在 0.2.2 上必须改的唯一原因。
  - `dsh-agent/lib/types/model-selection.js:82-85`：`current()` 每次返回一个新的、未冻结的对象（`{ ...recorded }`）。`dsh-agent/lib/index.js:359-386`：事件派发只做浅拷贝，pre-step payload 的 `modelSelection` 与 `:842` 使用的 `decision.selection` 是同一个对象（`preStep` 返回值中的 `selection` 在 `:699-705` 覆盖了 decision 中的同名字段，仍是这个对象）。
  - 在 `:671` 到发出请求之间，只有 `:1001` 那道一致性检查读取 `reasoningEffort`：工具解析、提示词变量只用 provider/model（`:1345-1346`）；「模型切换」提示只在 provider/model 变化时插入，effort 变化不插入（`dsh-agent/lib/index.js:224-238`）。
  - `dsh-api-session-controller/lib/index.js:704-719`：`selectModel` 校验后调用 `agent.model.select`，并在后台保存全局默认。`agent.model.select` 只在 0.2.2 的 `dsh-agent` 中存在，0.2.0-rc.2、0.2.1-rc.5 都没有。
  - 子会话：官方 `subagent`、`spawn_teammate` 工具的任务文本参数都是 `args.prompt`（`dsh-tool-subagent/lib/index.js:384、457`，`dsh-experimental-tool-agent-team/lib/index.js:264、284`）。`agent/created` 是 serial 事件（`dsh-agent/lib/index.js:703-714`），在工厂完成 setup 之后、首条消息投递之前触发（`dsh-agent-loop:1574-1579`，`dsh-subagent/lib/index.js:1800-1830、2242`）。
  - `agent/request` 在每次 attempt 中都会派发，包括 request-error 后的重试（`agent-loop:841-842、929-939`、`:994`），并允许原样返回或抛错。它已标为 deprecated，但新增 listener 不会被拒绝。
  - `dsh-system-prompt/lib/types/index.d.ts:114-122`：`system-prompt/assemble` 改为不含 `tools` 的 `PromptPresentation`。`dsh-subagent/lib:1806` 在 setup 中先写 `subagent/descriptor`，`experimental-agent-team/lib:873-896、1185-1187` 据此不接纳普通子会话，所以 fresh 裁判子会话不会注册 Team 工具。
  - `dsh-base/cordis.patch.yml:292-294`：顶层 insert 中的官方行 `id: fs-observation-policy` 为 `disabled: true`。评审者用目标 `cordis-plugin-include@1.1.0` 的 `applyPatches` 实测：用同 id/name 加 `disabled: false` 做整行覆盖后，恰有一条启用行；`scripts/sync.mjs:1863-1874` 对 plain fragment 原样拼接。
  - 根 `package.json:25` 的 `engines.node` 为 `>=22.0.0`，`scripts/bootstrap.mjs:21,60` 据此检查；0.2.2 要求 Node ≥ 24.9。
- 上游：`deepseek-ai/deepseek-harness` 关闭了 issues，只有 discussions。最相关的现有讨论是 [#7179 Session-scoped model and effort selection](https://github.com/deepseek-ai/deepseek-harness/discussions/7179)（2026-11-06 查询时有 5 条评论、4 个赞），其中多位插件作者提到依赖 `agent/request` 改路由。
- 约束：`staged-upgrade-execution`（基线、devbox 清洁候选、备份恢复次序 `:113-122`）、`runtime-api-migration`（真实历史备份副本 `:96-107`）、`repo-layout`（运行体 peer/engines 区间）；`docs/architecture/dsh-plugin-integration-pitfalls.md`；Worktree Session 中修改依赖前必须先 `ws promote`。

## Goals / Non-Goals

**Goals:**
- 本仓全部 local package 都能在 0.2.2-rc.1 上 build/typecheck/test，隔离预览中的功能与 0.2.1 基线等价。
- AUTO 在 0.2.2 上的可见行为与 0.2.1 相同：判断时机、输入、取消、排队、恢复都不变；主会话每一步开始时按 depth 设定 effort，step 1 就生效；子会话 step 1 即用 route；每次请求（含重试）都经过子会话门禁。
- 显式恢复文件观察策略；Web Fetch 的行为变化有书面记录。
- 把「插件需要在本步选择固定之前可等待地设定模型/effort」的诉求反馈到上游，以便日后去掉对实现细节的依赖。

**Non-Goals:**
- 第三方插件的可选升级、商店发版与商店 PR、启用 0.2.2 新功能（apply_patch、forge、liveshare、PTC VM）。
- 修改 AUTO 的判断算法、预设或 UI。
- `superagent` profile 的观察策略（sync 不物化该 profile，由 managed-superagent-host change 处理）。

## Decisions

### D1 主会话：判断位置不变，在 pre-step 中改写本步选择的 effort
AUTO 主会话的 `agent/pre-step` 监听保持现有结构：先 `await next()`，step 1 的用户回合等待 Jev，输入与上下文的取法不变。新增的是每一步（不只 step 1）都执行的应用逻辑：

1. 按本回合 depth、`payload.modelSelection` 的模型和实时 cap 计算目标 effort。
2. 与 `modelSelection.reasoningEffort` 不同时，先 await 官方 `selectModel`（持久化会话选择并保存默认；行为与现状相同，只是从 `agent/request` 移到 pre-step）。
3. 成功后执行 `payload.modelSelection.reasoningEffort = target`。

运行体要等整个 pre-step waterfall 结束才准备请求（Context `:685、742、842`），所以不会出现判断还没结束请求就已发出的情况；本步请求与 `:1001` 的一致性检查都读这个对象，因而 step 1 就用上新值，也不会抛错。只改 effort，不改 provider/model，因为工具集和提示词已经按本步模型生成。

这依赖于「`modelSelection` 是本步实际使用的同一个可写对象」这一实现事实。类型声明为 `Readonly`，所以它属于兼容性依赖，不是官方承诺。对策见 spec「本步选择改写依赖运行体核验」：
- 用真实 agent loop 跑集成测试，锁定这一行为，每次升级重跑；
- 赋值抛错（对象被冻结）时捕获并告警，退回为下一步生效；
- 运行体若改为传递副本，赋值不会生效但也不报错，由集成测试发现。

被否决的方案：
- **只调 `selectModel`、不改写本步对象**：从 step 2 起才生效。本机 34 个 AUTO 主会话、175 个用户回合中，约 23% 的回合 step 1 会用到上一回合的 effort，约 9% 的回合整回合都用错。用户要求消除这个差距。
- **入队时判断、领取（`agent/inbox/claimed`）时提交，配合维护窗口、停止边界预判与取消 reject**（第 1–3 轮的方案）：需要一整套新机制，并引入 `judgment-late`、取消吞掉 steer、批次求差受其它监听器干扰等新的行为差异；连续三轮评审都在挖出新的边角问题。
- **在 `llm/stream` 中拦截，自行用新 effort 重发请求**：会话日志中记录的请求头会与实际发出的请求不一致。
- **继续在 `agent/request` 里改写**：会抛错。

### D2 子会话：在 `agent/created` 中判断并写入 route；门禁留在 `agent/request`，只核验
- **判断与写入**：`tools/execute` 绑定窗口额外记下 `args.prompt`。`agent/created`（`source = "startup"`）是 serial、被 await 的钩子，并带 signal（`dsh-agent/lib/index.js:703-714`）：它在官方完成参数/允许列表校验、工厂完成 setup 之后、首条消息投递之前触发。AUTO 在这里按现行「AUTO 受管子会话范围」绑定并采样父配置，用该 signal await Jev、按退化链得到 route，再同步 `agent.model.select(route)`。不写全局默认。这里只是普通 await，不开维护窗口（嵌套 `runMaintenance` 才会抛错）。
- 这样父快照、「创建前切 MANUAL 时 Jev=0」都与现行受管范围 spec 一致（第 4 轮 M9），参数非法、未创建子会话的调用也不会外发 Jev（M10）。等待时长与 0.2.1 在子会话 step 1 前等待相同，只是位置前移到首条消息投递之前；期间工具调用阻塞。
- **输入**：用绑定窗口记下的 `args.prompt`，即子会话首条 user 消息的内容。同一绑定窗口内插件另建的子会话无法区分，沿用 `policy-host.ts:89` 已接受的 `shortcut:` 限制。
- **恢复**（第 4 轮 C6）：0.2.1 的 route 只在请求时改写，从不写进会话选择；记录已写 route、首个请求前中断的旧子会话，恢复后 `current()` 是父快照，只核验的门禁会一直拒绝。因此 `agent/created`（`source = "resume"`）对记录完整、parent 一致、非 `failed` 且已有 route 的子会话，若 `current()` 不等于 route，就同步 `select(route)`，不重判、不写默认；其余 fail closed 规则不变。正常的旧子会话已发过请求，`current()` 本来就等于 route，这一步是 no-op。
- **门禁**：`agent/request` listener 只核验（绑定记录完整、parent 一致、请求等于 route、目录/允许列表/captured allowlist/cap），然后返回 `await next()`，不改写。它在每次 attempt（含重试）都会派发，覆盖面与现状相同。压缩请求现状本来就不经过这道门禁，所以不算回退。listener 已标为 deprecated，集成测试同时断言「目标运行体在重试时仍派发 `agent/request`」，一旦上游移除它，测试会失败。
- 不能在子会话上用 D1 的对象改写：route 通常会换模型，而本步的工具集和提示词已经按旧模型生成。

applied 判定沿用 `request/header` 与 `session.requestHeader()` 的比对。

### D3 auto-model-routing 兼容下界抬到 `0.2.2-rc.1`
`agent.model.select` 只在 0.2.2 中存在，而且 D1 依赖 0.2.2 的选择固定流程。保留双路径会让测试翻倍。因此只改该包的 `engines.dsh` 与 dsh peer 下界，理由按 repo-layout 的要求记录在 package README/CHANGELOG 中。商店上的 0.7.0 在 0.2.2 Host 上会失效；本 change 不发版，收尾时明确提示用户。不做双路径兼容（用户 2026-11-07 决定）：发版时按 DSH 版本分线，0.2.0–0.2.1 停在已发布的 0.7.0/0.6.x，0.2.2 起用 0.7.1 及以后（用户 2026-11-07 定版本号；0.2.1 Host 按 engines.dsh 拒绝 0.7.1），README/CHANGELOG 写清每条版本线依赖的 DSH 范围。其它 local package 的下界不变，除非审计发现它们用了只有 0.2.2 才有的 API。

### D4 memex 裁判：删除过期的工具投影
删掉 `judge-boundary.ts:22-25` 中的 `system-prompt/assemble` 监听。0.2.2 的 fresh 裁判子会话不会注册 Team 工具（见 Context）。精确身份、冻结请求、`tools.guard` 和 `verifyJudgeRequest` 照旧是权威门禁，`dsh-memex-evaluation:198` 不受影响。用目标版本的真实组合复跑 `test/eval-judge-runtime.test.ts` 中启用 Team 时的成功路径，并保留「污染注入时首请求零调用」的断言。成功路径不通过就停在「未通过」，不能以全部拒绝或全部 unknown 收尾。

### D5 文件观察策略：整行覆盖 patch，不新增包行
新增 `patches/fs-observation-policy.yml`（plain patch），内容为 `id: fs-observation-policy`、`name: '@deepseek-ai/dsh-fs-observation-policy'`、`disabled: false`，并在 manifest 中加一个 `type: patch` 条目。评审已实测覆盖语义成立，sync 不需要扩展。不另写「官方行缺失」检查，改为每次升级的候选验收都重跑 `--dump-config`，断言恰有一条启用行（写入 note 与 spec）。

### D6 Web Fetch 接受新行为
不加限制。在 `dsh.yaml` 运行体版本附近写明：「0.2.2 起 Web Fetch 可访问非公网地址，信任面扩大，2026-11-06 由用户接受」。

### D7 pin、依赖与 Node
- 用 `scripts/check-update.mjs --rewrite-to 0.2.2-rc.1` 改写 `dshVersion` 与同族 provider pin（`dsh.yaml:29-30` skill-filesystem、`:41-42` mcp-client）及其 integrity。
- local package 的 devDependencies 改为 `^0.2.2-rc.1`，peer 尾段同步改为 `|| ^0.2.2-rc.1`。
- 根 `package.json` 的 `engines.node` 改为 `>=24.9.0`，并在 bootstrap 测试中断言 Node 24.8 会被拒绝。
- 先 `ws promote`，再 `npm install` 更新根 lockfile。

### D8 其余逐项复核（结论写入会被版本控制的 `checking/summary.md`）
- dsh-pet：核对按步骤启用工具后 `ctx.tools.schemas(scope)` 的结果（`src/index.ts:741/1216/1280/1938`），Locus 工具上限读回的等价性测试必须仍然通过。
- sidebar-session-provider-icon：`sessionProjections.register` 改为异步，按官方要求在启动时持有其返回值。
- connection patch：检查官方 connection 行的 `inject` 是否已含 `webServer`，已含则删除 fragment。
- noPet 官方模块名册按 0.2.2-rc.1 重新生成。
- `packages/dsh-auto-model-routing/scripts/host-capability-probe.mjs` 是针对 0.2.0-rc.2 精确 pin 的历史探针（`docs/host-capability-report.md:13`），不修改。
- 会话存储：release notes 写明「读取兼容旧版本并以新版本格式写入」，按 Migration Plan 的恢复演练确认旧版能否回读。

### D9 上游反馈
在 tasks 中加一项上游跟进：请上游提供一个可等待、发生在本步选择固定之前的接缝（或者把 pre-step 的 `modelSelection` 正式定为可修改），使 D1 不再依赖实现细节。顺带说明 `agent/request` 被弃用后，子会话 route 门禁需要一个非弃用的逐次请求核验点。执行规则：
- 动手时先重新搜索 discussions。优先在已有热度、主题相关的帖子下评论，当前首选 #7179；只有找不到合适帖子时才新建（Ideas 分类）。
- 先起草，内容不含本机路径、会话数据或凭据；**经用户确认后才发布**。发布的链接记入 `checking/summary.md`。
- 上游的回复不阻断本 change 的合入。

## Risks / Trade-offs

- [D1 依赖 `modelSelection` 是本步实际使用的可写对象] → 用真实 loop 的集成测试锁定；冻结时捕获并退回为下一步生效；改为副本时由测试发现；D9 推动上游给出正式接缝。
- [`agent/request` 已弃用，未来可能被移除] → 集成测试断言它在重试时仍会派发；一旦被移除，子会话门禁需要改挂其它逐次请求接缝（D9 一并反馈）。
- [子会话判断在 `agent/created` 中等待 Jev，期间创建它的工具调用阻塞] → 总延迟与现状在子会话 step 1 前的等待相同，使用该事件的 signal，可被取消；隔离验收用真实 fresh 子任务确认。
- [根会话在子会话 `agent/created` 写入 route 之后、首个请求之前离开 AUTO] → 退化链以写入 route 的时刻为准；这个窗口只覆盖首条消息投递前的同步过程。
- [商店 0.7.0 在 0.2.2 Host 上失效] → 收尾时提示用户尽快走 publish 流程。
- [0.2.2 单向存储格式迁移] → 按 Migration Plan 做离线快照与恢复演练；恢复快照会丢失切换后的新数据，切换前须告知用户。
- [checking 证据再次丢失] → 合入前把结论汇总进会被版本控制的 `checking/summary.md`。

## Migration Plan

1. **基线**：在现役 0.2.1-rc.5 上跑 `npm test`、`npm run check:artifacts` 与各 local package 的 build/typecheck/test，并记录人工验收项在现役版本上的结果（staged-upgrade `:46-90`）。
2. **实现**：在 worktree 中完成代码和 manifest 改动；`ws promote`，安装依赖，跑全部测试，其中包括 D1/D2 在目标运行体上的集成测试。
3. **隔离候选**：`dsh build` → `ws prepare-preview` → `dsh`，按分组（裸运行体 → local package → remote 插件）验收，复跑基线人工项（AUTO 主/子路由、Pet Locus、memex 召回与 eval、观察策略、btw、better-sidebar 各 tab 等）。再按精确 commit 在 devbox 跑清洁构建 gate。
4. **备份与恢复演练**（生产切换的准入条件）：
   1. 由用户执行 `dsh stop`，停止日常 Host 及其中的 Pet SQLite 写入方，并确认没有残留的 Host 进程。
   2. 先用目标运行体的 `--dump-config` 列出实际数据根（session-persistence-jsonl 的 `root`、attachment-local、各插件存储），再离线复制这些根，至少包括 `~/.dsh/sessions`、`~/.dsh/attachments`、`~/.dsh/plugins/dsh-pet/sqlite`、`~/.dsh/profiles/web`、`~/.dsh/state`、`~/.dsh/storages`；生成 sha256 清单，并把路径写入 tasks。
   3. 在隔离的 `DSH_HOME` 中，用这份副本以 0.2.2 打开、继续写入、重启，按 runtime-api-migration `:96-107` 逐项断言：
      - generation 保留与原子发布；
      - lease 排他；
      - 中断后的 generation 选择；
      - Session 身份与标题、workspace/cwd、父子 lineage、模型/provider、assistant 内容、tool call/result、带图片附件的消息；
      - 迁移后可以继续提交。

      之后停止全部写入方，恢复快照，以 0.2.1 启动，按同一组断言确认能读回。
   4. 结果写入 `checking/summary.md`。
5. **切换**：经用户批准后合入；从主 checkout 执行 `dsh build`，连续第二次无变更；由用户决定何时启动或重启，之后用 `dsh history` 核验。
6. **回滚**：
   1. 由用户停止 0.2.2 Host，确认全部写入方都已停止。
   2. 另存失败时的数据副本。
   3. 恢复第 4 步的快照，用 `git revert` 退回 0.2.1-rc.5 的精确配置，执行 `dsh build`。
   4. 核验无误后再启动旧 Host。

   恢复快照会丢失切换后的数据，执行前要告知用户。

## Open Questions

- 上游对 D9 的回应（正式的选择接缝、`agent/request` 的去留）不阻断本 change，结果记入 `checking/summary.md`。
