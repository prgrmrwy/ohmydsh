## Context

- 根 `README.md`（223 行，中文）与 `README.en.md`（146 行）形成于 2026-08-28 的开源整理。之后仓库新增了私有 overlay、`thirdPartyResources`、DSH 0.2 运行体、四个大型自研插件，README 只做增量追加，出现过时内容（`llm-subscriptions` pin、rc.2 临时策略），且把 UI 打开策略、订阅回滚等运维细节放在首页。
- `AGENTS.md` 是指向 `claude.md` 的符号链接，实际文件为 `CLAUDE.md`；在 Linux 与 GitHub 网页上为断链。
- `docs/` 下 `adr/` 7 份、`assets/` 2 份、`notes/` 25 份。`notes/` 中只有 `dsh-plugin-integration-pitfalls.md` 被大量引用（`CLAUDE.md` 强制前置阅读、源码注释、多个 change），其余多为某一时间点的调研、验收或复盘记录，11 份零引用。非 markdown 的引用存在于 `.gitignore`、`.env.local.example`、`dsh.yaml` 与 `packages/dsh-pet`、`packages/dsh-memex` 的源码注释。
- `dsh.yaml` 有 27 条 `note`，最长 9762 字符；唯一程序读取者是 `scripts/plugin-list.mjs`，按 `brief ?? note` 打印启动清单。`repo-layout` 与 `dsh-openspec-session`（第 136 行：upstream、license、telemetry 与 credential 边界、upgrade checkpoint、removal path）两份 spec 规定了 note 必须记录的事实类别。
- `scripts/sync.mjs` 的 `loadManifest` 未导出，且模块顶层直接执行 `main()`；既有测试（如 `tests/sync-profile-scaffold.test.mjs`）以「复制 sync 脚本到临时仓库 + 临时 `DSH_HOME` + 假 `DSH_BIN`」的黑盒夹具驱动 sync。
- 进行中的 `upgrade-dsh-0-2-0-runtime` 任务 7.1 计划把审查与回滚说明写回 note，与本次精简方向相反；它与本 change 都会修改 `dsh.yaml`。
- 用户约定：读者为「自管 DSH 的人或 AI」与「关注自研插件的人或 AI」；多机器只路由到 `dsh-cockpit`；从零开始以一段 prompt 解决，不新增机制；默认英文、所有 README 都有 `.zh.md`；记录统一进 OpenSpec，docs 严格准入；实施用 Team 模式，Lead 拆分、派发、分阶段验收，每阶段最多 5 轮后找人确认；teammate 使用 Sonnet。

## Goals / Non-Goals

**Goals:**

- 一个英文默认、中文对等的根门面，按两类读者组织，并给出可直接交给 AI 的安装 prompt。
- 可机械断言的门面约束（索引一致、双语成对与章节锚点、链接可达、旧路径清零、docs 白名单、入口文件、截图登记、note 形态）都由会失败的检查守住；无法机械断言的部分（双语语义一致、prompt 措辞、截图隐私）明确交给人工门禁，不冒充测试覆盖。
- 自研插件 README 按 A/B/C 分级重写首屏，A/B 级配合成数据截图。
- `docs/notes/` 清零，长期文档只有 adr / architecture / assets。
- `dsh.yaml` 恢复人可读，且迁移前后机器可读结构等价。

**Non-Goals:**

- 不新增 `dsh init`、模板目录或任何从零开始的代码路径。
- 不拆分「工具」与「配置」为两个仓库。
- 不翻译 OpenSpec 规范、ADR 或 change 文档；ADR 保持原语言。
- 不改 sync / 启动器 / 插件运行行为；源码改动仅限注释中的文档路径与各 package `package.json` 新增的 `ohmydsh.docTier` 元数据。
- 不在本仓 README 中介绍 cockpit 的安装与运维。
- 不为第三方插件写 README 或截图。
- 不修改 `openspec/changes/archive/` 中已有文件的内容（只允许向归档 change 目录新增迁入的记录文件）。

## Decisions

### D1 根 README 结构：读者路径优先，运维细节下沉

章节锚点顺序固定为 `what-it-does` → `quick-start` → `architecture` → `multiple-machines` → `your-configuration` → `plugins` → `contributing` → `license`。旧 README 的「日常命令表」压缩为不超过 8 行的速查，其余（UI 打开策略、autoUpdate 细节、rc.2 策略、订阅回滚）删除；需要时以 `dsh --help`、`dsh.yaml` 注释或对应 package README 为准。

