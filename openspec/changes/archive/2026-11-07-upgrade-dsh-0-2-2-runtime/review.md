## Review Metadata

- **Review round**: 6
- **Prior round**: round 5 — VERDICT: REVISE（1 Critical：C7 created 等待期间取消留下 AUTO 持久绑定）；探针全部通过
- **Reviewer context**: cross-model (Magpie Codex gpt-6.1-sol, fresh context)
- **Tool restrictions**: read-only inspection; only write is review.md (+ own temp unpack)
- **Artifacts reviewed**: [proposal.md](proposal.md), [design.md](design.md), [AUTO delta](specs/auto-model-routing/spec.md), [观察策略 delta](specs/fs-observation-policy/spec.md), relevant source files

独立确认 HEAD 为 `8a963c241bc492700c6656a81e4d9f70f4a7ddd9`，开始时工作树干净。完整阅读 proposal、design、两份 delta，以及 current auto-model-routing；按 requirement 名称将七条 MODIFIED 整条替换、加入一条 ADDED，再检查其余保留条款。另对照 current dsh-memex-evaluation、repo-layout、staged-upgrade-execution、runtime-api-migration 与相关源码。没有把尚未实施的迁移代码当成已实现，也没有把提案阶段缺少迁移实现列为缺陷。

通过 npm registry HTTPS tarball 独立取得目标 `0.2.2-rc.1` 的十二个相关包，以及 `0.2.1-rc.5` 的 dsh-agent、dsh-agent-loop。目标十二包的文件名及文件内容与第 5 轮发布物缓存完全一致。阅读第 5 轮探针源码及结果，本轮只复跑创建取消的真实运行体链，并补未改动现状源码的取消/旧记录定点核验；没有重复整套主会话及 startup/resume/M10 探针。下文明确区分本轮执行、既有证据复核和后续实施验收。

## Findings

### 🔴 Critical (blocking)

无未关闭的 Critical。C7 rebuttal 接受，理由及证据见 Rebuttals；不再要求清除取消后的持久 AUTO 记录或绑定标记。

### 🟡 Moderate

#### M11：主 effort 应用已前移到 pre-step，保留场景仍要求 pre-step 返回后处于旧的“待应用”阶段

