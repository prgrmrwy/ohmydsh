## ADDED Requirements

### Requirement: 根 README 是英文默认、中文对等的双语门面
仓库根必须(SHALL)同时跟踪 `README.md`（英文）与 `README.zh.md`（简体中文），且不得(SHALL NOT)再跟踪 `README.en.md`。两份文件必须(SHALL)在前 30 行内互相链接对方。每个二级标题（`## `）后必须(SHALL)紧跟一个稳定的章节锚点注释 `<!-- section: <key> -->`，`<key>` 为小写 kebab-case；两份文件的章节锚点序列必须(SHALL)完全相同。章节内容的语义一致性不由测试判定，而由阶段验收与终审的人工检查承担。

#### Scenario: 双语门面成对存在且章节锚点一致
- **GIVEN** 已应用本 change 的仓库
- **WHEN** 测试列出 git 跟踪的根目录文件并解析两份 README
- **THEN** `README.md` 与 `README.zh.md` 均被跟踪、`README.en.md` 未被跟踪，两者前 30 行互相链接，且两份文件提取出的章节锚点序列逐项相等

#### Scenario: 中英章节不一致
- **GIVEN** 某次修改只在 `README.md` 增加了带锚点 `faq` 的章节
- **WHEN** 运行仓库测试
- **THEN** 测试失败，并报告两份文件锚点序列的第一个差异位置与值

#### Scenario: 二级标题缺少锚点
- **GIVEN** `README.zh.md` 某个 `## ` 标题后没有章节锚点注释
- **WHEN** 运行仓库测试
- **THEN** 测试失败并点名该标题所在行

### Requirement: 门面按两类读者组织核心章节
根 README 必须(SHALL)按以下顺序包含且只包含这八个章节锚点：`what-it-does`、`quick-start`、`architecture`、`multiple-machines`、`your-configuration`、`plugins`、`contributing`、`license`。`what-it-does` 必须(SHALL)陈述本仓库的核心作用：聚合并可迭代地管理一个人的 DSH 配置及其从加入、审查、固定版本、物化、升级、禁用到移除的全生命周期。`architecture` 必须(SHALL)覆盖心智模型（仓库是真相源、`~/.dsh` 是产物）、定制来源类型、目录结构、生命周期与私有 overlay 接入，并嵌入 `docs/assets/ohmydsh-architecture.dual.svg` 与 `docs/assets/ohmydsh-lifecycle.dual.svg`。

#### Scenario: 核心章节齐全且有序
- **GIVEN** 已应用本 change 的 `README.md` 与 `README.zh.md`
- **WHEN** 测试按出现顺序提取章节锚点并截取 `architecture` 章节
- **THEN** 两份文件的锚点序列都恰好等于上述八个锚点的顺序，`architecture` 章节内引用了两张 SVG，且 `what-it-does` 章节正文同时出现 `dsh.yaml`、`~/.dsh` 与生命周期动词集合（英文版：add、review、pin、build、upgrade、disable、remove；中文版：加入、审查、固定、物化、升级、禁用、移除）中的每一项

#### Scenario: 缺失必需章节
- **GIVEN** `README.md` 删去了 `multiple-machines` 章节
- **WHEN** 运行仓库测试
- **THEN** 测试失败并点名缺失的锚点

#### Scenario: 章节语义人工验收
- **GIVEN** P2 交付的两份 README
- **WHEN** Lead 执行 P2 阶段验收
- **THEN** Lead 逐章确认中英语义一致、`what-it-does` 讲清聚合与全生命周期，并把每章结论写入 `verify.md`；任何一章缺少结论都视为 P2 未通过

