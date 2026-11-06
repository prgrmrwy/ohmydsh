## Review Metadata

- **Review round**: 3
- **Prior round**: round 2 — VERDICT: REVISE（2 Critical：重试绕过门禁、取消生命周期；3 Moderate：旧 SHALL 未替换、恢复漏判、cap 缓存失效）
- **Reviewer context**: cross-model (Magpie Codex gpt-6.1-sol, fresh context)
- **Tool restrictions**: read-only inspection; only write is review.md (+ own temp unpack)
- **Artifacts reviewed**: proposal.md, design.md, specs/, relevant source files

评审快照：`e35a49127108f1d5dd84aaadb03866487d374dc3`；开始时工作区干净。作者第 2 轮修复说明只作为待核对的说法，未使用作者对话记录。此次是提案与设计门禁，不把尚未实施的源码迁移当作已完成，也不因源码仍采用旧 API 本身重复报错。

独立从 npm registry HTTPS tarball 在内存读取了目标 `0.2.2-rc.1` 的 dsh-agent-loop、dsh-agent、dsh-llm、dsh-api-session-controller、dsh-agent-default-model、dsh-subagent、dsh-session、dsh-base，并补查 dsh-compaction-basic、dsh-command-compact、dsh-system-prompt、dsh-fs-observation-policy、dsh-experimental-agent-team、dsh-experimental-tool-agent-team；另对照 dsh-agent-loop@0.2.1-rc.5 和两个旧版 dsh-agent 的 API。以下 npm 行号来自本轮实际读取，而非照抄 design。

执行了发布物真实 ReactLoopInbox、ReactLoopAgent 的 send/cancel/runMaintenance/kick/turn/preStep，以及 step/prepareRequest/buildRequest、LlmRuntime 和 summarizeWithLlm 的内存探针。替身限于持久化、工具/提示上下文、模型 adapter、远程服务装饰器和包元数据等装配端口；没有运行完整候选 Host。中途发现探针的旧版 Inbox 构造参数、包元数据与请求辅助函数装配不完整，已查清并修正后重跑；报告只采用完成的探针结果。没有运行 build、sync、install，没有操作日常 Host，没有调用付费模型；仓库写入仅为整体替换本报告。

## Findings

### 🔴 Critical (blocking)

#### C4（部分修复，仍未关闭）：普通 attempt 的重试门禁成立，但官方压缩调用绕过新过滤条件

