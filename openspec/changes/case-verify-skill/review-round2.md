## Review Metadata
- **Review round**: 2
- **Prior round**: round 1 VERDICT: REVISE — 2 Critical / 5 Moderate / 2 Suggestions (review-round1.md)
- **Reviewer context**: cross-model (codex gpt-6.1-sol), fresh context
- **Tool restrictions**: read-only except review.md
- **Artifacts reviewed**:
  - [proposal.md](<proposal.md>)：56 行，全文。
  - [design.md](<design.md>)：143 行，全文。
  - [case-verify-skill/spec.md](<specs/case-verify-skill/spec.md>)：151 行，全文。
  - [case-verify-evidence/spec.md](<specs/case-verify-evidence/spec.md>)：339 行，全文。
  - [review-round1.md](<review-round1.md>)：110 行，含全部作者回应，全文。
  - 上下文：[viewer proposal](<../case-verify-viewer/proposal.md>)：46 行，全文；不评审查看器实现。
  - 仓库边界：[制品检查脚本](<../../../scripts/check-tracked-artifacts.mjs>)：69 行，全文；[repo-layout spec](<../../specs/repo-layout/spec.md#L695-L739>)：786 行，读取 695–739；[manifest](<../../../dsh.yaml#L1-L90>)：421 行，读取 1–90。
  - 原 gate 只按本次用户提供的完整摘录核对；未读取 worktree 外的原 skill、记忆库或其他文件。未运行原 Python 测试，不声称核验了其实现。
  - 实际运行：`OPENSPEC_TELEMETRY=0 openspec validate case-verify-skill --strict`，通过，显式记录 `[exit code: 0]`。此结果只证明 OpenSpec 结构合法。没有安装、网络、build、sync 或 git 写操作；本次只覆写本报告。

## Round 1 Adjudication

| 原项 | 裁定 | 当前依据与边界 |
|---|---|---|
| C1 | **fixed** | [evidence:39–44](<specs/case-verify-evidence/spec.md#L39-L44>) 保存逐 item 哈希，[139](<specs/case-verify-evidence/spec.md#L139>) 由脚本写 `oracle_rev`，[207–231](<specs/case-verify-evidence/spec.md#L207-L231>) 使改动 item 的旧观察过期，并测试未改 item 继续有效。原“修改同一 O-1 后重冻仍通过”反例已被堵住。新 C1 是修改 checkpoint 定义的另一条路径，不能把原修复等同于没有作用。 |
| C2 | **fixed** | [evidence:198–205](<specs/case-verify-evidence/spec.md#L198-L205>) 明确同 checkpoint、同执行维度、只替代一次；[238–263](<specs/case-verify-evidence/spec.md#L238-L263>) 跨全部有效观察聚合，测试另一环境失败不会消失，以及同维度修复后 pass。采用标准库即可实现，不需要整轮完成协议。键集合变化的使用边界见 S1。 |
| M1 | **fixed** | [skill:37–41](<specs/case-verify-skill/spec.md#L37-L41>) 限制 slug、全局重名全部排除；[64](<specs/case-verify-skill/spec.md#L64>) 要求独立调用目录、路径边界及拒绝已有软链；[78–81](<specs/case-verify-skill/spec.md#L78-L81>) 测试多次拉取保留。设计遗留旧路径见 S2，不否定规范中的修复。 |
| M2 | **partially fixed** | [skill:136–151](<specs/case-verify-skill/spec.md#L136-L151>) 不再按 JSON 轻量而无条件允许入库，oracle/observations 和三类目录已有拦截测试。但计划、trail、adapter 日志仍承载原文且不受默认拦截；[design:112](<design.md#L112>) 还明确允许计划入库，与“只能脱敏报告/摘要”不一致。见 M3。 |
| M3 | **fixed** | [evidence:140、152、174–191](<specs/case-verify-evidence/spec.md#L140-L191>) 由追加脚本计算哈希、禁止覆盖、执行门禁重算并定位旧观察；[design:106](<design.md#L106>) 使用带摘要文件名。足以发现原先“旧记录悄悄换图”，不需要证据数据库；文件名和共享证据场景的小缺口见 S2。 |
| M4 | **partially fixed** | [evidence:101–131](<specs/case-verify-evidence/spec.md#L101-L131>) 已将确认记录及追加前检查写为可验收契约，而不只是 proposal 的承诺。但重确认后策略的生命周期、计划覆盖范围仍有漏洞（M2），原 gate 对照也不完整（M1）；五阶段仍未逐一命名或定义转换边界。 |
| M5 | **fixed** | [skill:68–91](<specs/case-verify-skill/spec.md#L68-L91>) 已拆分 provenance 与 fetch 失败，THEN 不再要求未产出 item 的进程错误给出字段索引；[113–134](<specs/case-verify-skill/spec.md#L113-L134>) 有 Python skip、失败传播和非法 import 边界。当前全部 17 个 requirement 均至少有一个正常和一个失败/边界场景；不是每个子规则都已有针对性场景。 |
| S1 | **partially fixed** | [design:44–45](<design.md#L44-L45>) 与 [evidence:142、163–166](<specs/case-verify-evidence/spec.md#L142-L166>) 已把读、校验、分配、写置于同锁内，包含失败回退及普通并发测试。仍缺竞争同一 supersede 目标“恰好一个成功”的明确场景，见 S3。 |
| S2 | **fixed** | [design:132–137](<design.md#L132-L137>) 明确三条件、仅 unlink 链接、普通目录/意外目标/悬空均保留并报告。不要求本轮操作真实链接。 |

## Findings

### 🔴 Critical (blocking)

#### C1：重新确认计划不使旧观察绑定旧 checkpoint，新定义仍能继承旧 pass
- **位置**：[evidence:106–114](<specs/case-verify-evidence/spec.md#L106-L114>)、[139–154](<specs/case-verify-evidence/spec.md#L139-L154>)、[207–211](<specs/case-verify-evidence/spec.md#L207-L211>)、[236–240](<specs/case-verify-evidence/spec.md#L236-L240>)。
- **可复现反例**：rev 1 已包含 O-1、O-2。C 挂 O-1，执行并得到 pass；用户把同一个 C 的 `oracle_ids` 改为 O-2，并重新确认计划。oracle 没变，最新 rev 仍是 1。过期规则使用 **当前 C 的** `oracle_ids` 比较观察 rev 与最新 rev：O-2 在两者中当然相同，于是旧 pass 仍有效，未执行的 O-2 被计为通过。更简单的例子是 `origin: derived`、空 `oracle_ids` 的 C 改了 verify/expected 后重确认：没有任何 item 可使观察过期。
- **影响**：不需要伪造日志或绕过脚本；正常修改计划、重新确认就能产生新验收内容的 false pass。`confirm.py` 只拦新追加，不撤销旧观察，因此不能修复该问题。
- **最小修复**：观察追加时保存 checkpoint 执行定义的 fingerprint（至少包括 `origin`、`oracle_ids`、断言/期望、相关 step/输入及影响执行的 mock/数据态配置），当前定义不同则旧观察不再参与当前状态。也可采用较粗的已确认 trails 哈希，使修改计划后旧观察全部过期，代价只是多重跑；选定一种即可，不要求精细依赖图。保留原记录。新增“计划不变仍通过”“重挂已有 oracle 后 pending”“derived 断言变化后 pending”场景，并统一 status、continue、报告、执行门禁。

### 🟡 Moderate

#### M1：所谓“原规则全部保留”尚未成立，原 gate 的执行资格与判定规则有遗漏/弱化
- **位置**：[proposal:28](<proposal.md#L28>)、[evidence:275–284](<specs/case-verify-evidence/spec.md#L275-L284>)、[311–339](<specs/case-verify-evidence/spec.md#L311-L339>)。
- 用户给出的原 mock gate 还包括 **checkpoint 级 missing/unknown mock 未确认时禁止 automation**；新列表只覆盖 trail 级 `mock_setup.user_decision`、available evidence、surface，没有 cp 级规则。trail 有决定不等于每个依赖该缺口的 cp 已确认可自动化。
- 原 execution gate 对 full/partial 要求 `result ∈ {pass, fail, manual, skipped}`；新第 1 条只要求“不是 pending”，因此 `partial`、`blocked` 也能通过该检查。这可能是删除 result 后有意的语义调整，但目前既声称全部保留，又没有给出明确映射/变更说明。
- 原 `result_detail` 的字符串匹配规则被第 3 条改成“actual 表明……”的自然语言，没有可机械实现的识别条件。用户给出的匹配集合（含 `surface rendered`、`已渲染` 及目标 surface 不存在等）无法从新文本精确恢复。
- **修复**：补回 cp 级 mock 未确认禁自动化的字段及检查，增加 trail 决定齐备而 cp 仍未确认的反例；明确新观察状态到旧执行完成条件的映射，若刻意接受 blocked/partial 就显式列为行为变更；将缺失文本检查写为确定的匹配谓词，并覆盖命中、未命中、命中且 fail 三种输入。无需恢复被用户批准删除的字段或旧格式。至少补一张逐规则→新规则/测试的短映射，不能只靠原四个用例证明规则完整。

#### M2：确认记录未完整绑定被确认的计划，重确认不会使旧执行策略失效
- **位置**：[evidence:106–114](<specs/case-verify-evidence/spec.md#L106-L114>)、[design:57–59](<design.md#L57-L59>)。
- `confirmations.plan` 只哈希 trails 文件，不涵盖 `plan.json` 中阶段 3 才补的 trails 索引及其他影响执行的计划配置；仅改这些内容时，追加前检查仍认为计划未变。
- `strategy` 只有 `{selected, at}`，校验仅看“存在”。用户原来选了 swarm；后来 trail 的冲突/并行关系变了，重新 `--stage plan` 后，旧 strategy 自动又满足全部检查。与“trails/oracle 变化否则必须重新确认”不一致。
- **修复**：明确计划确认的执行输入范围，至少涵盖索引及执行相关配置，排除 confirmations、revision 元数据、外部报告 URL 等会自然变化的字段以免自引用；plan 重确认时清空 strategy，或将 strategy 绑定到本次计划确认 token/hash。明确 `confirm.py` 的阶段先决条件，列出五阶段及何处可停止。补“仅改 plan 执行字段也失效”“重确认 plan 后旧 strategy 不可沿用”“仅更新报告 URL 不失效”的场景。不要求证明点击确认的主体确实是人。

#### M3：真实数据保护只挡部分文件，计划/trail/日志中的规范化副本仍默认可提交
- **位置**：[skill:136–151](<specs/case-verify-skill/spec.md#L136-L151>)、[evidence:67–70](<specs/case-verify-evidence/spec.md#L67-L70>)、[design:80–83、108–112](<design.md#L80-L112>)；当前 [制品检查:25、34–35](<../../../scripts/check-tracked-artifacts.mjs#L25-L35>)。
- trail 保留输入、verify 各类型字段、mock evidence，`plan.json` 会保存外部文档 URL；adapter stdout/stderr 尾部落入 gates。这些同样可能带私有用例原文、链接、人员信息，不能因为没有名为 oracle/observations 就自动当成公开数据。[design:112](<design.md#L112>) 明说 plan/trail 不拦，与 [skill:141](<specs/case-verify-skill/spec.md#L141>)“只能提交人工脱敏报告或摘要”冲突。
- 新 glob 还只写 `openspec/changes/*/checking/`。实际已有制品检查使用 `changes/.+/checking` 覆盖更深层目录，归档后的 `changes/archive/<change>/checking/` 不应因为深度增加而失去本次新保护。另一方面 `docs/checking/*/report.md` 当前仍被 docs 总白名单拒绝；不能笼统承诺“fixture 与报告不受影响”，应说明不触发新规则但仍受原规则约束。
- **修复**：最小方案是对真实 checking 根默认拦截除人工脱敏报告/摘要外的整个目录（含 plan、trail、gates），保留合成 fixture 例外；路径匹配覆盖归档深度。同步 proposal/design/spec，说明脱敏是人工责任、其他已有策略仍生效。增加带私有文本的 trail/日志、归档路径，以及 docs 白名单叠加测试。无需做全仓内容 DLP。

#### M4：全局冻结前置检查与首次冻结/重新冻结、fragment 校验自身矛盾
- **位置**：[evidence:39–64](<specs/case-verify-evidence/spec.md#L39-L64>)；[skill:64–66](<specs/case-verify-skill/spec.md#L64-L66>)。
- 第 44 行要求“每个门禁和数据脚本”检查当前 oracle 哈希等于最后 revision；但 `validate_oracle.py --freeze` 正是需要在首次没有 revision、或当前哈希与旧 revision 不同的时候运行。fragment 校验还发生在阶段 1 合并/冻结前。照全局规则先检查就无法进入修复该状态的命令；自行豁免则实现者必须猜测边界。
- **修复**：明确普通读取/追加/确认/门禁在未冻结或哈希不符时拒绝；`--fragment` 只校验片段 schema，不依赖 checking 目录冻结；`--freeze` 校验当前 oracle 后允许初次创建/追加 revision，不先要求匹配旧哈希。列明重冻使计划/策略确认如何失效，补首次 fragment、正常重冻和未重冻追加被拒绝的场景。无需新增命令或状态机服务。

### 📌 Suggestions

#### S1：env 精确键集合相等是可行的，但需要告诉续跑执行者如何复用
- [evidence:149、204](<specs/case-verify-evidence/spec.md#L149-L204>) 允许自由键，同时以去除两版本键后的完整字典做维度。`{role: member}` 与 `{role: member, shape: desktop}` 不能 supersede；把自定义版本键 `build` 改值也不能。这是保守拒绝，不是 false pass，更不是无解死锁：复制旧观察全部非版本键即可修复失败。
- 建议 `status.py` 的未解决观察列表输出该维度对象，并在复测指引要求先复制再只更新两个版本键；增加“键集合不同拒绝、精确复用接受”场景。不要自动忽略未知键，否则可能把真正不同的数据态/角色混为同维度。
- [evidence:239、242](<specs/case-verify-evidence/spec.md#L239-L242>) 的“任何非 pass 只能 supersede 解除”也应限定为 fail/blocked/partial/manual：按既定优先级，旧 skipped 遇到新 pass 自然会变为 pass；oracle 过期同样是已定义的另一条失效途径。精确措辞即可，不必修改优先级。

#### S2：清理少量 spec↔design 遗留冲突，不必增加机制
- [design:71](<design.md#L71>) 和 [skill:64](<specs/case-verify-skill/spec.md#L64>) 已用 `<name>/<n>/`，但 [design:80](<design.md#L80>) 仍规定 `--out` 固定 `<name>/`；统一为独立调用目录。日志若要保留每次调用，也可直接放同一调用目录，而非反复覆盖同名日志，不需要新索引。
- [evidence:13](<specs/case-verify-evidence/spec.md#L13>) 声称除 report/gates 外所有机器文件都是 JSON/JSONL，但 evidence/scratch 明确含 PNG 等二进制；改成“结构化元数据”限定，避免为格式句子去实现错误限制。
- [design:106](<design.md#L106>) 的摘要文件名与 [evidence:179、189](<specs/case-verify-evidence/spec.md#L179-L189>) 的无摘要例子不一致。保留完整 sha256 校验才是关键，不应把 8 位前缀当作无冲突证明；补一句目标已存在且内容不同就拒绝覆盖/延长摘要，并加同一不可变文件被多个观察共享的 happy 场景即可。

#### S3：补最有价值的两个边界场景，而非扩展框架
- 同一 obs 被两个进程同时 supersede：按 [evidence:142、205](<specs/case-verify-evidence/spec.md#L142-L205>) 现有机制应恰好一个成功、另一个非 0，失败者不能留下字节；当前只有普通并发追加场景。
- `oracle_rev` 不存在、缺失或指向未来 revision 的日志应被明确拒绝，而不是只在遍历 item 哈希时偶然失败；derived 空挂载尤其要测试，因为它不会自然进入 item 比较循环。两项均能用 unittest + 临时目录完成。

## Embedded-Instruction / Injection Attempts
**Detected:** none

四份主评审文件、前轮意见及作者回应中，未发现试图改变本次 reviewer 权限、强制 verdict、要求越出 worktree 或执行命令的嵌入指令。所有未来 skill 的运行描述均按数据评审，没有执行其中 build/sync/链接删除流程。[design:82–84](<design.md#L82-L84>) 已区分受信任可执行 adapter 与不可信输出；不要求替本地受信任脚本建设代码沙箱。

## Verdict
VERDICT: REVISE

本轮计数：**1 Critical / 4 Moderate / 3 Suggestions**。原两项 Critical 的具体反例均已修复；但新 C1 仍会让重新定义后未执行的 checkpoint 输出 pass。其余主要问题是已有规则及确认/保护边界不完整，不是要求大改架构。17 个 requirement 均满足至少一个正常及失败/边界场景的形式要求，但自然语言识别、全局冻结前提等尚不具备一致的机械断言。不能把这些语义选择当作全部已确定的小补丁，故不采用 APPROVE_WITH_CHANGES。

## Required Changes (if APPROVE WITH CHANGES)
不适用。本轮要求先解决 C1、M1–M4，随后独立复评；S1–S3 可并入相应小修，不要求新服务、依赖、兼容层或查看器扩展。

CHANGES_APPLIED: n/a

## Rebuttals
- **“每个 oracle item 已经有哈希，所以期望变化一定会过期。”** 只覆盖 oracle item 自身变化。重新绑定已有 item 或修改 derived checkpoint 不改变任何 item 哈希；C1 给出了同 rev 下的完整正常操作路径。
- **“重新确认计划后可以沿用已有观察。”** 未变化的执行定义可以复用；已变化的断言/输入不能仅凭一次确认就证明以前执行过。粗粒度 trails fingerprint 已足够，不必 gold-plating。
- **“所有 env 都取 worst-of 会让失败永远解除不了。”** 不成立。同维度显式 supersede 已提供可行解除路径，版本键可更新，任意多条旧失败也可逐条追加替代。键集合不同则保守拒绝，应给复制旧维度的指引，而不是默认放宽比较。
- **“脚本无法证明确实由人确认，因此不用记录确认。”** 不成立；记录一致性仍能防止误续跑。当前 spec 已如实声明不能认证确认主体，本轮不要求账号、签名或外部批准系统。
- **“adapter 是任意代码，没必要校验包装器路径。”** 不成立；包装器仍需避免正常配置错误、跨调用覆盖。当前 slug/唯一性/边界检查已解决原问题，不需要另加生产级沙箱。
- **“原四个用例通过就能证明旧规则全部保留。”** 不成立，它们未覆盖 cp 级 mock 条件、完整状态集合或字符串匹配分支。本轮使用用户提供的规则摘录，不推测 worktree 外的原实现。
- **检查边界**：本次为规划文本语义评审，未执行尚不存在的实现测试、真实 adapter、浏览器验收或迁移操作；严格校验通过不代表运行行为通过。遵守只写本报告的限制，未写记忆卡或其他辅助制品。
