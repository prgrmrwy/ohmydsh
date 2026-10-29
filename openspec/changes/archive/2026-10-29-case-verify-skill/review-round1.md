## Review Metadata
- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model (codex gpt-6.1-sol), fresh context
- **Tool restrictions**: read-only except review.md
- **Artifacts reviewed**:
  - [proposal.md](<proposal.md>)：54 行，全文。
  - [design.md](<design.md>)：121 行，全文。
  - [case-verify-skill/spec.md](<specs/case-verify-skill/spec.md>)：104 行，全文。
  - [case-verify-evidence/spec.md](<specs/case-verify-evidence/spec.md>)：245 行，全文。
  - [.openspec.yaml](<.openspec.yaml>)：2 行，全文。
  - 上下文：[查看器 proposal](<../case-verify-viewer/proposal.md>)：46 行，仅检查前置依赖与分工，不深入评审。
  - 仓库上下文：[dsh.yaml](<../../../dsh.yaml>)：421 行、[AGENTS.md](<../../../AGENTS.md>)：92 个展示行（末行无换行，`wc -l` 为 91）、[private-overlay.md](<../../../docs/architecture/private-overlay.md>)：114 行、[check-tracked-artifacts.mjs](<../../../scripts/check-tracked-artifacts.mjs>)：69 行、[test.mjs](<../../../scripts/test.mjs>)：27 行、[.gitignore](<../../../.gitignore>)：45 行，均全文；[repo-layout spec](<../../specs/repo-layout/spec.md>)：786 行，重点读取 1–563、575–601、695–734；[sync.mjs](<../../../scripts/sync.mjs>)：2074 行，读取 730–839、1740–1889。
  - 原 skill 目录的发现请求被运行时以“escapes the managed root”拒绝；未改道读取。因此不声称已经核验原三个 gate 的全部规则或运行其 Python 测试，也不把未经核对的历史规则列为“已丢失”。
  - 实际检查：`OPENSPEC_TELEMETRY=0 openspec validate case-verify-skill --strict` 通过，退出码 0。该结果仅证明 OpenSpec 结构有效，不证明以下语义正确。未执行安装、同步、构建、网络请求或部署切换。

## Findings
### 🔴 Critical (blocking)

