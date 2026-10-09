## Why

ohmydsh 的 GitHub 门面停留在 2026-08-28 那次「开源范」整理：README 以中文为主、混入大量运维细节且已有过时内容（`llm-subscriptions` 写 `0.8.0` 实为 `0.9.7`、rc.2 临时策略在 0.2 线已无意义），没有说明「一个人如何用本仓统一、可迭代地管理自己的 DSH 配置全生命周期」，也没有面向自研插件的能力索引。仓库卫生同步退化：`AGENTS.md` 指向不存在的小写 `claude.md`（大小写敏感文件系统上为断链）、根目录残留调试截图与生成文档、`docs/notes/` 累积 25 份无准入规则的调研/验收记录、`dsh.yaml` 的 `note` 单条最长近万字已无法给人阅读。

本仓库的两类读者——**要自己管理 DSH 的人或 AI**、**关注自研插件解决什么问题的人或 AI**——目前都拿不到一条清晰路径。

## What Changes

- **BREAKING（文档入口）**：根 `README.md` 重写为英文门面，新增 `README.zh.md`；删除 `README.en.md`。旧 README 的运维细节不迁移，过时内容直接删除。
- 新门面按读者组织：核心作用（聚合、可迭代管理 DSH 配置及其生命周期）→ Quick Start（照抄全部 / 挑选 / 从零 三条路径 + 一段可直接交给 AI 的安装 prompt）→ 架构（心智模型、定制来源、目录结构、生命周期、私有 overlay）→ 多机器（一句话 + 路由到 `dsh-cockpit` 仓库）→ 实际配置（指向 `dsh.yaml` 与 `plugin-list`）→ 插件索引（第三方链上游、自研链目录 README，均为名称链接 + 一句能力，不写版本号）。
- 「从零开始」不新增命令或模板文件：README 的 AI prompt 说明把 `dsh.yaml` 换成最小 manifest（`dshVersion` + `customizations: []` + `autoUpdate.enabled: false`）后 build；并明确 `dsh reset` 只撤销部署、不清空 manifest。
- 用 archify 重新产出两张图：更新后的总架构图（含私有 overlay 与 `thirdPartyResources`）与新增的定制生命周期图，各自保留可编辑 JSON 与 dual SVG。
- 每个仓库内被跟踪的 `README.md`（`openspec/` 除外）都配一份 `README.zh.md`，默认英文，彼此互链。12 个自研 package 的 README 按 A（主打，含首屏图）/ B（功能小件，1 张脱敏图）/ C（粘合层，无图）三级重写首屏。
- 截图只来自合成数据的隔离 `DSH_HOME` 实例；每张图经 Lead 人工隐私门禁并在 `SCREENSHOTS.md` 登记。测试只校验登记与体积，隐私结论由人工门禁负责。
- 每个自研 package 在 `package.json` 声明 `ohmydsh.docTier`（A/B/C），作为 README 分级的单一数据源。
- `docs/` 实行准入白名单：仅 `docs/adr/`、`docs/architecture/`、`docs/assets/`。`docs/notes/` 25 份文件按 design 中的逐文件处置表分流（迁入 `docs/architecture/`、迁入所属 package 或 change 的目录、转 BACKLOG 条目，或删除——其中一份复盘含真实会话与群标识，不应留在公开仓库），并更新全部引用，包括源码注释与配置样例。
- 卫生：`AGENTS.md` 改为指向 `CLAUDE.md`；删除 `.cdp-scratch-shot.png` 与 `worktree-session-architecture.md`；删除 `package.json` 中误装的 `"2"` 依赖；`CONTRIBUTING.md` / `SECURITY.md` / `CODE_OF_CONDUCT.md` 改为英文为主；`CLAUDE.md` 阅读顺序改指 `docs/architecture/`；BACKLOG 删除已落地条目。
- `dsh.yaml` 的 `note` 精简为人读摘要（来源与许可、信任面要点、回滚路径），历史与审查过程交由 git 与 OpenSpec；所有启用定制补齐 `brief`。manifest 的机器可读结构不变。
- 新增仓库级文档测试，把可机械断言的约束变成会失败的检查（插件索引与 manifest 一致、双语成对与章节锚点、链接可达与旧路径清零、docs 白名单、入口文件、截图登记、note 形态）；双语语义一致、AI prompt 措辞与截图隐私由人工门禁负责，不冒充测试覆盖。

## Capabilities

### New Capabilities

- `repo-facade`: 根 README 双语门面的结构、读者路径、AI 安装 prompt、插件索引与 manifest 的一致性、多机器路由。
- `repo-docs-governance`: `docs/` 准入白名单、所有 README 的双语成对与互链、仓库内相对链接可达、Agent 入口文件正确、自研 package README 分级与截图来源约束。

### Modified Capabilities

- `repo-layout`: 新增「manifest 条目说明以人读摘要为准」（`note` 形态、`brief` 完备性，并兼容其它 spec 规定的事实类别）与「note 精简迁移不改变 manifest 的机器可读结构」（一次性迁移验收）；「长期仓库仅保存必要且可维护的派生资产」扩展为覆盖多张架构图与根目录遗留产物。

## Impact

- 文档：根 README 全量重写；`README.en.md` 删除；新增 18 份左右 `README.zh.md`；12 个 package README 首屏重写；社区文档英文化。
- `docs/`：`docs/notes/` 整体移除；新增 `docs/architecture/`；`docs/assets/` 新增生命周期图源与 SVG。
- 代码引用：`packages/dsh-pet/src/**`、`packages/dsh-memex/src/run/browse-service.ts` 等注释中指向 `docs/notes/` 的路径需更新（只改注释，不改行为）；各自研 package 的 `package.json` 新增 `ohmydsh.docTier`，会使下一次 sync 重建并重装这些 package，运行行为不变。
- 新增 `scripts/maintenance/manifest-structure-diff.mjs`（一次性迁移验收用，不被 sync 调用）。
- `dsh.yaml`：仅 `note`、`brief` 与 YAML 注释变化；`scripts/plugin-list.mjs` 行为不变（已优先读 `brief`）。
- `scripts/check-tracked-artifacts.mjs`：必需跟踪清单增加生命周期图；禁止跟踪清单增加两个根目录遗留文件。
- 测试：新增 `tests/repo-facade.test.mjs`、`tests/repo-docs-governance.test.mjs`、`tests/manifest-notes.test.mjs`。
- 依赖：根 `package.json` / `package-lock.json` 删除 `"2"`（需先 `ws promote`）。
- 进行中 change `upgrade-dsh-0-2-0-runtime` 的任务 7.1（「把审查与回滚说明写回 note」）改为遵循新的 note 形态；`pet-locus-*`、`fix-openspec-generation-closure-identity`、`dsh-memex-defer-write-reminder` 中指向 `docs/notes/` 的引用随分流更新。
- 不影响 sync 物化行为、DSH 运行时与任何插件功能。