双语对等用 `<!-- section: <key> -->` 锚点机械断言结构一致；语义一致由阶段验收与终审人工抽查。

备选：保留旧 README 结构只做翻译。否决理由：用户明确要求重写且旧内容可直接丢弃；旧结构没有读者路径，翻译只会复制过时信息。备选：只比较标题数量。否决理由：数量相等不能证明第 N 节对应同一主题（review M2）。

### D2 从零开始 = README 中的最小 manifest + AI prompt

最小 manifest 只有 `dshVersion`、`autoUpdate: { enabled: false }`、`customizations: []`。`autoUpdate.enabled` 必须显式为 false，因为缺省为 true 时启动器会改写 `dsh.yaml` 并自动 `git commit`。片段与 AI prompt 用 `<!-- fixture: ... -->` 注释标记，测试据此抽取。

可测试性：不重构 `scripts/sync.mjs`。测试复用既有黑盒夹具方式——把 README 片段写成临时仓库的 `dsh.yaml`，复制 sync 及其 `scripts/lib/` 依赖，以临时 `DSH_HOME` 与假 `DSH_BIN` 运行 sync，断言退出码 0 且没有安装动作。这样验证的就是真实校验逻辑，且不触碰生产代码（review C2）。

AI prompt 以 `[ASK-PATH]` 等固定英文规则标签组织，测试只断言六个标签都存在；措辞是否与标签语义一致由人工验收承担（review M2）。

备选：新增 `templates/dsh.minimal.yaml` 或 `dsh init --minimal`。否决理由：用户要求轻量；模板文件会成为第二个需要随 `dshVersion` 同步的真相源。备选：导出 `validateManifest` 供测试调用。否决理由：需要改 sync 模块结构，超出本 change 的「不改行为」边界，黑盒夹具已足够。

### D3 插件索引手写，由测试保证与 manifest 一致

索引按类别分组（Third-party packages / Official optional / Third-party resources / Adapted third-party skills / Self-developed packages / Self-developed skills, preset & patch / Self-developed, separate repo），每行为 `[id](link) — 一句话`。测试只校验 id 覆盖、链接形态与无版本号，不生成内容。

备选：从 `brief` 自动生成表格。否决理由：`brief` 是给启动清单看的中文短语，不适合直接当英文门面文案；生成器会让 README 依赖构建步骤。

### D4 docs 准入：白名单目录 + 被入口文档引用 + 旧路径清零

`docs/architecture/` 中的文件必须被 `README.md`、`CLAUDE.md` 或 `CONTRIBUTING.md` 链接，否则视为未准入。白名单检查放进 `scripts/check-tracked-artifacts.mjs`（与既有产物策略同一入口，CI 已运行）；markdown 相对链接可达、`docs/assets` 孤立资产、处置表一致性、全仓文本 `docs/notes/` 字面清零放进 `tests/repo-docs-governance.test.mjs`（review M3）。

`docs/notes/` 逐文件处置表（review M5）。移动的文件只改相对链接与开头归属说明；`archive/` 下只新增文件，不改既有文件。

