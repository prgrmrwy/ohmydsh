## Test Plan

<!-- LIVE LEDGER: during apply, flip each row 🔴 red → 🟢 green as its test passes. verify blocks on any row left red. -->

Shorthand: `RF` = `tests/repo-facade.test.mjs`, `RDG` = `tests/repo-docs-governance.test.mjs`, `MN` = `tests/manifest-notes.test.mjs`, `TA` = `tests/tracked-artifacts.test.mjs`. Spec paths are relative to `openspec/changes/github-facade-refresh/specs/`.

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| repo-facade/spec.md → 根 README 是英文默认、中文对等的双语门面 | 双语门面成对存在且章节锚点一致 | RF | `root README pair is tracked, cross-linked, and anchor sequences match` | 🔴 red |
| repo-facade/spec.md → 根 README 是英文默认、中文对等的双语门面 | 中英章节不一致 | RF | `anchor sequence mismatch reports first differing position` (fixture strings fed to the parser) | 🔴 red |
| repo-facade/spec.md → 根 README 是英文默认、中文对等的双语门面 | 二级标题缺少锚点 | RF | `h2 without section anchor is reported with its line` | 🔴 red |
| repo-facade/spec.md → 门面按两类读者组织核心章节 | 核心章节齐全且有序 | RF | `both READMEs have exactly the eight anchors in order with diagrams and lifecycle vocabulary` | 🔴 red |
| repo-facade/spec.md → 门面按两类读者组织核心章节 | 缺失必需章节 | RF | `missing required anchor is named` (fixture) | 🔴 red |
| repo-facade/spec.md → 门面按两类读者组织核心章节 | 章节语义人工验收 | `verify.md` § Manual gates / P2 | P2 per-section bilingual semantic sign-off | N/A — non-executable |
| repo-facade/spec.md → Quick Start 提供三条路径与可直接交给 AI 的安装 prompt | 最小 manifest 可被真实 sync 接受 | RF | `minimal-manifest fixture has exact shape and black-box sync accepts it with no installs` | 🔴 red |
| repo-facade/spec.md → Quick Start 提供三条路径与可直接交给 AI 的安装 prompt | 最小 manifest 漂移 | RF | `minimal-manifest dshVersion equals root dsh.yaml dshVersion` | 🔴 red |
| repo-facade/spec.md → Quick Start 提供三条路径与可直接交给 AI 的安装 prompt | AI prompt 缺少规则 | RF | `agent-install-prompt contains all six rule tags in both READMEs` | 🔴 red |
| repo-facade/spec.md → Quick Start 提供三条路径与可直接交给 AI 的安装 prompt | 引用不存在的 dsh 子命令 | RF | `every dsh subcommand mentioned in READMEs exists in bin/dsh case arms` | 🔴 red |
| repo-facade/spec.md → 多机器只做路由 | 多机器章节保持简短并指向 cockpit | RF | `multiple-machines is at most 8 lines, links dsh-cockpit, states per-machine build` | 🔴 red |
| repo-facade/spec.md → 多机器只做路由 | 多机器章节膨胀 | RF | `multiple-machines over 8 lines reports the count` (fixture) | 🔴 red |
| repo-facade/spec.md → 插件索引与 manifest 保持一致且不含版本号 | 索引覆盖全部启用条目 | RF | `plugin index covers every enabled customization and resource with valid links and descriptions` | 🔴 red |
| repo-facade/spec.md → 插件索引与 manifest 保持一致且不含版本号 | 新增定制未登记 | RF | `unlisted enabled id is reported` (synthetic manifest fixture) | 🔴 red |
| repo-facade/spec.md → 插件索引与 manifest 保持一致且不含版本号 | 索引写入版本号 | RF | `semver in plugin index is reported with its line` | 🔴 red |
| repo-docs-governance/spec.md → docs 目录实行准入白名单 | docs 只含白名单目录 | RDG | `tracked docs live only in adr/architecture/assets and architecture docs are linked from entry docs` | 🔴 red |
| repo-docs-governance/spec.md → docs 目录实行准入白名单 | 新增 docs/notes 文件 | TA | `rejects tracked docs outside the whitelist` (via `artifactPolicyViolations`) | 🔴 red |
| repo-docs-governance/spec.md → docs 目录实行准入白名单 | docs/assets 出现孤立资产 | RDG | `docs/assets has no orphan files` | 🔴 red |
| repo-docs-governance/spec.md → docs/notes 按已批准的处置表迁出并脱敏 | 迁移与处置表一致 | RDG | `notes migration matches notes-disposition.json and design table` | 🔴 red |
| repo-docs-governance/spec.md → docs/notes 按已批准的处置表迁出并脱敏 | 移动到处置表之外或产生副本 | RDG | `each migrated note h1 appears exactly once at its target` | 🔴 red |
| repo-docs-governance/spec.md → docs/notes 按已批准的处置表迁出并脱敏 | 迁移产物残留规则可匹配的标识或已登记人工项 | RDG | `migrated targets contain no redaction-rule matches or registered manual items` | 🔴 red |
| repo-docs-governance/spec.md → docs/notes 按已批准的处置表迁出并脱敏 | move 文件正文被改写 | `node scripts/maintenance/notes-migration-diff.mjs <base>` | content-fidelity diff exits 0, or the only residual diffs are registered manual items | N/A — non-executable |
| repo-docs-governance/spec.md → docs/notes 按已批准的处置表迁出并脱敏 | 人工门禁发现未登记的可识别信息 | `verify.md` § Manual gates / P1 | Lead per-file privacy read-through of every non-deleted migrated file | N/A — non-executable |
| repo-docs-governance/spec.md → 仓库内不残留失效的文档路径引用 | 链接全部可达 | RDG | `every repo-relative markdown link resolves to a tracked path` | 🔴 red |
| repo-docs-governance/spec.md → 仓库内不残留失效的文档路径引用 | 迁移文档后遗留旧链接 | RDG | `broken relative link is reported with file, line, target` (fixture) | 🔴 red |
| repo-docs-governance/spec.md → 仓库内不残留失效的文档路径引用 | 源码注释或配置样例残留旧路径 | RDG | `no tracked text file outside archive mentions docs/notes/` | 🔴 red |
| repo-docs-governance/spec.md → 仓库内每份 README 都有中文对照 | 所有 README 成对且互链 | RDG | `every tracked README.md has a cross-linked README.zh.md within language thresholds` | 🔴 red |
| repo-docs-governance/spec.md → 仓库内每份 README 都有中文对照 | 新增 package 缺中文 README | RDG | `README without zh pair is reported` (fixture file list) | 🔴 red |
| repo-docs-governance/spec.md → 仓库内每份 README 都有中文对照 | 英文 README 实际是中文 | RDG | `cjk ratio helper flags a Chinese README.md` (fixture text) | 🔴 red |
| repo-docs-governance/spec.md → Agent 入口文件在大小写敏感文件系统上有效 | AGENTS.md 指向 CLAUDE.md | RDG | `AGENTS.md is a symlink whose blob is exactly CLAUDE.md` | 🔴 red |
| repo-docs-governance/spec.md → Agent 入口文件在大小写敏感文件系统上有效 | 链接目标大小写错误 | RDG | `wrong-case symlink target is reported` (fixture index entry) | 🔴 red |
| repo-docs-governance/spec.md → 自研 package README 按分级呈现 | 各级 README 满足呈现要求 | RDG | `package READMEs satisfy their docTier presentation rules` | 🔴 red |
| repo-docs-governance/spec.md → 自研 package README 按分级呈现 | 首屏说明人工验收 | `verify.md` § Manual gates / P3 | per-package problem-statement and bilingual sign-off | N/A — non-executable |
| repo-docs-governance/spec.md → 自研 package README 按分级呈现 | 新增 package 未分级 | RDG | `package without ohmydsh.docTier is reported` | 🔴 red |
| repo-docs-governance/spec.md → 自研 package README 按分级呈现 | A/B 级首屏只嵌入了 SVG 而没有栅格位图 | RDG | `A/B tier with only an SVG above first h2 is reported` (fixture) | 🔴 red |
| repo-docs-governance/spec.md → 入库截图经隐私门禁并登记来源 | 截图已登记且体积合规 | RDG | `every README bitmap is registered in SCREENSHOTS.md with kind, and under 400 KiB; illustration rows have a note and a committed source` | 🔴 red |
| repo-docs-governance/spec.md → 入库截图经隐私门禁并登记来源 | 示意图被用于必须截图的 package 或理由不符 | RDG | `illustration allowlist, reason phrase, source file and kind values are enforced` (fixtures: unknown kind; illustration in dsh-pet; wrong reason; missing source; screenshot row carrying the illustration phrase) | 🔴 red |
| repo-docs-governance/spec.md → 入库截图经隐私门禁并登记来源 | 未登记的截图 | RDG | `unregistered bitmap is reported` (fixture) | 🔴 red |
| repo-docs-governance/spec.md → 入库截图经隐私门禁并登记来源 | 截图含敏感信息 | `verify.md` § Manual gates / P3 screenshots | Lead per-image privacy checklist verdict | N/A — non-executable |
| repo-docs-governance/spec.md → 入库截图经隐私门禁并登记来源 | 图源文件含位图中不可见的敏感信息 | `verify.md` § Manual gates / P3 illustration sources | Lead per-source-file privacy checklist verdict (metadata, comments, hidden layers, unrendered text) | N/A — non-executable |
| repo-docs-governance/spec.md → 入库截图经隐私门禁并登记来源 | kind 与实际来源不符 | `verify.md` § Manual gates / P3 provenance | Lead provenance check: screenshot rows tied to the isolated-instance capture record; illustration rows re-rasterized from the committed source and compared | N/A — non-executable |
| repo-layout/spec.md → manifest 条目说明以人读摘要为准 | 启用条目都有简短 brief 与受限 note | MN | `every enabled customization has a brief ≤80 and note ≤600 code points` | 🔴 red |
| repo-layout/spec.md → manifest 条目说明以人读摘要为准 | note 重新膨胀 | MN | `oversized note is reported with id and length` (fixture) | 🔴 red |
| repo-layout/spec.md → manifest 条目说明以人读摘要为准 | 其它 spec 要求的事实类别被精简掉 | MN | `dsh-openspec note keeps upstream/license/telemetry/credential/upgrade/removal` | 🔴 red |
| repo-layout/spec.md → note 精简迁移不改变 manifest 的机器可读结构 | 迁移前后结构等价 | `node scripts/maintenance/manifest-structure-diff.mjs <base>` | prints `structure unchanged`, exit 0 | N/A — non-executable |
| repo-layout/spec.md → note 精简迁移不改变 manifest 的机器可读结构 | 迁移误改字段 | MN | `structure-diff reports a changed version path and exits non-zero` (temp git repo fixture) | 🔴 red |
| repo-layout/spec.md → 长期仓库仅保存必要且可维护的派生资产 | 完成 OpenSpec 验收 | TA | `rejects raw checking evidence and any tracked archify output` (existing) | 🟢 green |
| repo-layout/spec.md → 长期仓库仅保存必要且可维护的派生资产 | 更新仓库架构图 | TA | `requires the root lock and architecture source/display allowlist` (existing) | 🟢 green |
| repo-layout/spec.md → 长期仓库仅保存必要且可维护的派生资产 | 每张门面图都有图源 | TA | `requires both facade diagrams with their sources` | 🔴 red |
| repo-layout/spec.md → 长期仓库仅保存必要且可维护的派生资产 | 根目录遗留产物被重新提交 | TA | `rejects root debug screenshot and generated architecture note` | 🔴 red |

