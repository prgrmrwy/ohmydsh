## Review Metadata

- **Review round**: 4。
- **Prior rounds**: round 1 — REVISE；round 2 — REVISE；round 3 — APPROVE_WITH_CHANGES，RC1/RC2 后经定向独立复核 accepted，历史 `CHANGES_APPLIED: yes`。第三轮历史摘要见下文；本轮结论不覆盖其已经完成的修订记录。
- **User approved continuation / minimal revision**: yes。实施在发现 spec drift 后暂停；用户批准本轮最小修订：failed、事件缺失或 Host 换代后无法证明资源释放即停止；只归档登记测试根，cancel 清 inbox 并等待 whenIdle，保留 live 根且不冒充 dispose；桥沿用 Host authority/Origin/cookie，不承诺 socket 本机来源。先前批准的固定虚构输入、普通委派事后审计、默认值不自动恢复及业务评估延期全部保留。
- **Reviewer context**: fresh 独立子评审；本地静态核查，不是作者自审，也未另启模型 reviewer。按单用户、六条件串行自检审查，不把首版重新扩大成业务评估平台。
- **Review basis**: 当前 [proposal][proposal]、[design][design]、[evaluation delta spec][spec]、[memory delta spec][memory-delta]、原第三轮报告、[implementation-progress][progress]，以及只读核对 [tasks][tasks]、[test-plan][test-plan]、[manifest][manifest]、当前 [scope spec][scope-spec] / [memory spec][memory-spec]、[集成陷阱][pitfalls]、[resolver][resolver]、[身份账本基础模块][ledger]及指定 compatibility runtime 真实源码。重点追踪 jobs-local、workspace archive、continuable drain、Agent cancel/whenIdle 与 Connection。
- **Restrictions observed**: 唯一写入是本报告。没有修改 proposal/design/specs、test-plan/tasks 或实现；没有联网、创建/操作测试会话、调用模型、构建、运行测试或访问 Memex。对子评审父会话的结果通知仅用于交付评审结论。实现进度中的历史测试结果不是本轮执行结果。

## Findings

What this change does: 将实施中发现的生命周期与认证承诺修回真实 Host 能力：归档静止但保留根对象，使用连续 jobs 证据证明释放，认证沿用既有 Host operator 边界。固定三题自检及此前裁判、默认值、递归审计不变量保持不变。

**0 Critical、2 Moderate、0 Suggestions。结论：APPROVE_WITH_CHANGES。** 两项均可用现有官方接口补足，是清退顺序和释放谓词的小修，不需要新增 core seam、扩大权限或重新选择产品方向。未要求已经运行 live；但不能用“失败就停止”掩盖正常成功分支的缺口。

### Critical

无。本轮没有发现必须撤销用户已批准收缩、引入新 core 释放 API 才能完成首版的实质问题。所有 failed 一律停止虽会保守拒绝部分已经释放的作业，但它是明确接受的边界，不作为缺陷要求放宽。

### Moderate / Must fix

**M1. drain 成功会把结算通知重新 inject 到已清空的根 inbox；清队列必须在 drain 后再做一次。**

- **What this is / 位置**：[设计 D6:81–85][design-cleanup]及[身份生命周期规范:143、167–175][spec-cleanup]要求先归档根、exact Agent cancel 清队列并 await whenIdle，再证明 jobs 释放、调用 `drainContinuableDescendants([exactRoot])`。归档阻止模型步骤，但根对象保留。
- **Problem / 具体正常情形**：一个已经 announced、默认通知策略的 continuable 后代在 drain 时成功收尾。[drain:224–266][drain]先把 exact root 标为 closing，再 dispose 后代；[finishDisposal:662–680][activation-finish]在返回前发送结算通知。[notifySettlement:684–702][settlement-notice]发现 parent 位于 closing scope 时会调用 `parent.inject(message)`，不是丢弃通知。因此前面已清空的 root inbox 被重新填入 next-step 消息；[inject:825–826、whenIdle:883–888][loop-cleanup]不会因这种无唤醒注入变成 running，单独检查 idle 会通过。该路径不需要异常、外部操作者或恶意插件，就能违反“清空队列”的收尾结果。
- **Fix / 最小修复**：保留“先归档、初次 cancel/idle、逐 owner jobs 释放证明、正式 scoped drain”的现有步骤；在 **await drain 完成及合法 owner 的 one-shot 收尾之后**，再对登记的 exact root 执行一次不带 `keepInbox:true` 的 cancel 并 await whenIdle，然后核验两类 inbox 均空、仍为同一 live 对象、jobs 账本健康且所有期间新增资源均已获得连续释放证明。将这些放到换题/续跑放行之前。不要改 runtime 通知策略、全局吞通知、伪造 disposer 或归档后代以绕过该顺序。预算到期或未知资源仍按原边界停止。
- **可判定验收**：真实 continuable runtime + mock LLM，保留默认 settlement notice，构造已 announced 后代和在途 materialization。验证 scoped drain 的通知确实发生；最终根 inbox 两队列均空、根保留且 archived、子代 handle 已由合法 owner 释放、后续 continuation admission 被拒绝、无下一题提前启动，未登记日常根及其后代仍可运行。不要只测 `interrupt accepted` 或 `whenIdle` 返回。
- **If we skip it**：正常成功 drain 后仍留下队列，或者实现只能把这种可消除的残留当作失败而终止自检。归档 gate 可阻止下一模型步，但不能把有待处理输入的 live 根说成队列已经清空。

