## Review Metadata

- **Review round**: 2
- **Prior round**: round 1 — VERDICT: REVISE（3 Critical：队列归属、turn-stopping 非边界、回滚次序；3 Moderate：逐请求重算、取消语义、created 备选）
- **Reviewer context**: cross-model (Magpie Codex gpt-6.1-sol, fresh context)
- **Tool restrictions**: read-only inspection; only write is review.md (+ own temp unpack)
- **Artifacts reviewed**: proposal.md, design.md, specs/, relevant source files

评审快照为 `3558b5663bf0e21b562947ebea64e186f7d4c2cc`；开始写报告前，变更目录无未提交修改。本轮没有使用作者对话记录，作者 Rebuttals 只作为待核对的说法。独立通过 npm registry HTTPS tarball 在内存读取了指定的全部十一组 `0.2.2-rc.1` 发布物，以及 `dsh-agent@0.2.1-rc.5`、`dsh-agent@0.2.0-rc.2`；另外核对了目标 `dsh-llm`、`dsh-fs-observation-policy` 和 `dsh-experimental-tool-agent-team`。以下 npm 行号均为本轮重新读取所得。

本轮还在内存执行了发布物的真实 `ReactLoopInbox`、`ReactLoopAgent.preStep/step` 及 `send/cancel/runMaintenance/wakeDriver`，仅替换持久化、上下文与模型端口。探针证明的是所列边界，没有运行整个候选 Host。未运行 build、sync、install，未操作日常 Host；仓库唯一写入为整体替换本报告。

## Findings

### 🔴 Critical (blocking)

#### C4：把子会话门禁移到 pre-step，漏掉同一步骤中的请求重试