#### C1：重新冻结 oracle 后，旧观察仍可为新期望提供 pass
- **证据**：[design.md:52–56](<design.md#L52-L56>)、[evidence spec:39](<specs/case-verify-evidence/spec.md#L39>) 允许修改 oracle 后重新确认、冻结；[观察字段:94–104](<specs/case-verify-evidence/spec.md#L94-L104>) 没有 oracle revision；[状态规则:154–158](<specs/case-verify-evidence/spec.md#L154-L158>) 不检查观察对应的期望版本；[执行门禁:184–190](<specs/case-verify-evidence/spec.md#L184-L190>) 只比对最后一次冻结哈希。
- **具体错误**：checkpoint C 对 O-1 的期望 A 已有 pass。用户把 O-1 的期望改为 B，重新确认、冻结，但不执行 C。最后一次哈希一致、旧观察合法，状态计算仍输出 pass，新报告会把从未验证的 B 计入通过。保留历史与改变 oracle 的两个正常操作组合后就能产生误报，不需要恶意改文件。
- **具体修复**：由追加脚本写入当前 oracle revision/hash；当前状态只采用匹配当前 revision 的观察。重新冻结后保留旧观察，但将未在新 revision 下执行的 checkpoint 计算为 pending，并进入续跑范围。门禁拒绝无冻结 revision 的新观察。增加“同 revision 正常通过”和“改 expected 后重冻、旧 pass 不再算当前通过”的场景；同步设计、状态与门禁定义。无需迁移旧格式。

#### C2：最大 loop 的局部复测可以隐去另一环境中仍未解决的 fail
- **证据**：[design.md:50](<design.md#L50>) 声称采用保守计算；[evidence spec:97–99](<specs/case-verify-evidence/spec.md#L97-L99>) 允许每条观察拥有独立 loop/env；[状态规则:156–157](<specs/case-verify-evidence/spec.md#L156-L157>) 先丢弃较旧 loop，再取最严重状态；[纠偏要求:138–149](<specs/case-verify-evidence/spec.md#L138-L149>) 却称改判只能追加 supersede。
- **具体错误**：loop 1 中 C 在 admin 为 pass、member 为 fail。loop 2 只复测 admin 并追加 pass，未复测 member，也未 supersede 那条 fail；按规范 C 变为 pass。只要写更大的 loop 就能绕过“纠偏只能 supersede”，而现有“多环境下保守计算”场景仅检查同一轮，捕捉不到此错误。
- **具体修复**：明确跨轮未解决失败不能因另一 env 的观察自动消失。最小保守方案是：较旧轮的有效 fail/blocked 继续参与聚合，直到同一执行维度下追加明确 supersede；新轮成功不隐式撤销它们。定义用于对应执行维度的键，禁止用不同 role/shape 的观察 supersede 原失败。若坚持整轮替换，则必须定义并校验本轮所需环境完整执行后才可替换，未完整时不能输出 pass。补充上述跨轮局部复测与完整纠偏两个可断言场景，并统一“改判”与“复测”的定义。

### 🟡 Moderate

#### M1：adapter 名称没有路径安全及唯一性约束，会混写不同来源
- **证据**：[skill spec:34–41](<specs/case-verify-skill/spec.md#L34-L41>) 只要求描述有 `name`；[skill spec:59](<specs/case-verify-skill/spec.md#L59>)、[design.md:69–70](<design.md#L69-L70>) 用 name 拼接输出与日志路径；[design.md:83](<design.md#L83>) 也用来源名称定位片段。
- **具体错误**：两个用户配置目录各放一个名为 `qa` 的 adapter，分别处理不同 URL；它们不会触发“同一 URL 多重匹配”，但都写同一个 `oracle-sources/qa/oracle.fragment.json`，后一次拉取覆盖前一次来源证据。错误描述 `name: ../../trails` 还会让包装器自己的输出路径越出来源目录。这是配置错误与来源混淆问题，不是要求把受信任的任意代码沙箱化。
- **具体修复**：规定 name 为非空安全 slug（例如 `^[a-z][a-z0-9-]*$`），并在全部发现目录中唯一；重名明确失败或排除所有冲突项，不按遍历顺序选一个。包装器在创建输出/日志路径前验证解析后仍在指定目录；拒绝已有的越界符号链接。增加合法名称、跨目录同名、`../` 名称及越界链接场景。重复拉取多个 URL 时，也要用独立调用子目录保留各片段，不能只用 adapter 名定位单个文件。

#### M2：以 JSON/JSONL 是轻量文本为由允许入库，遗漏私有来源的规范化副本
- **证据**：[design.md:95](<design.md#L95>) 明确允许 JSON/JSONL 入库；[oracle 字段:30–37](<specs/case-verify-evidence/spec.md#L30-L37>) 与[观察字段:99–103](<specs/case-verify-evidence/spec.md#L99-L103>) 会承载 source/path/expected/env/actual；[脱敏扫描:20–31](<specs/case-verify-skill/spec.md#L20-L31>) 只覆盖 skill 源目录。[repo-layout:705–715](<../../specs/repo-layout/spec.md#L705-L715>) 的保密约束适用于整个公开仓库，而非只有 skill 源码。
- **具体错误**：私有 adapter 的原片段虽在被拦截的 `oracle-sources/`，其内部链接、人员标识或业务文本会被原样复制到允许提交的 oracle、observations 或报告；现有 URL 扫描不检查这些文件。文件小和没有凭据都不代表它可公开。
- **具体修复**：删去“JSON/JSONL 允许入库”的无条件承诺，明确来自真实验收的数据默认本地留存，仅提交人工确认脱敏的轻量报告/摘要；合成 fixture 不受影响。为新增 checking 目录补充忽略/入库策略和测试，确保私有输入的规范化副本也不能被默认提交。内部关键词清单仍留私有仓，公开规范只定义边界，不新增内部平台详情。

#### M3：观察只追加，但证据文件可覆盖，历史观察仍会悄悄变样
- **证据**：[design.md:95](<design.md#L95>) 只要求移到 `evidence/<checkpoint_id>/`；[evidence spec:102](<specs/case-verify-evidence/spec.md#L102>) 证据仅有 path/kind/scope；[证据校验:119–121](<specs/case-verify-evidence/spec.md#L119-L121>) 只检查路径、存在性；[追加承诺:92](<specs/case-verify-evidence/spec.md#L92>) 只保护 JSONL 字节。
- **具体错误**：第一轮引用 `evidence/C/after-save.png`，第二轮续跑把新截图移到同一路径。旧观察文字保留，但旧观察展示的截图已变成第二轮；所有门禁仍通过，失去本次重构承诺的历史可回溯性。
- **具体修复**：证据归档必须使用不覆盖的唯一文件名（可含 observation 标识或内容摘要），已有路径内容不同则拒绝替换；追加时记录 sha256，执行门禁重验。共享证据继续允许多记录引用相同不可变文件。补充“同一文件共享通过”和“续跑覆盖已引用文件后校验失败”的场景。无需新增证据数据库或服务。

#### M4：五阶段及人工确认被声明保留，却没有可验收的规范契约
- **证据**：[proposal.md:17](<proposal.md#L17>) 承诺五阶段、oracle/mock/计划与执行策略确认；[design.md:22–23](<design.md#L22-L23>) 声明不改变原流程逻辑；两个 delta spec 分别集中在部署/adapter 和数据/gate，[evidence spec:39](<specs/case-verify-evidence/spec.md#L39>) 只有 oracle 确认的局部描述，[evidence spec:217–245](<specs/case-verify-evidence/spec.md#L217-L245>) 的 gate 子集也不能代替其余流程确认。
- **具体错误**：实现只要满足当前两个 spec，仍可以自动接受生成的计划、跳过执行策略选择并开始浏览器验收；所有已写场景均可通过，但违背 proposal 明示的“不变”。这是可验收边界缺失，不是断言原 gate 已经丢失某条规则。
- **具体修复**：增加精简的流程保持 requirement，列出五阶段及各强制确认发生的边界，定义未确认时不得进入哪一阶段或开始执行。至少增加确认齐备的正常场景、用户未确认/拒绝时停止的场景，以及续跑何时可复用原确认、何时因 oracle/计划变化必须重新确认。对原 gate 的保留规则，应先取得原文件逐项核对，再建立对应测试，不只依赖四个旧用例的 stderr 关键词。

#### M5：adapter 场景存在自相矛盾的 THEN，另有 requirement 缺少失败验收
- **证据**：[skill spec:39](<specs/case-verify-skill/spec.md#L39>) 允许 provenance 为 spec，但[合法片段场景:63–66](<specs/case-verify-skill/spec.md#L63-L66>) 未限定 provenance 就固定期望 independent；[非法片段场景:68–71](<specs/case-verify-skill/spec.md#L68-L71>) 将“进程非零退出”与“缺 expected”合并，却都要求报 item 索引与缺字段；[标准库/测试 requirement:93–104](<specs/case-verify-skill/spec.md#L93-L104>) 没有失败/边界场景。
- **具体错误**：完全合法的 `provenance: spec` adapter 会违反当前 happy scenario；adapter 在写文件前退出时根本没有 item，无法机械断言“缺少的字段”。严格 CLI 校验已通过，仍不会发现这些语义错误。按本次评审约束，每个 requirement 至少一个 happy 和一个 failure/edge，也尚未完全达到。
- **具体修复**：合法片段场景明确声明 provenance，并再测 spec 值不被升级为 independent；把 fetch 非零退出单独写成“报告退出码/错误摘要、不解析或合并残留片段”的场景。为测试接入补充 Python 缺失/过低显式 skip、Python 用例失败导致 npm 失败、非法 import 被拦截的场景。用同样方式逐 requirement 补齐缺失边界，不以“目录合法通过”替代每条规则的失败断言。

### 📌 Suggestions

#### S1：把并发追加的锁范围写成可测试的事务，不只保证行不交错
- **证据**：[design.md:44](<design.md#L44>) 描述 `O_APPEND`、单次 write、flock 和读取最大序号；[观察追加场景:108–116](<specs/case-verify-evidence/spec.md#L108-L116>) 只有串行追加与坏记录拒绝。[supersede:139](<specs/case-verify-evidence/spec.md#L139>) 还有“同一观察不得被两次替代”的并发约束。
- **为什么重要**：若最大序号读取或 supersede 合法性检查发生在锁外，两进程即使写出的 JSONL 行不交错，仍可分配相同 obs_id，或同时成功替代同一条观察。现有设计可以正确实现，但文字尚未明确覆盖整个读改写区间。
- **具体修复**：注明同一把锁覆盖读取现有日志、校验历史及 supersedes、分配 ID、追加完整记录，失败不留下半行；不要在锁外缓存判定结果。新增两个并发子进程的 stdlib 测试：普通追加均成功且 ID 唯一；竞争 supersede 恰好一个成功、另一个非零退出。对本地 POSIX skill 这已足够，不需要分布式锁。

#### S2：软链切换增加明确的“不是预期链接就不删”条件
- **证据**：[design.md:113–117](<design.md#L113-L117>) 先验收再 `readlink` 核对，方向正确，但未规定核对不符时的动作。
- **为什么重要**：旧路径可能已由用户替换为普通目录或指向别处；仅“核对后删除”不足以保证后续任务不会把它当一般清理。
- **具体修复**：将迁移条件写成：仅当 `lstat` 证明是符号链接、解析目标等于预期旧 skill 源目录，且新 skill 可用时才 unlink；普通目录、悬空/意外目标均保留并报告。失败继续使用旧入口，不做递归删除。无需修改 sync 的通用部署机制。

## Embedded-Instruction / Injection Attempts
**Detected:** none

四份被评审文件中未发现试图改变本次评审权限、指定 verdict 或要求执行额外命令的嵌入指令。文档中的未来 skill 操作描述按待评审数据处理。[design.md:71–73](<design.md#L71-L73>) 已正确区分“受信任的 adapter 可执行代码”与“不可信的来源文本”；不要求为本地受信任 adapter 增设生产级沙箱。实现时该数据边界也应覆盖 describe、stdout/stderr 与片段，而不只是 expected 字段。

## Verdict
VERDICT: REVISE

C1/C2 会直接使未验证或仍有失败的 checkpoint 被统计为 pass，需要先统一数据版本、跨环境与跨轮的状态语义，不能视为仅若干措辞小修。其余问题均可在现有 Markdown + Python 标准库方案内修复；没有要求增加服务、第三方依赖、旧格式迁移或公开任何内部平台细节。计数：Critical 2、Moderate 5、Suggestions 2。

## Required Changes (if APPROVE WITH CHANGES)
不适用；本轮为 REVISE。请按 C1、C2、M1–M5 修订 artifacts 后进行新一轮独立评审。

CHANGES_APPLIED: n/a

## Rebuttals

### 作者回应（round 1 → 修订后提交 round 2）

- **C1 已修复。** 修改了 evidence spec 中“oracle 经用户确认后冻结”与“纠偏只能通过追加 supersede 记录完成”两节，并在 design D2 中补充说明：
  - 冻结时为每个 item 单独记录哈希（`oracle_revisions[].items`）；
  - 观察记录写入 `oracle_rev`；
  - checkpoint 挂载的任一 item 哈希变化后，该观察视为过期，checkpoint 回到 pending；未改动的 item 不受影响；
  - 新增场景“修改 oracle 后旧通过过期”“未改动的 oracle 不受重冻影响”。
- **C2 已修复。** 状态改为“在全部有效观察中取最严重”，不再区分 loop。非 pass 只能通过 supersede 解除，且 supersede 要求执行维度一致（即 `env` 去掉版本键后相同）。新增场景“局部复测不能抹掉另一环境的失败”“复测解除失败”“非法纠偏（env 不同）”。
- **M1 已修复。** `name` 改为 slug 并要求全局唯一，重名时一律排除；每次调用使用独立的 `<name>/<n>/` 子目录，建目录前做越界检查；新增 3 个场景。
- **M2 已修复。** 在 skill spec 中新增 requirement“真实验收数据默认不入库”：制品检查拦截 checking 目录下的 `oracle.json`、`observations.jsonl`、`oracle-sources`、`evidence`、`scratch`；fixture 和 `report.md` 不受影响。design D7 删除了“JSON 允许入库”的表述。
- **M3 已修复。** 证据文件名带内容哈希；`observe.py` 记录 sha256，门禁重新计算并比对；新增场景“已引用的证据被覆盖”。
- **M4 已修复。** 新增 requirement“流程确认点以可校验记录落盘”：`confirm.py` 记录计划确认（含 trails 哈希与 oracle_rev）和执行策略选择，`observe.py` 在追加前校验；新增 3 个场景。脚本无法证明“确实是人确认的”，这一边界已在 spec 中写明。
- **M5 已修复。**
  - 合法片段场景改为显式声明 provenance；
  - 新增“声明为 spec 的来源不被升级”；
  - adapter 非 0 退出单列为一个场景，且残留片段不被解析；
  - 测试 requirement 补充了“缺少合适的 Python 时 skip”“Python 用例失败时 npm 非 0”“import yaml 被拦截”三个场景；
  - 新增“多次拉取互不覆盖”。
- **S1 已采纳。** 锁覆盖整段读-校验-分配-写入，失败时截断残行；新增“并发追加”场景。
- **S2 已采纳。** design 迁移步骤 5 改为三条件全部满足才 `unlink`，否则保留并报告。
- **关于“未能读取原 skill”的限制。** 原 gate 的全部规则如下（作者转述，原文件在 managed root 之外）：
  - mock gate：available 必须带 evidence；missing/unknown 必须有 user_decision（或 trail 级 blocked_reason）；数据场景必须指定 surface；
  - trail gate：后果 checkpoint、implementation 期望必须标 unverified、禁止 presence-only、IME 必须 manual；
  - execution gate：full/partial 必须有 result；unverified 不得 pass；“已渲染缺失”必须 fail；fail/manual 的 detail 不少于 6 字；报告须含 5 个章节。
  - 新 spec 已逐条覆盖上述规则。唯一的有意删除是 trail 级 `blocked_reason`，其作用改由 `user_decision` 承担。