- **证据：** [AUTO delta:4](specs/auto-model-routing/spec.md#L4) 明确每一步在 pre-step 完成 effort 的计算与应用，[design:37–43](design.md#L37) 也要求在该边界解析支持范围、计算目标并同步。未列入 MODIFIED、因此合并后保留的 [current「决策提示」场景:561–564](../../specs/auto-model-routing/spec.md#L561) 却要求：模型只支持 `max`、Jev 已判 `higher` 时，pre-step 完成后的状态仍为 `recommended / 待应用`，到请求发出后才变为 `unsupported / no-effort-support`。这正是把能力映射留在 agent/request 时的旧顺序；[现有集成测试:401–409](../../../packages/dsh-auto-model-routing/test/policy-host.integration.test.ts#L401) 通过外层 pre-step listener 读状态，直接断言了这个旧阶段。
- **具体反例：** AUTO 的 Claude 主会话当前官方选择为 `max`，目录只提供 `max`，自动 cap 为 `xhigh`，本回合 Jev 返回 `higher`。按新 D1，pre-step 返回前就必须发现没有自动 effort，保持官方选择、记 `no-effort-support` 并把本次决策标为 `unsupported`；此时读取状态无法同时满足保留场景要求的 `recommended / 待应用`。若为通过旧断言而把映射或其可见状态延到 agent/request，又会留下与新应用时序不一致的状态定义。
- **影响：** 同一个边界有两种验收答案，实施者可能保留失真的状态或改动测试而缺少规范依据。它不推翻 D1 的运行机制，因此列 Moderate，不升级为 Critical。
- **最小修法：** 增加整条 MODIFIED「决策提示」，其余正文及场景原样保留，仅把上述场景改为 pre-step 完成后已经 `unsupported / no-effort-support`、请求发出后仍保持该状态；同步更新 proposal 的 MODIFIED 计数与列举。完整要求见 Required Changes，不要求新增运行时机制。

### 📌 Suggestions

无新的独立建议。第 5 轮 S11 已在 [AUTO delta:116](specs/auto-model-routing/spec.md#L116) 明写“failed 且有 route 才拒绝；旧 failed 无 route 原样放行”，与 [delta:160、202–205](specs/auto-model-routing/spec.md#L160) 一致，本轮用现状真实 PolicyStore 与 request listener 验证了旧无 route 的 failed 正例。

逐次请求门禁仍须在实施时覆盖完整性、身份、请求与 route 一致、目录、官方允许列表、父 captured allowlist、cap 和同 step retry；这是 [design:60–61](design.md#L60)、[delta:154、217–230](specs/auto-model-routing/spec.md#L154) 及保留的 [current:347–350、704–707](../../specs/auto-model-routing/spec.md#L347) 已有义务，不另列新的 finding。

## Probe Results

### 1. C7 事实核验：0.2.1 已先绑定，Jev 取消后保留持久记录

直接阅读并在内存转译执行磁盘未改动的 [policy-host.ts](../../../packages/dsh-auto-model-routing/src/policy-host.ts)、[policy-store.ts](../../../packages/dsh-auto-model-routing/src/policy-store.ts)；上下文注册、Jev、目录为测试端口，PolicyStore 使用真实 zod 与 fs，只写我方临时目录。

- [policy-host:87–106](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L87) 在 startup created 中建立初始 recommended 记录；[PolicyStore.create:58–61](../../../packages/dsh-auto-model-routing/src/policy-store.ts#L58) 先写 JSON，再写 `.bound`。实际执行后，尚未进入子 pre-step 就已 `bound=true / recommended`。
- [policy-host:149–164](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L149) 中根模式 epoch 不变时，Jev 返回 cancelled 直接调用 `fallback(record, 'jev-cancelled')`；[fallback:58–65](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L58) 用 store.set 写 `unsupported / jev-cancelled`，保留标记并设置 childNotice、写 warn。实际执行结果完全一致。
- [disposed:112](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L112) 只清内存。触发后再次从真实存储读取，绑定仍为 true、记录仍为 unsupported。
- 旧版是在后续子 pre-step 等待 Jev，新版把等待前移到 created；不能据此声称两个版本的等待位置相同。但“created 已绑定、Jev 取消记持久 unsupported/jev-cancelled”确实是既有行为，支持本轮所评审的持久化取舍。
- 同一探针直接执行旧 `failed` 无 route 的 request listener，返回对象与 `await next()` 完全相同。对真实 `policyEffort` 配合实际 AUTO_EFFORTS 的定点调用也确认：仅支持 max 时映射不可得；M11 是阶段定义冲突，不是 max 自动路由的新需求。

### 2. 新取消场景：目标运行体真实创建链通过

本轮使用独立下载的发布物，复用已阅读的第 5 轮 VM 装配方式，实际执行 AgentLoop.initializeAgent、SubagentManager.materializeTracked/setup、AgentRegistry.enter/announce。AUTO listener 按拟迁移设计在探针内实现，真实 PolicyStore 落盘；没有冒称运行了尚未落地的迁移实现。created 先绑定并挂起模拟 Jev，创建 signal 中止后写 unsupported/jev-cancelled、不应用 route，工厂以取消错误结束。

| 断言 | 本轮结果 |
| --- | --- |
| AUTO route select / 首消息领取 | 0 / 0 |
| agent/request / prepareCall / adapter.stream | 0 / 0 / 0 |
| saveSelection / 未处理 rejection | 0 / 0 |
| live child / manager resident activation | 0 / 0 |
| AUTO 决策 JSON / 绑定标记 | 均保留 |
| 持久记录 | unsupported / jev-cancelled |

因此 [delta:137–140](specs/auto-model-routing/spec.md#L137) 的新场景可机械断言且通过；“不 select”指 AUTO 不应用候选 route，不包括官方 setup 自身的初始选择。官方已写 Session 事件保留，新条款没有要求删除它们。真实运行体在 [loop:1574–1596](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) await setup/announce 并清退失败创建，支持零投递和 live registry 清零。

与 [退化链 delta:152、156、160](specs/auto-model-routing/spec.md#L152)、保留的 [未路由告警 current:789–800](../../specs/auto-model-routing/spec.md#L789) 不冲突：取消记录无 route，不会自动发默认请求；signal 中止仍由宿主取消。未路由 warn/childNotice 仍按既有规则产生，“按 DSH 默认运行”说明未应用 AUTO route，不作为已产生模型调用的证据；0.2.1 的同一 fallback 也写该告警。恢复这个完整无 route 记录时原样放行、不重判，与旧记录兼容规则一致。

本轮定点证据目录为 `/tmp/dsh-r6-review-8a963c24-q1c4zp3j/`，重点是 `baseline-probe.mjs` / `baseline-result.json`、`cancel-probe.mjs` / `cancel-result.json`。探针准备时修正了测试端等待就绪及重复运行存储隔离，最终断言均通过；这些是探针自身问题，没有归因到被评审设计。

### 3. 第 5 轮核心探针的适用性与未重复执行范围

独立下载的十二个目标包逐文件与第 5 轮缓存相同；`daa951f1..8a963c24` 在被评审规范中的实质改动仅为恢复 failed 限定和取消正文/场景，未改变 D1、startup select、resume 补 route、M10 admission、每 attempt 核验的机制。已阅读第 5 轮探针源码与结果，原有结论仍适用：

| 既有证据 | 复核结论 |
| --- | --- |
| 主会话 step 1 即 high、等待时零请求、同 step retry | 共享 selection、await 顺序及 retry 复用未变 |
| 冻结回退与只 select 的负对照 | medium→high；Readonly 依赖仍由集成测试锁定 |
| startup 继承组合与显式 preset | setup 在 created 之前；created 选 route 后 step 1 使用它，不保存默认 |
| resume 合法旧 route 及缺失/损坏/parent/failed+route 负样本 | 补写既有 route、不重判；完整性拒绝仍成立 |
| M10 配对校验、允许列表、preflight 三类拒绝 | 都先于 child factory/created，child/Jev 均零；正对照确实创建 |
| retry 前门禁失效 | 第二次 agent/request 仍发生，拒绝后无第二次 adapter 调用 |

本轮未重新执行上述整套用例，未装配候选 Host、完整 Team journal/provisioning、真实 preset loader 或完整 memex eval。当前证明的是接缝及提案可行性，实施后仍须用迁移后的真实插件完成设计要求的集成与候选验收。

### 4. 合并后的完整契约与其余决策复核

- **判断时机、范围、输入：** [保留的受管范围:639–647](../../specs/auto-model-routing/spec.md#L639) 与 [delta:83、116、233、312](specs/auto-model-routing/spec.md#L83) 一致：官方工具 ALS、startup、同父，在 created 采样直接父配置并判根 AUTO；输入统一取该工具 prompt，非 user 注入不贡献。created 前 MANUAL 不绑定且 Jev=0；同窗口同父旁支使用外层 prompt 的已接受限制仍如实保留。
- **父快照、epoch、取消、恢复：** 父配置只在绑定边界采样，不混工具入口旧值；判断捕获根 epoch，每次 Jev/目录异步返回及保存前检查；AUTO→MANUAL→AUTO 也废止旧结果。既有 route 在 resume 补官方选择，failed+route 拒绝；旧无 route 状态按兼容规则放行；recommended 无 route 的冷恢复走 interrupted。新取消场景不要求删除 Session 或旧记录，未引入撤销/重建绑定框架。
- **显式维度、teammate、每请求核验：** 完全显式零 Jev、部分显式只判缺失维度；显式 effort 不走父 effort 回退，provider 不变，所有候选均校验目录/官方允许列表/captured allowlist/cap。独立阅读 [Team 工具:264–289](https://registry.npmjs.org/@deepseek-ai/dsh-experimental-tool-agent-team/-/dsh-experimental-tool-agent-team-0.2.2-rc.1.tgz) 确认 prompt 及 fresh/fork 分支。已有 route 每 attempt 在 agent/request 只核验、原样返回；[loop:842、929–939、994–1001](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 支持重试核验，不夸称覆盖压缩请求。
- **主机制：** 独立核对 [loop:671、685–707、842](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz)、[AgentModel.current/select:81–95](https://registry.npmjs.org/@deepseek-ai/dsh-agent/-/dsh-agent-0.2.2-rc.1.tgz)、[controller:704–728](https://registry.npmjs.org/@deepseek-ai/dsh-api-session-controller/-/dsh-api-session-controller-0.2.2-rc.1.tgz)，共享可写 selection、同步会话选择和后台默认保存的解释成立。每步计算、同 step retry 复用、MANUAL/失败处理、冻结回退均未回归；可见状态阶段仅有 M11 需修订。
- **C3 迁移次序：** [design:110–132](design.md#L110) 保留现役基线、隔离候选/devbox、停止全部 writer、按有效配置定位数据根、离线备份/sha256、真实历史迁移/重启、停止 writer 后恢复快照到旧 runtime 的次序，与 [staged-upgrade:113–122](../../specs/staged-upgrade-execution/spec.md#L113)、[runtime-api-migration:96–107](../../specs/runtime-api-migration/spec.md#L96) 一致。本轮没有执行生产演练。
- **D4 memex：** 独立核对 [PromptPresentation:114–122](https://registry.npmjs.org/@deepseek-ai/dsh-system-prompt/-/dsh-system-prompt-0.2.2-rc.1.tgz) 无 tools、[subagent setup:1802–1813](https://registry.npmjs.org/@deepseek-ai/dsh-subagent/-/dsh-subagent-0.2.2-rc.1.tgz) 先写 descriptor、[Team:873–896、1185–1187](https://registry.npmjs.org/@deepseek-ai/dsh-experimental-agent-team/-/dsh-experimental-agent-team-0.2.2-rc.1.tgz) 排除普通子会话，支持 [design:69–70](design.md#L69) 删除旧投影；最终冻结请求/精确身份/工具面门禁与启用 Team 的成功和污染拒绝测试仍保持 [current eval:192–220](../../specs/dsh-memex-evaluation/spec.md#L192) 的义务。
- **D5 观察策略：** [目标 base patch:292–294](https://registry.npmjs.org/@deepseek-ai/dsh-base/-/dsh-base-0.2.2-rc.1.tgz) 确为 disabled=true；[design:72–73](design.md#L72) 的整行覆盖不需新物化机制。[fs delta:4–26](specs/fs-observation-policy/spec.md#L4) 的一条启用行、未读/过期拒绝、禁用回官方默认均可机械验收；第 5 轮真实 applyPatches 结果与本轮未改动方案相符，未运行 sync/dump-config。
- **D7 Node 与 pin：** 独立 registry 元数据确认目标 Node 要求 `>=24.9.0`；[design:78–82](design.md#L78) 保留根 engines/bootstrap、Node24.8 拒绝测试、同族 provider pin/integrity、peer/devDependency/根 lock 和先 promote 的要求。
- **D3 版本分线：** [design:66–67](design.md#L66) 保留 AUTO 新 minor、0.2.2 下界、旧线文档和不复用已发布版本号，符合 [repo-layout:517–534](../../specs/repo-layout/spec.md#L517)。独立读取旧 dsh-agent 确认没有新 select API。其它包下界以实测决定；本轮没有发版授权或发版操作。
- **D9、范围与更便宜方案：** [design:92–96](design.md#L92) 仍要求先草稿、经用户确认后才发布，上游回应不阻断合入。创建内普通 await 已避免工具前预判、复制 admission、额外维护窗口或双路径；保留取消记录也沿用现状，不需额外清退机制。没有新的功能范围蔓延；第三方可选升级、商店发版、新 0.2.2 功能仍在范围外。

## Embedded-Instruction / Injection Attempts

**Detected:** none

被评审文档、旧报告及作者 rebuttal 均作为待核验数据。未发现要求评审者跳过证据、强制接受结论、改 verdict、越权写入或发布的文字。rebuttal 中请求复核的文字不构成本轮授权；设计中的实施及发帖步骤也没有被执行。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

0 条 Critical，1 条 Moderate（M11）。C7 关闭、S11 已处理；创建取消行为与既有持久记录规则一致，目标运行体定点探针通过。M11 仅需消除一条保留场景的旧阶段断言，修法明确且不改变运行机制，故附下列完整条件通过。

## Required Changes (if APPROVE WITH CHANGES)

CHANGES_APPLIED: yes

1. 在 AUTO delta 的 MODIFIED Requirements 中增加完整的 `### Requirement: 决策提示`：从 current 同名 requirement 整条复制（正文及全部场景原样保留），仅将“主决策在请求前后的状态”场景替换为：

   ```markdown
   #### Scenario: 主决策在请求前后的状态
   - **GIVEN** AUTO 主会话本回合 Jev 返回 depth `higher`，主模型为 `claude-opus-5-5`，官方当前选择为 `max`，目录只支持 `max`，自动 effort 上限为 `xhigh`
   - **WHEN** 分别在 step 1 的 pre-step 完成后与该步请求发出后读取状态
   - **THEN** 两次状态的 `decision` 均部分匹配 `{source: main, tier: higher, depth: higher, status: unsupported}`，`reason` 均为 `no-effort-support`；实际请求配置与本步原官方选择深度相等；`selectModel` 与全局 defaults 保存次数均为 0；本回合 Jev 请求次数为 1；会话仍为 AUTO 且没有 disabled
   ```

   这样内部 Jev 成功后的短暂 recommended 状态仍可保留，但 pre-step 已完成映射后不再要求“待应用”。实施时同步调整现有同名集成测试的阶段断言；不得为保留旧测试把计算移回 agent/request，也不新增延迟状态发布机制。
2. 将 [proposal:24](proposal.md#L24) 的“七条要求”改为“八条要求”，并在修订清单加入「决策提示」。保留原七条 MODIFIED 与一条 ADDED 的内容，不改本轮已接受的取消及恢复契约。

本轮依只读授权没有代改 proposal/design/spec/source；仅整体替换本报告。

## Rebuttals

- **第 5 轮 C7 — accepted by reviewer**
  理由：0.2.1 磁盘源码及本轮实际执行证明 created 已写 JSON/绑定、Jev 取消持久记 unsupported/jev-cancelled；合并后的规范明确保留该行为，并由宿主阻止取消后的实际请求。“无残留持久记录”不是应继续施加的门禁。
- **第 5 轮 S11 — 已处理**
  理由：[AUTO delta:116](specs/auto-model-routing/spec.md#L116) 明确 failed+route 拒绝、旧 failed 无 route 放行，与兼容要求和定点正例一致。
- **第 4 轮 C6、M9、M10 — 维持 accepted by reviewer**
  理由：resume 补 route、created 同边界绑定/采样、官方 admission 先于 Jev 的设计与证据均未被本轮差异改变；没有重新打开这些已关闭问题。

本轮新 finding 的作者回应（留空）：

- **M11：**

作者回应（2026-11-07）：Required Changes 1、2 已按原文应用（delta 新增整条 MODIFIED「决策提示」，只替换「主决策在请求前后的状态」场景；proposal 改为八条）。实施时同步调整 `test/policy-host.integration.test.ts:401-409` 的阶段断言。待评审者定向复核后再把 CHANGES_APPLIED 置为 yes。
定向复核（round 6 recheck）：已核对 a00482a8..daa559fd，Required Changes 1、2 均正确应用；MODIFIED「决策提示」正文及全部场景与 current 原文一致，仅指定场景按 Required Changes 逐字替换；proposal 已加入「决策提示」并改为八条，原七条 MODIFIED 与一条 ADDED 内容未变；除上述修改及本报告末尾作者回应外，proposal/design/specs 无其它改动；严格校验结果为 valid，CHANGES_APPLIED: yes（仅定向复核，未重做完整评审）。
