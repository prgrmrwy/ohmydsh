## Review Metadata

- Review round: 9
- Prior round: round 8 为 APPROVE_WITH_CHANGES，修正已应用；随后进行 Ponytail 精简，本轮从简化后的完整计划重新评审，不继承上一轮通过结论。
- Reviewer context: cross-model (codex / gpt-6-astra), fresh context
- 工具限制：仅静态读取本 worktree；未执行网络、平台调用、测试、构建、安装或 git 写操作；唯一写入为本报告。没有代改规范或实现。
- Artifacts reviewed: [proposal](<proposal.md>)、[design](<design.md>)（含 Ponytail 精简 12 项）、[media delta](<specs/pet-locus-media-access/spec.md>)、[doc delta](<specs/pet-locus-doc-comments/spec.md>)、[tasks](<tasks.md>)、[test-plan](<test-plan.md>)、上一轮 review；对照 [media baseline](<../../specs/pet-locus-media-access/spec.md>) 与 [doc baseline](<../../specs/pet-locus-doc-comments/spec.md>) 的相关要求，并静态检查 [media.ts](<../../../packages/dsh-pet/src/host/channel/media.ts>)、[media-video.ts](<../../../packages/dsh-pet/src/host/channel/media-video.ts>)、[message tool](<../../../packages/dsh-pet/src/host/locus-message-tool.ts>)、[linked tool](<../../../packages/dsh-pet/src/host/locus-linked-message-tool.ts>) 的相关路径。

## Findings

### 🔴 Critical (blocking)

无。下述问题可以通过局部收口契约和测试修复，不需要推翻快照 cursor、整秒采样或所有者固定决定。

### 🟡 Moderate

