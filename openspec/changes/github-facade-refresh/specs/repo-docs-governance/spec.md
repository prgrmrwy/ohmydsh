## ADDED Requirements

### Requirement: docs 目录实行准入白名单
`docs/` 下被 git 跟踪的文件必须(SHALL)只位于 `docs/adr/`、`docs/architecture/`、`docs/assets/` 三个子目录。`docs/adr/` 只收录已接受的长期架构决策；`docs/architecture/` 只收录描述当前系统结构与机制、且被 `README.md`、`CLAUDE.md` 或 `CONTRIBUTING.md` 链接的文档；`docs/assets/` 只收录被仓库内被跟踪 markdown 文件引用的图形资产，或与被引用 SVG 同名（`<name>.json` 对应 `<name>.dual.svg`）的可编辑图源。调研、验收记录、事故复盘、提交归属说明等时间点性材料不得(SHALL NOT)进入 `docs/`，应归入所属 OpenSpec change 目录、所属 package 目录或 BACKLOG。

#### Scenario: docs 只含白名单目录
- **GIVEN** 已应用本 change 的仓库
- **WHEN** 测试列出 git 跟踪的 `docs/**` 文件
- **THEN** 每个文件路径都以 `docs/adr/`、`docs/architecture/` 或 `docs/assets/` 开头，且 `docs/architecture/` 中每个文件都被 `README.md`、`CLAUDE.md` 或 `CONTRIBUTING.md` 至少一处链接

#### Scenario: 新增 docs/notes 文件
- **GIVEN** 某次提交新增 `docs/notes/2026-10-10-spike.md`
- **WHEN** 运行 `npm run check:artifacts`
- **THEN** 检查失败并点名该文件不在 docs 白名单内

#### Scenario: docs/assets 出现孤立资产
- **GIVEN** `docs/assets/` 中有一个既不被任何被跟踪 markdown 引用、也不是被引用 SVG 的同名图源的文件
- **WHEN** 运行仓库测试
- **THEN** 测试失败并点名该孤立资产

### Requirement: docs/notes 按已批准的处置表迁出并脱敏
`docs/notes/` 全部 25 个文件必须(SHALL)按 `openspec/changes/github-facade-refresh/notes-disposition.json` 处置（`move`、`move-rewrite`、`delete`、`backlog`），`design.md` 中的处置表是其人类可读呈现。迁移完成后 `docs/notes/` 不得(SHALL NOT)存在任何被跟踪文件。处置为 `move` 的文件，内容只允许三类修改：仓库内相对链接改写、开头增加一行以 `> Migrated from docs/notes/` 开头的归属说明、脱敏替换；处置为 `move-rewrite` 的文件可重写为当前机制说明。

所有非删除的迁移产物（含写入 BACKLOG 的内容）必须(SHALL)脱敏：不得出现 `redactionRules` 能匹配的文本，也不得出现 `manualRedactions` 登记的条目。人工条目在实施期由迁移执行者登记并补全；规划不保证其完整。脱敏完整性的最终判定是人工门禁：Lead 逐份通读全部非删除迁移产物，对照检查清单（真实人名与 bot 显示名、账号、私有仓库名与提交号、组织专属域名或链接、会话与群标识、本机路径与主机名），把每份结论写入本 change 的 `verify.md`。本要求只约束本次迁移产物；仓库其它文件与 git 历史不在范围内。

#### Scenario: 迁移与处置表一致
- **GIVEN** 处置文件与迁移后的工作树
- **WHEN** 测试读取每一行的源文件与目标
- **THEN** 每个 `move`/`move-rewrite` 行的目标被跟踪，`move` 行目标首行为归属说明，`git ls-files docs/notes` 为空，且每个 `move` 源文件的一级标题在被跟踪 markdown 中只作为一级标题出现一次、就在其目标文件里

#### Scenario: 移动到处置表之外或产生副本
- **GIVEN** 某个 `docs/notes` 文件被复制到处置表之外的第二个路径
- **WHEN** 运行仓库测试
- **THEN** 测试失败，报告该一级标题出现在多个文件中

