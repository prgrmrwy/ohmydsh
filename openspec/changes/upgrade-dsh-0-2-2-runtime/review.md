## Review Metadata

- **Review round**: 5
- **Prior round**: round 4 — VERDICT: REVISE（1 Critical：旧子会话恢复缺 route；2 Moderate：受管范围未替换、参数非法时先外发 Jev）；核心主会话探针通过
- **Reviewer context**: cross-model (Magpie Codex gpt-6.1-sol, fresh context)
- **Tool restrictions**: read-only inspection; only write is review.md (+ own temp unpack)
- **Artifacts reviewed**: [proposal.md](proposal.md), [design.md](design.md), [specs/](specs/auto-model-routing/spec.md), relevant source files

独立确认评审快照为 `7733fd722cc09892d66931c66841e92a7bf2294a`，初始工作树干净。本轮按 requirement 名称，将七条 MODIFIED 整条替换进 current auto-model-routing，再加入一条 ADDED；没有把尚未实施的源码迁移视为缺陷。第 4 轮作者 rebuttal 只作为待验证的主张。

通过 npm registry HTTPS tarball 独立取得 `0.2.2-rc.1` 的 dsh-agent-loop、dsh-agent、dsh-api-session-controller、dsh-subagent、dsh-tool-subagent、dsh-experimental-tool-agent-team、dsh-llm，并补读 dsh-base、dsh-system-prompt、dsh-experimental-agent-team、dsh-agent-default-model、dsh-compaction-basic；另取两个旧版 dsh-agent、`cordis-plugin-include@1.1.0` 及 registry 元数据。下文发布物行号均来自本轮实际读取，未沿用作者声称的核验结果。

在 Node v24.12.0 中，以 VM 装配发布物真实类及方法体，执行了 AgentLoop.initializeAgent、SubagentManager.materializeTracked/setup、applyChildComposition、AgentRegistry.enter/announce、submitAdmitted/deliver，以及 ReactLoopAgent 的完整首步请求链、AgentModel/投影、Inbox/投影、agentEvents 和流累积器。官方 subagent 工具 execute、requestedAgentOptions、允许列表及 preflight helper、官方 selectModel 方法体亦实际执行。持久化、Cordis 装配、工具/提示词、目录/模型 adapter 是测试端口；模型调用与 Jev 均为本地桩，没有付费调用。AUTO 的拟迁移 listener 按设计在探针内实现，**不冒称已经运行了尚不存在的迁移实现**；PolicyStore 则由磁盘真实源码在内存转译，用真实 zod/fs 在我方临时目录写读。

探针及详细结果位于评审者临时目录 `/tmp/dsh-r5-review-7733fd72/`。没有运行 build、sync、install，没有操作日常 Host，没有发帖或联系上游；仓库唯一写入是整体替换本报告。

## Findings

### 🔴 Critical (blocking)

#### C7：created 等待期间取消创建，会保留 AUTO 的持久绑定；本轮要求的“无残留记录”未成立

