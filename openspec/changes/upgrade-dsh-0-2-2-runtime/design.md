## Context

- 现状：`dsh.yaml:5` pin `0.2.1-rc.5`，生产 3080 自 2026-11-05 起运行该版本。上一轮升级 change 已归档到 `openspec/changes/archive/2026-11-06-upgrade-dsh-0-2-1-runtime/`。
- 目标：`@deepseek-ai/dsh@0.2.2-rc.1`（npm latest=next）。以下证据都来自 `npm pack` 下来的 0.2.2-rc.1 包，并经 lead 与协作会话分别独立核对：
  - `dsh-agent-loop/lib/index.js:670-671`：`preStep` 先 claim inbox，再读 `model.current()` 固定本步 selection；`:685` 才进入 `agent/pre-step`；`:1000-1001` 中 `agent/request` 的返回值只要与 selection 不同就抛错。
  - `:746-748` + `dsh-agent/lib/types/runtime-types.d.ts:293-296`：pre-step `reject` 会让回合以 blocked 结束，已 claim 的消息就此消费，不会重进 inbox。
  - `:564-569`：`send()` 先 `inbox.splice`，`:199-200` 在其中同步 emit `agent/inbox/inserted`，然后才 `wakeDriver()`；`:618-622`：`wakeDriver` 遇到 `maintenance` 阶段只置 `wakeRequested`；`:605`：维护任务结束后再启动 driver。`runMaintenance` 是公开接口（`runtime-types.d.ts:193-201`）。
  - `:789-794`：回合关闭前 await serial `agent/turn-stopping`；`:827`：inbox 仍有待处理消息时，同一个 driver 直接开下一回合，中间不经过 idle。
  - `dsh-api-session-controller/lib/index.js:704-716`：`selectModel` 内部调用 `agent.model.select(selected)`。`agent.model.select` 在 0.2.0-rc.2 和 0.2.1-rc.5 的 `dsh-agent` 类型中都不存在；`runMaintenance` 与 `agent/inbox/inserted` 在两个旧版本中都已存在。
  - `dsh-system-prompt/lib/types/index.d.ts:114-122`：`system-prompt/assemble` 的 payload 改为不含 `tools` 的 `PromptPresentation`。
  - `dsh-base/cordis.patch.yml:292-294`：顶层 insert 中已有官方行 `id: fs-observation-policy`，值为 `disabled: true`，位置在 `tool-fs` 之前。
- 约束：`staged-upgrade-execution`、`runtime-api-migration`、`repo-layout`（运行体 peer/engines 区间）三个 current spec；`docs/architecture/dsh-plugin-integration-pitfalls.md`；Worktree Session 的依赖修改须先 `ws promote`。

## Goals / Non-Goals

**Goals:**
- 本仓在 0.2.2-rc.1 上全部 local package 都能 build/typecheck/test，隔离预览中功能与 0.2.1 基线等价。
- AUTO 主会话和子会话的路由在 0.2.2 上真正生效：step 1 的 selection 就是判断结果，并且不触发运行体抛错。
- 显式恢复文件观察策略；Web Fetch 行为变化有书面记录。

**Non-Goals:**
- 第三方插件的可选升级、商店发版与商店 PR、启用 0.2.2 新功能（apply_patch、forge、liveshare、PTC VM）。
- 修改 AUTO 的判断算法、预设或 UI。

## Decisions

### D1 AUTO 判断时机：空闲入口用 `runMaintenance`，回合间入口用 `agent/turn-stopping`
空闲会话收到 user 消息时，在 `agent/inbox/inserted` 的同步回调里调用 `agent.runMaintenance(signal => judgeAndSelect(...))`。运行体会把唤醒挂起到维护结束，因此 step 1 读到的已经是新 selection。运行中排队的下一回合消息，在当前回合的 `agent/turn-stopping`（serial，会被 await）里判断。两个入口共用一个判断函数，按 (agent, 回合) 去重。`runMaintenance` 同步抛错时（已有活动工作），本回合沿用上一 depth。