**M2. “未证明已 removed / 未证明先 removed”混淆释放与登记删除；保留 live 根时正常后台 job 不会自动 removed。**

- **What this is / 位置**：[设计 D6:83][design-cleanup]将“未证明已removed”列作停止条件；[规范:145][spec-cleanup]使用“未证明先 removed”。它们既可读成“已移除但缺少此前释放证明”，也可读成“必须先证明记录被移除”。后者与本轮批准的保留根方案不兼容。
- **Problem / 具体正常情形**：被测者启动后台 bash，job 正常 completed 或取消后 killed；连续注册和结算证据齐全。当前 [jobs-local:736–755][jobs-settlement]结算只更新状态并发 `settled`，不会删 record；[list:493–495、remove:513–516][jobs-list-remove]仍可列出该 terminal record，只有显式 remove 才删除。[owner cleanup:762–785][jobs-drop]自动 drop 依赖 **owner Agent dispose**，而本轮恰好不 dispose 根。因此若要求根 owned job 必须先自动 removed，普通后台作业即使可靠释放也无法进入下一题。这不是必须靠 fail closed 接受的能力缺失。
- **Fix / 最小修复**：在 D6 与身份规范明确唯一谓词：同 generation、监听连续、账本健康，且每个本轮 owned job 有 `registered → trusted completed/killed settled`，即取得该 job 的释放证明；**已经结算但仍留在 registry 的 record 不妨碍继续**。若 record 已 removed，必须仍持有其此前完整的合格结算证据；仅 removed、terminal 快照、空 list 均不补出释放证明。首版无需为了清记录而引入 remove 操作。若实现另行选择显式 `jobs.remove`，也只能在保存合格结算证据后按 exact owner 删除登记，不能把 remove 本身当释放。所有 failed、丢事件、未知身份和跨 generation 无证明继续停止。
- **可判定验收**：给[新增精确 owner 场景:172–175][spec-cleanup]增加正常成功分支：已可信 completed/killed、root 仍 live、record 仍能 list 时允许换题。配对断言“registered→合格 settled→removed”可继续，“registered→failed→removed”及“只有 removed / 空 list”均停止；unowned job 不取消、不删除、不要求其释放，不借日常作业的不相关事件阻塞测试树。
- **If we skip it**：实施者可能为满足含混的文字要求等待一个永远不会自动发生的 removed，或错误要求销毁根，重新引入已被用户否决的所有权假设。反过来，把 removed 直接当 released 也会放行 forced-failed 孤儿。

## Confirmed feasibility and retained invariants

以下是实际源码支持的成功路径及边界，不是 live 通过声明：