### Requirement: Quick Start 提供三条路径与可直接交给 AI 的安装 prompt
`quick-start` 必须(SHALL)给出三条路径：照抄完整配置、挑选部分定制、从零开始。从零开始路径必须(SHALL)只依赖现有命令：把 `dsh.yaml` 替换为仅含 `dshVersion`、`autoUpdate.enabled: false` 与空 `customizations` 的最小 manifest 后执行 `dsh build`；不得(SHALL NOT)为此新增命令、脚本或模板文件。该最小 manifest 必须(SHALL)出现在一个紧跟 `<!-- fixture: minimal-manifest -->` 注释的 ```yaml 代码块中，且其 `dshVersion` 必须(SHALL)等于根 `dsh.yaml` 的 `dshVersion`。

该章节必须(SHALL)包含一个紧跟 `<!-- fixture: agent-install-prompt -->` 注释的 fenced code block 作为给 AI agent 的安装 prompt。prompt 必须(SHALL)以编号规则列表的形式包含以下规则，每条规则行以固定的英文规则标签开头（中文版 prompt 同样保留英文标签）：`[ASK-PATH]` 先询问用户选择哪条路径；`[VERIFY-IDEMPOTENT]` 以连续两次 `dsh build` 第二次无变化作为验证；`[NO-DEPLOY-EDIT]` 不手改 `~/.dsh`；`[NO-SECRETS]` 不把凭据写入 manifest、命令参数或聊天；`[STOP-ON-FAIL-CLOSED]` 遇到 sync 的 fail-closed 报错时停止并报告，不删除文件绕过；`[ASK-RESTART]` 重启 DSH 前询问用户。README 必须(SHALL)明确 `dsh reset` 只撤销部署、不清空 manifest，不能作为从零开始的方式。规则措辞是否与标签语义一致不由测试判定，由人工验收承担。

#### Scenario: 最小 manifest 可被真实 sync 接受
- **GIVEN** README 中 `minimal-manifest` fixture 代码块
- **WHEN** 测试先解析该片段，断言其顶层键集合恰为 `{dshVersion, autoUpdate, customizations}`、`autoUpdate` 恰为 `{enabled: false}`、`customizations` 恰为空列表，然后把它写为临时仓库的 `dsh.yaml`，复制 `scripts/sync.mjs` 及其 `scripts/lib/` 依赖，以临时 `DSH_HOME` 与假 `DSH_BIN` 黑盒运行 sync（与既有 `tests/sync-profile-scaffold.test.mjs` 相同的夹具方式）
- **THEN** sync 以退出码 0 结束、没有安装任何定制，且片段的 `dshVersion` 等于根 `dsh.yaml` 的 `dshVersion`

#### Scenario: 最小 manifest 漂移
- **GIVEN** 根 `dsh.yaml` 的 `dshVersion` 升级而 README 片段未更新
- **WHEN** 运行仓库测试
- **THEN** 测试失败并同时报告两个版本值

#### Scenario: AI prompt 缺少规则
- **GIVEN** README 的 `agent-install-prompt` 代码块中缺少 `[NO-SECRETS]` 规则行
- **WHEN** 运行仓库测试
- **THEN** 测试失败并点名缺失的规则标签及所在文件

#### Scenario: 引用不存在的 dsh 子命令
- **GIVEN** 某次修改在 README 中写入 `dsh init`
- **WHEN** 测试把 README 中所有 `dsh <word>` 形式的子命令与 `bin/dsh` 参数解析 `case` 分支中声明的子命令集合比较
- **THEN** 测试失败，报告 README 引用了未实现的子命令 `init`

### Requirement: 多机器只做路由
`multiple-machines` 章节必须(SHALL)不超过 8 行非空正文，必须(SHALL)链接 `https://github.com/prgrmrwy/dsh-cockpit`，并必须(SHALL)说明每台机器各自 clone 本仓库（及可选私有 overlay）并 `dsh build`、cockpit 不分发配置。

#### Scenario: 多机器章节保持简短并指向 cockpit
- **GIVEN** 已应用本 change 的两份 README
- **WHEN** 测试截取 `multiple-machines` 章节正文
- **THEN** 非空行数不超过 8，包含 dsh-cockpit 仓库链接，且英文版正文同时含 `clone`、`dsh build` 与 `does not distribute`，中文版正文同时含 `clone`、`dsh build` 与「不分发」

#### Scenario: 多机器章节膨胀
- **GIVEN** 某次修改把 cockpit 的安装步骤整段复制进该章节，使非空行超过 8
- **WHEN** 运行仓库测试
- **THEN** 测试失败并报告实际行数

### Requirement: 插件索引与 manifest 保持一致且不含版本号
`plugins` 章节必须(SHALL)覆盖 `dsh.yaml` 中所有 `enabled: true` 的 `customizations` 条目与 `thirdPartyResources` 条目，每个条目以其 `id` 作为一个 markdown 链接的链接文本出现并附一句能力说明。第三方条目必须(SHALL)链接到外部 https URL（上游仓库或 npm 页面）；`source: local` 的 package 以及 skill、preset、patch 条目必须(SHALL)链接到仓库内存在的路径；以非 npm spec 从自有 GitHub release 安装的条目必须(SHALL)链接到其 GitHub 仓库。索引不得(SHALL NOT)出现 semver 形式的版本号（`\d+\.\d+\.\d+`）。

#### Scenario: 索引覆盖全部启用条目
- **GIVEN** 当前 `dsh.yaml`
- **WHEN** 测试收集所有启用条目的 id 与类型，并解析两份 README `plugins` 章节中的链接
- **THEN** 每个 id 在两份文件中都恰好是某个链接的文本，且该链接所在行在链接之后还有至少 8 个非空白、非标点字符的能力说明；local/skill/preset/patch 条目的链接目标是被跟踪路径；`spec` 为 `https://github.com/<owner>/<repo>/releases/...` 的条目链接目标恰为 `https://github.com/<owner>/<repo>`；其余条目的链接目标以 `https://` 开头

#### Scenario: 新增定制未登记
- **GIVEN** `dsh.yaml` 新增一个 `enabled: true` 的条目但 README 未更新
- **WHEN** 运行仓库测试
- **THEN** 测试失败并列出未登记的 id

#### Scenario: 索引写入版本号
- **GIVEN** 某次修改在插件索引中写入 `0.9.7`
- **WHEN** 运行仓库测试
- **THEN** 测试失败并报告出现版本号的行