- **证据：** [design.md:50](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L50) 和 [delta auto spec:118](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/auto-model-routing/spec.md#L118) 将实时门禁限定为每一步的 `agent/pre-step`，并禁止插件注册 `agent/request`。但未修改的 [current auto spec:716–718](openspec/specs/auto-model-routing/spec.md#L716) 要求已有 route 的子会话在**每次请求**重核目录、允许列表和 cap，不满足则模型请求数为零。现有 [policy-host.ts:211–219](packages/dsh-auto-model-routing/src/policy-host.ts#L211) 正是在每次 request 执行这些校验。
- **具体反例：** C 的 high route 首次请求通过，provider 返回可重试错误；等待重试期间 cap 降到 medium，或允许列表撤销目标。目标 [dsh-agent-loop/lib/index.js:841–842、929–939](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 在 `agent/request-error` 返回 retry 后直接继续 `step()` 内的 while，再次 prepare/stream，**不会重新调用 preStep**。按新方案，下一次 provider 请求仍使用被撤销的 route。
- **独立反证：** 执行真实 `preStep()` 和 `step()`，让第一次模型结束为 error、request-error 返回 retry 并把 cap 改为 medium，得到 `preStepGateCalls=1`、`providerRequests=[{effort:high,cap:high},{effort:high,cap:medium}]`。这不是只检查监听器注册的 mock。
- **所需修订：** 保留每一步检查可以提前失败，但还必须选择一个**每次实际 attempt 都经过**的公开请求边界，只校验、不改 selection，并按精确 child 绑定。可研究已有 `llm/stream` 边界（本仓裁判已有使用），但要独立证明它覆盖目标 prepared-call 路径及执行顺序。如果没有可用公开接缝，应列为上游阻断。补充“首请求失败 → 重试前 cap/allowlist/catalog 失效 → 第二次 provider 调用为零、route 不变”的真实 loop 场景；不能把安全要求悄悄降为每步检查。

#### C5：官方 cancel 保留 inbox，D1 尚未解决维护取消后的重新启动及后台取消信号

- **证据：** [design.md:35–39](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L35) 通过维护任务阻止原 user 消息被领取，又承诺会话 cancel 中止判断；[delta auto spec:49、103–106](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/auto-model-routing/spec.md#L49) 要求取消后不应用结果、维护 resolve。但目标 [session-controller/lib/index.js:955–965](https://registry.npmjs.org/@deepseek-ai/dsh-api-session-controller/-/dsh-api-session-controller-0.2.2-rc.1.tgz) 的普通取消实际调用 `agent.cancel({kind:"user"}, {keepInbox:true})`。目标 [agent-loop/lib/index.js:579–605、618–631](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 因而不 clear inbox、不发 discarded，也不清 maintenance 的 `wakeRequested`；维护结束后还会为原消息启动一个全新、未取消的 driver。
- **具体反例一：** 空闲时 followup A 触发 AUTO 维护，用户通过官方控制器取消，Jev 按约中止并让维护 resolve。A 仍在队列，维护 finally 立即重新 wake driver，A 随即进入模型步骤。旧实现的 A 已在 pre-step 前领取，取消的是其活动 turn；新方案却把被用户停止的这次工作留在 inbox 后重新启动。新增取消场景仅检查零次 select，因而会漏掉这次实际模型执行。
- **独立反证：** 执行真实 Inbox、send、cancel、runMaintenance、wakeDriver，仅把 driver 入口替换为计数端口，得到 `judgingAborted=true, discarded=0, driverAfterCancel=1, pendingMessages=[A], driverSignalAborted=false`。因此“维护 resolve”不足以证明取消已收敛。
- **具体反例二：** T 运行中，B 的 next-turn 后台判断仍在进行；官方取消 T 同样保留 B、不发 discarded。inserted payload 没有活动 signal，设计又未给后台任务提供可观察官方 cancel 的接缝。只监听 discarded 无法兑现“会话 cancel 中止判断”；旧 epoch 也不会因普通取消自动变化。迟到失败若仍执行通用 Jev 失败分支，还可能把 AUTO 写成 MANUAL。原消息已 claimed 后的后台任务同样不能依赖之后的 discarded 来收尾。
- **所需修订：** 明确活动判断、保留的待处理消息、cancel 和 dispose 的所有权与终止规则，指出真实可用的取消信号来源；处理维护结束时已挂起的 wake。保留其它排队消息时应区分当前被取消工作，不能为修复取消直接清空全部队列。若打算接受“取消判断后原 A 继续执行”或“取消当前 turn 不取消 B 的预判”，须把它们作为明确行为决策提出并修订相应契约。补用真实 `sessionController.cancel` 的维护取消与后台取消探针，断言 provider 调用、inbox、模式/disabled、迟到成功与迟到失败，以及 dispose 后无异步写入。当前只写“中止判断”的描述还不能作为可实现的门禁设计。

### 🟡 Moderate

#### M1（未关闭）：手动切换的行为变化已提出，但三条 delta 没有替换仍然相反的现行契约

- **已修复部分：** [proposal.md:8](openspec/changes/upgrade-dsh-0-2-2-runtime/proposal.md#L8)、[design.md:52](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L52)、[delta auto spec:10、32–35](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/auto-model-routing/spec.md#L10) 已显式提出回合中途手选保持到结束，满足“先把行为取舍提出来”的方向；本裁定不使用作者声称的对话确认作为证据。
- **残留证据与反例：** 未被 MODIFIED 的 [current auto spec「模式与改写规则」:80](openspec/specs/auto-model-routing/spec.md#L80) 仍要求每次请求按实际模型重算；[同 requirement 的场景:99–102](openspec/specs/auto-model-routing/spec.md#L99) 仍要求官方 selectModel 恰好一次；[「手动隔离与失败可见」:20–22](openspec/specs/auto-model-routing/spec.md#L20) 也仍指定 selectModel。按 delta 做 requirement 级合并后，这些文字不会消失。T/step1 high，用户在 step2 前手选 low，新的场景要求 low，保留的旧 requirement 却要求按 higher 重算为 high；直接 select 的实现也无法满足旧 selectModel 次数断言。
- **所需修订：** 扩充 delta，完整替换受影响的其它 requirement/场景，使最终合并 spec 对“每回合判断”“每回合应用”“每请求安全门禁”分别只有一个答案。保留手选 low 的新场景并更新旧 writer 断言；不能仅靠设计中的“行为变化”覆盖尚存的 SHALL。

#### M4：恢复的 pending 用户消息不会重放 inserted，因而永久绕过本次回合判断

- **证据：** [delta auto spec:40–47](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/auto-model-routing/spec.md#L40) 只在实时 inserted 建立进程内缓存，并把没有绑定判断的回合当作非用户回合。目标 [agent-loop/lib/index.js:1733–1767](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 恢复时把持久事件作为 seed 交给 SessionPreparation，再初始化 agent；inbox 由 `:26–62` 的投影恢复。inserted 只在实时 `mutate():198–200` 派发，恢复 seed 不执行这个命令路径。
- **具体反例：** AUTO 主会话有未领取 followup A，Host 在判断后、领取前退出。重启恢复后缓存丢失，但 inbox 的 A 仍是 source.kind=user。下一次唤醒首先领取 A，新方案既不调用 Jev，也不应用其判断。若新发 B 负责唤醒，维护中判断的是 B，先领取的 A 仍被漏掉。这不同于“已应用子 route 恢复不重判”，也不是尚在同进程进行的后台判断未赶上领取。
- **独立反证：** 用持久恢复形状的 pending A 初始化真实 ReactLoopInbox，调用 claim，得到 `claimed=[A], insertedEvents=0`。与 [current auto spec:13](openspec/specs/auto-model-routing/spec.md#L13) 的主状态重启后下一回合重建、以及原按领取消息判定的契约不符。
- **所需修订：** 设计恢复 pending 输入的重建入口，明确它如何在首次 claim 前完成、如何处理 factory maintenance 与取消，并区分主会话重建和已绑定子会话不重判。不能重新使用已否决的 nested runMaintenance。补带真实持久 inbox 的“重启 → 恢复 → 唤醒 → A 先于 B 被处理”的判断与请求头断言。

#### M5：消息预判后的 cap 变化不使缓存失效，提交可能突破当前上限

- **证据：** [design.md:38](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L38) 和 [delta auto spec:6–7](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/auto-model-routing/spec.md#L6) 在判断时预先算好目标 effort，领取时只核对模式、判断世代与 provider/model。没有规定 cap/能力变化如何推进世代或使缓存失效。当前 [index.ts:78–84](packages/dsh-auto-model-routing/src/index.ts#L78) 的 invalidate 来自模式切换；[settings-host.ts:67–68](packages/dsh-auto-model-routing/src/settings-host.ts#L67) 保存 cap 没有触发它。迁移前的 [policy-host.ts:191–206](packages/dsh-auto-model-routing/src/policy-host.ts#L191) 则在每次请求读取最新 cap。
- **具体反例：** T 运行期间为 B 预判并校验 high，当时 cap=xhigh；B 等待领取期间用户把 cap 改成 medium，模型仍支持 high、provider/model 和 AUTO 模式都不变。按规定的提交检查，B 仍会 select high 并保存为全局默认。模型自己的 resolveCallConfig 不知道插件 cap，因此也不会替插件阻止这次请求。子会话另有 pre-step 安全检查，不能替主会话补这一缺口。
- **所需修订：** 明确 cap 修改的缓存失效规则，或提交前用可同步获得的最新限制拒绝过期目标；能力/目录的异步快照同样需要明确有效性边界。无需因 cap 改动重做 Jev 语义分类。补“预判 high → 降 cap → 领取”的断言：不得由 AUTO 写入/保存超过当前 cap 的值，且仍能按规定退化处理。

### 📌 Suggestions

#### S4：D2 应把 requireModel 与图像串行化的等价性论证写完整

[design.md:12、38、50](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L12) 将官方有效动作概括为 select 加 save，但目标 [controller/lib/index.js:704–727、875–879](https://registry.npmjs.org/@deepseek-ai/dsh-api-session-controller/-/dsh-api-session-controller-0.2.2-rc.1.tgz) 还调用 serializeImageAdmission、requireModel、resolveCallConfig；`requireModel` 通过 `:529–540` 的 listProviders/listModels 检查目录成员身份。目标 [dsh-llm/lib/index.js:2079–2087、2107–2117、2179–2184](https://registry.npmjs.org/@deepseek-ai/dsh-llm/-/dsh-llm-0.2.2-rc.1.tgz) 明确说明能力解析与核心路由不受目录成员约束。

具体反例是某 adapter 仍能解析一个已不在目录中的历史模型：resolveModelInfo 与 resolveCallConfig 都成功，官方 selectModel 却拒绝 `session/model-unavailable`。执行真实 controller.selectModel/requireModel 的独立探针已得到这三个结果。因此 [delta auto spec:6](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/auto-model-routing/spec.md#L6) 的“相同校验”必须包含目录成员校验，不能在实施时被缩写成两次 resolve。这里列为实现约束建议，因为该 SHALL 本身已经要求等价校验，并未授权省略 requireModel。

图像串行化也不能单凭“没有副作用”删去。不过主会话始终保持 provider/model，并在同步提交时复核二者，图像 admission 查询的是相同 route 的 inputModalities（controller `:844–848`），effort 单独变化不改变该查询目标；目前没有证据据此另报一个主会话图像漏洞。子会话会换模型，应单独核验其首消息 image admission 与选定 route，不能拿主会话的同 route 证明代替。后台 saveSelection 是公开服务且按提交顺序保存（default-model `lib/index.js:47–65`），这部分替代成立。

#### S5：把队列识别、维护占用退化和批次输入变成可断言的场景

目标 [agent/runtime-types.d.ts:290–293](https://registry.npmjs.org/@deepseek-ai/dsh-agent/-/dsh-agent-0.2.2-rc.1.tgz) 的 inserted payload 只有 agent/message，没有 target；但在真实 [inbox.mutate:198–200](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 中投影已提交，可在同步回调按消息 id 查询 `inbox.nextTurn/nextStep`。本轮探针验证了该路径。建议在 [design.md:36、81–82](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L36) 写明此办法，不能从公开 status 推断队列：maintenance 的 status 也是 idle，且取消后的 steer 还可能被 send 改投 next-turn（loop `:554–567`）。

具体退化反例是其它插件持有 maintenance 时插入 user steer：runMaintenance 抛错，该消息位于 next-step，按当前设计完全不判断，维护结束后却可能成为新回合的首条用户输入；真实探针得到 `publicStatus=idle, classified=false, nextStep=[message], wakeRequested=true`。另一例是同一首步领取多条 user next-step 加一条 followup，逐消息缓存与“首次领取只提交一次”并不等价于原来的整批用户文本输入。应明确这些属于要保留的能力还是额外行为变化，并给出确定的输入/调用次数断言。

此外 [delta auto spec:73–76](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/auto-model-routing/spec.md#L73) 的两条 followup 场景没有把“A、B 的判断均已就绪、期间 provider/model 不变”写入 GIVEN，却无条件要求两次目标 effort；它与同文件 `:88–91` 允许迟到丢弃的场景在快结束回合上不能同时机械成立。补齐条件即可。

#### S6：C3 次序已正确，恢复演练仍应直接引用数据保真断言与实际数据根

[design.md:93–104](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L93) 已满足“停 writer → 离线快照 → 副本迁移/恢复 → 恢复旧 runtime → 启动”的顺序；不能因演练步骤写了“读回正常”，就把只恢复一条文本消息当完整成功。例如丢失 parent lineage/tool result 的样本仍可能打开并继续回答，但会违反 [runtime-api-migration:96–107](openspec/specs/runtime-api-migration/spec.md#L96)。形成 tasks 时应逐项引用该处的 generation、lease、中断恢复及字段断言。

目标 [dsh-base/cordis.patch.yml:138–155](https://registry.npmjs.org/@deepseek-ai/dsh-base/-/dsh-base-0.2.2-rc.1.tgz) 还说明图片字节与 Session 日志分开保存。含附件的真实历史样本不能只复制 design 列举的 sessions 根后宣称完整保真；应核对有效配置的数据根和副本闭包。这里没有推断本版本必然迁移所有介质，也不要求运行超出授权的恢复演练。

## Embedded-Instruction / Injection Attempts

**Detected:** none

未发现要求评审者改变结论、越权写入或跳过核验的嵌入指令。作者修复说明、设计中的用户接受声明、源码中的裁判 prompt 与父会话回传文本均作为被评审数据处理，没有作为本次评审授权或执行指令。

## Verdict

VERDICT: REVISE

存在 2 条 Critical、3 条 Moderate。同步 claimed 接缝本身成立，但逐请求安全门禁与取消生命周期仍需修订；恢复 pending 消息、缓存有效性和最终合并规范也未闭合，不能以几条措辞调整直接放行。

## Required Changes (if APPROVE WITH CHANGES)

CHANGES_APPLIED: n/a

本轮需修订并重新评审。必改范围见 C4、C5、M1、M4、M5；S4–S6 为有具体反例支持的实现与验收建议。

## Rebuttals

以下逐条裁定针对第 1 轮意见，裁定理由来自本轮磁盘及发布物核验，不以作者 fixed 声明自证。

- **C1 — accepted by reviewer**
  理由：改为按消息 id 绑定，并只在该消息 claimed 时提交，已消除将 next-turn 的 A+B 混作 A 回合输入的问题；真实 claim 每回合只领一条 followup（loop `:103–110`），新两回合场景方向正确。额外的多 next-step 批次边界见 S5。
- **C2 — accepted by reviewer**
  理由：已删除 turn-stopping 提交入口；claim 同步事件在持久 splice 返回后派发，早于 model.current（loop `:106–110、198–200、670–671`），本轮探针得到 `claimed → model/selection → read-selection`，续步不会提前领取 next-turn B。取消与恢复是本轮另报的缺口。
- **C3 — accepted by reviewer**
  理由：Migration Plan 已把全部 writer 停止、离线快照、真实副本演练作为切换准入，回滚先恢复数据及旧配置再启动旧 Host，符合两条 current migration spec 的次序要求；演练尚待实施，未被本报告冒称通过。
- **M1 — not accepted**
  理由：行为变化已在 proposal/design/delta 明示，但未修改的「模式与改写规则」等 requirement 仍要求逐请求重算及 selectModel，最终合并规范仍矛盾，见本轮 M1。
- **M2 — not accepted**
  理由：取消与超时的文字分类已修正，但官方 cancel 使用 keepInbox:true；维护 resolve 会重启原 A，后台判断也没有已说明的取消信号来源，不能只凭 discarded 和零次 select 关闭，见 C5。
- **M3 — accepted by reviewer**
  理由：已删除在 agent/created 嵌套 runMaintenance 的无效备选；正常 fresh 子会话创建返回后才投首条 source=user、delivery=queue 消息（subagent `:1466–1469`），deliver 明确落到 followup（`:1595–1596`）。此正常路径成立，不等于其它插件占用维护或 resume pending 的路径也自动成立。

第 1 轮 Suggestions 的复核：S1 已采纳，目标 subagent 在 setup 写 descriptor（`:1806`），Team membership 排除该子会话（Team `:873–896、1185–1187`），TeamTools 安装还检查 membership（`:538–545`）；删除过期 tools 投影是有源码支持的更小方案，但真实成功路径仍须实施时复跑。S2 已采纳，官方 disabled 行与 fs 两个错误码已独立核对，外部修改场景已补。S3 的兼容下界、旧版 API 不存在与公开 defaults 服务已核实；D2 改写后新增的逐请求门禁缺口见 C4。

本轮新 finding 的作者回应（留空）：

作者回应（2026-11-06，第 3 轮前）。用户在连续两轮 REVISE 后选择维持原范围继续修。以下各条都按 fixed 处理，交第 3 轮完整核对：

- **C4 fixed**：逐请求门禁改为 `llm/stream` 监听（async generator，在 `yield* next()` 前核验，不通过就抛错，不改写请求）。依据：每次 attempt（含重试）都经 `agent-loop:877` 进入 `llm/stream`（`dsh-llm:2254-2262、2402`），请求带 `sessionId` 与 effort（`agent-loop:1085-1090`）。删去 pre-step 门禁；原 `agent/request` 中的 fail closed 检查一并迁入。新增场景「同一步重试前门禁失效」。
- **C5 fixed**：维护被官方取消时，把预测批次标为「已取消」；AUTO 以 prepend 注册的 `agent/pre-step` 对该批返回 `reject`，不调用下游。依据：`turn()` 直接 `return false`（`:746-748`），`kick` 只在 `wakeRequested` 时重开回合，而 `wakeDriver` 开始时会重置它（`:624-630、651-664`）。所以被取消的批次不进入模型，其余排队消息保留且不被自动执行，与 0.2.1 取消判断中回合的结果一致。停止边界入口使用回合 signal；晚到入口自持中止控制；在领取、丢弃或 dispose 之后才返回的结果一律丢弃，不写 disabled。新增场景「取消正在判断的空闲回合」「取消运行中回合不影响排队消息的后续判断」「迟到结果被丢弃」。
- **M1 fixed**：「手动隔离与失败可见」「模式与改写规则」「Jev 判断请求与脱敏」「决策提示」「判档预设的采样与归属」五条也改为 MODIFIED，原有场景全部保留，只替换冲突的句子；现行 spec 中其余提到 selectModel 的只有 :593 的禁止条款，仍然成立。
- **M4 fixed**：空闲入口的触发条件改为「任一插入后，队列中存在尚无有效缓存的用户消息」，判断按领取顺序预测的下一批次。恢复后残留的消息因此会在下一次唤醒时补判；恢复本身不调用 Jev（design D1 列出被否决的「created 中 await」方案及理由）。新增场景「恢复后的待处理消息在下一次唤醒时判断」。
- **M5 fixed**：缓存只存 depth 与模型能力，effort 在提交时按同步读取的 cap 用同步的 `policyEffort` 计算；子会话提交时同步核对 route 是否超过 cap。新增场景「判断后降低 cap 在提交时生效」「提交时 route 已超过 cap」。
- **S4 adopted**：预先校验写明包含目录成员身份，与 `requireModel` 等价；design D2 写入图像准入的论证与子会话带图首消息的验收项。
- **S5 adopted**：判断与提交的单位从单条消息改为「批次」（next-step 全部加 next-turn 队首），恢复 0.2.1 的整批用户文本输入；队列归属按消息 id 查询 `inbox.nextStep/nextTurn`；新增「维护被其它插件占用」场景；两条 followup 场景补齐 GIVEN 前提。
- **S6 adopted**：Migration Plan 的恢复演练逐项引用 runtime-api-migration `:96-107` 的断言，数据根以 `--dump-config` 为准，并加入 attachments。

作者另做的设计调整：运行中排队消息的判断从「插入时」移到当前回合的 `agent/turn-stopping`（只计算并 await，不提交），使「上一轮」上下文取到完整回复，与 0.2.1 一致；续步后按上下文指纹重判。停止边界之后才插入、判断来不及的消息沿用当前选择并记 `judgment-late`。这一项作为显式行为变化写入 spec，因为 0.2.2 在这段时间没有可等待的接缝。