1. **jobs owner 与连续性可接线。** [jobs-local events:52–87][jobs-events]同步分发且吞 listener 抛错；[事件契约:212–236][jobs-event-contract]明确 owners:all 与不 awaited 的回调。设计要求首资源前订阅、持久记录、sticky unhealthy 正确；实现应使用同步持久化或显式 flush barrier，在放行前确认所有写入完成，不能只抛异常或只排队。当前[账本:59–75][ledger]已有同步写入与 fsync 基础，但尚未接线，不能据此声称 Host 生命周期已实现。没有公共事件 seq 也不必虚构一个：连续性来自同进程不中断的订阅、每 job 状态链及健康/落盘检查；重新挂载或恢复不能凭快照补齐丢失事件。
2. **unowned 不能冒领。** [list 实现:493–495][jobs-list-remove]和[事件 filter 实现:71–80][jobs-events]确实把 unowned 混进 caller 可见集合。设计/规范要求二次 `job.owner === exactOwnerId` 过滤正确；官方 [job archive admission:26–41][job-archive]也如此过滤。记录 all 不等于操作 all。Host generation 与精确登记的 live 对象一起约束 owner 身份，不能在同 ID 被替换后继续用旧证明。
3. **failed 不等于释放，completed/killed 存在真实成功来源。** [producer done:104–109][producer-contract]要求释放后 resolve、不得 reject；[jobs-local:472–490][jobs-list-remove]将 reject 转 failed，[teardown:800–823][jobs-forced]还可能强制 failed 并留下孤儿。全部 failed 停止匹配批准边界；不解析 detail。另一方面，官方 [one-shot settleRun:3018–3036][oneshot-settlement]确实先 await `run.dispose()` 再返回 outcome，正常 completed/killed 并非不可达。foreground bash 还会在返回前删除 record，见 [bash:431–476][bash-record]；必须靠先前事件证明它，而不是以列表非空/空判断安全。
4. **归档不是 dispose，且 gate 确实存在。** [workspace:524–538][workspace-archive]先持久归档再请求停止；已归档重试是 no-op，不能期待它再清队列。[turn archive handler:18–35][agent-archive]仅取消 running Agent，因此额外 exact Agent cancel 必须保留。[Agent cancel:828–833][loop-cleanup]默认清 inbox，whenIdle 只等活动。[归档 gate:17–48][archive-gate]拒绝根及 subagent-origin lineage 的后续模型步，不删除 Agent/history；独立 fork 不假装被该 gate 覆盖，仍受已有递归登记/清退证明约束。用户主动 unarchive 属于现有 operator 控制，不是本轮承诺的永久隔离。
5. **scoped drain admission 可实际关闭。** [drain:224–266][drain]在第一个 await 前关闭 exact live roots 的 admission、收集在途 materialization 并等待；[materialize / submit:324–363][drain-admission]与[发布后复核:488–502][activation-finish]再次检查 cutoff；[finishDisposal:633–680][activation-finish]child-first 释放合法 handle。没有要求桥冒领 one-shot disposer。收尾窗口新资源继续纳入 all-events 监测和末次核验；已知 failed 仍不能被后续 drain 成功洗白。M1 是收尾后通知的顺序修正，不是否定该 drain 能力。
6. **认证修订符合现有实现。** [Connection authority/Origin:205–218][connection-trust]允许 loopback authority 或 trustedHosts，并拒绝跨源浏览器标记；[requestRejection:585–588、RPC route:640–656][connection-route]再检查 cookie，最终 handler 得到 [request.signal:695][connection-route]。它不证明 remoteAddress、本机 socket 或 CLI 进程身份。当前 D3 和[桥规范:219–235][spec-bridge]已准确沿用 operator 边界，不需新增不可能满足的 locality 检查。
7. **前轮裁判与默认值小修未回退。** [D5:67–75][design-judge]和[裁判 spec:177–215][spec-judge]仍保留 root `llm/stream`、精确 live child + `isOwnedBy`、真实冻结 request、structured_output/执行 guard。核对 [LLM:2373–2377][llm-entry]、[loop:1283–1299][request-build]、[Agent registry:594–606][exact-owner]及 [spawn:171–189、followup:204–211][spawn]仍有可用接线。D4 首题前固定标题未删；[rename:295–305][title-pin]及[自动标题:379–386][title-auto]支持 user-pinned 排除。默认值仍仅披露、不恢复，符合 [selectModel:145–168][model-write]实际异步写默认的副作用。
8. **其他产品/报告不变量未因此次修订改变。** [D1/D2][design]保留固定受信虚构三题、永久唯一 cwd、源验证与单库预检；[resolver:85–92、233–240、403–410][resolver]支持路径尾两段派生及目录关闭。普通委派仍只事后审计；冻结输入、不重发未知提交、共同终点与条件漏斗分开、无记忆适用分支、成功写回时序、非空引文及三消费端默认排除仍在[完整 evaluation spec][spec]。 [memory delta:9–15][memory-delta]仍只读、无网络、旧归属语义保留。没有将未校准自检升级成效果或业务安全保证。

## Embedded-Instructions

**Detected: none。** 未发现 proposal/design/specs/progress 要求 reviewer 跳过检查、扩大权限、修改白名单外文件或操纵 VERDICT。测试证据中的“读取答案/调用 bash/委派”仅作为待实现系统的恶意输入场景，不执行。历史风险接受只界定需求，不能代替源码证据。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