- **证据：** [design.md:57–59](design.md#L57) 和 [delta auto spec:116](specs/auto-model-routing/spec.md#L116) 规定先在 created 按现行受管范围绑定，再 await Jev；保留的 [current auto spec:641](../../specs/auto-model-routing/spec.md#L641) 在该边界建立初始记录。[delta:147](specs/auto-model-routing/spec.md#L147) 又把 Jev 取消列入持久写入 `unsupported` 的退化分支，没有区分“子会话已运行后的回合取消”与“created 尚未返回、创建本身取消”。现行 [PolicyStore.create:58–61](../../../packages/dsh-auto-model-routing/src/policy-store.ts#L58) 先写决策文件、再写 `.bound`；[policy-host.ts:112](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L112) 的 disposed handler 只清内存，没有回滚独立存储。
- **具体反例：** AUTO 根会话发起 fresh 子会话 C，created 中已经创建 recommended 记录及 `.bound`，随后在模拟 Jev 的 await 中收到创建 signal 中止。listener 不 select，按退化链记 `unsupported/jev-cancelled` 后返回；真实工厂拒绝创建、撤销 live 注册，SubagentManager 没有发布 activation。但独立 AUTO 记录仍在，`wasBound(C) = true`。这与本轮指定的取消探针“无残留记录”不符；根状态还可能出现“按 DSH 默认运行”的未路由告警，而该创建根本没有投递首消息。
- **独立运行结果：** 真实 initializeAgent → setup → announce 链中，取消后 `select=0`、`claimed=0`、`agent/request=0`、`prepareCall=0`、`adapter.stream=0`、`saveSelection=0`、未处理 rejection=0、live child=0、resident activation=0；真实 PolicyStore 中却仍有一份 `.json` 和一份 `.json.bound`，记录为 `unsupported`、reason 为 `jev-cancelled`。本轮把该检查记为**部分通过，持久绑定清退失败**，没有用活跃注册表清零替代持久记录清零。
- **责任边界：** [目标 loop:1448–1450、1475–1507、1586–1596](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 明确保留失败初始化已写的 Session，只关闭 handle 并 detach live Agent/Session；它没有访问 AUTO 独立决策目录的能力。官方保留 Session 是既有恢复语义，**不列为本 change 的缺陷，也不要求删除官方 Session**。失败是设计没有为新前移的等待阶段规定 AUTO 新绑定的发布/撤销边界。
- **最小修订：** 区分 startup 创建取消与已发布 child 的后续回合取消。created 等待 Jev/目录时只保留带精确 child 身份、父快照和 epoch 的内存候选；signal 已取消时不 select、不发布本次新 AUTO 决策或绑定、不发布“默认运行”的告警，向工厂正常传播创建取消。若选择先持久绑定，则必须明确仅回滚本次新建、尚未发布的 AUTO 文件/标记，不能删除或洗白已有绑定、恢复记录或官方 Session。补机械场景：挂起 Jev → abort → 释放成功/取消结果，两种结果均无新持久 AUTO 绑定；重复恢复/已有记录不被清除。将此例外写入退化链，避免仍要求对同一取消写 `unsupported`。本条只针对本轮要求的创建等待取消，不扩大成任意创建失败的持久存储清理框架。

### 🟡 Moderate

未发现新的独立 Moderate 阻断项。第 4 轮 M9、M10 经独立核验关闭，见 Rebuttals。取消持久绑定问题统一列为 C7，不重复计数。

### 📌 Suggestions

#### S11：恢复条款把 failed 的限定写完整，避免实施时误拒绝合法旧无 route 记录

[delta:116](specs/auto-model-routing/spec.md#L116) 的末句写“failed 时仍按现有规则 fail closed”，而 [delta:155、197–200](specs/auto-model-routing/spec.md#L155) 明确保留旧 `failed` **无 route** 时原样放行。具体样本是旧 `{status: failed, reason: 初始判断已取消}`：不得仅因 status 就在 resume 入口拒绝。本轮按“现有规则”将其解释为 **failed 且有 route 才拒绝**，因此不另立冲突 finding；建议直接写出限定，并在实施测试保留无 route 的旧 failed 正例。

#### S10 复核：请求门禁矩阵的设计已处理，仍须在实施时完整落成测试

[design.md:61](design.md#L61) 已明确完整性、parent、route 一致、目录/allowlist/captured allowlist/cap，以及每次 attempt 的核验；[delta:212–225](specs/auto-model-routing/spec.md#L212) 保留实时撤销和同 step retry。具体反例“bound 存在但文件缺失”“parent 不符但没有 route”要求先校验完整性和身份，再判断 route 是否存在；不能把 `if (!record?.route) return config` 当成整个恢复门禁。必须同时保留 [current:347–350、704–707](../../specs/auto-model-routing/spec.md#L347) 的断言。源码的旧执行顺序尚未迁移，不在提案评审中算实现缺陷；本快照也没有 tasks，不能声称矩阵已经执行完毕。压缩请求仍在门禁之外，设计未夸大覆盖范围。

## Probe Results

### 1. 子会话 startup：延迟 Jev 后 select 的完整请求链通过

两例分别使用继承组合和显式 preset；构造参数故意为 `P/OPTIONS/medium`，working-directory/setup 端口另写 `P/SETUP/medium`。真实 SubagentManager 的 setup 完成后，真实 Registry.announce 串行调用 AUTO listener；listener await 可控 promise，等待开始及另过 30ms 两次断言 `stream=0`、`claimed=0`，随后同步 `agent.model.select(P/CHILD/low)`。

| 检查 | 继承组合 | 显式 preset |
| --- | --- | --- |
| 等待期间模型请求/首消息领取 | 0 / 0 | 0 / 0 |
| setup / created route select | 1 / 1 | 1 / 1 |
| materialize 返回后的 current | P/CHILD/low | P/CHILD/low |
| step 1 modelSelection/header/stream | 均 P/CHILD/low | 均 P/CHILD/low |
| agent/request / prepareCall / stream | 1 / 1 / 1 | 1 / 1 / 1 |
| saveSelection / agent error | 0 / 0 | 0 / 0 |
| turn/end | completed | completed |

继承组合顺序：session announce → working-directory/setup → compose → agent enter/created → materialize 返回 → submitAdmitted/deliver。显式 preset 顺序：session announce → preset mount → working-directory/setup → agent enter/created → materialize 返回 → submitAdmitted/deliver。options/setup 不会在 created 之后覆盖 route。

独立行号：[factory:1574–1580](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz)、[Registry:703–718](https://registry.npmjs.org/@deepseek-ai/dsh-agent/-/dsh-agent-0.2.2-rc.1.tgz)、[SubagentManager:1802–1830、2232–2246](https://registry.npmjs.org/@deepseek-ai/dsh-subagent/-/dsh-subagent-0.2.2-rc.1.tgz)。design 的核心发布物引用成立；准确的工厂 await announce 位于 `:1579`。

### 2. startup 创建等待取消：运行期清退通过，持久 AUTO 绑定未清退

在上面同一真实链中，created 先用真实 PolicyStore 建立初始记录，再挂起模拟 Jev。调用方 abort 后，listener 观察同一 signal、不执行 route select；工厂以 `cancel-create` 拒绝，错误由调用端 await/catch 处理。

- 首消息领取、请求、prepareCall、stream、AUTO route select、saveSelection 均为 0；没有未处理异常。
- live registry 查不到 child，manager resident 为 0；没有留下可运行的 activation。
- PolicyStore 中 `.json` 与 `.json.bound` 仍各一份，`wasBound=true`，内容为 `unsupported/jev-cancelled`。
- 官方 Session 已写的 descriptor/setup 事件保留，符合工厂自身保留已写事件的恢复语义；不能宣称全部持久记录清零。

因此本轮指定的“无残留记录”没有完全通过，列 C7。这里证明的是**设计所规定的先绑定再等待、取消走退化链**的后果，不是声称未来实现已经合入。

### 3. C6 resume：无原生选择/header 的合法旧 route 恢复通过

从真实 PolicyStore 读出 `recommended + route=P/CHILD/low`，恢复的 Session 中没有 `model/selection` 或 `request/header`；真实 AgentModel 在 listener 开始时返回 `P/M/medium`。经真实 manager resume 分支 → initializeAgent(source=resume) → Registry.announce，listener 同步恢复既有 route，再经真实 submitAdmitted/deliver 执行首请求：

- `beforeRestore=P/M/medium`；恢复 select=1。
- step 1 的 current/modelSelection/header/adapter 均为 `P/CHILD/low`。
- `Jev=0`、`saveSelection=0`、模型请求=1，回合正常完成。
- 正例没有重新写 AUTO 决策文件；恢复补写的是官方模型选择。

负样本使用真实存储读取，并在 resume listener 执行拟议完整性/身份检查：绑定标记存在而文件缺失、损坏 JSON、parent 不符、failed+route 四类均在模型请求前拒绝；每例 `Jev=0`、`select=0`、`prepareCall=0`、`stream=0`，live child/activation 无残留。损坏 JSON 的“子任务决策无法恢复”错误来自真实 PolicyStore，身份与 failed 的拒绝来自按设计实现的核验器。此证明了新接缝可承载这些门禁，尚不能代替迁移代码落地后的集成测试。

另用真实 PolicyStore 读取含 `version:1`、`policyVersion`、`mappingVersion` 的旧 recommended+route，得到原 route 且丢弃三个历史键；多 `task` 键及 `version:2` 均拒绝。没有扩张旧记录的容忍范围。

### 4. M10：官方准入在 created 前执行，三类拒绝均 Jev=0

实际执行发布物官方 subagent execute 方法体及其真实 helpers，将 startActivation 端口接到上面的真实 materialize/setup/announce 链。结果：

| 调用 | 官方 preflight 次数 | child created | Jev |
| --- | --- | --- | --- |
| 只传 model、不传 provider | 0 | 0 | 0 |
| provider/model 不在允许列表 | 0 | 0 | 0 |
| 允许列表通过、resolveCallConfig 拒绝 | 1 | 0 | 0 |
| 全部通过的正对照 | 1 | 1 | 1 |

第一类错误确为 `child LLM provider and model must be supplied together`，第二类为 route 不被本 Session 允许，第三类保留 preflight 的拒绝。失败时没有到达 child factory，也没有绑定窗口中的 child 记录。证据：[tool-subagent:60–95、115–126、431–472](https://registry.npmjs.org/@deepseek-ai/dsh-tool-subagent/-/dsh-tool-subagent-0.2.2-rc.1.tgz)。无需复制官方 admission 逻辑。

### 5. 主会话机制无回归

第 4 轮以来 D1 未改变。本轮仍实际跑了真实 turn → preStep → step → prepareRequest → buildRequest，并在 listener 内执行官方 controller.selectModel 方法体（模型解析、admission/default 存储为端口），再改写共享 modelSelection：

- **step 1 即用目标：** header/stream=P/M/high；selectModel=1、saveSelection=1、Jev=1，回合 completed，未触发 `:1000–1001` 一致性错误。
- **等待隔离：** await 模拟 Jev 开始及另过 30ms 时，模型请求均为 0。
- **同 step retry：** 首个 adapter 返回真实 finish-error chunk，request-error 返回 retry；`agent/request=2`、prepare=2、stream=2，两次均 high，Jev/select/save 各 1。
- **重试前门禁拒绝：** 第二次 agent/request 抛 `cap revoked`；request=2，但 prepare/stream 均为 1，第二次模型调用为 0，回合 error 符合预期。
- **冻结回退与负对照：** 冻结共享对象后赋值 TypeError 被捕获一次，两步 header/stream 为 medium→high；只 select、不改共享对象时也为 medium→high。两例均 completed，证明正常例的 step 1 high 来自对象改写，而非全局默认副作用。

独立核对 [loop:671、685–707、742、842、990–1001](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz)、[agentEvents:358–386 与 AgentModel:181–203](https://registry.npmjs.org/@deepseek-ai/dsh-agent/-/dsh-agent-0.2.2-rc.1.tgz)、[model-selection:81–96](https://registry.npmjs.org/@deepseek-ai/dsh-agent/-/dsh-agent-0.2.2-rc.1.tgz)、[controller:704–728](https://registry.npmjs.org/@deepseek-ai/dsh-api-session-controller/-/dsh-api-session-controller-0.2.2-rc.1.tgz)，支持 design 对共享可写 selection、浅拷贝 dispatch 和 select/default 保存的解释。Readonly 仍是兼容依赖，不因类型本身否决实测机制。

### 6. 合并后的规范、版本分线及其它回归

- **受管范围与判断边界：** 保留的 [current:639–707](../../specs/auto-model-routing/spec.md#L639) 与新 [delta:83、116、143–155、307](specs/auto-model-routing/spec.md#L83) 现在一致：官方工具 ALS + startup + 同父；created 时采样父配置/判根模式；此后捕获 epoch，在 Jev/目录异步返回后及保存前检查；resume 不重新判断。created 前切 MANUAL 是不绑定、Jev=0；created 内等待中模式变化则 mode-changed。二者有不同时间条件，不再相互矛盾。取消的持久发布边界另见 C7。
- **输入与已接受限制：** 正式子判断统一使用 ALS 中的 `args.prompt`，各次独立捕获 preset，不使用预览结果；运行体注入不贡献输入。新 delta 已明确同窗口同父插件旁支无法区分，旁支会沿用外层 prompt。这是写明的绑定限制，不再要求同时保证旁支按自身首消息判断；不能对用户宣称能区分旁支。
- **显式维度、退化与恢复：** 完全显式零 Jev，只显式一个维度只判断另一个；P 不变，显式 effort 不走父 effort 回退，候选均查目录/官方允许列表/captured allowlist/cap。有 route 的每次 attempt 核验、恢复不重判及旧记录严格读取保持；无 route 的历史状态和 interrupted 分支也保留。没有重新引入 judgment-late、维护窗口、claimed 集合求差或自主重试升级。
- **teammate 范围：** [官方 Team 工具:264–289](https://registry.npmjs.org/@deepseek-ai/dsh-experimental-tool-agent-team/-/dsh-experimental-tool-agent-team-0.2.2-rc.1.tgz) 的字段确为 prompt、fresh/fork 两分支，符合 ALS 的 fresh 入口；fork 原样放行。**没有完整装配 Team journal/provisioning、真实 preset loader、全工具 catalog 或候选 Host。** 本轮证明到了本地 subagent 工厂/setup/announcement/首消息/首请求，以及 Team 工具字段与调用路径的源码边界，未冒称真实 teammate 全链已通过。
- **D3 版本分线：** [design:66–67](design.md#L66) 的单路径、新 minor 及不复用 0.7.0，与 [repo-layout:517–534](../../specs/repo-layout/spec.md#L517) 一致。AUTO 新线应使用 `engines.dsh >=0.2.2-rc.1 <0.3.0-0`、每个 dsh peer 为该区间加 `|| ^0.2.2-rc.1`、devDependency 为 `^0.2.2-rc.1`；其它包下界由实测决定。独立 registry 确认 0.7.0 已发布，两个旧版 dsh-agent 均无 AgentModel.select。旧发布物的宽 engines 不会因 README 自动缩窄，分线说明须写清其在新 Host 上不可用；本 change 没有获得发版授权，也无需加入双路径。
- **C3 无回归：** [design:113–132](design.md#L113) 保留停止全部 writer、按有效配置找数据根、离线副本/sha256、真实历史迁移/重启、停止 writer 后恢复快照到旧 runtime 的次序，与 [staged-upgrade:113–122](../../specs/staged-upgrade-execution/spec.md#L113) 和 [runtime-api-migration:96–107](../../specs/runtime-api-migration/spec.md#L96) 一致。未执行生产备份或恢复演练。
- **D4 无回归：** 独立读取 [system-prompt 类型:114–122](https://registry.npmjs.org/@deepseek-ai/dsh-system-prompt/-/dsh-system-prompt-0.2.2-rc.1.tgz) 的 PromptPresentation/PromptAssembly 区别，以及 [subagent setup:1802–1813](https://registry.npmjs.org/@deepseek-ai/dsh-subagent/-/dsh-subagent-0.2.2-rc.1.tgz) 先写 descriptor、[Team.tryMembership:873–896、subagentDescriptor:1185–1187](https://registry.npmjs.org/@deepseek-ai/dsh-experimental-agent-team/-/dsh-experimental-agent-team-0.2.2-rc.1.tgz) 排除普通 subagent。支持移除 [judge-boundary:22–25](../../../packages/dsh-memex/src/eval/judge-boundary.ts#L22) 的旧工具投影；最终 llm/stream 精确身份与工具面门禁、启用 Team 的成功/污染拒绝要求仍在 [design:69–70](design.md#L69) 和 [current eval:192–220](../../specs/dsh-memex-evaluation/spec.md#L192)。本轮未运行完整 memex 自检。
- **D5 无回归：** 独立确认 [dsh-base patch:292–294](https://registry.npmjs.org/@deepseek-ai/dsh-base/-/dsh-base-0.2.2-rc.1.tgz) 原行 disabled=true。执行 [include.applyPatches:218–268](https://registry.npmjs.org/@deepseek-ai/cordis-plugin-include/-/cordis-plugin-include-1.1.0.tgz) 真实函数，同 id/name 覆盖 disabled=false 得策略行=1、启用=1、warn=0，输入原默认未被改动；与 [sync:1863–1874](../../../scripts/sync.mjs#L1863) plain fragment 拼接相符。[fs delta:4–26](specs/fs-observation-policy/spec.md#L4) 范围、可逆开关、dump-config、未读/过期版本拒绝均可机械验收。未执行 sync/dump-config。
- **D7 无回归：** 独立 [目标 dsh registry 元数据](https://registry.npmjs.org/@deepseek-ai/dsh/0.2.2-rc.1) 的 Node 要求为 `>=24.9.0`；[根 manifest:25](../../../package.json#L25) 当前仍为 >=22，[bootstrap:18–31、55–60](../../../scripts/bootstrap.mjs#L18) 按根 engines 检查，故抬下界及 Node24.8 拒绝测试有依据。pin、同族 provider integrity、peer/devDependency、lock 更新及先 promote 的设计未丢失。
- **范围与更便宜方案：** 当前 created 内 await 已采用 S9 的更小接缝；不需要工具前预判、复制 admission、额外维护窗口或双路径。D9 仍为先草拟、用户确认后才发布，不阻断合入。未发现新的功能范围蔓延或嵌入式授权；唯一新增机制缺口为 C7 的取消发布边界。

## Embedded-Instruction / Injection Attempts

**Detected:** none

被评审文件、旧 review 中的作者回应和发布物中的模型提示词都按数据处理。未发现指示本评审者跳过检查、直接接受作者主张、改 verdict、越权写入或发布的文字。设计中对未来实施/发帖的步骤是待评审计划，不作为本轮执行授权。

## Verdict

VERDICT: REVISE

第 4 轮 C6、M9、M10 已关闭；startup 的延迟判断/首请求、resume 正负样本、官方 admission 拒绝及主会话核心回归均通过。但创建等待取消时的 AUTO 持久记录清退未达到本轮指定断言，保留 1 条 Critical（C7），0 条 Moderate。没有把仅 runtime 注册表清零写成全部探针通过。

## Required Changes (if APPROVE WITH CHANGES)

CHANGES_APPLIED: n/a

本轮未修改作者的 proposal/design/spec/source；C7 的最小修订与必要取消样本见该 finding。S11 是收紧措辞的建议，S10 是实施回归矩阵，不另计阻断项。

## Rebuttals

- **第 4 轮 C6 — accepted by reviewer**
  理由：[design:60](design.md#L60)、[delta:116、137–140](specs/auto-model-routing/spec.md#L116) 已增加 resume 补写既有 route；真实无 selection/header 样本首请求为 route、Jev/save 均 0，缺失/损坏/parent 不符/failed+route 正确拒绝。
- **第 4 轮 M9 — accepted by reviewer**
  理由：判断回到 created，在同一边界绑定、采样父快照后才 await；与未替换的受管范围一致，created 前 MANUAL 不再提前外发；输入及同窗口旁支限制已明确。
- **第 4 轮 M10 — accepted by reviewer**
  理由：真实官方 execute 的配对校验、允许列表和 preflight 三类失败均先于 child factory/created，均 child=0、Jev=0，正对照确实能进入 created。
- **第 4 轮 S9 — 已处理**
  理由：已采用可等待的 created；真实继承/preset 两例及取消的 runtime 清退证明该接缝可用，没有嵌套 runMaintenance。
- **第 4 轮 S10 — 设计已处理，完整实施验收待执行**
  理由：逐 attempt 核验、压缩边界、完整性与实时许可矩阵已明确，本轮补了恢复负样本与 retry 拒绝；未实施代码不能冒称其全部回归测试已落地。

本轮新 finding 的作者回应（留空）：

- **C7：**