| # | 源文件 | 处置 | 目标 | 理由 |
|---|---|---|---|---|
| 1 | `2026-09-15-concurrency-and-queueing.md` | 移动 | `openspec/changes/archive/2026-09-18-pet-unified-locus-collaboration/checking/research-concurrency-and-queueing.md` | 为该 change 的串行队列设计所做的调研 |
| 2 | `2026-09-15-concurrent-write-isolation.md` | 移动 | `openspec/changes/archive/2026-09-18-pet-unified-locus-collaboration/checking/research-concurrent-write-isolation.md` | 正文锚定该 change design.md:269 |
| 3 | `2026-09-15-memex-commit-attribution.md` | 移动 | `openspec/changes/archive/2026-09-20-dsh-memex-scoped-memory/commit-attribution.md` | 只解释该 change 的提交归属 |
| 4 | `2026-09-18-pet-locus-collaboration-phase2-friction-review.md` | 删除 | — | 含真实 session id、群 chat id 与本机组织路径，不应留在公开仓库；结论已拆入 BACKLOG（B026–B034） |
| 5 | `cockpit-bridge-061-deployment.md` | 移动 | `openspec/changes/upgrade-dsh-0-2-0-runtime/checking/cockpit-bridge-061-deployment.md` | 属于 0.2 升级的部署验收 |
| 6 | `dsh-0.1.5-rc.2-extension-point-survey.md` | 移动 | `openspec/changes/archive/2026-09-22-shrink-pet-compat-to-minimal/checking/extension-point-survey.md` | 为收缩 Pet compat 所做的上游勘察 |
| 7 | `dsh-home-agent-instructions.md` | 移动并改写 | `docs/architecture/agent-instructions.md` | 描述当前 `agentInstructions` 机制，被 README 链接 |
| 8 | `dsh-memex-integration.md` | 移动 | `packages/dsh-memex/docs/integration-notes.md` | 只与 dsh-memex 当前实现相关 |
| 9 | `dsh-openspec-generation-identity.md` | 移动 | `packages/dsh-openspec/docs/generation-identity.md` | 只与 dsh-openspec 当前实现相关 |
| 10 | `dsh-plugin-integration-pitfalls.md` | 移动 | `docs/architecture/dsh-plugin-integration-pitfalls.md` | `CLAUDE.md` 强制前置阅读，跨插件通用 |
| 11 | `federated-dsh-operations.md` | 删除 | — | `dsh-federation` 已不在仓库，设计与证据保留在归档 change `2026-08-27-federated-dsh-control-plane` |
| 12 | `local-manifest-overlay.md` | 移动并改写 | `docs/architecture/private-overlay.md` | 描述当前 overlay 机制，被 README 架构章节链接 |
| 13 | `pet-independent-agent-capability-audit.md` | 移动 | `openspec/changes/pet-locus-independent-agent-inquiries/checking/capability-audit.md` | 正文声明对应该进行中 change |
| 14 | `pet-locus-delivery-safety-hardening-live-acceptance.md` | 移动 | `openspec/changes/archive/2026-09-19-pet-locus-delivery-safety-hardening/checking/live-acceptance.md` | 该 change 的真机验收清单 |
| 15 | `pet-locus-host-capability-audit.md` | 移动 | `openspec/changes/archive/2026-09-18-pet-unified-locus-collaboration/checking/host-capability-audit.md` | 正文声明为该 change 的边界审计 |
| 16 | `pet-locus-independent-child-handoff.md` | 移动 | `openspec/changes/archive/2026-09-15-pet-locus-independent-child/handoff.md` | 正文声明对应该 change |
| 17 | `pet-locus-on-demand-tree-handoff.md` | 移动 | `openspec/changes/archive/2026-09-15-pet-locus-on-demand-tree/checking/live-acceptance.md` | 正文声明对应该 change |
| 18 | `pet-locus-plan-ab-maintenance-cost-analysis.md` | 移动 | `packages/dsh-pet/docs/locus-plan-ab-cost-analysis.md` | ADR-0006/0007 的成本依据，无单一 change 归属，只与 dsh-pet 相关 |
| 19 | `pet-locus-spike-findings.md` | 移动 | `openspec/changes/archive/2026-09-15-pet-locus-multi-binding/checking/spike-findings.md` | 该 change proposal 引用的 spike |
| 20 | `pet-media-official-cli-download.md` | 移动 | `packages/dsh-pet/docs/media-download.md` | 描述 Pet 当前媒体下载实现 |
| 21 | `pet-mention-open-id-and-asker-name.md` | 移动 | `openspec/changes/archive/2026-09-19-pet-mention-open-id-and-asker-name/notes.md` | 该文件由此 change 的任务 15 创建（tasks.md:15），用于把随 `pet-locus-delivery-safety-hardening` 发布的行为补进规范；按「由哪个 change 写成」归属 |
| 22 | `pet-unified-locus-cutover.md` | 移动 | `openspec/changes/archive/2026-09-18-pet-unified-locus-collaboration/cutover-runbook.md` | 正文声明为该 change 的 runbook |
| 23 | `sync-clean-first-build-breaks-deployment.md` | 转 BACKLOG | `BACKLOG.md` 缺陷备忘新条目 | 状态「待处理」的缺陷，不是长期文档 |
| 24 | `upgrade-dsh-0-2-0-devbox-validation.md` | 移动 | `openspec/changes/upgrade-dsh-0-2-0-runtime/checking/devbox-validation.md` | 该进行中 change 的验收记录 |
| 25 | `ws-clean-archived-and-loaded-deadlock.md` | 转 BACKLOG | `BACKLOG.md` 缺陷备忘新条目 | 状态「待处理」的缺陷 |

脱敏是**实施期门禁**，规划只规定规则与验收口径，不预先穷举条目：

1. 自动规则（下表）作用于所有处置不是「删除」的文件（含转入 BACKLOG 的内容）：