#### Scenario: 迁移产物残留规则可匹配的标识或已登记人工项
- **GIVEN** 某迁移产物仍含一个完整 `ou_` ID，或仍含 `manualRedactions` 已登记的人名
- **WHEN** 运行仓库测试
- **THEN** 测试失败并列出文件、行号与命中的规则类别或登记项

#### Scenario: move 文件正文被改写
- **GIVEN** 某个 `move` 目标文件除脱敏、相对链接与归属说明外还删改了一段正文
- **WHEN** 执行 `node scripts/maintenance/notes-migration-diff.mjs <base>`（对源文件应用同一脱敏后，与目标逐行比较；只把仓库内相对链接目标规范化为解析后的被跟踪路径，外部 URL 按字节比较）
- **THEN** 命令以非零退出码结束并输出差异行

#### Scenario: 人工门禁发现未登记的可识别信息
- **GIVEN** Lead 通读时在某迁移产物中发现一个未登记的真实人名
- **WHEN** 执行人工门禁
- **THEN** 该名字被补登记到 `manualRedactions` 并替换，测试重跑通过后该文件结论记为「补登记后通过」；`verify.md` 中任何一份文件缺少结论都视为 P1 未通过

### Requirement: 仓库内不残留失效的文档路径引用
git 跟踪的 markdown 文件（排除 `openspec/changes/archive/`）中所有指向仓库内路径的相对链接与图片引用必须(SHALL)解析到被跟踪的文件或目录；带 `#L<n>` 行锚的链接只校验文件存在。此外，所有被跟踪的文本文件（排除 `openspec/changes/archive/` 与本 change 目录）中不得(SHALL NOT)出现字面 `docs/notes/`。外部 URL 不在此要求范围内。

#### Scenario: 链接全部可达
- **GIVEN** 已应用本 change 的仓库
- **WHEN** 测试解析所有被跟踪 markdown 中的相对链接
- **THEN** 每个链接目标都在 git 跟踪列表中，或是被跟踪文件的父目录

#### Scenario: 迁移文档后遗留旧链接
- **GIVEN** 某 markdown 文件仍链接已删除的 `docs/notes/local-manifest-overlay.md`
- **WHEN** 运行仓库测试
- **THEN** 测试失败并列出源文件、行号与失效目标

#### Scenario: 源码注释或配置样例残留旧路径
- **GIVEN** `.env.local.example` 或 `packages/dsh-pet/src/index.ts` 的注释仍写着 `docs/notes/dsh-plugin-integration-pitfalls.md`
- **WHEN** 运行仓库测试
- **THEN** 测试失败并列出文件与行号

### Requirement: 仓库内每份 README 都有中文对照
除 `openspec/` 外，git 跟踪的每个 `README.md` 必须(SHALL)在同一目录配有被跟踪的 `README.zh.md`，且两份文件都在前 15 行内链接对方。`README.md` 默认使用英文：将 fenced code block、行内代码与 markdown 链接目标剔除后，CJK 统一表意文字（U+4E00–U+9FFF）占非空白 Unicode code point 的比例必须(SHALL)低于 5%；`README.zh.md` 的同一比例必须(SHALL)高于 20%。

#### Scenario: 所有 README 成对且互链
- **GIVEN** 已应用本 change 的仓库
- **WHEN** 测试遍历 git 跟踪的 README 文件
- **THEN** 每个 `README.md` 都有同目录 `README.zh.md`，两者前 15 行互相链接，语言比例满足阈值

#### Scenario: 新增 package 缺中文 README
- **GIVEN** 新增 `packages/new-plugin/README.md` 但没有 `README.zh.md`
- **WHEN** 运行仓库测试
- **THEN** 测试失败并点名缺少中文对照的目录

#### Scenario: 英文 README 实际是中文
- **GIVEN** 某个 `README.md` 正文主要由中文写成
- **WHEN** 运行仓库测试
- **THEN** 测试失败并报告该文件的 CJK 比例

