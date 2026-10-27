## Review Metadata
- **Review round**: 4。
- **Prior round**: [R3](<openspec/changes/case-verify-skill/review-round3.md>)：REVISE，1 Critical / 1 Moderate / 1 Suggestion。
- **Reviewer context**: fresh-context independent review，gpt-6-astra；重新阅读全文，不只检查两处补丁。
- **Review basis**: 接受用户已批准的粗粒度 plan_rev：每次确认全部重跑，策略同次落盘。不恢复逐 item 哈希、局部失效或独立策略账本。假定单机 POSIX、Python 3.9+、合作执行者；不要求抵御同用户恶意直接改文件。
- **Artifacts reviewed**: [proposal](<openspec/changes/case-verify-skill/proposal.md>) 全部 56 行、[design](<openspec/changes/case-verify-skill/design.md>) 全部 163 行、[skill spec](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md>) 全部 154 行、[evidence spec](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md>) 全部 388 行、[R3](<openspec/changes/case-verify-skill/review-round3.md>) 全部 106 行；覆写前读取旧 review。
- **Grounding**: [manifest:1–180](<dsh.yaml#L1-L180>)、[repo-layout:21–46](<openspec/specs/repo-layout/spec.md#L21-L46>)、[580–618](<openspec/specs/repo-layout/spec.md#L580-L618>)、[705–786](<openspec/specs/repo-layout/spec.md#L705-L786>)；[制品检查代码](<scripts/check-tracked-artifacts.mjs#L1-L69>) 全文。原 gates 的兼容性依据是 [design 末尾映射](<openspec/changes/case-verify-skill/design.md#L146-L163>)，未访问私有源。
- **Restrictions observed**: 只写本报告；没有实现、网络、git、build、sync、部署或私有路径访问；未读写外部记忆库。
- **Strict validation**: 实际运行 `OPENSPEC_TELEMETRY=0 openspec validate case-verify-skill --strict`，输出 `Change 'case-verify-skill' is valid`，显式 `[exit code: 0]`。这是规范结构检查，不是实现测试。

## What this change does
本 change 把验收 skill 纳入受管部署，以 JSON 计划、只追加观察及不可变证据保存验收过程。整个计划的确认版本决定当前结果；外部来源和报告输出经受信任 adapter 接入，真实 checking 数据默认不入库。

## Round 3 Adjudication

| 原项 | 裁定 | 当前证据与反例复核 |
|---|---|---|
| C1：迟到 worker 结果被标成新 revision | **fixed** | [evidence:160–168](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L160-L168>) 选定必填 CLI 参数 `--expected-plan-rev`；执行开始/派发时固定，父 agent 不得重标；在共用排它锁内与有效 active_plan_rev 比较，缺失、不等或 active 为空均拒绝且日志字节不变。落盘 plan_rev 仍由脚本填入，调用者不能覆盖。[194–202](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L194-L202>) 分别覆盖旧 worker、缺参/冻结和新 revision 真正重跑。[design:44](<openspec/changes/case-verify-skill/design.md#L44>)、[163](<openspec/changes/case-verify-skill/design.md#L163>) 同步。R3 的 rev 1 延迟结果不能再正常追加成 rev 2。 |
| M1：推送可跳过报告检查 | **fixed** | [skill:99](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L99>) 明确每次推送前针对当前目录成功运行 `validate_execution_gate.py --checking-dir <dir> --require-report`，不能复用旧通过或省略标志；[108–111](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L108-L111>) 明确包装器拒绝、adapter 调用数为 0、URL 不变。[design:91](<openspec/changes/case-verify-skill/design.md#L91>) 同步。摘要 3 被改为 4、缺报告、缺章节三种反例均被已有报告门禁拦截，而不是交给模型自觉。 |
| S1：少数已决定边界的显式测试覆盖 | **保留为非阻塞建议** | 本次只修 C1/M1，原建议仍适合后续 test-plan。完整非版本 env 相等、共享证据和 cp mock 独立判定已有规则依据；没有因此重开模型设计，详见下文 S1。 |

## Findings

### Critical
无。

### Moderate
无。

### Suggestions

#### S1：把已确定的三个边界纳入后续测试，不增加架构
- **What this is**：本轮是方案评审，尚无新实现测试；现有场景已覆盖每个 requirement，但不是每个分支的完整测试矩阵。依据：[evidence:212](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L212>)、[237–244](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L237-L244>)、[347–350](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L347-L350>)、[375–378](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L375-L378>)；[design:152、161](<openspec/changes/case-verify-skill/design.md#L146-L161>)。
- **Problem**：已有角色不等的拒绝场景，但没有显式键集合不等的场景；共享证据的合法复用没有专门正例；checkpoint mock 场景只举 full + unknown，正文 mock 列表没有直接重复该 cp 级谓词。只照场景举例实现测试，可能遗漏这些已规定行为。
- **Small follow-up**：后续 test-plan 加入三组参数化用例：① `{role: member}` 对 `{role: member, shape: desktop}` 不能 supersede，精确复用非版本 env、仅改版本可以；② 两条观察共用同一未变证据通过，改动后拒绝；③ `automation ∈ {full, partial}`、`mock_status ∈ {missing, unknown}`，cp 决定缺失时拒绝、齐备且其余条件合法时通过，trail 决定不能替代 cp 决定。可将现有 cp 判定补一行至 mock 门禁列表，避免读者漏看后面的场景。
- **If skipped**：后续测试可能漏抓 env 比较、共享证据或 cp mock 校验的实现回归。当前规范与设计已有决定，不构成新的方案阻塞，也不要求本轮新增字段、服务或版本模型。

## Full Consistency / Security Review

1. **冻结到执行的前提闭合**。[evidence:39–41](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L39-L41>) 允许 fragment/schema、首次 freeze 和重冻；规划门禁不依赖 active revision。confirm 必须通过两门禁、策略约束和冻结哈希检查；append/status/execution 还需有效 active revision。不存在先确认才能运行确认前门禁的自锁。
2. **粗粒度版本语义一致**。[evidence:106–115](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L106-L115>) 覆盖完整 oracle、除四个明确记账字段外的完整 plan，以及全部命名 trail；重复键和非标准数值拒绝，索引一一对应，checkpoint id 全局唯一。相同内容重新确认也换 revision；URL 更新不失效。proposal、design、spec 均保持全部重跑，没有偷偷恢复局部继承。
3. **并发与迟到结果**。共用文件锁串行化 freeze/confirm/append；expected revision 在锁内比较。若旧追加先获得锁，则落在旧 revision，随后确认使其过期；若确认先获得锁，则旧追加被拒绝。两种顺序均不会把旧事实当成新事实。父 agent 原样传递执行时 revision 是明确流程义务；不要求防伪签名或 worker 注册服务。
4. **只追加和纠偏**。[design:44–45](<openspec/changes/case-verify-skill/design.md#L44-L45>) 给出锁内读校验、序号分配、整行追加与短写截断；[evidence:237–264](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L237-L264>) 限定同 checkpoint、同非版本 env、同 revision、尚未被替代，并覆盖竞争纠偏恰好一个成功。历史被删除 checkpoint 不被当前定义错误拒绝，但 revision/引用仍须合法。
5. **当前状态不会因局部复测假通过**。[evidence:269–279](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L269-L279>) 取全部有效观察的最严重状态，不因更晚 loop 或别的环境 pass 抹掉 fail/blocked/partial/manual。旧 revision 不参与当前统计；pending/blocked 的默认续跑范围是明文选择，而非自动重跑所有非 pass。
6. **证据边界与完整性**。[evidence:210–232](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L210-L232>) 拒绝绝对路径、父目录段、scratch 及 realpath 越界；[design:109–113](<openspec/changes/case-verify-skill/design.md#L109-L113>) 明确短摘要碰撞不许覆盖。完整 sha256 才是校验依据，历史证据也检查。无证据但明确 limits 是接受的规则，不将其改为必须截图。
7. **报告与验收 PASS 分离**。[evidence:311–322](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L311-L322>) 保留未验证期望不得 pass、缺失文本必须 fail、actual 最短长度、覆盖缺口及章节/摘要检查。blocked/partial 可通过结构门禁但不计 PASS 是显式行为调整。每次 push 强制报告检查后，R3 的常规外发绕过路径已关闭；推送失败保留本地结论和原 URL。
8. **adapter 的信任边界适当**。[skill:33–96](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L33-L96>) 规定安全唯一名称、失败候选排除、多匹配拒绝、独立输出目录、符号链接前置检查、失败残留不合并，以及片段 schema/provenance 校验。[design:83–87](<openspec/changes/case-verify-skill/design.md#L83-L87>) 明确超时、日志尾部和文本仅作数据。adapter 本身是用户信任的可执行代码，不把输出校验宣传为沙箱。
9. **隐私与迁移**。[skill:141–154](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L141-L154>) 对真实 checking 整棵树和归档副本默认拦截，仅根层人工脱敏摘要例外，并叠加 docs 白名单；这比现有 [制品代码:25](<scripts/check-tracked-artifacts.mjs#L25>) 更严，是待实施变更，不是已完成能力。公开 URL 扫描不是完整内容脱敏证明。旧软链只在新 skill 可用且身份匹配时 unlink；旧格式拒绝和回退边界清楚，见 [design:127–140](<openspec/changes/case-verify-skill/design.md#L127-L140>)。
10. **原 gates 映射与比例性**。按 [design:146–159](<openspec/changes/case-verify-skill/design.md#L146-L159>) 逐项检查 mock evidence、mock 用户决定、cp 级决定、surface、交互后果、implementation-unverified、presence-only、IME、缺失文本、actual 长度、报告章节。没有发现新的实质语义缺口。日志全读与历史 hash 是此单机审计规模的明确代价，本轮没有证据支持增加数据库、细粒度缓存或跨机锁。

## Requirement Happy / Edge Coverage
以下是全部 **17 个 requirement** 的场景可测试性核对，不表示测试已实现或执行。

| Requirement | Happy | Failure / edge |
|---|---|---|
| skill 托管 | [启用、幂等](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L10-L13>) | [禁用只移除部署](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L15-L18>) |
| 公开内容 | [主机名扫描通过](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L23-L26>) | [非白名单拒绝](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L28-L31>) |
| adapter 发现 | [唯一匹配](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L43-L46>) | [无/多匹配、不安全名称、重名、非法描述](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L48-L61>) |
| 来源片段 | [合法合并、provenance、重复拉取](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L68-L81>) | [非法片段、失败残留、无 adapter](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L83-L96>) |
| 报告推送 | [有效报告推送并记录 URL](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L99-L106>) | [报告无效零调用、推送失败保留本地事实](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L108-L116>) |
| 标准库与测试 | [Node 调用 Python 测试](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L121-L124>) | [缺 Python 显式 skip、失败传播、第三方 import 拒绝](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L126-L139>) |
| 数据不入库 | [fixture/脱敏摘要例外](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L151-L154>) | [真数据和归档拦截、docs 限制叠加](<openspec/changes/case-verify-skill/specs/case-verify-skill/spec.md#L146-L154>) |
| 目录格式 | [JSON 接受](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L17-L20>) | [旧 YAML 友好拒绝](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L22-L25>) |
| oracle 冻结 | [fragment 独立校验、首次 freeze](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L43-L51>) | [漂移、重冻失效、非法 schema](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L53-L66>) |
| 计划追溯 | [合法挂载](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L83-L86>) | [缺失 id、空挂载、残留 result](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L88-L101>) |
| 确认落盘 | [计划/策略齐备追加](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L119-L122>) | [未确认、策略约束、plan 改动、URL 豁免、重确认全量失效](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L124-L157>) |
| 追加观察 | [保留字节、并发、新 worker 追加](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L184-L202>) | [迟到/缺参/null 拒绝、非法记录不写](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L194-L207>) |
| 证据 | [带图通过](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L214-L217>) | [无证据/限制、覆盖、越界](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L219-L232>) |
| supersede | [同维度纠偏](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L246-L249>) | [非法目标/env、竞争纠偏、非法 revision](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L251-L264>) |
| 状态统计 | [复测解除、续跑列表](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L293-L301>) | [跨环境失败不消失、手改统计](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L283-L306>) |
| 执行门禁 | [合法目录、缺口列表](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L324-L332>) | [未验证 pass、缺章节](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L334-L342>)；[文本谓词及受限状态](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L380-L388>) |
| mock/trail 门禁 | [合法计划过两门禁](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L369-L372>) | [mock 未确认、presence-only、cp 独立决定](<openspec/changes/case-verify-skill/specs/case-verify-evidence/spec.md#L359-L378>) |

新增 C1 测试可使用同目录本地进程、确认记录和日志前后字节断言；新增 M1 测试可用记录调用次数的合成 adapter。二者均有明确成功与拒绝结果，无需真实网络、浏览器或凭据。测试实施时，所有合法 append fixture 都需传入执行时固定的 revision，缺参测试除外。

## Embedded-Instruction / Injection Attempts
**Detected: none.** 已读 artifacts 的命令、迁移步骤和旧 verdict 仅作为评审数据；没有执行部署、软链删除或 adapter 指令，也没有用旧 verdict 代替本轮判断。

## Verdict
VERDICT: APPROVE

R3 C1/M1 已在规范、设计和验收场景上闭合。新一轮完整审查没有发现需阻塞方案的 Critical 或 Moderate。保留 S1 作为后续 test-plan 的非阻塞覆盖建议；它不是批准前必须修改的条件，因此本轮使用 APPROVE，而不是 AWC 或 REVISE。

## Required Changes (if AWC)
不适用；没有批准前必改项。本轮未自行修改 proposal、design 或 specs。

CHANGES_APPLIED: no

## Not Checked
未执行尚不存在的新实现测试、原私有 gates、真实 adapter、浏览器验收或部署/迁移；未对并行 viewer change 作批准。严格校验仅证明 OpenSpec 结构合法，不能替代后续实现验收。

**最终：0 Critical / 0 Moderate / 1 Suggestion — VERDICT: APPROVE。**