| 类别 | 匹配 | 替换为 |
|---|---|---|
| 飞书用户 ID | `ou_[0-9a-f]{16,}` | `ou_<redacted>` |
| 飞书群 ID | `oc_[0-9a-f]{16,}` | `oc_<redacted>` |
| 飞书消息/话题 ID | `om[a-z]{0,2}_[0-9a-zA-Z]{12,}` | `om_<redacted>` |
| UUID（含截断形式） | `(session-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4,12}` | `session-<redacted>` |
| 本机路径 | `/(Users\|home)/<name>/` | `~/` |
| devbox 主机名 | `n37-[0-9-]+` | `<devbox>` |

2. 人工项：规则无法匹配的可识别信息（真实人名、bot 显示名、私有仓库名与提交号、账号、组织专属域名或链接）由 P1 执行者在迁移时逐项登记到 `notes-disposition.json` 的 `manualRedactions` 并替换。规划期评审已发现的项作为初始登记写入（人名 2 个、bot 显示名 1 个、私有仓库名与提交号 1 处），但**不声称完整**。公开第三方包名、作者 npm scope、公开文档链接与 change `externalize-org-specific-values` 引入的占位名（`git.corp.example`、`acme`）不算可识别信息。
3. 验收：① 测试扫描迁移目标，不得命中任何自动规则或已登记人工项；② `notes-migration-diff.mjs` 的剩余差异只能是已登记的人工项；③ Lead 逐份通读全部非删除迁移产物，按上面的检查清单判定，每份文件的结论（通过 / 补登记后通过）写入 `verify.md`。三者都满足才算 P1 的 docs 迁移验收通过。

处置表与脱敏规则另存为 `openspec/changes/github-facade-refresh/notes-disposition.json`（机器可读，测试与维护脚本读取）。每行含 `n`、`source`、`action`（`move`/`move-rewrite`/`delete`/`backlog`）、`target`、`reason`、`autoRedact`（非删除行恒为 true）、`manualRedactions`（实施期补全）。本节表格是其人类可读呈现，测试逐行比较两者的 `source`、`action`、`target`、`reason`。所有引用（`CLAUDE.md`、`CONTRIBUTING.md`、`.gitignore`、`.env.local.example`、ADR-0006、进行中 change、`dsh.yaml`、源码注释、issue 模板、BACKLOG）同步更新为新路径。`.gitignore` 中 `docs/notes/<topic>.local.md` 的本地笔记约定改为 `*.local.md` 通用规则。

备选：保留 `docs/notes/` 并只加 README 索引。否决理由：用户要求记录统一进 OpenSpec、docs 严格准入。

### D5 双语成对的范围与语言判定

成对要求覆盖除 `openspec/` 外的全部被跟踪 `README.md`（根、packages、patches、presets、skills，以及 `packages/dsh-pet/compat/subagent/`、`packages/sidebar-session-provider-icon/src/client/assets/` 这类内部说明）。语言用 CJK 统一表意文字比例判定（英文 < 5%，中文 > 20%），以 Unicode code point 计数，剔除代码块、行内代码与链接目标后计算——这是能机械断言的最小规则（review S3）。

社区文档（CONTRIBUTING、SECURITY、CODE_OF_CONDUCT）改为英文为主，但不强制 `.zh.md`，因为它们不是 README；其中的中文内容删除而非并列。

备选：只对根 README 做双语。否决理由：用户明确要求所有 README 都有 `.zh`。

### D6 package README 分级与截图隐私门禁

分级由各 package `package.json` 的 `ohmydsh.docTier` 声明（单一数据源，review S2）：A = `dsh-pet`、`dsh-memex`、`worktree-session`、`dsh-openspec`；B = `sidebar-session-provider-icon`、`session-title-copy`、`system-clock`、`session-links`、`home-network-model-guard`；C = `subscriptions-sandbox-shim`、`cockpit-worktree-open-shim`、`cockpit-memex-browse-shim`。A/B 级首屏必须有位图截图（与 proposal 的「截图」承诺一致，review M4）；A 级可再加 archify 示意图。

截图流程：一名 teammate 用隔离 `DSH_HOME`（临时目录）与非 3080 端口启动实例，`node scripts/sync.mjs` 物化本仓库配置，只填充合成会话与数据，用 Chrome CDP 截图；截图串行完成，避免多实例争抢端口与 profile。隐私不能由测试证明（review C3），所以拆成两层：
- 机械层：`SCREENSHOTS.md` 五字段登记行、单张 ≤ 400 KiB。
- 人工门禁：Lead 逐张查看，按检查清单（会话标题与正文、路径与用户名、hostname、账号与邮箱、组织专属域名或链接、token/key 片段）判定，结论写入登记行与 `verify.md`。未通过的退回重拍。