## Coverage Notes

- **Shared helpers.** `tests/helpers/markdown.mjs` provides section-anchor extraction, fenced-block and inline-code stripping, link extraction and resolution, the CJK ratio, and `git ls-files` access. Negative scenarios marked "(fixture)" feed synthetic strings or file lists to the same helpers, so they never mutate the working tree.
- **Black-box sync.** "最小 manifest 可被真实 sync 接受" reuses the temp-repo + temp `DSH_HOME` + fake `DSH_BIN` pattern from `tests/sync-profile-scaffold.test.mjs`. No production refactor.
- **Pre-existing greens.** Two `repo-layout` scenarios are unchanged text from the current spec and are already covered by existing tests. They are listed for traceability and marked 🟢 from the start.
- **N/A — non-executable rows.** Eight rows are not regression tests:
  - Two are one-time migration acceptance commands (`notes-migration-diff.mjs`, `manifest-structure-diff.mjs`). Each is a real tool that exits non-zero on failure. The command, `<base>` SHA, and output are recorded in `verify.md`. Their failure behaviour also has a regular test (the structure-diff row in MN). The notes diff is exercised by its own RDG fixture test, `notes-migration-diff flags an unregistered body edit`, which is an extra test outside the mapping floor.
  - Six are human gates the spec explicitly assigns to the Lead: bilingual semantics (P2), the notes privacy read-through (P1), package problem statements (P3), screenshot/bitmap privacy (P3), illustration source-file privacy (P3), and `kind` provenance (P3). Each passes only when `verify.md` contains a per-item conclusion; a missing conclusion fails the phase. These cannot be automated without false assurance, which was the reason for round 1 C3 and the 2026-10-09 human decisions.
- **Red-first.** Every 🔴 row's test is written before its implementation and must fail for the stated reason against the current tree. Examples: no `README.zh.md`; `AGENTS.md` → `claude.md`; `docs/notes/` present; no `ohmydsh.docTier`; notes over 600 code points.