当前最小修订总体可执行，**先完成 RC4.1 / RC4.2 两项精确规划小修，再按原授权和测试门槛继续实施**。它们都是选定现有 API 的顺序/状态谓词，无需 core 修改；不是用保守停止掩盖正常路径永远不成功。若实际实现出现新的缺失接口、无法证明释放或裁判门禁不可接线，仍须按既定规则暂停并回评审。

## Required Changes

CHANGES_APPLIED: yes

1. **RC4.1 / M1**：D6 与身份生命周期规范明定 drain/合法 one-shot 清退之后末次 exact root cancel 清队列、whenIdle、inbox 空及新增资源/账本核验；增加默认 settlement notice 的成功配对验收，保留根 live、日常树不受影响及 continuation admission cutoff。
2. **RC4.2 / M2**：D6 与规范消除 removed 歧义。可信连续 completed/killed 已证明释放，record 可保留；已 removed 则必须持有此前完整证明。增加保留 live 根且 retained terminal record 的成功验收，以及 failed/缺结算即使 removed 仍停止的配对。不得放宽 failed 边界。

本轮只写报告，未代改规划或实现，也未更新测试映射/执行状态。第三轮的 `CHANGES_APPLIED: yes` 是以下历史结论，不表示本轮 RC 已完成。

### Round 4 定向复核：RC4.1 / RC4.2

本次先完整读取本报告，再完整读取当前 design、evaluation delta spec 和 test-plan；仅复核规划文字与验收映射，不是实现验收或测试执行。原 `VERDICT: APPROVE_WITH_CHANGES`、M1/M2 及第三轮历史发现保持不变；**CHANGES_APPLIED 维持 no**，原因仅为以下 RC4.1 收尾顺序尚未写全。