若某插件的主功能在隔离实例中无法呈现（例如需要飞书绑定的 Pet 功能），截图改为该插件在隔离实例中可呈现的界面（如 Pet 设置页、管理面板的空态或合成数据态），A/B 级的位图截图要求不放宽；不得用真实实例截图替代。若连这一点也做不到，必须修订本 design 与 spec 的分级并重新评审，不允许执行期自行降级。

`package.json` 新增元数据会改变 local package 的内容哈希，下次 sync 会重建并重装这些 package；运行行为不变。

备选：使用用户日常实例截图后人工打码。否决理由：真实会话标题、路径、hostname 很容易遗漏；合成数据从源头避免泄漏。备选：分级表写在测试里。否决理由：新增 package 需要改测试实现。

### D7 note 精简、brief 补齐与一次性结构等价验收

每条 note 只保留「来源/许可或 change 名 + 信任面要点 + 升级复核点 + 回滚/移除路径」，≤ 600 code point；条目上方的逐版本历史注释删除。其它 current spec 对特定条目规定的事实类别（`dsh-openspec` 条目的 upstream、license、telemetry、credential、upgrade、removal）由 `tests/manifest-notes.test.mjs` 以关键词逐项检查（review C1）。

结构等价是一次性迁移验收，不是长期回归（review M1）：新增 `scripts/maintenance/manifest-structure-diff.mjs <base-ref>`，用 `git show <base-ref>:dsh.yaml` 取迁移前版本，与工作树版本分别解析、删除 note/brief 后深度比较，输出 `structure unchanged` 或差异路径并以非零退出。迁移完成时运行一次，命令与输出记入 `verify.md`；该脚本留在 `scripts/maintenance/`，以后做类似整理时可复用。

与 `upgrade-dsh-0-2-0-runtime` 的冲突处理：本 change 在 tasks 中修改该 change 的任务 7.1 描述，使其遵循新形态；`dsh.yaml` 精简放在实施最后一个内容阶段，执行前先合入最新 main 以减少冲突，`<base-ref>` 取执行当时的 HEAD。

备选：把 note 移到独立的 `docs/plugins.md`。否决理由：会增加一个需要同步的文件，且 note 与条目共存最自然。备选：长期 fixture 对比。否决理由：会冻结整个 manifest，后续正常 pin 更新都要改基线。

### D8 架构图

用 archify 产出两张 showcase 级图：更新后的总架构图（在现有图源上增加私有 overlay 根与 `thirdPartyResources`）与新增的生命周期图（加入 → 审查 → pin → build → 验证 → 升级 → 禁用 → 移除 / reset），各自提交 JSON 图源与 dual SVG，`check-tracked-artifacts.mjs` 的必需清单加入生命周期图两件。图中文案为英文；中文 README 复用同一张图。

备选：中英文各一套图。否决理由：重复资产违反「同图不保留多套导出」，且维护成本翻倍。

### D9 实施编排：Team 模式分阶段验收

| 阶段 | 内容 | 执行 | 写入范围 |
|---|---|---|---|
| P1 卫生与准入 | 入口文件、遗留产物、`"2"` 依赖、docs 按处置表迁移并脱敏、白名单/链接/旧路径/脱敏测试、`notes-migration-diff.mjs`、CLAUDE/CONTRIBUTING 阅读顺序、BACKLOG 清理 | 1 名 teammate | 根文件、`docs/`、迁入目标目录、`scripts/check-tracked-artifacts.mjs`、`tests/`、BACKLOG、引用文件 |
| P2 门面 | 根 README 双语、AI prompt、两张图、facade 测试 | 2 名 teammate 并行（文案 / 图） | 根 README*、`docs/assets/`、`tests/repo-facade.test.mjs` |
| P3 插件 README | 4 名 A 级各 1 人，B 级合 1 人，C 级与 patches/presets/skills/内部 README 合 1 人，截图 1 人 | 最多 7 名 teammate（Team 上限 8，需在 P2 成员结束后创建） | 各自 `packages/<id>/`、`skills/`、`patches/`、`presets/` |
| P4 note 精简 | `dsh.yaml` note/brief、manifest-notes 测试、结构等价脚本、改写 upgrade change 任务 7.1 | 1 名 teammate | `dsh.yaml`、`tests/manifest-notes.test.mjs`、`scripts/maintenance/`、`openspec/changes/upgrade-dsh-0-2-0-runtime/tasks.md` |
| P5 终审 | 全量评审 + 修复 | 1 名评审 teammate，修复由 Lead 执行 | 只读 / Lead |