被否决的方案：
- **在 `agent/pre-step` 里 select**：selection 在 pre-step 之前就已固定（`:670-671`），本步赶不上，只能下一步生效，单步回合会完全失效。
- **pre-step 里 `reject`，然后把消息放回 inbox**：会留下一个 blocked 的空回合，还要自己操作 inbox 重排，用户可见的历史也会变。
- **继续在 `agent/request` 里改写**：会直接抛错，官方也已标为 deprecated。
- **在 `inserted` 里异步发起判断但不进入维护**：与 driver 竞态，step 1 是否赶得上不确定。

### D2 应用方式：主会话走官方 `selectModel`，子会话走 `agent.model.select`
主会话沿用现有的 `deps.selectModel`。spec 要求同步官方选择和 defaults，而 0.2.2 的 `selectModel` 内部就是 `agent.model.select`。子会话不能写全局 defaults，所以直接调用子 agent 的 `agent.model.select(route)`。`agent/request` 监听器只保留「返回 `await next()` + 子会话实时门禁核验（不通过就抛错）」，不再改写。applied 判定沿用现有的 `request/header` 和 `session.requestHeader()` 比对逻辑。

### D3 auto-model-routing 兼容下界抬到 `0.2.2-rc.1`
`agent.model.select` 在 0.2.0 和 0.2.1 中不存在（D1 的证据）。如果保留双路径（特性探测 + 旧的 request 改写），就要并存两套应用语义和两套测试，而且旧路径在 0.2.2 上是错的。因此只保留新路径，把该包的 `engines.dsh` 和 dsh peer 区间下界改为 `0.2.2-rc.1`，理由按 repo-layout D5 记在 package README/CHANGELOG 里。代价：商店上的 0.7.0 在 0.2.2 Host 上会失效（请求抛错），0.2.0/0.2.1 用户只能继续用 0.7.0。新版本的发版后置到单独的 publish 流程，但本 change 的收尾要明确提示这个风险。其它 local package 的下界不变，除非审计发现它们也用了只在 0.2.2 才有的 API。

### D4 memex 裁判的工具投影迁移
`judge-boundary.ts:22-25` 现在在 `system-prompt/assemble` 中过滤 Team 工具的 schema。0.2.2 中工具声明改由按步骤启用的工具解析（`tools.resolve` / `executable`）提供。实现时以目标版本类型为准，选用官方「按 agent 作用域让工具不可用」的接口，把同一组 Team 工具从该裁判 child 的工具集中排除。最终门禁（`verifyJudgeRequest`、`tools.guard`）保持不变，仍是权威核验。如果没有等价接口，就删掉这层投影，只依赖最终门禁拒绝；这条路需要先在 design 里补记，并确认 spec `dsh-memex-evaluation:198`（首个请求前核验有效工具面）仍然满足。

### D5 文件观察策略：整行覆盖 patch，不新增包行
新增 `patches/fs-observation-policy.yml`（plain patch，按 id 整行覆盖），内容为 `id: fs-observation-policy`、`name: '@deepseek-ai/dsh-fs-observation-policy'`、`disabled: false`；在 manifest 中加一个 `type: patch` 条目。不新增 remote 包条目：该包已是 `dsh-base` 的依赖，再加一行会造成双注册，first-wins 冲突。另加一个仓库测试：从已安装的目标运行体读取 `dsh-base/cordis.patch.yml`，断言存在同 id、同包名的官方行，不存在就失败（对应 spec「官方行缺失时失败」）。sync 现有的 `mergeConfig` 不支持 `disabled`，这里也不需要它。实现时先用 `--dump-config` 确认整行覆盖后 `disabled` 生效；如果 cordis 的整行覆盖不能清掉 `disabled`，回到 design 改方案（例如给 sync 增加受限的 `disabled` 覆盖）。

### D6 Web Fetch 接受新行为
不加限制，在 `dsh.yaml` 中运行体版本附近的注释或说明里写明「0.2.2 起 Web Fetch 可访问非公网地址，信任面扩大，已于 2026-11-06 由用户接受」。