- **已成立的部分：** [design.md:73](design.md#L73) 采用 async generator，在 `yield* next()` 前校验的方向正确。目标 [dsh-agent-loop/lib/index.js:841–842、877、929–939](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 每次 retry 重新 prepare/stream；[dsh-llm/lib/index.js:2254–2263、2398–2402](https://registry.npmjs.org/@deepseek-ai/dsh-llm/-/dsh-llm-0.2.2-rc.1.tgz) 的 prepared 与普通 stream 都进入同一个 waterfall。真实 step + LlmRuntime 探针在两条路径都得到 `gateCalls=2, adapter.stream=1, requestErrorRetries=1`，第二次 attempt 抛出探针的可诊断门禁错误，没有第二次生成调用。middleware throw 不被 adapterFailureChunk 转换；loop 的 `:886–919、800–816` 会传播并记录为步骤/回合错误。
- **剩余证据：** [delta auto spec:167](specs/auto-model-routing/spec.md#L167) 一方面要求“每一次实际模型调用”，另一方面只处理 `isAgentLoopRequest` 为真的请求；[design.md:73](design.md#L73) 同样限定 loop 请求。实际 [dsh-base/cordis.patch.yml:355–356](https://registry.npmjs.org/@deepseek-ai/dsh-base/-/dsh-base-0.2.2-rc.1.tgz) 装配官方 compaction-basic，其 [lib/index.js:292–323](https://registry.npmjs.org/@deepseek-ai/dsh-compaction-basic/-/dsh-compaction-basic-0.2.2-rc.1.tgz) 用子会话自己的 `sessionId`、`purpose: "compaction"` 调 `ctx.llm.stream(options)`，没有调用 markAgentLoopRequest。它可在 `agent/pre-step`（`:839–849`）和 request-error 的上下文溢出恢复（`:879–905`）中执行。
- **具体反例：** C 已绑定 route P/M；之后官方允许列表撤销 M。下一步先触发压力压缩，压缩仍用历史请求头中的 P/M。即使 adapter 仍能解析 M，新的监听因该请求没有 loop 标记而原样放行；真正的 loop 请求随后才因 allowlist 被拒。最终已经发生一次被撤销模型的生成调用，不能满足保留的 [current auto spec:716、779–782](../../specs/auto-model-routing/spec.md#L716) 所要求的零模型请求。直接执行发布物 summarizeWithLlm + LlmRuntime 得到 `sessionId=C, purpose=compaction, marked=false, gateChecks=0, adapter.stream=1`；这不是虚构另一条插件请求路径。
- **另一个必须闭合的入口条件：** [design.md:73](design.md#L73) 声称同一监听还接管 requireBindingRecord，但它和 [delta:167](specs/auto-model-routing/spec.md#L167) 都把核验对象写成“已有 route”的子会话。`.bound` 尚在而记录文件被删除时，不存在可供该过滤器匹配的 route；不能先以 record?.route 判定放行，再指望同一分支检查记录缺失。保留的 [current spec:347–350、647](../../specs/auto-model-routing/spec.md#L347) 明确要求此时零模型请求。原检查位于 [policy-host.ts:109–110、211–215](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L109)。
- **所需修订：** 先按精确 sessionId / live Agent / bound 身份识别应受保护的会话，检查绑定完整性，再区分请求种类；明确如何处理该会话的官方辅助生成调用。最保守的小方案是在受管会话上拒绝未被允许的非 loop 生成调用，不能只过滤掉它们。若确实要豁免压缩，必须把门禁范围及现行零请求契约的变化明确提出，不能继续声称覆盖每次模型调用。补“allowlist 撤销 → pre-step 压缩”和“上下文溢出 → 压缩 → retry”、以及“bound 存在但记录缺失”的 adapter.stream 零调用断言。普通 loop 请求的 marker + sessionId 能识别该请求所属会话；它不证明辅助请求不存在，也不能替代缺失记录检查。

#### C5（部分修复，仍未关闭）：取消后不会重启普通 followup 已证明，但维护期间的 steer 被额外消费

- **已成立的部分：** [design.md:50](design.md#L50)、[delta:73、127–130](specs/auto-model-routing/spec.md#L73) 的 reject 方案在所写的纯 followup 场景中成立。真实 0.2.2 类探针得到：maintenance 的 `wakeRequested=true`；释放维护后新 driver 的 `wakeRequested=false`；第一个批次被 reject，零 step/start、零 user/message，回合 blocked，剩余 followup A 保留。`keepInbox:true` 没有清掉维护 wake，但 [loop:624–630](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 创建新 driver 时重置了它；不是 cancel 自己把它置为 false。
- **剩余证据：** [design.md:50、106](design.md#L50) 宣称与 0.2.1 相比“可见差别只是” aborted 变 blocked。[delta:60、73](specs/auto-model-routing/spec.md#L60) 却让维护期间所有输入继续停留 inbox，之后以整批 reject。真实 [ReactLoopInbox.claim:103–110](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 会领取**全部** next-step，再领一条 next-turn；pre-step reject 消费整批，不会恢复其中后来插入的消息。
- **具体反例与独立对照：** 初始残留 followup B；用户发 followup A 唤醒，AUTO 开始判断 B。判断期间用户再发 user steer C，然后官方 cancel。0.2.1 在等待 Jev 前已经领取 B，C 因而还在 next-step，取消后得到 `pending=[C,A], end=aborted`。0.2.2 的维护阻止领取，C 与 B 随后一起被 claim/reject，得到 `pending=[A], end=blocked`。即使取消标记只标 B，因批次含 B，C 仍被整批消费。两个版本都没有 step/start 或 user/message，但新版本额外丢掉了尚未执行的 C。上述结果来自两个版本真实 Inbox、send/cancel、kick/turn/preStep；没有用自写 turn 代替。
- **所需修订：** 明确取消所拥有的工作在何时固定，并处理“维护开始后才进入 next-step”的输入。若要保持旧语义，应把非取消所有权的已领取输入按原队列/顺序重新放回，使用不唤醒的 inbox 操作，并保证 reject 后仍停在 idle；或者明确提出“取消会消费维护期间追加的 steer”这一额外行为变化，删除仅结束标签不同的等价性结论。新增上述双版本对照场景，断言 provider、剩余两个队列、user/message、模式/disabled 与实际 wake 值。仅补纯 followup 场景无法关闭本条。

### 🟡 Moderate

#### M6：第一次 claimed 时的队列集合求差，不是稳定的领取凭据

- **证据：** [design.md:47、107](design.md#L47) 和 [delta:68](specs/auto-model-routing/spec.md#L68) 把“回调前记录的 pending − 回调时队列”作为精确批次。发布物 [Inbox.claim:103–110、replace:134–138、mutate:198–200](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 证明领取确实先整体移出、再逐条 emit，但 emit 的其它同步 listener 可以再次 splice/replace。它们产生 discarded/inserted，且此时 Session append 已返回，可合法重入。
- **具体反例：** next-turn 为 [A,B]，真实 claim 只领 A；排在 AUTO 前的 claimed listener 把仍待处理的 B replace 为 C。若 pending 记录跟随 discarded/inserted 更新，到 AUTO 回调时记录和当前队列都只剩 C，差集为 []；若冻结的是领取前 [A,B]，再减回调时 [C]，差集为 [A,B]，把被其它 listener 丢弃的 B 也算作领取。真实 Inbox 探针得到了前一种 `difference=[]`，但 `claim()` 返回 `[A]`。即使 A 的缓存已就绪，当前算法也可能错失本应提交的用户回合，且这不属于声明的 judgment-late 时间窗。
- **缓存反例：** 同一公开 replace API 允许保留 id 而替换文本。探针把 A 的文本从旧任务替换为另一任务后，用户 id 键仍为 [A]，claim 读到的却已是新文本。[delta:66、68](specs/auto-model-routing/spec.md#L66) 没有规定已就绪缓存如何因这种替换失效；只写“判断在丢弃后才返回则丢弃”并不覆盖先返回、后替换的结果。
- **所需修订：** 用能够区分 claim 移除与 discard/replace 的事务凭据记录批次，并在 claimed 时同步消费该凭据；不要把任意两个时间点的队列差当成原子操作。例如可在 session/event 中只读跟踪 `agent/inbox/spliced` 的移除与 outcome，收集领取移除，仍在 claimed 中 select；不能在 session/event 中 select。明确替换/丢弃使已就绪缓存失效，包括同 id 新内容。补“先执行的 claimed listener replace 剩余队列”“维护中 replace/discard”“多条 next-step + 一条 next-turn”的输入顺序及恰好一次提交断言。

#### M7：子 route 超过新 cap 后的场景，无条件保证了退化链无法保证的结果

- **证据：** [delta:165、193–196](specs/auto-model-routing/spec.md#L165) 要求提交时 route 超 cap 则“不改写并告警”，却断言“子会话请求不使用 high”。未被替换的 [current spec:714、754–757](../../specs/auto-model-routing/spec.md#L714) 规定退化时请求与官方合成配置相同，显式 effort 不可用也不得被替换。[design.md:71](design.md#L71) 没有增加修改官方初始 effort 的步骤。
- **具体反例：** 官方 fresh 子会话初始选择本身是 high（可由显式参数给出，或继承 high 父选择）；判断时 cap=xhigh，候选 route=high；领取前 cap 降为 medium。不执行 AUTO select 并按退化链原样放行，实际请求仍是官方 high。这同时满足“不改写”，却违反新场景的“请求不使用 high”；若为了满足后者改成 medium，又违反前者及显式维度不替换契约。
- **所需修订：** 保留自动路由 cap 的原有边界，把断言改为“AUTO 不提交超 cap route；请求保持官方初始配置”，并分别覆盖官方初始 medium 与 high。若要禁止所有 high 请求，则须另行修改退化链和显式参数契约，不能用这条迁移场景暗中扩大 cap 权限。主会话提交时读最新 cap 的 M5 修复本身成立，见 Rebuttals。

#### M8：新增 judgment-late 状态违反合并后仍保留的 reason 闭集

- **证据：** [delta:78、117–120、142–145](specs/auto-model-routing/spec.md#L78) 明确要求状态 `reason: "judgment-late"`；本轮八条 MODIFIED 中没有「AUTO 芯片与状态面板」。因此 requirement 级合并后，[current auto spec:497–498](../../specs/auto-model-routing/spec.md#L497) 仍要求 `reason` 为闭集 `jev | no-effort-support`。
- **具体反例：** 按晚到 followup 场景，让另一个 turn-stopping listener 挂起，插入 B，再让 B 在后台判断完成前被领取。返回 judgment-late 违反保留的闭集；返回 jev 或 no-effort-support 则违反 delta 的明确断言。没有一个状态响应能同时满足两条 SHALL。
- **所需修订：** 将「AUTO 芯片与状态面板」也纳入 MODIFIED，扩充闭集并写清此状态的 depth/effort/decision 呈现和清除时机；加状态端点及面板断言。上一轮 M1 指出的旧 writer/逐请求重算冲突已经消失，本条是新增状态未同步进保留 requirement 的另一个合并缺陷。

### 📌 Suggestions

#### S7：预先校验补上了 requireModel，但应把目录/能力快照的有效期列成实现验收项

[delta:18–19](specs/auto-model-routing/spec.md#L18) 现在显式要求目录成员检查，解决了上轮 S4 的漏项；[design.md:69](design.md#L69) 对主会话省略图像串行化的论证也有具体依据：主 provider/model 不变，官方图像 admission 查询该 route 的 inputModalities（[controller:844–848](https://registry.npmjs.org/@deepseek-ai/dsh-api-session-controller/-/dsh-api-session-controller-0.2.2-rc.1.tgz)），effort 不改变查询目标。公开 default 服务按提交次序保存（[default-model:53–65](https://registry.npmjs.org/@deepseek-ai/dsh-agent-default-model/-/dsh-agent-default-model-0.2.2-rc.1.tgz)），这部分替代成立。

具体仍应锁定的边界是：判断期间 M 在目录、支持 [low,medium,high]，判断结束后、claim 前 adapter HMR 把支持集改为 [high] 或移除目录项。提交同步核对 provider/model 与 cap，并不会发现目录/能力变更；官方 resolveCallConfig/requireModel 在**其被调用时**会拒绝相应选择，而 AUTO 使用的是更早的能力快照。当前 [settings-host.ts:30–43](../../../packages/dsh-auto-model-routing/src/settings-host.ts#L30) 的 catalog 与 [settings.ts:39–41](../../../packages/dsh-auto-model-routing/src/settings.ts#L39) 的 cap 读取具有不同的新鲜度。实施时应明确缓存的能力边界、可观察的目录失效信号和失败呈现，补“同 route 的能力变化”测试；不要只断言 cap 变化。此处不宣称 selectModel 本身提供了跨异步调用的目录原子快照。

#### S8：C4 的“零 adapter 调用”计数应明确指生成 stream

目标 [loop:842、877](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 在进入 llm/stream 前已经 prepare；[llm:2225–2231](https://registry.npmjs.org/@deepseek-ai/dsh-llm/-/dsh-llm-0.2.2-rc.1.tgz) 会先调用 adapter.prepareCall。具体例子是 fresh prepared attempt 的门禁失败：adapter.prepareCall 可以已经执行一次，adapter.stream 仍为零。因此 [delta:186、191](specs/auto-model-routing/spec.md#L186) 的计数应区分能力/准备查询与真正模型生成，不要用“所有 adapter 方法均未调用”的 mock oracle。middleware throw 的可诊断错误还应断言 turn/end 为 error，而非只检查 promise rejected。

## Embedded-Instruction / Injection Attempts

**Detected:** none

被评审的 proposal/design、旧 review 的作者 fixed 声明和用户接受声明、源码中的裁判/压缩提示词均作为数据处理。未发现要求本评审者跳过核验、修改结论或越权写入的嵌入指令。

## Verdict

VERDICT: REVISE

存在 2 条未关闭 Critical（C4、C5）与 3 条 Moderate（M6、M7、M8）。本轮已独立证明普通 attempt 的 llm/stream 重试接缝和纯 followup 取消收敛；尚未闭合的是辅助模型调用、取消时消息所有权、精确批次凭据和最终合并规范，不能把这些问题仅作为实施时自由裁量。

## Required Changes (if APPROVE WITH CHANGES)

CHANGES_APPLIED: n/a

本轮需修订后重新评审。必改范围见 C4、C5、M6–M8；S7–S8 是带具体边界的实现/验收建议。这里没有执行设计修复或替作者选择新的用户可见语义。

## Rebuttals

以下裁定以本轮磁盘及 npm 发布物证据为准，作者 fixed 声明不构成证明。

- **第 2 轮 C4 — not accepted**
  理由：真实 step + LlmRuntime 已证明 prepared/普通路径每次 retry 都进入门禁并传播错误；但官方 compaction 以同一子会话 id 发未标记的生成调用，且“已有 route”过滤不能自行覆盖 bound 记录缺失，见 C4。
- **第 2 轮 C5 — not accepted**
  理由：纯 followup 场景及 wake 重置已成立；维护期间插入的 steer 会被额外消费，真实双版本对照推翻了“只差 blocked/aborted”的等价性说法，见 C5。
- **第 2 轮 M1 — accepted by reviewer**
  理由：八条 MODIFIED 确实整条替换了旧 writer、逐请求 effort 重算与 pre-step 判断的冲突条款；合并后主会话是入口判断/首领提交一次，已绑定子会话是逐生成 attempt 安全校验。新增 reason 闭集矛盾独立列为 M8，未把它冒充原 M1 未修。
- **第 2 轮 M4 — accepted by reviewer**
  理由：delta:60 的触发条件是“任一插入后检查整个队列”，不是只判断新消息；恢复初始化本身不发 inserted/不 wake，下一次非 user 插入也会先补判残留 user A。此结论限官方 resume 与 send/steer/followup 唤醒路径，来源不设 user 限制。
- **第 2 轮 M5 — accepted by reviewer**
  理由：delta:18–19 不再缓存最终 effort；SettingsStore.read 与 policyEffort 可同步执行，领取时按最新 cap 计算，主会话的旧 high 缓存绕过降 cap 问题已消除。子会话新增场景错误另列 M7，目录/能力快照边界见 S7。

第 1 轮已 accepted 条目的回归核对：

- **C1 — accepted by reviewer（原问题未重现）**
  理由：next-turn 两条 followup 仍按各自一回合处理，delta:102–105 也补齐各自缓存就绪的前提，没有重新把 A+B 当作 A 的分类输入；扩展后的批次求差在其它 listener 修改队列时失真，是本轮 M6。
- **C2 — accepted by reviewer（原问题未重现）**
  理由：停止边界只计算、await，不写 selection；真正提交仍在首次 claimed，早于 loop:671 读选择。续步的 claim 不提交，delta:107–115 明确按新上下文指纹重判，未恢复在 turn-stopping 提前换模的错误。
- **C3 — accepted by reviewer（原问题未重现）**
  理由：design:118–129 保持停止全部 writer、离线备份、真实副本迁移/恢复、恢复旧数据与配置后再启动旧 Host 的顺序，并按有效配置列数据根，加入附件及 runtime-api-migration 的字段/generation/lease 断言。这里是设计已闭合，不是恢复演练已执行。
- **M3 — accepted by reviewer（原问题未重现）**
  理由：未重新引入 agent/created 嵌套维护。目标 loop:1565–1593 仍在 factory maintenance 中执行 created；正常 fresh 子会话在 subagent:1821–1830 创建返回后，才由 :2232–2242 → :1595–1596 投递首条消息，此时可走空闲入口。

第 2 轮 Suggestions 的核对：S4 的目录成员校验和主会话图像论证已写入，精确能力快照边界见 S7；S5 的队列读取、多个 next-step 输入及维护占用场景已补，但批次凭据仍有 M6；S6 的恢复数据根与逐项保真断言已补。memex 删除过期 tools 投影仍是有发布物依据的较小方案：subagent setup 先写 descriptor，Team membership 排除普通子会话，Team tools 安装还检查 membership；最终安全门禁和启用 Team 时成功路径的实测要求仍保留。文件观察策略的官方 disabled 行及 plain patch 接线也有证据，未发现本轮回归。

本轮新 finding 的作者回应（留空）：

- **M6：**
- **M7：**
- **M8：**