每阶段流程：Lead 在共享任务板建任务（含验收标准与写入范围）→ spawn teammate → 交付 → Lead 按 test-plan 对应行与人工检查清单验收 → 不合格则 `send_message` 退回原 teammate。阶段最多 5 轮，超出即停下询问用户。每阶段通过后由 Lead 在 `ws/` 任务分支提交一次。全量 `npm test` 与 sync 只由 Lead 在阶段验收时串行运行。

teammate 模型：`spawn_teammate` 没有模型参数，按源码 teammate 创建时继承 Lead 的 provider/model；Team profile 同时禁用了可选模型的 `subagent` 工具。用户已在 DSH 设置中配置子 agent 模型；P1 派出第一个 teammate 后立即用 `list_agents` 核对其 `model` 字段，若不是 Sonnet 则中止该成员，改为每次派发前把 Lead 会话临时切到 `claude-sonnet-5-5`、spawn 后切回。

备选：每阶段用一次 workflow 编排（支持按 agent 指定模型）。否决理由：Worktree Session 守卫拒绝 workflow 工具；Team 模式的任务板与消息更适合多轮退回。备选：把本 change 拆成门面与治理两个 change（review S1）。否决理由：分阶段提交已提供独立回滚点；拆分会让 README 的链接与 docs 迁移跨 change 互相阻塞。

## Risks / Trade-offs

- [双语文件长期语义不同步] → 锚点只保证结构一致；在 CONTRIBUTING 中写明修改 README 必须同时改 `.zh.md`，P5 评审抽查语义一致性。
- [CJK 比例阈值误判]（如英文 README 引用中文 UI 文案） → 阈值 5% 留有余量，代码块、行内代码与链接目标不计；确需例外时在测试中按文件登记豁免并写明理由。
- [docs/notes 迁移丢失仍有用的知识] → 处置表逐文件给出去向，只有 2 份删除且写明理由；引用由链接与旧路径测试兜底；内容保真由 `notes-migration-diff.mjs` 一次性验收。
- [迁移目标仍含真实标识] → 自动规则作用于全部迁移文件 + 实施期人工登记 + 测试扫描 + Lead 逐份通读门禁（结论入 verify）；仓库其它位置与 git 历史中的同类标识不在本 change 范围，记入 BACKLOG（用户 2026-10-09 确认的范围）。
- [截图泄漏隐私] → 合成数据实例 + Lead 人工门禁 + verify 记录；测试只覆盖登记与体积，不宣称证明隐私。
- [隔离实例无法呈现部分功能] → 按 D6 改截该插件在隔离实例中可呈现的界面；仍做不到则修订 design/spec 的分级并重新评审，不允许执行期降级。
- [与 main 上的 `dsh.yaml` pin 更新冲突] → P4 放在最后，执行前先合入最新 main。
- [多名 teammate 同时跑测试或 sync 互相干扰] → teammate 只跑自己范围的测试；全量测试与 sync 由 Lead 串行执行。
- [teammate 未按要求使用 Sonnet] → 派发后用 `list_agents` 核对 `model` 字段。
- [单个 change 范围较大] → 分阶段提交，每阶段独立可回滚。

## Migration Plan

1. P1–P4 按阶段提交到 `ws/openspec-explore-github-0-dsh-1-quick-start-temp`。
2. 每阶段提交前运行 `npm test`、`npm run check:artifacts`；P4 额外运行 `scripts/maintenance/manifest-structure-diff.mjs`，并在隔离 `DSH_HOME` 中连续运行两次 `node scripts/sync.mjs` 确认第二次无变化（不触碰日常 `~/.dsh`）。
3. P5 通过后由用户确认，再用 `scripts/ws-merge.mjs` 合入 main。
4. 回滚：本 change 只改文档、测试、`dsh.yaml` 的说明字段、package 元数据与根依赖中的误装包，revert 合并提交即可。

## Open Questions

- BACKLOG 中「已落地」的判定：以条目状态为「已完成/已落地」或已有对应归档 change 为准；边界条目由 Lead 列出请用户确认。