### Requirement: Agent 入口文件在大小写敏感文件系统上有效
仓库根 `AGENTS.md` 必须(SHALL)是相对目标恰为 `CLAUDE.md` 的符号链接，且 `CLAUDE.md` 必须(SHALL)是被跟踪的普通文件。仓库根不得(SHALL NOT)跟踪 `claude.md`、`agents.md` 等仅大小写不同的同名文件。

#### Scenario: AGENTS.md 指向 CLAUDE.md
- **GIVEN** 已应用本 change 的仓库
- **WHEN** 测试读取 git 索引中 `AGENTS.md` 的模式与 blob 内容
- **THEN** 模式为 `120000` 且 blob 内容字节等于 `CLAUDE.md`，`CLAUDE.md` 模式为 `100644`

#### Scenario: 链接目标大小写错误
- **GIVEN** `AGENTS.md` 的链接目标为 `claude.md`
- **WHEN** 运行仓库测试
- **THEN** 测试失败并报告实际链接目标

### Requirement: 自研 package README 按分级呈现
每个 `packages/<id>/` 必须(SHALL)在其 `package.json` 中声明 `ohmydsh.docTier`，取值 `A`、`B` 或 `C`；未声明或取值非法时测试失败。每份 package `README.md` 与 `README.zh.md` 在首个二级标题之前必须(SHALL)有一段说明，回答「它为用户解决什么问题」；该段落紧跟 `<!-- problem -->` 注释，且至少 40 个非空白 code point。说明是否真正回答了用户问题由 P3 阶段验收人工判定。A 级与 B 级必须(SHALL)在首个二级标题之前嵌入至少一张位于该 package `docs/` 下的位图（png/jpg/jpeg/webp）。位图的内容类型在 `SCREENSHOTS.md` 的 `kind` 列登记，取值 `screenshot`（隔离实例中的真实界面）或 `illustration`（由受审阅的图源栅格化得到的示意图，图源 JSON/SVG 同目录提交）。`illustration` 只允许用于 `worktree-session`、`dsh-openspec`、`sidebar-session-provider-icon`、`session-title-copy`、`session-links` 这五个 package（理由：隔离实例没有模型凭据，无法产生带标题与消息的会话），且其 `note` 列必须(SHALL)恰好包含短语 `isolated instance has no model credentials`。其余 A/B 级 package（`dsh-pet`、`dsh-memex`、`system-clock`、`home-network-model-guard`）必须(SHALL)使用 `screenshot`。新增或调整 `illustration` 的适用范围属于规范修订，必须经 design 与 spec 评审，不得在执行期改动测试里的允许名单。C 级不得(SHALL NOT)要求图片，但必须(SHALL)有章节锚点为 `removal` 的章节，说明它连接哪两端、何时可以移除。

#### Scenario: 各级 README 满足呈现要求
- **GIVEN** 已应用本 change 的仓库
- **WHEN** 测试读取每个 package 的 `ohmydsh.docTier` 并检查其 README 对
- **THEN** 每份 README 首个二级标题前都有紧跟 `<!-- problem -->` 且不少于 40 个非空白 code point 的段落，A/B 级首个二级标题前引用了存在于该 package `docs/` 下的位图，C 级含 `removal` 章节

#### Scenario: 首屏说明人工验收
- **GIVEN** P3 交付的全部 package README
- **WHEN** Lead 执行 P3 阶段验收
- **THEN** Lead 逐个确认 `problem` 段落讲清了用户问题、中英语义一致，并把每个 package 的结论写入 `verify.md`；任何一个缺少结论都视为 P3 未通过

#### Scenario: 新增 package 未分级
- **GIVEN** 新增 `packages/new-plugin/` 且其 `package.json` 没有 `ohmydsh.docTier`
- **WHEN** 运行仓库测试
- **THEN** 测试失败并要求为该 package 声明级别

#### Scenario: A/B 级首屏只嵌入了 SVG 而没有栅格位图
- **GIVEN** 某 A/B 级 package 的 README 首屏只嵌入一张 SVG，没有任何位于其 `docs/` 下的 png/jpg/jpeg/webp
- **WHEN** 运行仓库测试
- **THEN** 测试失败，报告该 package 缺少合格位图（screenshot 或 illustration 的栅格文件）