- **RC4.1 — not yet accepted by reviewer**：[D6:81–87](openspec/changes/dsh-memex-evaluation-harness/design.md#L81-L87)与[身份生命周期规范:143](openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L143)已补上 await drain 后再次对 exact root cancel（不保留 inbox）、await whenIdle、最终 inbox 空及账本/jobs 复核；[新增场景:177–180](openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L177-L180)已映射到[test-plan:68 的 EVAL-060](openspec/changes/dsh-memex-evaluation-harness/test-plan.md#L68)。但 D6:85 和规范:143 都只将末次清队列排在 drain 之后；D6:87 的“one-shot只能由其合法owner收尾，桥不冒领handle；无法证明即停”仅规定所有权和失败边界，**未规定 await 合法 owner 的 one-shot 收尾完成后，才执行末次 exact root cancel / whenIdle / inbox 与资源最终核验**。EVAL-060 的对应场景同样没有该先后关系，不能排除先清空 inbox、再发生合法 one-shot 收尾通知的顺序。**最小遗漏**：在 D6 和身份规范明确“await scoped drain 及合法 owner 的 one-shot 收尾完成 → 末次 exact root cancel（不带 keepInbox:true）→ await whenIdle → 最终两类 inbox 均空、同一 live root、账本健康及全部新增资源释放证明 → 才允许换题/续跑”；并在现有 EVAL-060 对应场景/覆盖说明中加入 one-shot 收尾完成先于末次清队列的配对断言。不需新增 API、冒领 disposer 或修改 runtime 通知策略。
- **RC4.2 — accepted by reviewer（规划静态复核）**：[D6:83、87](openspec/changes/dsh-memex-evaluation-harness/design.md#L83-L87)与[身份规范:145](openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L145)共同明确：同 generation、连续 registered→可信 completed/killed 结算证明释放，terminal record 仍 listed 不阻止继续；已 removed 必须持有此前释放证明，remove/空 list 不补证明；所有 failed、缺事件、账本写失败及跨 generation 不明继续停止。D6:87 也明确解释旧“未证明已removed”不是要求所有记录先删除。[保留记录成功场景:182–185](openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L182-L185)及[failed/丢证据移除仍停止:162–165](openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L162-L165)分别对应[test-plan:69 的 EVAL-061](openspec/changes/dsh-memex-evaluation-harness/test-plan.md#L69)与[test-plan:64 的 EVAL-057](openspec/changes/dsh-memex-evaluation-harness/test-plan.md#L64)；[exact owner 场景:172–175](openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L172-L175)保留不操作 unowned 的约束。未放宽 failed 边界，也未要求销毁保留的根或强制删除记录。

**本次未运行任何测试、构建、OpenSpec CLI、网络、模型或测试会话操作；未访问记忆。EVAL-060/061 仍是规划中的 red 映射，不是本次通过证据。唯一写入为本报告。**

### Round 4 fresh 定向复核：RC4.1 最后遗漏闭合

本次在读取到上节最新定向复核记录（RC4.1 未接受、RC4.2 已接受）后，静态对照当前 D6、身份生命周期要求、对应场景及 test-plan 映射；编辑前再次读取本报告相关区段，未见并发变化。上节未接受结论保留为历史，不覆盖原 `VERDICT: APPROVE_WITH_CHANGES`、M1/M2 或第三轮发现；当前两项规划修订均已满足，**CHANGES_APPLIED: yes**。

- **RC4.1 — accepted by reviewer（规划静态复核）**：[D6:81–87](openspec/changes/dsh-memex-evaluation-harness/design.md#L81-L87)，尤其 [D6:85](openspec/changes/dsh-memex-evaluation-harness/design.md#L85)，现已明确 drain 与合法 one-shot owner 收尾均可能 inject 结算通知，必须等待二者均完成，再对 exactRoot cancel（不 keepInbox）、await whenIdle，最终复核 inbox 空、账本/jobs 无未证明资源；清退窗口新增资源继续监测，未知资源停止。[身份生命周期规范:143–145](openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L143-L145)同样要求二者均完成后末次 cancel、whenIdle 及全部资源证据最终核验，保留精确测试根归档但不冒称 dispose、不得操作日常会话等边界。[“后代结算通知在最终清队列时清除”场景:177–180](openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L177-L180)现在同时覆盖 drain 与合法 one-shot owner 的结算注入，明确二者之后才末次清队列，且任一 owner 收尾未完成不得进入最终核验或下一题；仍精确映射到 [EVAL-060:68](openspec/changes/dsh-memex-evaluation-harness/test-plan.md#L68)。上节指出的最后顺序遗漏已闭合，无需新增 API、冒领 handle 或修改 runtime 通知策略。
- **RC4.2 — accepted by reviewer（规划静态复核，维持先前接受）**：再次核对 [D6:83–87](openspec/changes/dsh-memex-evaluation-harness/design.md#L83-L87)及[身份规范:145](openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L145)：连续可信 registered→completed/killed 证明释放，record 仍 listed 不妨碍继续；已 removed 必须持有此前释放证据，未要求先删除全部记录；failed、缺事件、账本写失败及跨 generation 身份不明仍停止。[保留记录成功场景:182–185](openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L182-L185)与[failed/缺证据停止场景:162–165](openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L162-L165)分别仍映射到 [EVAL-061:69](openspec/changes/dsh-memex-evaluation-harness/test-plan.md#L69)与 [EVAL-057:64](openspec/changes/dsh-memex-evaluation-harness/test-plan.md#L64)；[exact owner 要求及场景:145、172–175](openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L145-L175)未放宽 unowned 不操作边界。

**仅静态规划复核。没有运行测试、构建、OpenSpec CLI、模型、测试会话或网络操作；未访问记忆。EVAL-060/061 仍是 red 规划映射，不是执行通过证据；未宣称实现、部署或 live 验收通过。唯一写入为本报告，历史复核记录完整保留。**

## Historical round 3 RC summary

- **Round 3 verdict**：APPROVE_WITH_CHANGES；两项 Required Changes 后经独立定向复核接受，**历史 CHANGES_APPLIED: yes**。
- **RC1 — accepted by reviewer（历史，保留）**：D5 / 裁判规范落实 Host/root `llm/stream`、请求 sessionId 关联登记精确 child、`agents.get(id) === registeredChild` 与 `agents.isOwnedBy(id, registeredParent)`；检查当前冻结请求而非重新 assemble；保留每次请求复核、child execution guard。后置 assemble 注入、错误 live owner、成功 structured_output 与无关日常请求四类配对验收仍在[裁判规范:187–215][spec-judge]。
- **RC2 — accepted by reviewer（历史，保留）**：六个普通顶层首 prompt 前官方 rename、回读 user-pinned 固定非题面标题，失败不发题；默认标题 provider 共装时自检 title 辅助请求为 0、日常标题仍正常，见[固定标题规范:109–121][spec-title]。未新增默认值恢复或全局关标题操作。
- **Round 3 S1（历史建议）**：forced-failed 孤儿 job 与 interrupt accepted 但队列未清退不能冒充释放。本轮 D6 与三项新增生命周期场景已吸收主要边界；本轮 M1/M2 是新核实的正常收尾顺序/removed 歧义，不重开此前已解决的裁判、标题问题。
- **范围说明**：此前 accepted 的固定虚构来源、路径唯一、普通委派事后审计、不恢复默认值、冻结/证据/漏斗与方法延期决策继续保留。本轮不是对实施完成、部署或 live 结果的批准。

## Not checked

未运行测试、OpenSpec CLI、构建、真实模型或 live Host 验收；没有读取个人会话/记忆内容。未对现有未完成实现做整包代码评审。静态核查能确认官方接缝及以上反例，不能替代后续真实依赖 + mock adapter 测试及另行授权的 live 验收。

[proposal]: openspec/changes/dsh-memex-evaluation-harness/proposal.md#L1-L50
[design]: openspec/changes/dsh-memex-evaluation-harness/design.md#L1-L165
[design-cleanup]: openspec/changes/dsh-memex-evaluation-harness/design.md#L77-L89
[design-judge]: openspec/changes/dsh-memex-evaluation-harness/design.md#L65-L75
[spec]: openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L1-L367
[spec-cleanup]: openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L139-L175
[spec-bridge]: openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L217-L245
[spec-judge]: openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L177-L215
[spec-title]: openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-evaluation/spec.md#L109-L121
[memory-delta]: openspec/changes/dsh-memex-evaluation-harness/specs/dsh-memex-memory/spec.md#L3-L47
[progress]: openspec/changes/dsh-memex-evaluation-harness/implementation-progress.md#L5-L19
[tasks]: openspec/changes/dsh-memex-evaluation-harness/tasks.md#L1-L66
[test-plan]: openspec/changes/dsh-memex-evaluation-harness/test-plan.md#L1-L78
[manifest]: dsh.yaml#L5-L138
[scope-spec]: openspec/specs/dsh-memex-scope/spec.md#L10-L230
[memory-spec]: openspec/specs/dsh-memex-memory/spec.md#L213-L340
[pitfalls]: docs/architecture/dsh-plugin-integration-pitfalls.md#L15-L59
[resolver]: packages/dsh-memex/src/scope/resolver.ts#L85-L410
[ledger]: packages/dsh-memex/src/eval/ledger.ts#L15-L75
[jobs-events]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-jobs-local/lib/index.js#L52-L87
[jobs-list-remove]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-jobs-local/lib/index.js#L468-L516
[jobs-settlement]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-jobs-local/lib/index.js#L736-L755
[jobs-drop]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-jobs-local/lib/index.js#L762-L785
[jobs-forced]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-jobs-local/lib/index.js#L800-L823
[jobs-event-contract]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-jobs/lib/types/types.d.ts#L212-L236
[producer-contract]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-jobs/lib/types/types.d.ts#L97-L109
[job-archive]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-jobs/lib/types/archive-admission.js#L26-L41
[oneshot-settlement]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-subagent/lib/index.js#L3018-L3036
[bash-record]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js#L431-L476
[workspace-archive]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-workspace/lib/index.js#L524-L538
[agent-archive]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-agent/lib/index.js#L18-L35
[archive-gate]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/archived-session-gate.js#L17-L48
[loop-cleanup]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/compat-packages/agent-loop/lib/index.js#L825-L888
[drain]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-subagent/lib/types/continuation-activation.js#L224-L266
[drain-admission]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-subagent/lib/types/continuation-activation.js#L324-L363
[activation-finish]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-subagent/lib/types/continuation-activation.js#L488-L680
[settlement-notice]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-subagent/lib/types/continuation-activation.js#L684-L702
[connection-trust]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js#L205-L218
[connection-route]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js#L585-L695
[llm-entry]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/compat-packages/llm/lib/index.js#L2373-L2377
[request-build]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/compat-packages/agent-loop/lib/index.js#L1283-L1299
[exact-owner]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-agent/lib/index.js#L594-L606
[spawn]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js#L171-L211
[title-pin]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-session-title/lib/index.js#L295-L305
[title-auto]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-session-title/lib/index.js#L379-L386
[model-write]: packages/dsh-pet/compat/subagent/.launcher-builds/eb647bc3c166dc3e836b1049b0cebba3db6f68c9938e2810aa29223fd792c42e-b3b10b77-e228-4f7b-ad50-daede2cb9ec5/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/commands.js#L145-L168