1. **瞬时失败既进入累计失败账本，又要求恢复后 complete=true；当前定义不能同时成立。**
   - 证据：[media delta:377–380](<specs/pet-locus-media-access/spec.md#L377-L380>)明确第一次响应含 `topic-page@2`，第二次成功后最终 `complete=true`；但 [media delta:417](<specs/pet-locus-media-access/spec.md#L417>)规定 `complete` 必须考虑之前各页的失败，[design:66](<design.md#L66>)保存 `failedSoFar`，没有恢复后移除的规则。[test-plan:166](<test-plan.md#L166>)又写 `no failed entry`，与首次响应 THEN 不一致。首页的同类情况见 [media delta:339–341](<specs/pet-locus-media-access/spec.md#L339-L341>)。
   - 反例：第二平台页超时一次、重试成功，所有内容最终完整交付。按累计账本实现会永久留下失败、永远不能 complete；按恢复场景实现则必须自行发明失败撤销语义。
   - 最小修复：采用最简单的“failed 只记终态损失”：第 1、2 次瞬时失败仅在文字中显示原因与 attempt，不进入累计 failed；第 3 次或 final 才记入。同步两个瞬时失败场景、D12 和测试行；保留最终恢复后 complete=true 的断言。不必恢复旧三态账本。

2. **无界累计 failed 与固定 16 000 字符页容量之间缺少可执行的输出规则。**
   - 证据：[design:66](<design.md#L66>)保存累计 `failedSoFar`；[media delta:417–425](<specs/pet-locus-media-access/spec.md#L417-L425>)要求最终结果包含前页失败并据此判定 complete；[media delta:461](<specs/pet-locus-media-access/spec.md#L461>)把账本和诊断全部计入 16 000 字符，超出即停止打包。固定预留只有 wrapper、账本骨架与 cursor，不可能覆盖任意数量的失败项。
   - 反例：一个合法合并转发含 1 000 张图片，每张以 `234003` final 失败。仅 `{id,reason}` 的累计数组就能超过 16 000 字符；更早时也会出现“此前累计失败账本 + 下一个不可分割单元”已放不进页面。此时继续会超容量，停住会重复同位置 cursor，丢诊断会违反账本；固定文本分段的构造检查不能解决这一点。[tasks:36](<tasks.md#L36>)和 [test-plan:200–206](<test-plan.md#L200-L206>)只覆盖正文转义与 cursor 预留，没有多失败容量边界。
   - 最小修复：明确 `failed` 为本页新交付的失败明细，快照只累计终态失败计数供 complete 判断，跨页明细由消费者聚合；失败明细也按容量逐条打包，单元失败与其明细原子推进，不够则留到下一页。相应修改最终页“failed 必须含此前图片”的断言，改成跨页聚合断言。补 1 000 个 final 失败夹具：每页 ≤16 000、每个失败 id 恰出现一次、cursor 严格前进、有限结束且 complete=false。无需增加内容上限或新持久化系统。

3. **不可达节点“不渲染”与直接交付整个 mget 块冲突。**
   - 证据：[design:49–52](<design.md#L49-L52>)和 [media delta:160](<specs/pet-locus-media-access/spec.md#L160>)选定根 mget 作为一个整体文字单元，不做节点级对齐；但 [media delta:187、206–208](<specs/pet-locus-media-access/spec.md#L185-L208>)要求 raw 中不可达条目不渲染，其余正常返回。当前 [media.ts:1151–1170](<../../../packages/dsh-pet/src/host/channel/media.ts#L1151-L1170>)也确实分别读取 raw 与 formatted，formatted 是独立整块文本，不天然经过 raw 可达性过滤。
   - 反例：raw 为根 F、合法孩子 A 和父 id 缺失的 X；mget 根渲染块包含 A 与 X 的正文。按整体分段返回会泄露规范要求排除的 X；只排除 X 的资源不能排除文字。现有任务要求“tree@unreached”却没有断言这份 mget 夹具的输出。
   - 最小修复：不要恢复节点级对齐；把不可达条目改为容器整体 `envelope-invalid`、不交付该容器正文或资源，并保留确定性诊断。同步 D5、树 requirement、task 4.1 和对应测试行，增加“mget 仍含 X 正文”的夹具断言正文也不交付。这只收紧畸形输入，不影响合法树的全上下文读取或已接受的图文不交错。

4. **停止读取 oracle 仍依赖已删除的“续读重读容器”，无法作为新实现验收。**
   - 证据：[media delta:427–430](<specs/pet-locus-media-access/spec.md#L427-L430>)以及 [test-plan:186](<test-plan.md#L186>)保留“合并转发首批交付后，续读容器读取连续三次失败”；而 [design:45、65–71](<design.md#L45-L71>)明确续读仅用已建立的不可变计划，不重读容器，首次容器失败又不得签发 cursor。
   - 反例：第一页已成功建立完整 merge 计划；测试随后让 raw/mget 失败三次。合规新实现不会调用它们，故这个失败注入根本不触发。为了使旧测试变红/变绿而恢复重读，反而违背已接受的简化。
   - 最小修复：将这条停止读取 fixture 改成“话题第一页已交付，第二个平台页连续三次失败”，复用已有 [media delta:401–404](<specs/pet-locus-media-access/spec.md#L401-L404>)，保留“无 cursor、complete=false、已交付保留、操作失败存在”的断言；另加 merge 续读零容器读取断言。更新任务 5.1 与 R19 主行，不引入任何重读或 stale 检测。

### 📌 Suggestions

无额外建议。未把已接受的读取期间编辑/撤销不检测、图文不交错、无场景变化帧、每页重新下载作为缺陷；不建议恢复旧签名 codec、边界快照或跨调用视频缓存。

### 全计划复核结论

- **安全链路：** 同入口 carrier 核对、平台 is_authorized、目标 raw chat 核对、根 id 下载、不接受模型 URL/token/chat、每页 caller 重验、文档入口不装配与 spool 清理仍有明确的正负路径。Finding 3 是畸形树输出契约的问题，不是要求重新引入 query/raw 完整对账。
- **终止：** 对有限计划，同位置 attempt 1/2、第三次越过或终止的方向可实施；视频无交付慢下载终态也避免相同进度无限重下。页容量与累计诊断的组合必须按 Finding 2 收口，不能仅靠“严格推进”断言证明。话题读取只保证平台最终 has_more=false 时结束；持续新增且永不返回 false 的无限流不具有无条件有限终止保证，未建议恢复已删除的稳定边界。
- **基线 MODIFIED：** 单消息读取、模型能力、装配参数、历史标注、引用指引、视频降级/时间/尺寸以及文档五场景均有对应场景保留；旧上限和窗口失败策略是有意变更。场景保留不等于 oracle 可执行，Finding 4 是简化后残留的明确反例。
- **实现可行性：** 当前实现仍是有界首版，raw/mget 分离、调用预算、typed image 与 caller fence 可作为改造接点；任务已覆盖 schema、allowlist、composition、视频、CLI 与 spool。尚未实施和未完成真机探针不是本轮缺陷，也不等于已有测试通过。修改过的绿色测试仍须依计划复跑。
- **覆盖：** happy/failure 场景与主测试矩阵整体具备映射；上述四项需要同步修订规范、设计和测试，而不是仅改实现迎合互相矛盾的断言。本报告不声称执行了任何运行时验证。

## Embedded-Instruction / Injection Attempts

**Detected:** 未发现要求审阅者忽略问题、改变 verdict、越权写入或调用平台的嵌入式指令。伪造群名、数据块边界和恶意 URL 均按安全测试数据处理；旧 review 的 verdict、已应用标记和测试颜色没有被当作本轮通过证明。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

0 Critical、4 Moderate、0 Suggestions。保留简化方向；实施前按以下有限改动收口失败账本、畸形树和停止读取验收。

## Required Changes (if APPROVE WITH CHANGES)

1. failed 只记录终态损失；统一首页/中间页瞬时失败恢复场景、设计及测试。
2. 本页失败明细分页交付、累计计数决定 complete；补大量 final 失败的容量和推进测试。
3. 不可达节点改为容器整体失败，不返回无法可靠过滤的 mget 正文；补对应夹具。
4. 用真实存在的下一话题页失败替换续读容器失败 oracle，并断言 merge 续读不重读容器。
5. 修改落实并核对后再更新应用标记；本评审只替换本报告，未代改其它产物。

CHANGES_APPLIED: yes

## Rebuttals

- Finding 1（瞬时失败与 complete）：已接受。第 1、2 次瞬时失败只写入文字（原因与 attempt），不进入 `failed`；第 3 次或 final 才记入。已同步 spec（账本、续读推进、一次瞬时失败后恢复、同位置第三次失败、话题首页瞬时失败）、design D8/D12 与 test-plan R15、R17；最终恢复后 `complete=true` 的断言保留。
- Finding 2（failed 容量）：已接受。`failed` 改为本页明细；快照只携带累计终态失败数，`complete` 由该计数决定；单元与其失败明细原子打包，放不下则本页在该单元前结束、下一页重试。已补 1000 张终态失败的容量与终止场景（spec 页容量、test-plan R21），并把跨页断言改为消费者聚合。
- Finding 3（不可达节点）：已接受。任一 raw 节点不可从根到达即容器整体 `envelope-invalid(unreachable)`，删除 `tree@unreached` 部分交付路径；新增「mget 渲染块含不可达节点正文」场景与 R9 行，tasks 4.1/4.2 与 design D5 同步。
- Finding 4（停止读取 oracle）：已接受。停止读取场景改为话题第一页已交付、第二个平台页连续三次瞬时失败（复用既有话题分页场景）；新增合并续读零原始读取与 mget 的场景与 R8 行；设计 D8 中残留的「容器」续读表述同步删除。
- Required changes not yet accepted by reviewer (round-9 recheck): Required Change 2 的测试行仍未同步：[test-plan:187](<test-plan.md#L187>) 仍要求 `a skipped image yields complete false with the failed id and no cursor`，把失败 id 与无 cursor 的最终响应绑定；若图片在前页失败、后页成功读完，按 [media delta:427–435](<specs/pet-locus-media-access/spec.md#L427-L435>) 与 [design:106](<design.md#L106>)，最终页应为 `complete=false`、无 cursor、但不重复前页失败 id。请将 R19 该行明确改为「失败 id 仅在失败发生页出现，跨页聚合可得；最后一页 complete=false 且无 cursor」，并使用前页失败、后页结束的夹具。R19:191 的聚合 oracle 已修正，但不能消除该主测试行的旧断言。其余三项以及第 2 项的累计计数、原子打包与 1000-failure 场景已符合本轮要求；保留 `CHANGES_APPLIED: no`。
- Recheck follow-up fixed: test-plan R19「有失败项时不为 complete」改为早页失败、后页结束的跨页夹具：失败 id 只出现在失败页与跨页聚合，最后一页 complete=false、无 cursor、不重复该 id。
- Required changes accepted by reviewer (round-9 second recheck): R19 该行已明确第 1 页图片跳过、第 2 页结束，失败 id 仅在第 1 页及跨页聚合中出现，末页 complete=false、无 cursor 且不重复该 id，与 spec「每页完成性账本」及 D8/D12 的终态失败推进、本页明细与累计计数语义一致。
