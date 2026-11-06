## Review Metadata

- **Review round**: 4
- **Prior round**: round 3 — VERDICT: REVISE（2 Critical：压缩请求绕过门禁、取消吞 steer；3 Moderate：批次求差、子场景断言、reason 闭集）；作者其后经用户批准替换为最小方案
- **Reviewer context**: cross-model (Magpie Codex gpt-6.1-sol, fresh context)
- **Tool restrictions**: read-only inspection; only write is review.md (+ own temp unpack)
- **Artifacts reviewed**: proposal.md, design.md, specs/, relevant source files

评审快照经 `git rev-parse HEAD` 独立确认为 `9a9821b7ad238f5c98e67f8dfb9f71ad027af841`。这是整份提案/设计评审，按 requirement 名称将七条 MODIFIED 整条替换进 current spec，再加一条 ADDED；没有把尚未实施的迁移代码当作缺陷。旧 review 末尾作者声明只作为待核对数据。

独立通过 npm registry HTTPS tarball 取得 `0.2.2-rc.1` 的 dsh-agent-loop、dsh-agent、dsh-api-session-controller、dsh-subagent、dsh-tool-subagent、dsh-experimental-tool-agent-team、dsh-llm、dsh-base，并补查 dsh-system-prompt、dsh-experimental-agent-team、dsh-agent-default-model、dsh-compaction-basic、`@deepseek-ai/cordis-plugin-include@1.1.0`；对照了两个旧版 dsh-agent 和 `dsh-agent-loop@0.2.1-rc.5`、旧版 compaction-basic。下文 npm 行号均来自本轮独立读取。

在 Node v24.12.0 中执行发布物真实 ReactLoopAgent 的构造、send/followup、kick、turn、preStep、step、prepareRequest、buildRequest，以及真实 AgentModel/模型投影、Inbox/投影、agentEvents、流累积器和官方 selectModel 方法体；子探针还执行真实工厂 initializeAgent、Registry.announce、SubagentManager.materializeTracked/setup、applyChildComposition、submitAdmitted/deliver。源方法体未改写；通过 VM 装配，替换持久化、Cordis 装配/注册端口、schema 装配壳、模型 adapter、工具及提示词端口。探针及结果保存在评审者临时目录 `/tmp/dsh-r4-review-9a9821b7/`。没有运行 build、sync、install，没有操作日常 Host，没有真实 Jev/付费模型调用；仓库唯一写入为整体替换本报告。

## Findings

### 🔴 Critical (blocking)

#### C6：合法的旧子会话已有 route，但没有官方选择时，升级恢复会被新门禁永久拒绝

