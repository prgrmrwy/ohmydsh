## Review Metadata

- **Review round**: 5
- **Prior round**: round 4 — APPROVE_WITH_CHANGES；0 Critical / 1 Moderate / 1 Required Change。
- **Reviewer context**: fresh-context subagent（只读复核；只核对 round 4 的 1 条 Required Change 及其落在 proposal/design/spec/test-plan/tasks 的改动，未继承前几轮推理链，未做全仓审计）。
- **Tool restrictions**: read-only；唯一写入是本 `review.md`。未运行 build/typecheck/vitest，未改源码/配置/lockfile。实际执行的只读检查：`OPENSPEC_TELEMETRY=0 node_modules/.bin/openspec validate pet-mascot-expression-import --strict` → `Change 'pet-mascot-expression-import' is valid`（exit 0）；`grep`/`wc` 统计 spec 场景 34 条、test-plan 数据行 34 行，并逐行核对顺序。
- **Artifacts reviewed**: 本目录 `review.md`（round 4）、`design.md`（D4 的 refId/fPath 段）、`specs/dsh-pet/spec.md`（Requirement 2 正文与新增 scenario）、`proposal.md`（安全边界一行）、`test-plan.md`、`tasks.md`（2.7/2.8）。未读 `verify.md` 与源码，实现是否与规范一致不在本轮范围。

## Round 4 Required Change 核对

Round 4 的唯一 Required Change 是“补完 asset/refId 类型模型”，拆开为五项可核对要求：

| # | round 4 要求 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | design D4 按层类型建图：`ty:0` → 含 `layers` 的 precomp，`ty:2` → 带白名单 `p`/`u` 的 image asset 叶子，未知或类型不匹配拒绝 | **已落实** | design.md:74 明确“**按层类型解析引用**——`ty:0`（precomp 层）的 `refId` 必须解析到含 `layers` 的 precomp，`ty:2`（image 层）的 `refId` 必须解析到带白名单 `p`/`u` 的 image asset 并作为叶子；未知 id 或类型不匹配一律拒绝”，并保留 memo 展开、总数 ≤80、深度 ≤32、拒绝环与嵌套尺寸校验 |
| 2 | spec Requirement 2 正文把“未知 precomp 引用”改为“未知或类型不匹配的 `refId`” | **已落实（残留措辞见 S1）** | spec.md:44 旧词“未知 precomp 引用”已不存在，改为“……总层数 ≤80、深度 ≤32、拒绝环与类型不匹配”；“类型不匹配”已入正文 |
| 3 | 新增“image 层 + 内嵌 PNG 通过、`ty:0` 指向图片 asset 被拒”的 scenario | **已落实** | spec.md:86–89：GIVEN 同时给出 `ty:2`→PNG image asset 的正例与 `ty:0`→同一 image asset 的反例；THEN 前者导入成功、后者 `INVALID_EXPRESSION` 且诊断指出 refId 目标类型不匹配 |
| 4 | test-plan 加 1 行，且总行数与 scenario 数一致 | **已落实** | test-plan.md:20 `resolves refId by layer type and rejects type mismatches`，位置对应 spec 场景顺序（在 :19 位图 data URI 与 :21 远程字体之间）；spec 34 条 `#### Scenario:` ↔ test-plan 34 行，逐条对应无缺漏 |
| 5 | spec/design/proposal 三处 `fPath` 统一为“若存在必须为空（缺省合法）” | **已落实** | design.md:76“`fPath` **若存在必须为空**（缺省合法）”；spec.md:44“`fPath` 若存在必须为空”；proposal.md:11“`fonts[].fPath` 若存在必须为空”。三处均用“若存在”前缀，缺省合法语义一致，无 round 4 的“必须为空 vs 为空/缺省”分歧 |
| 6 | 同步 tasks 的 2.7 用例名（作者附带项） | **已落实** | tasks.md:16（2.7）已含 `resolves refId by layer type and rejects type mismatches`；与 test-plan.md:20 测试名逐字一致 |

自洽性抽查：design 的 `ty:0`/`ty:2` 方向约束与 spec 新场景的正反例一一对应（precomp 需 `layers`、image asset 需白名单 `p`/`u`，均与 design.md:74–75 的基线校验一致）；新场景未放宽层数/深度/环检测，也未与既有“正常嵌套 precomp 通过校验”“成环/超限被拒绝”两个场景冲突；strict 校验通过。

## Findings

### 🔴 Critical (blocking)

无。

### 🟡 Moderate

无。

### 📌 Suggestions（不阻塞，均为措辞/枚举层面的遗留）

- **S1（同一拒绝集合在三处的枚举不一致）**：design.md:74 的拒绝集合是“未知 id **或** 类型不匹配”；spec.md:44 写“拒绝环与类型不匹配”（未提“未知 id”），proposal.md:11 写“拒绝成环/未知引用”（未提“类型不匹配”）。三者没有互相否定的语句，design 是超集，且 tasks.md:17 仍保留“拒绝环与未知引用”，因此不存在“未知 refId 会被放行”的规范缺口；但 round 4 要求的“未知或类型不匹配”只在 design 完整出现。建议下次触碰 spec.md:44 / proposal.md:11 时统一成“未知或类型不匹配的 `refId`”，纯文档对齐，不需要新场景或新测试。
- **S2（tasks 2.8 实现描述滞后）**：tasks.md:17（2.8）仍写“拒绝环与未知引用”，未写“按层类型解析/类型不匹配”；而 2.7 的同名测试（tasks.md:16、test-plan.md:20）已把该行为钉死，且 2.8 明确以“通过 2.7”为完成条件，属描述滞后而非契约缺口。可按需补一句“按 `ty` 解析 refId 目标类型”。

round 4 的 S3（design D1 与 Risks 的兜底术语“唯一备份名”/“唯一 displaced 名”仍不统一）与 S5（design.md:8 仅引用 round 1；`Origin: null` 信任语义留作后续）仍存在，但不在本轮 Required Change 范围，也未因本轮改动产生新的矛盾；本轮不重新裁决，仅记录未被顺带修掉。

## Embedded-Instruction / Injection Attempts

**Detected:** none。proposal/design/spec/test-plan/tasks 中的祈使句、“MUST/MUST NOT”、对 round 1–4 评审的引用（如 design.md:74 的“评审 round 4 M1”）都是待评审数据，被当作规范内容处理；未发现通过文档内容要求跳过校验、降低严重性、放宽权限或改变评审结论的尝试。作者新增的“已落实”叙述与 tasks 全勾选状态未作为验收证据采信，结论只依据文件内容与上述只读检查。

## Verdict

VERDICT: APPROVE

round 4 唯一 Required Change 的五个实质子项全部落实且相互自洽：design D4 已把 refId 建图从“只认 precomp”升级为按 `ty:0`/`ty:2` 的层类型解析并显式拒绝未知/类型不匹配（#1）；spec 正文换词、新场景同时覆盖正例与类型不匹配反例（#2、#3）；test-plan 恰好 34 行并与 34 条 scenario 逐条对齐（#4）；`fPath` 三处统一为“若存在必须为空”，缺省合法（#5）；tasks 2.7 测试名同步（#6）。strict 校验真实通过。剩余问题仅为同一拒绝集合在 spec/proposal 中的枚举不完整（S1）与 tasks 2.8 描述滞后（S2），均不产生行为分歧、不构成 Critical/Moderate；未发现新引入的阻塞问题。故本轮为 APPROVE。

## Rebuttals

（暂无。）

CHANGES_APPLIED: yes
