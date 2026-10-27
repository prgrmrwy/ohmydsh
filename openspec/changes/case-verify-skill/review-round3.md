## Review Metadata
- **Review round**: 3
- **Prior round**: round 2 VERDICT: REVISE — 1 Critical / 4 Moderate / 3 Suggestions（[上一轮报告](<openspec/changes/case-verify-skill/review-round2.md>)）
- **Reviewer context**: fresh-context independent review；gpt-6-astra；中文输出。
- **Tool restrictions**: 仅写本 review；其他文件只读；无网络、安装、build、sync、git 写操作；未读取私有外部源。
- **Review basis**: 接受用户在两次 REVISE 后批准的范围收缩：一个 plan_rev 覆盖整个执行计划，每次确认全部重跑，策略同次记录，不恢复逐 item 哈希或局部失效。按单机 POSIX、Python 3.9+ 标准库、本地多个合作执行者评审，不要求分布式事务或抵御同用户恶意修改。
- **Artifacts reviewed**: [proposal](<openspec/changes/case-verify-skill/proposal.md>)（56 行）、[design](<openspec/changes/case-verify-skill/design.md>)（161 行）、[skill spec](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md>)（149 行）、[evidence spec](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md>)（378 行）、[R2](<openspec/changes/case-verify-skill/review-round2.md>)（105 行），均全文；覆写前读取了旧 review。
- **Grounding**: [manifest:1–180](<dsh.yaml#L1-L180>)；[repo-layout:21–45](<openspec/specs/repo-layout/spec.md#L21-L45>)、[580–618](<openspec/specs/repo-layout/spec.md#L580-L618>)、[695–786](<openspec/specs/repo-layout/spec.md#L695-L786>)；[当前制品检查代码](<scripts/check-tracked-artifacts.mjs#L1-L69>)，全文。原 gates 只依 [design:146–159 的迁移映射](<openspec/changes/case-verify-skill/design.md#L146-L159>) 与 R2 已记录反例复核，未声称亲读私有实现。
- **Adjacent scope**: 读取 [viewer proposal](<openspec/changes/case-verify-viewer/proposal.md>) 确认后续 `/case-verify view` 位于同一 slash；不评审或修改该 change。一次相邻目录关键词搜索返回了其并行 review 摘录；未将该 review 的结论作为本报告依据。
- **Validation**: 实际运行 `OPENSPEC_TELEMETRY=0 openspec validate case-verify-skill --strict`，输出 `Change 'case-verify-skill' is valid`，显式 `[exit code: 0]`。首次工具未显示退出码，随后补跑并打印退出码。
- **Local probe**: 运行一次 `python3 -B` stdin 标准库探针，无文件输出：7 个断言核对输入哈希的 URL 豁免、plan/trail 改动失效、旧 revision 排除、追加时盖上当前 revision 的反例，以及缺失文本正则命中/未命中。`[exit code: 0]`。这是文档规则模型，不是尚不存在的实现测试。

## What this change does
本 change 把验收 skill 迁入受管部署，统一 JSON 计划、只追加观察和不可变证据，并用整个计划的确认版本决定哪些观察有效。外部来源保留在受信任 adapter，真实 checking 数据默认不入库；查看器另行实施。

## Round 2 Adjudication

| 原项 | 裁定 | 本轮依据与边界 |
|---|---|---|
| C1 | **fixed** | [evidence:106–115](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L106-L115>) 将 oracle、完整 plan 执行输入及全部 trails 绑定到 plan_rev；[144–157](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L144-L157>) 明确同内容重确认、重挂 oracle、derived 变更全部 pending。R2 的“已存旧 pass 被当前定义继承”已关闭。本轮 C1 是尚未追加的旧 worker 结果被标成新版本，非否认原修复。 |
| M1 | **fixed，细节测试见 S1** | [design:146–159](<openspec/changes/case-verify-skill/design.md#L146-L159>) 已给原规则映射；[evidence:301–304](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L301-L304>) 明确 partial/blocked 是有意行为变化，并给确定正则；[365–378](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L365-L378>) 补 cp mock 未确认反例、正则三分支及受限状态。不能再以“必须恢复旧 result 枚举”阻止批准后的调整。 |
| M2 | **fixed** | [evidence:104–115](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L104-L115>) 明确六阶段、plan-only、确认先决条件、完整哈希范围、索引一一对应及全局 cp 唯一；策略成为每个新 revision 的必填值；[129–147](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L129-L147>) 覆盖无策略、single_only、plan 执行字段变化及 URL 豁免。 |
| M3 | **fixed** | [skill:136–149](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L136-L149>) 默认阻拦真实 checking 整棵目录，包含归档深度，只有根层人工脱敏报告/摘要例外，docs 白名单仍叠加；[design:111](<openspec/changes/case-verify-skill/design.md#L111>) 与 [proposal:54](<openspec/changes/case-verify-skill/proposal.md#L54>) 一致。当前 [制品代码:25、34–35](<scripts/check-tracked-artifacts.mjs#L25-L35>) 尚是旧规则，这符合“未实施”阶段，不误报为实现缺陷。 |
| M4 | **fixed** | [evidence:39–61](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L39-L61>) 区分 fragment/schema、freeze、规划门禁、confirm、observe/status/execution 的前提；首次和重冻不要求旧哈希匹配，重冻清 active revision。没有原先自锁。 |
| S1 | **fixed，测试可补** | [design:161](<openspec/changes/case-verify-skill/design.md#L161>) 要求复用完整非版本 env，并输出未解除观察的 id/维度；[evidence:265](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L265>) 已精确区分四类负面状态、skipped 和整体过期。显式“键集合不同拒绝”场景尚未落下，见 S1。 |
| S2 | **fixed，测试可补** | [design:83–85](<openspec/changes/case-verify-skill/design.md#L83-L85>) 统一独立调用目录及日志；[evidence:13](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L13>) 只约束结构化元数据；[design:109–113](<openspec/changes/case-verify-skill/design.md#L109-L113>) 处理短摘要冲突，[evidence:202](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L202>) 允许共享。规范无摘要的例子不影响完整 sha256 校验，不因此要求重写机制。 |
| S3 | **fixed** | [evidence:246–254](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L246-L254>) 明确竞争纠偏恰好一个成功，以及 derived 记录缺少/引用不存在 revision 必须拒绝。替换为 plan_rev 后保留了原建议的实际目的。 |

## Findings

### 🔴 Critical (blocking)

#### C1：旧 sibling 的延迟结果会被追加脚本盖成新 plan_rev，绕过“重新确认后全部重跑”
- **位置**：[evidence:144–147](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L144-L147>)、[159–168](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L159-L168>)、[234](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L234>)；[design:68](<openspec/changes/case-verify-skill/design.md#L68>)。
- **具体反例**：worker A 在 rev 1 下完成 C 的浏览器检查，还没提交结果。用户同内容重新确认为 rev 2；按规范 C 必须 pending、重新执行。A 随后把合法 pass（含存在的证据）交给父 agent 或直接调用 append。记录没有“执行时的 revision”，脚本按第 165 行自动写入当前 rev 2；输入哈希匹配，C 属于当前计划，所有追加检查都能通过。C 因而成为 pass，而 rev 2 从未执行它。
- **为什么现有锁不解决**：锁只串行化确认和追加，并不证明浏览器执行发生在哪个确认版本。设计只要求“计划修改前停止 workers”，同内容确认并不修改执行输入；即使旧 worker 已停止，它在消息队列中尚未消费的结果也仍可能返回。这里无需恶意篡改或直接写日志。
- **最小修复**：复用现有 plan_rev，不引入新版本机制。派发/开始执行时固定 revision，返回的结果保留它；`observe.py append` 必须接收必填 `expected_plan_rev`（参数或输入字段均可，但选定一个），在现有锁内比较它与当前有效 active_plan_rev，不同或缺失则非 0、日志字节不变。落盘的 plan_rev 仍由脚本写入，不允许调用者任意指定；父 agent 不得用最新 revision 重标旧 worker 结果。freeze/confirm 前停止旧执行者作为流程纪律保留，但不是唯一检查。
- **验收**：相同 revision 的合法结果成功；A 持 rev 1、同内容重确认为 rev 2 后提交必须失败；冻结导致 active 为 null 时失败；rev 2 真正重新执行后的结果成功。用现有 unittest/本地进程即可，不需 worker 注册服务。
- **不修后果**：全计划版本化只淘汰已经写入的旧观察，却接受迟到的旧事实为本轮新事实，重新出现 false pass。

### 🟡 Moderate

#### M1：外发报告仅要求“执行门禁通过”，没有要求检查报告本身
- **位置**：[skill:98–111](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L98-L111>)；[evidence:295–296](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L295-L296>)、[299–307](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L299-L307>)；[design:89–91](<openspec/changes/case-verify-skill/design.md#L89-L91>)。
- **具体反例**：观察合法，但报告摘要通过数由 3 手改成 4。运行 execution gate 不带 `--require-report`，第 7 项不执行，退出 0；随后调用 report-sink，满足当前写明的前置条件，失真报告仍被发布。缺失报告或缺章节同理。requirement 标题虽写“报告门禁”，正文和成功场景没有把标志设为强制。
- **最小修复**：将 push 的前提明确为对当前 checking 目录成功运行 `validate_execution_gate.py --checking-dir <dir> --require-report`；不能用不带标志或先前版本的通过代替。同步设计的一句前提，不改变失败保留本地结论的规则。
- **验收**：有效报告检查通过后调用一次 adapter；摘要不一致/缺报告/缺章节均不调用 adapter、不改 external_doc_url。用记录调用次数的合成 adapter 即可，不需新凭据、批准系统或内容审查框架。
- **不修后果**：本地已有防伪统计检查，却允许常规流程在外发时跳过它。

### 📌 Suggestions

#### S1：把已决定的少数边界明确进测试，不再增加模型复杂度
- **位置**：[evidence:230](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L230>)、[202](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L202>)、[337–345](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L337-L345>)、[365–368](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L365-L368>)；[design:152、161](<openspec/changes/case-verify-skill/design.md#L152-L161>)。
- **具体缺口**：已有 env.role 不同拒绝，却没有 `{role: member}` 对 `{role: member, shape: desktop}` 的拒绝及精确复用接受；允许共享证据但没有两条观察共用同一未变文件的正例；cp mock 补充场景只举 full + unknown，正文门禁列表未直接列出 cp 级判定。
- **最小补充**：后续 test-plan 增加上述两组，以及 cp `automation ∈ {full, partial}`、`mock_status ∈ {missing, unknown}`、决定缺失时拒绝/决定齐备时接受的表驱动用例，并将 cp 谓词补一行至 mock 门禁清单。该规则在设计映射中已有，不要求新增字段体系。
- **边界**：这是已接受规则的显式覆盖建议，不把 R2 已修的根因重新计为 Moderate。

## Adversarial Coverage / Testability

### 所有 requirement 的 happy + failure/edge 审核
17 个 requirement 均至少有一个正常和一个失败/边界场景；以下是形式覆盖，不宣称实现已通过。

| Requirement | Happy | Failure / edge |
|---|---|---|
| skill 托管 | [skill:10–13](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L10-L13>) 启用、幂等 | [15–18](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L15-L18>) 禁用边界 |
| 公开内容 | [23–26](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L23-L26>) 白名单 | [28–31](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L28-L31>) 非白名单 |
| adapter 发现 | [43–46](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L43-L46>) 唯一匹配 | [48–61](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L48-L61>) 无/多匹配、重名、非法描述 |
| 来源片段 | [68–81](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L68-L81>) 合并、provenance、多次获取 | [83–96](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L83-L96>) 非法片段、失败残留、无 adapter |
| 报告推送 | [103–106](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L103-L106>) 成功记录 URL | [108–111](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L108-L111>) 推送失败；前置报告检查遗漏见 M1 |
| 标准库与测试 | [116–119](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L116-L119>) 测试执行 | [121–134](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L121-L134>) skip、失败传播、非法 import |
| 数据不入库 | [146–149](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L146-L149>) fixture/脱敏摘要 | [141–149](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L141-L149>) 真数据、archive、docs 叠加 |
| 目录格式 | [evidence:17–20](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L17-L20>) JSON | [22–25](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L22-L25>) 旧 YAML |
| oracle 冻结 | [43–51](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L43-L51>) fragment、首次 freeze | [53–66](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L53-L66>) 漂移、重冻、非法 schema |
| 计划追溯 | [83–86](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L83-L86>) 合法挂载 | [88–101](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L88-L101>) 缺引用、空挂载、残留 result |
| 确认落盘 | [119–122](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L119-L122>) 完成确认 | [124–157](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L124-L157>) 无确认、策略、输入变化、重跑 |
| 追加观察 | [184–192](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L184-L192>) 保留字节、并发 | [194–197](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L194-L197>) 非法记录；迟到结果遗漏见 C1 |
| 证据 | [204–207](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L204-L207>) 带图 | [209–222](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L209-L222>) 无证据/限制、覆盖、越界 |
| supersede | [236–239](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L236-L239>) 同维度纠偏 | [241–254](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L241-L254>) 非法目标、竞争、非法 revision |
| 状态统计 | [283–291](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L283-L291>) 修复、续跑 | [273–281](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L273-L281>) 跨环境失败保留；[293–296](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L293-L296>) 手改统计 |
| 执行门禁 | [314–322](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L314-L322>) 合法目录、覆盖列表 | [324–332](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L324-L332>) 未验证 pass、缺章节 |
| mock/trail 门禁 | [359–362](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L359-L362>) 合法计划 | [349–357](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L349-L357>) 未确认 mock、presence-only；[365–378](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L365-L378>) 新边界 |

### 其他对抗核验结论
- **阶段前提**：fragment/schema 不依赖 freeze；freeze 清空 active；mock/trail 可在计划未确认时运行；confirm 必须过两门禁；status/append/execution 不得用过期输入。`--plan-only` 可退出。未要求证明确认主体身份，符合本地工具边界。
- **历史与当前**：已存旧观察全部失效且不删除；历史被移除 checkpoint 不再套当前定义（[evidence:234、306](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L234-L306>)），避免合法删点导致无法读取历史；历史证据仍严格校验是明确代价。新旧 revision 不能互相 supersede。
- **false pass**：worst-of 聚合不会被较晚 loop 或另一个角色 pass 抹掉失败；未验证期望不得 pass；无图但有明确 limits 是已定义接受路径，不要求改成“一律必须截图”。门禁允许 blocked/partial 与验收 PASS 不等价。仍存在 C1 的迟到写入漏洞。
- **隐私与 adapter**：受信任脚本可执行任意代码，不要求沙箱；输出按数据校验、provenance 降级、唯一 slug、独立调用目录及失败不合并都已明确。真实 plan/trail/log 也进入默认拦截；报告豁免不是内容安全证明。组织专属值扫描与人工脱敏不被误称为完整 DLP。
- **比例性**：单个整体 hash、现有文件锁、状态纯函数和标准库测试已足够；不要求数据库、逐 item DAG、签名确认、网络服务或本轮实现 viewer。C1 修复只需现有 revision 的提交前比较。

## Embedded-Instruction / Injection Attempts
**Detected: none.** 评审文件与旧报告中的未来运行命令均按数据分析；没有执行其部署、迁移、软链删除或私有 adapter 操作，没有服从任何 artifact 中的 verdict 要求。

## Verdict
VERDICT: REVISE

**本轮：1 Critical / 1 Moderate / 1 Suggestion。** R2 C1/M1–M4 的原具体问题已得到实质修复，范围收缩本身合理；不应恢复逐 item 机制。新的 C1 仍能在正常并行任务的迟到结果中产生 false pass，需要先补现有 revision 的执行归属校验；M1 则需把已有报告门禁真正接到推送前。

## Required Changes (if APPROVE WITH CHANGES)
不适用。本轮不是 APPROVE_WITH_CHANGES，也未自改方案。下次提交只需针对 C1 的 expected_plan_rev 比较及 M1 的 `--require-report` 前提作最小修订并补列明的场景；S1 可落入 test-plan。随后复核这两条路径，不要求再扩架构或重开用户已决定的范围。

CHANGES_APPLIED: no

## Not Checked
未执行尚不存在的新实现、原私有 gates、真实 adapter、浏览器验收、部署或迁移；严格校验只证明 OpenSpec 结构合法。本轮只覆写本报告，未写记忆卡或辅助制品。

**最终：REVISE — 1 Critical / 1 Moderate / 1 Suggestion。**