### Requirement: 入库截图经隐私门禁并登记来源
截图必须(SHALL)只来自填充合成数据的隔离 `DSH_HOME` 实例，不得(SHALL NOT)来自日常使用的 `~/.dsh` 实例。来源与内容是否脱敏无法由测试证明，因此每张新增或修改的位图（含示意图）**及其同目录提交的图源文件**（`.json`/`.svg`，含元数据、注释、隐藏图层与未渲染文本）必须(SHALL)在合入前通过人工隐私门禁：Lead 逐张查看并对照检查清单（会话标题与正文、文件路径与用户名、hostname、账号与邮箱、组织专属域名或链接、token 与 key 片段）。可机械断言的部分为：被 README 嵌入的每张位图必须(SHALL)在同目录 `SCREENSHOTS.md` 中有登记行（文件名、`kind`、拍摄或生成来源、日期、隐私门禁检查人与结论、`note`），且单张不超过 400 KiB。

#### Scenario: 截图已登记且体积合规
- **GIVEN** 已应用本 change 的仓库
- **WHEN** 测试遍历被 README 引用的位图
- **THEN** 每张都在同目录 `SCREENSHOTS.md` 有包含 `file`、`kind`、`source`、`date`、`reviewer`、`verdict`、`note` 字段的登记行，`kind` 只能是 `screenshot` 或 `illustration`；`illustration` 行只允许出现在上述五个 package 的目录下，其 `note` 含短语 `isolated instance has no model credentials`，且同目录存在同名图源（`.json` 或 `.svg`）；`screenshot` 行的 `note` 不得含该短语；文件不超过 400 KiB

#### Scenario: 示意图被用于必须截图的 package 或理由不符
- **GIVEN** `packages/dsh-pet/docs/SCREENSHOTS.md` 中有一行 `kind=illustration`，或某五个允许 package 之一的 `illustration` 行 `note` 写成 `unavailable`，或缺少同名图源，或 `kind` 为未知值，或 `screenshot` 行的 `note` 含有 `isolated instance has no model credentials`
- **WHEN** 运行仓库测试
- **THEN** 测试失败并点名文件、行与违规原因

#### Scenario: 未登记的截图
- **GIVEN** 某 README 新嵌入一张未在 `SCREENSHOTS.md` 登记的 png
- **WHEN** 运行仓库测试
- **THEN** 测试失败并点名该图片

#### Scenario: 图源文件含位图中不可见的敏感信息
- **GIVEN** 某示意图的 `.svg` 或 `.json` 图源在位图中不可见的位置（元数据、注释、隐藏图层、未渲染文本）含有真实路径、主机名、账号、URL 或 token 片段
- **WHEN** Lead 执行隐私门禁
- **THEN** 该示意图被退回，登记行结论不得填写为通过；门禁对图源文件按与位图相同的检查清单逐项检查，并在 `verify.md` 写明「图源已检查」

#### Scenario: kind 与实际来源不符
- **GIVEN** 某 `kind=screenshot` 的位图实际是合成的示意图，或某 `kind=illustration` 的位图不是由同目录登记的图源栅格化得到
- **WHEN** Lead 执行来源核验
- **THEN** Lead 对每个 `screenshot` 行确认其来自隔离 `DSH_HOME` 实例（拍摄过程记录在 `verify.md` 的 P3 小节：端口、主机名遮罩证据、清理证据），对每个 `illustration` 行把同目录图源用登记的渲染器与参数重新栅格化，并与已提交位图做像素比对（相同渲染器与参数下要求逐像素一致；若渲染器输出不确定，则退而要求目视一致并在记录中说明）；比对记录必须写入 `verify.md`，含图源路径、渲染器与版本、完整命令与选项、比对准则与结果；任一行无法核实来源即视为 P3 未通过，`verdict` 不得填写为通过

#### Scenario: 截图含敏感信息
- **GIVEN** 一张截图中可见真实 hostname
- **WHEN** Lead 执行隐私门禁检查
- **THEN** 该截图被退回重拍，登记行结论不得填写为通过；`verify.md` 记录每张截图的门禁结论