- **证据：** [delta auto spec:116](specs/auto-model-routing/spec.md#L116) 只规定在创建绑定时 `agent.model.select(route)`，继而声称恢复时“已持久的选择即为 route”；[design.md:58](design.md#L58) 同样没有已有记录的恢复步骤。但 [delta:145](specs/auto-model-routing/spec.md#L145) 明确允许 `recommended` 有 route、无 actual；[delta:137](specs/auto-model-routing/spec.md#L137) 与 [delta:197–200](specs/auto-model-routing/spec.md#L197) 只把“recommended 且无 route”当作 interrupted。旧实现确实先在 [policy-host.ts:175–176](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L175) 写入带 route 的 recommended，再在后续请求覆盖配置（[policy-host.ts:211–218](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L211)）。[policy-store.ts:24–25](../../../packages/dsh-auto-model-routing/src/policy-store.ts#L24) 接受此状态，[policy-store.ts:63–69](../../../packages/dsh-auto-model-routing/src/policy-store.ts#L63) 将它独立写盘。
- **具体反例：** 0.2.1 子会话 C 已持久保存 `recommended + route=P/CHILD/low`，在首个 `request/header` 前进程中断。其官方创建参数/descriptor 仍是 `P/M/medium`，因为旧实现从未为 child 写官方选择。升级后 source=resume，不重新绑定、不重新判断；新门禁按设计只核验，请求却仍从 `P/M/medium` 开始。它既不是记录损坏，也不是无 route 的 interrupted。保留的 [current auto spec:679–682](../../specs/auto-model-routing/spec.md#L679) 要求恢复后请求仍用原 route，现方案没有一步能实现它。
- **独立运行结果：** 真实目标 loop 在这个持久化端口状态下得到 `model.current=P/M/medium`、`agent/request=1`、`prepareCall=0`、`adapter.stream=0`、`turn/end=error`，错误为探针核验器的 `bound route mismatch`。关闭该核验也只会发出错误的父 route。正对照在恢复后、preStep 前仅执行 `agent.model.select(已有route)`，得到 step 1 current/header/stream 均为 `P/CHILD/low`、`Jev=0`、`saveSelection=0`、回合 completed。执行真实旧版 prepareRequest 并沿用旧 request 覆盖策略，结果配置也是 `P/CHILD/low`。
- **原因边界：** [目标 AgentModel:81–96](https://registry.npmjs.org/@deepseek-ai/dsh-agent/-/dsh-agent-0.2.2-rc.1.tgz) 只读取原生 pending/lastUsed，否则用 options；它不会读取 AUTO 的独立决策文件。[目标 loop:1759–1766](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 恢复时重传 agentOptions 并 announce resume，不能把两个存储中的 route 自动合并。新建流程的“写 AUTO 记录 → 写原生 selection”也不应假定是跨存储原子操作。
- **所需修订：** 明确对已有合法绑定 route 在恢复/首次准备之前恢复原生选择，且不重判、不写全局默认、不重写绑定；至少覆盖旧 `recommended+route`、已有 applied，以及该绑定的独立存储中断窗口。先验证绑定完整性和 failed 状态；缺失/损坏、parent 不符及已有 route 的 failed 继续 fail closed，不能用恢复路径把这些状态洗成可执行。恢复后仍保留每次 attempt 的实时门禁。补上述旧版本迁移样本的正负对照，不能只测试已出现 route 请求头的 applied 样本。

### 🟡 Moderate

#### M9：未替换的受管范围仍把 created 当作身份、父快照和零外发边界，与工具前判断不自洽

- **证据：** 七条 MODIFIED 没有“自动受管子会话范围”（实际 requirement 名为「AUTO 受管子会话范围」）。因此 [current auto spec:641](../../specs/auto-model-routing/spec.md#L641) 仍要求在 `agent/created` 一次判定、同步采样父配置；[current:694–697](../../specs/auto-model-routing/spec.md#L694) 明确要求入口 A/Ma/Ea、created 前变成 B/Mb/Eb 时，两份 parentSelection 都必须为 B/Mb/Eb，非显式 P 也必须为 B。另一方面 [design.md:57](design.md#L57) 要求在 tools/execute 的 `next()` 前已经按退化链确定 route；[delta:133–136](specs/auto-model-routing/spec.md#L133) 仍让 P/M0/E0 来自该创建快照。目标 [tool-subagent:445–448](https://registry.npmjs.org/@deepseek-ai/dsh-tool-subagent/-/dsh-tool-subagent-0.2.2-rc.1.tgz) 与 [subagent:1421–1427](https://registry.npmjs.org/@deepseek-ai/dsh-subagent/-/dsh-subagent-0.2.2-rc.1.tgz) 在入口到 created 之间有真实 await；这不是一个只有同步指令的窗口。
- **具体反例一：** 工具前 Jev/目录以 A/Ma 算完 route，官方工具在 preflight/prepare 时挂起；父配置变成 B/Mb，再继续创建。使用 A route 不满足以 created 快照 B 为锚的退化链；只把 parentSelection 改成 B 又会记录一个并非按该快照产生的 route。设计未规定重算边界或该结果如何处理。
- **具体反例二：** 工具入口根为 AUTO，子 Jev 已发出；它等待时根切 MANUAL，随后才进入 created。新 [delta:141](specs/auto-model-routing/spec.md#L141) 要求丢弃结果并以 unsupported/mode-changed 结束；但未替换的 [current:674–677](../../specs/auto-model-routing/spec.md#L674) 对同一“created 前切 MANUAL”场景要求 C 无记录、无绑定、Jev 请求数为 0。已发出的外部请求无法撤回成 0。若改为工具期只保留无 childId 的临时结果，也应明确其与 created 时“不受管”的关系，不能同时保留两份不同断言。
- **另一个受此边界影响的已接受限制：** [current:689–692](../../specs/auto-model-routing/spec.md#L689) 仍将同窗口同父插件旁支一并受管；[delta:83](specs/auto-model-routing/spec.md#L83) 改用外层工具 prompt，则旁支 L 的实际任务与外层工具任务不同的时候，旧版“按自身输入独立判断”已经改变。当前接受的限制只承认身份不可区分，没有承认把外层任务的判断复用于不同任务。
- **所需修订：** 将「AUTO 受管子会话范围」也纳入 MODIFIED，为身份判定、父快照、模式/epoch、临时结果转成持久记录的时点给出唯一答案；补父配置变化、created 前模式往返及同窗口不同任务旁支的机械断言。若改变这些旧行为，须在 proposal/Goals 中写明具体差异，不能继续概括为判断输入和时机都不变。S9 给出一个值得先验证的更小接缝。

#### M10：Jev 前移到工具体之前，会对官方最终拒绝的创建调用先外发任务

- **证据：** [design.md:57](design.md#L57)、[delta:116](specs/auto-model-routing/spec.md#L116)、[delta:218](specs/auto-model-routing/spec.md#L218) 都要求在 tools/execute 调用 next() 前完成 Jev。目标 [tool-subagent:431–451](https://registry.npmjs.org/@deepseek-ai/dsh-tool-subagent/-/dsh-tool-subagent-0.2.2-rc.1.tgz) 却在真正工具体内才检查 provider/model 配对、官方 allowlist、实际 route 可解析性。旧实现 [policy-host.ts:142–161](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L142) 只有已经精确绑定的 child 进入 pre-step 时才调用 Jev。合并后 [current auto spec:645](../../specs/auto-model-routing/spec.md#L645) 仍以实际创建的受管对象为判断边界；[design.md:25](design.md#L25) 仍声称判断输入、时机和可见行为等价。
- **具体反例：** 工具参数给出合法非空 `model` 与 prompt，但省略 provider 和 effort；这通过参数结构声明（provider/model 各自 optional），会触发新方案仅判断 depth 的 Jev。随后真实官方 `requestedAgentOptions` 在 [tool-subagent:60–66](https://registry.npmjs.org/@deepseek-ai/dsh-tool-subagent/-/dsh-tool-subagent-0.2.2-rc.1.tgz) 抛出 `child LLM provider and model must be supplied together`，没有创建 child。旧版是 Jev=0、child=0；新要求的顺序是 Jev=1、child=0。完整 provider/model 但不在允许列表、未给 effort 的调用同样先外发，随后才在 `:89–95` 被拒。
- **独立核对：** 执行发布物真实配对检查 helper 确认上述抛错；计数差异来自 design 指定的前后顺序，不冒称执行了尚未实现的插件。除成本与延迟外，这会把本来未进入子会话的 prompt 发往决策服务；不能由“总等待时长与现状相同”推出等价。
- **所需修订：** 将判断放到能证明官方创建已经通过准入、但首步尚未准备的边界，或明确提出并验收“失败创建也可能外发/计费”的行为变化。至少加入配对错误、allowlist 拒绝、preflight 失败三类断言。不建议复制一份官方工具校验来维持两套 admission 逻辑。

### 📌 Suggestions

#### S9：先验证可等待的 agent/created，再决定是否需要把判断前移到工具体之前

[design.md:13](design.md#L13) 已引用 created 的 serial 语义，但 [design.md:56–60](design.md#L56) 的备选分析未讨论直接在该 serial listener 内等待判断。目标 [factory:1574–1579](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 已完成 setup 才 await announce，[Registry:703–714](https://registry.npmjs.org/@deepseek-ai/dsh-agent/-/dsh-agent-0.2.2-rc.1.tgz) await serial listeners。这里等待 Jev、随后同步调用 model.select，不需要嵌套 runMaintenance。

具体可比较的场景是 M9 的“入口 A、created 时 B”及 M10 的官方拒绝：保留 tools/execute 仅携带 ALS 元信息/任务文本，在已证明受管身份、采样父配置之后判断，再在 listener 返回前 select，能自然避开这两类提前判断问题。仍需验证创建取消与旁支任务输入，不能据此声称完整方案已通过；本轮工厂探针已证明等待 created 返回后才投递首消息的调用次序。这个方向不会改变 D1 已通过的主会话机制。

#### S10：把“逐次请求”的边界和原有 fail closed 检查列成回归矩阵，避免重新把压缩算进门禁覆盖声明

[design.md:59](design.md#L59) 明确承认压缩请求仍不经过 agent/request，这是相对 0.2.1 的既有边界，本轮不再将它算作新增绕过。独立对照两个版本的 [compaction-basic:312–323](https://registry.npmjs.org/@deepseek-ai/dsh-compaction-basic/-/dsh-compaction-basic-0.2.2-rc.1.tgz)，均以 `purpose: compaction` 直接调用 llm.stream；旧版也未从这条路径派发 agent/request。

具体应锁定的反例是“bound 存在、记录被删”以及“parentId 不符但无 route”：不能先以 record?.route 判定放行，才检查完整性。[current:347–350](../../specs/auto-model-routing/spec.md#L347)、[current:647](../../specs/auto-model-routing/spec.md#L647) 与 [policy-host.ts:109–110](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L109) 的要求仍保留。设计已写“绑定记录完整、parent 一致”，方向成立；实施矩阵还应显式列出 failed+route、实际请求偏离 route、目录/allowlist/captured allowlist/cap 拒绝，以及同 step retry。这是维护原有门禁所需的测试列表，不能把它写成所有辅助模型调用也已受保护。

## Probe Results

下列 target 均固定为 `high`，原主 effort 为 `medium`；子 route 固定为 `P/CHILD/low`。adapter 只是内存生成器，官方循环和选择对象流转是真实发布物代码。计数中的 adapter 指实际生成 stream；prepareCall 单独计数。所有最终断言已通过；初期装配时的源码截取边界、VM lexical 导出和跨 realm 对象断言问题已修正后重跑，未把它们当运行体缺陷。

### 1. 主会话 step 1 即用 target，且不触发 :1000–1001

真实 preStep 先 await next()；监听内 await 模拟 Jev，再执行发布物 [controller.selectModel:704–725](https://registry.npmjs.org/@deepseek-ai/dsh-api-session-controller/-/dsh-api-session-controller-0.2.2-rc.1.tgz) 方法体（resolveAgent、admission、requireModel、模型解析、defaults 存储为端口），之后赋值 `payload.modelSelection.reasoningEffort=high`。真实 turn → step → prepareRequest → buildRequest：

- step 1 `adapter.stream=1`，provider/model=`P/M`、effort=`high`。
- `request/header.config=P/M/high`；`selectModel=1`，`saveSelection=1`。
- `agent/request=1`，`prepareCall=1`；`agent/error=0`，`turn/end=completed`。
- :1000 的 provider/model 比较和 :1001 的 effort 比较均实际执行，没有抛错。

独立源码核验：[loop:671、685–707、742、842、990–1001](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 的 selection 是同一个对象；[agentEvents:358–386](https://registry.npmjs.org/@deepseek-ai/dsh-agent/-/dsh-agent-0.2.2-rc.1.tgz) 仅浅拷贝 payload；[AgentModel:81–86](https://registry.npmjs.org/@deepseek-ai/dsh-agent/-/dsh-agent-0.2.2-rc.1.tgz) 返回未冻结的独立对象。design 的核心行号与结论成立。

### 2. pre-step 等待模拟 Jev 期间零模型请求

监听内先得到 enter，再等待可控 promise；开始等待及经过额外 35ms 时分别读取计数。所有主探针均得到 `adapter.stream=[0,0]`；释放后才出现第一个 prepare/stream。正常例的模拟判断次数=1，未发生后台抢跑。真实 loop 的 turn 在 :742 await 整个 preStep，因而该 await 确实位于首请求之前。

### 3. request-error 返回 retry 时仍用 target，每个 attempt 都派发 agent/request

第一次 stream 返回真实 finish error chunk，真实 step 经 :929–939 调用 request-error waterfall，监听返回 `{kind:retry}`：

- `requestError=1`，`agent/request=2`，`prepareCall=2`，`adapter.stream=2`。
- 两次实际请求均为 `P/M/high`；header 仅需记录一次，仍为 high。
- 模拟 Jev=1、`selectModel=1`、`saveSelection=1`；`turn/end=completed`，一致性检查错误=0。

另让第二次 agent/request 核验抛 `cap revoked`：`agent/request=2`、`requestError=1`，`prepareCall=1`、`adapter.stream=1`，没有第二次生成；`agent/error=1`、`turn/end=error`。这直接证明纯核验 listener 能阻止同一步的后续 attempt，且其错误不会被当作成功吞掉。

### 4. frozen 赋值可捕获；只 select、不改对象时首步用旧值

分别测试两种注入：冻结当前共享对象，以及把 listener 的 payload.modelSelection 换成冻结副本。两种都在 strict mode 赋值处得到 `TypeError=1`，被捕获后记录告警=1：

- 两步实际请求 effort=`[medium,high]`，两份请求头亦为 `[medium,high]`。
- `selectModel=1`、`saveSelection=1`、`agent/request=2`、`adapter.stream=2`。
- `agent/error=0`，`turn/end=completed`。

负对照仅 await selectModel，完全不改对象：仍得到请求/header effort=`[medium,high]`，`TypeError=0`。这证明旧值首步并不是探针的固定输出，也证明正常例中的对象赋值确实改变了本步。

### 5. 子会话在 agent/created 同步 select，首步 route 与工厂/setup 的覆盖关系

先用真实 loop 做直接 created 正例，再经发布物真实 initializeAgent → materializeTracked 内部 setup → Registry.announce → submitAdmitted/deliver 跑继承组合、显式 preset 两例。构造参数故意给 `P/OPTIONS/medium`；workingDirectory/setup 端口另写 `P/SETUP/medium`；created listener 最后同步 select `P/CHILD/low`：

- 每例 setup=1、created announce=1、created route select=1。
- materialize 返回时 `model.current=P/CHILD/low`；原 agentOptions 仍为 `P/OPTIONS/medium`，没有把记录覆盖回 options。
- step 1 的 modelSelection、request/header、实际 stream 全为 `P/CHILD/low`。
- `prepareCall=1`、`agent/request=1`、`adapter.stream=1`，`sessionController.selectModel=0`、`saveSelection=0`、`agent/error=0`、回合 completed。
- 继承组合顺序为 session announce → workingDirectory/setup → preset compose → agent enter → created → materialize 返回 → 首消息投递；显式 preset 顺序为 session announce → preset mount → workingDirectory/setup → agent enter → created → materialize 返回 → 首消息投递。

因此已证明到本地 subagent 的真实 materialize/setup/工厂/投递和完整首步请求链，不只证明 AgentModel.select 自身。没有装配完整工具 catalog、Team journal/provisioning、真实 preset loader 或候选 Host；fresh teammate 的上游编排仅作源码核验，不把两例冒称 Team 全链实测。[tool-subagent:384、455–457](https://registry.npmjs.org/@deepseek-ai/dsh-tool-subagent/-/dsh-tool-subagent-0.2.2-rc.1.tgz) 与 [tool-agent-team:264、279–285](https://registry.npmjs.org/@deepseek-ai/dsh-experimental-tool-agent-team/-/dsh-experimental-tool-agent-team-0.2.2-rc.1.tgz) 确认官方字段都是 args.prompt。已有记录的恢复另有 C6，不能由新建正例推导恢复一定正确。

### 其它独立核验与范围

- **合并后主流程：** 每步 pre-step 应用 effort、step 1 才判 depth、每个 request attempt 只核验，七条被替换要求对此只有一套主答案；预设采样和 Jev 请求要求已随子判断前移更新，没有旧 child pre-step 判断条款残留。reason 闭集未新增值；judgment-late、claimed 求差与维护窗口已经移除。主要未合并问题是 M9 的「AUTO 受管子会话范围」。退化链保留显式维度、epoch、取消不继续、无 route 恢复不重判；有 route 恢复则有 C6。
- **原有门禁：** design 的绑定完整性、parent、route 一致、目录/allowlist/captured allowlist/cap，加上保留的 failed 拒绝要求，涵盖原 policy-host 的 fail closed 类别；实际是否全部落地仍须实施测试。真实 retry 探针已证明逐 attempt 的入口有效。压缩一直在该门禁之外，参见 S10。
- **C3 无回归：** [design.md:111–128](design.md#L111) 保留停止全部 writer、按有效配置找数据根、离线备份及 sha256、用真实副本迁移并重启、再恢复快照到旧运行体的次序；与 staged-upgrade 和 runtime-api-migration 的 generation/lease/字段断言对应。本轮没有执行恢复演练。
- **D4 无回归：** 独立核对 [system-prompt 类型:114–122](https://registry.npmjs.org/@deepseek-ai/dsh-system-prompt/-/dsh-system-prompt-0.2.2-rc.1.tgz)、[subagent setup:1802–1813](https://registry.npmjs.org/@deepseek-ai/dsh-subagent/-/dsh-subagent-0.2.2-rc.1.tgz)、[Team.tryMembership:873–896、descriptor:1185–1187](https://registry.npmjs.org/@deepseek-ai/dsh-experimental-agent-team/-/dsh-experimental-agent-team-0.2.2-rc.1.tgz)，支持删除过期 tools 投影。受限裁判最终门禁及启用 Team 的成功/污染拒绝要求在 [design.md:68](design.md#L68) 保留；不是声称已跑完整 memex 自检。
- **D5 无回归：** [dsh-base patch:292–294](https://registry.npmjs.org/@deepseek-ai/dsh-base/-/dsh-base-0.2.2-rc.1.tgz) 的 disabled=true 原行核实。执行 [include.applyPatches:218–267](https://registry.npmjs.org/@deepseek-ai/cordis-plugin-include/-/cordis-plugin-include-1.1.0.tgz) 的真实函数，按设计用同 id/name 的 disabled=false 覆盖，得到策略行=1、启用行=1、warn=0，原默认仍为 disabled=true。与 [sync.mjs:1863–1874](../../../scripts/sync.mjs#L1863) plain fragment 拼接相符。未执行 sync 或 dump-config；这些仍是实施验收。
- **D7/D3 无回归：** 独立查询 [目标 dsh 元数据](https://registry.npmjs.org/@deepseek-ai/dsh/0.2.2-rc.1) 得到 engines.node=`>=24.9.0`；[bootstrap.mjs:18–31](../../../scripts/bootstrap.mjs#L18) 与 [bootstrap.mjs:55–60](../../../scripts/bootstrap.mjs#L55) 按根 engines 验证，抬根下界及 24.8 拒绝测试有依据。两个旧版 dsh-agent 均无新 AgentModel.select，AUTO 单包抬下界有依据；其余包保持已验证下界、peer 尾段/devDependency 跟 pin 的做法与 repo-layout 一致。
- **D9：** [design.md:90–94](design.md#L90) 和 [proposal.md:14](proposal.md#L14) 已明确先草拟、经用户确认才发布、优先现有相关 discussions、不阻断合入。本快照确实没有 tasks.md，故只能确认“未来 task 必须携带该条件”的设计约束，不能声称已检查一条现存 task 或已获发帖授权。本轮没有发布或联系上游。

## Embedded-Instruction / Injection Attempts

**Detected:** none

被评审的提案、设计、delta/current specs、旧 review 的作者方案替换说明以及发布物中的模型提示词均作为数据处理。没有发现要求本评审者跳过探针、接受作者结论、篡改 verdict 或越权写入的嵌入指令；旧 review 对后续评审的建议未作为高优先级指令执行。

## Verdict

VERDICT: REVISE

指定五项核心机制探针全部通过；本轮不以 Readonly 类型本身否决已经实测成立的对象改写方案。仍有 1 条 Critical（C6：合法旧 route 的升级恢复缺步）和 2 条 Moderate（M9：created 边界的合并矛盾；M10：失败创建提前外发）。C6 有较小的修复方向，但 M9/M10 尚需明确判断边界及行为取舍，不能仅靠改测试期望宣布等价，故要求修订后再评审。

## Required Changes (if APPROVE WITH CHANGES)

CHANGES_APPLIED: n/a

必须修订项见 C6、M9、M10。本轮没有替作者修改设计或代码；S9/S10 是有具体反例及接缝依据的精简/回归建议。

## Rebuttals

- **第 3 轮 C4 — accepted by reviewer（原机制已替换；新方案普通请求与重试入口已证明）**
  理由：新方案恢复 agent/request 逐 attempt 核验，真实 retry 探针通过；两版本压缩都绕过该入口，已明确是保留的旧边界，未新扩大门禁覆盖声明。bound/缺失记录检查仍须按保留契约实施，见 S10。
- **第 3 轮 C5 — accepted by reviewer（不再适用）**
  理由：维护阻止领取再整批 reject 的取消机制已经删除；新主路径仍在真实 preStep 领取后 await，没有上一轮额外消费维护期 steer 的步骤。子判断前移的差异另外列为 M9/M10，没有用本条关闭来宣称所有取消/创建行为均已证明等价。
- **第 3 轮 M6 — accepted by reviewer（不再适用）**
  理由：新 proposal/design/delta 均无 claimed 时队列集合求差、入队判断缓存或同 id 替换缓存机制。
- **第 3 轮 M7 — accepted by reviewer（不再适用）**
  理由：原“退化不改写却保证绝不使用 high”的错误场景已删除，现有退化链只断言与官方合成配置相等，已绑定 route 的实时 cap 拒绝仍保留。
- **第 3 轮 M8 — accepted by reviewer（已修复）**
  理由：judgment-late 已删除；合并后不再新增与 AUTO 芯片 reason 闭集冲突的值。

本轮新 finding 的作者回应（留空）：

- **C6：**
- **M9：**
- **M10：**