### D7 pin 与依赖
用 `scripts/check-update.mjs --rewrite-to 0.2.2-rc.1` 改写 `dshVersion` 与同族 provider pin（skill-filesystem、mcp-client）及其 integrity；local package devDependencies 改为 `^0.2.2-rc.1`，peer 尾段同步改为 `|| ^0.2.2-rc.1`。先 `ws promote` 再 `npm install` 更新根 lockfile。

### D8 其余逐项复核（结论写入 `checking/summary.md`，该文件会被版本控制）
- dsh-pet：`ctx.tools.schemas(scope)` 在按步骤启用工具后的结果（`src/index.ts:741/1216/1280/1938`）；Locus 工具上限读回的等价性测试必须仍然通过。
- sidebar-session-provider-icon：`sessionProjections.register` 改为异步，按官方要求在启动时持有返回值。
- connection patch：检查官方 connection 行的 `inject` 是否已含 `webServer`；已含则删除 fragment。
- noPet 官方模块名册按 0.2.2-rc.1 重新生成。
- `scripts/host-capability-probe.mjs:78` 的 `agent/request` 探针改为只读。
- Node ≥ 24.9：核对 bootstrap/host-prerequisites 的最低版本门槛是否需要上调。
- 会话存储：release notes 写明「读取兼容旧版本并以新版本格式写入」。必须在隔离预览中确认 0.2.2 写过的 Session、Pet SQLite 能否被 0.2.1 读回，并据此写回滚步骤。

## Risks / Trade-offs

- [子会话首条消息入队时，子 agent 可能不处于 idle，`runMaintenance` 会抛错] → 隔离环境先用探针确认官方 fresh 子会话的创建与首条消息时序；若不处于 idle，改在 `agent/created` 时对子会话 `runMaintenance`（此时必然 idle），从创建参数中取任务文本，同时修订 spec。
- [维护任务等待 Jev 期间，用户回合最多推迟一个「Jev 期限」（≤ 8000 ms）] → 与现有在 pre-step 中等待的延迟相同；超时即放弃，不改选择。
- [`select` 会持久化，并延续到之后的回合] → 主会话本来就同步官方选择；非用户回合沿用上一 depth 与持久化语义一致。子会话 route 本就固定。
- [商店 0.7.0 在 0.2.2 Host 上失效] → 收尾时提示用户尽快走 publish 流程；不在本 change 内发版。
- [0.2.2 的单向存储格式迁移导致无法回滚] → 生产切换前备份 `~/.dsh/sessions`、Pet SQLite 和 profile，并在 tasks 中写明备份路径与校验结果；隔离预览中验证旧版本能否读回。
- [checking 证据再次丢失] → 合入前把结论汇总进会被版本控制的 `checking/summary.md`。

## Migration Plan

1. 在 worktree 中完成代码和 manifest 改动；`ws promote`，安装依赖，跑全部测试。
2. 隔离候选：`dsh build` → `ws prepare-preview` → `dsh`，按分组（裸运行体 → local package → remote 插件）验收，复跑基线人工项（AUTO 主/子路由、Pet Locus、memex 召回与 eval、观察策略、btw、better-sidebar 各 tab 等）。
3. 经用户批准后合入；备份并校验；从主 checkout `dsh build`，连续第二次无变更；由用户决定是否重启，重启后用 `dsh history` 核验。
4. 回滚：`dshVersion` 与 local 依赖改回 0.2.1-rc.5（git revert），`dsh build`，重启；如果存储已单向迁移，从第 3 步的备份恢复。

## Open Questions

- D4 是否存在等价的「按 agent 作用域移除工具声明」接口（实现前在目标版本类型中确认）。
- 子会话首条消息入队时 agent 的阶段（见 Risks 第一条）。
- cordis 整行覆盖能否把官方 `disabled: true` 改为启用（D5，实现前以 `--dump-config` 确认）。
