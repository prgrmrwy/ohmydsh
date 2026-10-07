## Context

- `skills/README.md` 和 `scripts/sync.mjs` 证实当前 OpenSpec Skills 属于项目 `.agents/skills`；CLI 在 PATH 可用并不发布全局 Skills。
- `dsh.yaml` pin DSH 0.1.5-rc.2；`repo-layout` 要求 source-owned 配置、精确第三方身份、幂等与可逆部署。`docs/notes/dsh-plugin-integration-pitfalls.md` 要求验证实际 Agent surface，不以声明存在代替装配。
- 社区参考 `@codigoconelmer/dsh-openspec@0.1.0`，gitHead `95966d073759c56cf3a1c21ad58bf2a5309ea6a2`，MIT，npm integrity `sha512-QaCEbKHM3KHa0V3WgR8yHvaKuOpYTRUrvGYx9X3cryqZEuZ5l/pE7sRMv8+hAHPDSqEWThLV83gJpRSGnAK1SA==`。它只有六条 slash、直接读取官方内部模板，没有 Skill provider。**决定：作为 prior art 致谢，不 fork 源码**（见 D1）。
- 官方 1.13.2 `core/shared/skill-generation.js` 提供 `getSkillTemplates`、`getCommandTemplates`、`generateSkillContent`，会解析 optional workflows；`profiles.js` 有 12 个 ALL_WORKFLOWS、6 个 CORE_WORKFLOWS。这些内部 API 不在公共 core exports，需要隔离与升级检查。
- 运行体版本：`dsh.yaml` pin `dshVersion` 为 0.1.5-rc.2，但运行中的 launcher 里被探测的子包（`dsh-skill`、`dsh-tool-skill`、`dsh-commands`）是 `0.1.5-rc.3`；profile 里的 `dsh-skill-filesystem` 是 rc.2，其 `lib/index.js` 与 launcher 的 rc.3 逐字节相同。本设计引用的运行体行为来自 launcher 副本，并经 profile 副本交叉核对。
- 用户明确：全能力指官方会话交付表面，而非 CLI 全部原生命令；自定义 init/管理/router 独立标识。用户选择插件独立管理官方版本，并显式选择本 change 的 Anvil。Jev shadow 观察倾向 Anvil但未达阈值，实际权威来源是用户。

## Goals / Non-Goals

**Goals:** 忠实官方 Skill/command 消费；跨 workspace 可见；受管模板/CLI 同版本（经受管调用串）；有界 24h 更新检查和显式可逆升级；两阶段 router **契约**（v1 为 contract-only：无生产调用方、不向任何会话发布工具，见 D7）。

**Non-Goals:** 不改 DSH core；不造混合 schema；不包一套 CLI-only tools 或万能 `/openspec`；不自动写项目、不自动安装/重启；不建 OpenSpec Web 编辑器；不接入/迁移 Jev、不变更既有 shadow 规范、不修 recorder 的 60s 截断；不承诺拦截任意 Bash；**不在本 change 解决宿主层 Skill provider 进入 Pet scope 的缺口**（见 D1：与 archify、spec-superflow 同级，用户决定先声明缺口、先用着试试）。本规划不创建远端仓库、发 npm 或实现代码。

## Decisions

### D1. 一个 local Host bundle，官方 renderer 为真相源

`packages/dsh-openspec` 为可独立发布的源码 bundle，使用当前 DSH family peers 和官方 skills/commands 服务。隔离的 `upstream-compat` 仅从 pin 的官方依赖解析模板、profile/delivery、引用变换和 CLI 路径；通过 official shared renderer 得到已解析完整模板，不能只从原始模板工厂抄字符串。有效工作流由官方 profile 配置解析；缺省采用官方 core，不擅自把用户配置改成 custom/all；文档说明如何启用全部官方 workflows。所有工作流均有能力映射/一致性断言，升级遇未知 id 必须显式适配后通过，不能静默丢项。

**探测 0.2/0.3 结论（DSH 0.1.5-rc.2，`dsh-tool-skill`、`dsh-skill`、`dsh-skill-filesystem` 源码）**：模型加载 Skill 时 `ctx.skills.get(name, {cwd, signal, scope})` 调用 provider 的 `get(candidate, options)`，这是真实的加载事件，且带调用会话的 cwd；而 `list` 会被 catalog 反复触发，不能当作加载信号。加载结果只有 `content` 一个正文字段，**没有独立的上下文通道**；官方 filesystem provider 没有加载钩子。因此：需要自写薄 provider（只在 `get` 里触发消费检查与附加块，`list` 不做网络请求），但目录发现仍可复用官方 filesystem provider 的类（`FileSystemSkillProvider` 有导出）读取 generation 目录。Skill 正文是官方 renderer 输出，**受管调用串与更新提示以明确分隔、带 provenance 标记的块追加在正文之后**（用户选择；正文字节仍可与官方 renderer 比对）。command 仅改 DSH invocation 引用，raw 用户输入保持为用户输入，不能提升成可信指令。

**宿主层 provider 与 Pet 的关系（审查 C3，已用真实 `SkillRegistry` 复现）**：`SkillRegistry.collectFresh` 把每个 scope 的视图建为 `[global 层, ...scope 链]` 再合并，registry 没有 restrict/过滤 API；scope 层只能追加，不能删减。因此**任何宿主层 provider——包括 `archify`（`cordis.patch.yml` 插入官方 filesystem provider）、现有 `spec-superflow` 与本适配器——都会出现在 Pet executor 和 Locus child 的 Skill 视图里**。Pet 当前的隔离只靠“preset 不加载 `skill-filesystem`”，管不到宿主层。这与 Pet 规范“仅全局可见的 Skill 必须 fail closed”相冲，但它是**整类宿主层 provider 的既有缺口**，不是本适配器引入的。**决定（用户）**：本适配器与 archify、spec-superflow 保持一致，注册为宿主层 provider，在 spec 与文档中如实声明该缺口，登记到 `BACKLOG.md`，由 Pet 侧另立 change 统一处理；本 change 不做 per-preset 白名单（那会与同类插件行为不一致，且本机没有真实 Pet executor/Locus child 样本可验证）。本机早先对比“Pet 目录 9 个 vs 普通会话 29 个”的证据**不能**说明 Pet 隔离了宿主层 provider——两组会话相隔近一个月，差异来自 memex/Jev/spec-superflow 后装。

**provider 如何识别会话（审查 M2）**：registry 把调用方传入的整个 options 对象（含 `scope`，即调用 Agent）原样传给 provider 的 `list`/`get`；`dsh-tool-skill` 两处调用点都传 `scope`（模型路径用 `exec.agent`，可能为 undefined）。`scope` 不在 provider 合同声明的 `SkillLookupOptions` 里，属于未声明依赖，必须用测试在两个调用点钉住。更新提示的每会话去重以 `scope` 对象身份为键（进程内 `WeakMap`，重启/resume/fork 重置，随 agent 回收），无 `scope` 时不投递提示。

替代：
- 静态 vendor 12 篇 Markdown：会陈旧。
- 把所有 CLI native tools 暴露到会话：违背范围。
- 直接从六个模板文件加载：不足以覆盖官方表面和 optional workflow 条件。
- **sync 时用官方 renderer 渲染进 user-dsh / filesystem-provider 目录（最便宜的方案）**：它能解决跨 workspace 发现与版本一致，因此初版应尽量复用官方 `dsh-skill-filesystem` provider 读取受管 generation 目录，而不是自写 provider。但它单独无法满足以下已确认需求，因此仍需一个薄 Host 层：① “消费时检查更新”必须知道真实的 get/load 或 slash 调用，静态目录没有这个事件；② 受管调用串需要随所选 generation 交付；Skill 加载只返回 `content`，所以只能作为正文之后的分隔块追加，正文本身保持官方一致（块的规范格式见 D2）；③ `/openspec-init`、`/openspec-upgrade` 与官方 workflow slash 需要命令注册；④ routing 注册表与 dispatcher 需要一个进程内服务（本 change 不发布任何会话工具）。Host 层职责仅限这四项。探测 0.3 已证明官方 filesystem provider 没有加载钩子，故需自写薄 provider（目录发现复用其导出类）。
- **fork 社区 0.1.0 源码**：会与 `repo-layout`“第三方不 vendor、local 表示自研”冲突；其 slash 注册与消息构造在新设计中几乎全部被替换，保留价值低。决定：NOTICE 中致谢 prior art（包名、版本、gitHead、MIT），不复制源码。

### D2. 独立不可变 generation，通过普通 Bash 使用 CLI

源码 `packages/dsh-openspec/package.json` 中 `@fission-ai/openspec` 精确依赖 + 根 lockfile 是官方版本唯一 pin，初始 1.13.2。`dsh.yaml` 条目控制 bundle 版本/启用，并按 `repo-layout` 第三方记录要求在 `note` 中以散文记录官方依赖；**C2 决定（用户选 A）**：`dsh.yaml` 记录只写**散文**（来源、许可、遥测/凭据边界、升级复核点、移除路径），**不写版本号**，因此升级/回滚事务只需改 `package.json` 与根 lockfile 两个文件，不会让 manifest 记录与 pin 失配。`dsh-openspec-pin-mismatch` 改为比对 `package.json` 的 pin 与**根 lockfile 解析出的名称/版本/integrity**，不一致即失败并同时给出两个值。插件选项 `updateCheck`、`telemetry` 不放 `dsh.yaml`（sync 不向 bundle 传递条目配置，且会引入 repo-layout 变更），改为读 DSH settings 服务命名空间 `dsh-openspec`（由用户设置文件承载，与 `dsh-memex` 同一通道），默认 `updateCheck: enabled`、`telemetry: adapter-off`。根 workspace 提升后 `node_modules/.bin/openspec` 会出现在仓库 npm scripts 中；本仓库自身的 OpenSpec 使用不依赖该 bin，实施时核对不改变仓库工具链。

遥测：官方 CLI 默认向 `edge.openspec.dev` 发送命令名与版本。受管调用串默认带 `OPENSPEC_TELEMETRY=0`；插件选项 `telemetry: official` 时不设置，尊重用户官方配置（但恒带 `OPENSPEC_NO_UPDATE_CHECK=1`，见上）。构建阶段核验 version/integrity并物化包含官方发布物、依赖闭包、模板和CLI入口的不可变 generation。部署位置 `$DSH_HOME/plugins/dsh-openspec/generations/<identity>/`，每 profile 有原子 active 引用；不能把CLI路径指到升级时会覆盖的 node_modules。

会话 get/load 记录 generation id，并在**未改动的官方正文之后**追加一个**规范化**的适配器块；官方正文本身不被替换或改写。

**块的规范格式（审查 C1）**：加载器 `renderSkillContent` 把 `content` 原样嵌在 `<skill_instructions>…</skill_content>` 之间，只转义 name 属性和资源提示，不转义 `content`；且块经两条载体到达模型——模型 `skill` 工具结果与用户 `/name` 手势注入（后者是 user 角色消息）。因此块必须：① 放在最后，位于两行固定 marker 之间，开头 marker 带 `dsh-openspec-adapter` 与 `block-format=1`；② 字段闭集：generation id（`[a-z0-9._-]+`）、受管调用串、遥测模式、更新检查模式、可选 notice（`{installed, available, managementEntry}`）、可选 `recovery` 枚举；③ 不含 cwd、slash 参数、项目文本、registry 原始字符串或错误文本，版本由解析出的整数重新渲染为 `MAJOR.MINOR.PATCH`；④ 受管调用串由唯一一个具名 POSIX 单引号函数（`'` 渲染为 `'\''`）逐路径段渲染，NUL/CR/LF/其它控制字符或非绝对路径返回 `block-unrenderable`，不产出部分块、加载 fail closed；⑤ 两条载体共用同一构造器、字节一致；⑥ 准备阶段若官方正文含 marker 行或 `</skill_instructions>`/`</skill_content>` 则 `upstream-incompatible`（实测 1.13.2 全部 `dist` 不含这些串，拒绝成本很低）；⑦ 测试只用共享的 `parseAdapterBlock`。cwd 来自 Bash 的 `workdir`，不进块。

**调用串内容**：`node <generation 官方 bin>`，恒带 `OPENSPEC_NO_UPDATE_CHECK=1`（审查 M5：官方 CLI 的 `OPENSPEC_TELEMETRY=0` 会一并关闭它自己的更新检查，`telemetry: official` 会让官方 `update` 自行发请求并提示在受管流程之外升级；`OPENSPEC_NO_UPDATE_CHECK` 是独立开关），`telemetry` 为默认时再带 `OPENSPEC_TELEMETRY=0`。仅限 POSIX shell（DSH 在 win32 用 pwsh，本 change 不覆盖）；管理检查报告 Bash PATH 上 `node` 是否满足官方引擎要求（>=20.19.0）。

**正文的唯一判据（审查 M3）**：`renderOfficialBody(selection)` = 官方 renderer 输出的 `instructions`，外加**唯一一个**文档化的 DSH 转换：官方 `/opsx:<name>` 引用改写为同一 workflow 的 DSH 合法名（DSH 命令名须匹配 `^[a-z][a-z0-9_-]*$`，`:` 不可表示；官方 renderer 的 `transformInstructions` 钩子即为此留）。加载器会去掉 frontmatter 并 trim，所以加载结果永远不等于 `generateSkillContent` 的完整输出，可比对的是 instructions 部分。Skill 与 command 共用该函数。

**命令载体（审查 M8）**：为每个有效官方 workflow 注册 `opsx-<workflow>`（`<workflow>` 为官方 workflow 名），另有 `openspec-init`、`openspec-upgrade`。DSH 对已注册命令只运行 handler，**不会**把参数原文发给模型，所以官方 workflow 命令的 handler 提交**两条**消息：① 一条来源标记为本适配器的消息，文本 = `renderOfficialBody` + 适配器块，**不含原始参数字符串**；② 一条用户来源的消息，内容恰为原始参数字符串，使用户自己的请求原样到达模型，且绝不进入适配器来源的消息（trust 边界：适配器消息只含适配器自己构造的文本）。`openspec-init` 与 `openspec-upgrade` 没有官方正文，其适配器消息文本是适配器自写的固定指令 + 适配器块，只带已校验的值。`recordInput` 对官方 workflow 命令实际上不起隔离作用（参数会作为用户消息持久化），仅对不需要审计参数的自定义命令设为 `false`。手势 `/<skill-name>` 若命中 Skill 则走 Skill 路径，块字节一致。

**受管调用的边界与诊断**：它仍走普通 Bash 文件/权限通道，不新增通用 CLI 工具，不改 Host/global PATH，也不承诺裸 `openspec` 被重定向。版本一致只对该受管调用串成立；Agent 若运行裸 `openspec`，执行的是 PATH 上的版本，管理检查报告 `path-version`/`managed-version`/`mismatch`。项目覆盖 Skill 不注入为官方 bundled consumer；诊断如实报告胜出的 `source` 与 `provider`（registry 的 `SkillSummary` 没有版本字段，故不报版本）。有效 profile/delivery 在每次 get/load 时重新读取官方全局配置。

旧 generation 不在升级中删除；第一版只清理无活动引用的 staging，中间/旧健康 generations 保守保留，显式后续GC不属于本次。不同官方版本仍使用官方全局配置路径，受管版本不意味着隔离所有 OpenSpec用户配置；升级不得隐式迁移其全局配置。

替代：PATH 覆盖依赖 shell 启动语义且会影响无关命令；每命令走新的 native wrapper违背官方Bash用法；在线下载latest产生不可复现执行。

### D3. 初始化与管理是 Agent 指引，不是越权 Host spawn

`/openspec-init` 将固定、明确标识的指引和校验后参数交给当前 Agent，经 session Bash 执行 managed CLI。缺省 `--tools none --no-copilot-cloud --no-animation`；只在 caller cwd 初始化，不猜测其它路径/store，不静默使用 force。tools/profile 只接受所 pin 版本官方取值；`--language` 在官方是自由文本，adapter 以 `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$` 校验。**adapter 代码生成完整 shell-quoted 命令串**，模型只运行它，不拼接原始 slash 参数；含 shell 元字符或未知值时返回类型化校验错误且不提供命令。已有项目按官方 init 的保守语义；force 和 cloud 选项需单独明确确认。探测 0.7 已确认：`--profile` 本身只读，但 extend 模式的 `migrateIfNeeded` 在“全局配置无 `profile` 字段且项目已有官方 workflow 产物”时会写全局配置；因此工作区已含 `openspec` 目录时，`/openspec-init` 的结果文本必须警告该可能（已写入 session spec 要求与场景）。

自定义入口名：`/openspec-init`（按用户要求保留该名；官方 1.13.2 无同名 workflow）与 `openspec-upgrade`（Skill 与 `/openspec-upgrade`）。用户在实施期选择用 `openspec-upgrade` 替换原管理入口名，以直观表达“升级适配器受管的官方 OpenSpec 栈”；描述和帮助须明确这是适配器自定义入口，不是官方工作流。本次只改公开名称，不新增权限：保留只读检查、精确版本升级/回滚及单独授权的项目刷新，项目刷新不是软件升级的副作用。不注册旧名别名；旧 generation 保守保留，新的命名使用新的 generation identity，不能覆盖旧正文。官方 1.13.2 无同名 Skill/command；未来准备阶段若官方产出的 Skill/command 名与任一自定义名冲突则 fail closed。D3 的 session Bash 执行边界不因改名而改变。

`openspec-upgrade` Skill 与 `/openspec-upgrade` 提供 check/upgrade/rollback/project-refresh 的独立指引。source mutation仍由 session受控 Bash运行受管 updater，不在 Host命令handler里直接执行npm或写源码。调用或加载帮助不等于升级批准。调用的session政策不能写source时返回 blocked，不能改用部署目录凑成功。

### D4. 消费检查与提示是有界只读附加行为

get/load 或command delivery触发共享check service；固定 npm metadata endpoint、2s AbortSignal预算、64KiB响应上限、无认证无redirect。缓存记录成功checkedAt/latest和规范化失败状态，按 DSH_HOME/profile归一化保存到状态目录；相同进程single-flight，跨进程用短期限锁+原子rename，成功TTL24h、失败退避15min。缓存包含查询package/channel，禁止负年龄/损坏值当fresh。显示 installed/available 版本对，单session去重；**探测 0.6 结论（已按审查 M1 更正）**：运行体**存在**非唤醒写入接缝：`Agent.inject(message)` 是公开 API（`dsh-agent` 类型文档：为下一个 pre-step 排队模型可见上下文而不唤醒 driver；官方 `dsh-user-approval`、`dsh-plan-mode`、`dsh-hooks-*` 在用）。不用它的真实理由是：① `inject` 会把一条额外的 user 角色消息**持久化进会话**，等于改写对话；② 投递是 best-effort（若某请求的 pre-step 已领走批次则可能错过，取消/销毁时可能被丢弃）；③ skill provider 拿不到可调用它的 agent 句柄（只有 `scope` 身份）。因此提示**只作为下一次 Skill/command 消费结果里的附加块**交付，不追加会话消息、不 steer。检查在后台完成，结果落缓存；某 scope 结束后才返回的结果不写入该 scope，下一个 live scope 的首次消费才展示。去重键与竞态见 D1：以 `scope` 身份为键的 `WeakMap`，decide-and-mark 为 await 之前的单次同步 test-and-set。

**registry 请求（审查 M6）**：固定 `GET https://registry.npmjs.org/@fission-ai%2Fopenspec/latest` 并只读 `version` 字段（实测约 3 KB；完整 packument 约 157 KB 会超 64 KiB 上限，缩略 packument 约 57 KB 且随版本增长，均不使用）。测试用与真实响应同形的 fixture。

**目录失效（审查 M7）**：官方 profile/delivery 变更后，registry 对 `list` 结果按 (cwd, scope 链, revision) 缓存且无 TTL，必须由 provider 调用注册期给出的 `invalidate()`。适配器在每次消费时、以及至多每 30s 对官方全局配置文件做 stat，变化则 `invalidate()`。

state写入是受管plugin状态，不包含用户正文。开关为 DSH settings 服务命名空间 `dsh-openspec` 中的插件选项 `updateCheck`（默认 `enabled`，`disabled` 时自动与显式检查都零网络请求）。显式check可绕过TTL但仍share in-flight/budget。registry latest 低于已选版本时状态为 `ahead-of-latest`，不提示。提示绝不触发升级。提示每 session×版本对至多一次、不开新轮次。

### D5. 升级是 source-owned staged transaction

管理入口仅接受明确批准的精确stable version；禁止@latest/npx在线执行。**升级与回滚是同一种事务**：回滚也是把 pin/lockfile 写回旧版本 B 再激活 B，而不是只切部署引用，否则下次 sync 会按源码 pin 切回。受控helper定位sync记录的真实authoritative checkout（realpath/provenance，不从用户参数接受任意写入根），核验原pin、lockfile和active generation，锁住同一source/profile事务。调用方是 Worktree-bound session，或目标 checkout 不是 sync 记录的 realpath，返回 `blocked` 且零写入（与 `source-workspace-worktree-session` 的 fail-closed 一致）。dirty但不相关文件不自动清理；相关pin/lockfile变化要拒绝并让用户协调。事务的**完整写集合是 `packages/dsh-openspec/package.json` 的官方依赖条目与根 lockfile 闭包两个文件**（`dsh.yaml` 记录为散文，不重写），禁止改 `dsh.client`、`exports`、peer 等启动期字段。目标版本的 lockfile integrity 必须在任何源码写入前等于 registry 对该精确版本给出的 `dist.integrity`。

硬链接窗口（BACKLOG D005）：local package 以 pnpm `file:` 硬链接部署，CAS 写 `packages/dsh-openspec/package.json` 会立即改变已部署清单。由于事务不改启动期字段，重启时 bundle 仍按原入口加载；官方依赖的实际解析在 generation 目录内（按 active 引用），不走部署 node_modules，所以 CAS 后、sync 前重启仍由旧 active generation 服务，并由 journal 报告 `recovery-required`。此论证由 updates spec “Kill between source CAS and activation then restart” 场景实测。

事务步骤：在独立staging解析目标包及lock变更 → 验官方身份/模板表面/CLI --version +非写操作smoke → 写prepared journal（仅文件哈希、身份、阶段）→ compare-and-swap source pin/lockfile →现有build/sync物化新generation → 原子active引用切换并提交journal。依赖安装使用ignore-scripts；后续adapter build为已审查本地命令。升级所需源码写入/网络/部署权限均服从session政策。

跨source和部署无法单一文件原子提交，必须有可恢复journal。中断/restart读journal只判断/报告，不在Host启动时越权修源码；再次受授权helper执行commit或rollback。崩溃恢复完成前阻止新升级，以旧active generation继续服务；不得把暂时source drift报为升级成功。失败回滚仅当文件仍等于本事务写入哈希，防止覆盖用户并发修改；不能安全恢复则返回 recovery-required，保留旧healthy active和journal，提供明确手工协调路径。健康前一代保持可回滚，source与lock回写后sync不会把升级还原。

动态官方模板generation可在Host重新materialize并invalidate catalog；DSH bundle代码变化仍需要profile reload/重启，由用户执行。结果统一带 `activation: live | pending-reload`；live 新 generation 接线无法证明时报 `pending-reload`，不宣称热更新完成；不自动重启。

`$DSH_HOME/plugins/dsh-openspec/` 在 v1 只提供 disable：撤销表面与引用，保留 generations、缓存与 journal。v1 不提供 purge，也不删除任何非 staging generation；清理磁盘的 purge/GC 留给后续 change 单独设计。移除路径在 `dsh.yaml` 记录中写明：disable + sync 后，用户可在确认无未完成 journal 时手动删除该目录。

### D6. Routing contract v1容纳现有两段判断，但不实现Jev

服务名建议 `openspec.routing`，这是新接口，具体Cordis服务名必须在实现期确认唯一性。contract v1 标注 experimental，直到首个生产 provider 上线前可调整。`register(provider)`返回disposer；provider包含id、contractVersion=1、supportedStages、可选trusted external workflow declarations和`decide(request)`。只配置一个activeProviderId，重id拒绝，不按加载顺序或投票选人。

信任来源：阶段 token 由 dispatcher 签发，绑定 session id、TTL 10min，存于 Host 内存；`workflow-selection` 必须带同 session、未过期、来自 `formal-workflow` 结果的 token，否则 `invalid-stage-token` 且不调用 provider。已有 change 的权威由 dispatcher 根据传入的 change 名经官方发现自行解析，命中即直接返回记录的 schema、不调用 provider；用户显式选择是单独的枚举参数，文档标明为模型转述、非权威。

输入：stage、token、strict bounded feature schema（复用intent/scope/behaviorChange/persistence/concurrency/externalSystems/safetyRisk/migrationRisk等）、authority state、typed candidates、AbortSignal。第一阶段固定direct/formal-workflow；第二阶段区分 `openspec-schema` 与 `external-workflow`，schema来自当前root/store的official发现结果，external来自本机受信扩展静态声明及eligibility callback。router不会得到完整上下文、源码或路径，official发现由主插件本地执行。候选描述上限2KiB/个，总数32，外部扩展策略有自己的版本身份。

输出：status=recommendation/needs-review/unavailable、可选candidateId、bounded概率/置信度/差距、规范化reason code。主插件校验stage/候选/数值并返回，不执行推荐。显式选择/已有change先处理；不存在正式第一阶段结果不能请求第二阶段。两阶段token由host维护、session绑定、短TTL，不能由模型伪造另一个会话的phase结果。

每request最大5s，可取消；dispose期间generation变化、provider卸载导致旧结果丢弃。无候选/失效不等于direct。扩展自身调用外部服务/持久化是扩展信任与隐私责任，主插件不加载repo任意代码、不给外部API凭据。现有Jev shadow实现与state完全不调用不迁移。

### D7. 一个窄调用入口，默认零路由表面

**advisory 边界**：把结果交给 Agent 在效果上就是 advisory。因此结果固定带 `authority: none`；本 change 只允许测试 fixture 中的 provider 被选为 active，非测试 provider 需要单独 change 的显式批准记录，否则 `provider-not-approved` 且不发布工具；Jev-backed provider 在 `jev-workflow-routing` 完成 advisory 准入前不可选。

**探测 0.4/0.5 结论与本 change 的收缩**：真实会话头只有 `id、cwd、parentSession、isSeeded、origin、delegationDepth、agentPreset`。本机真实样本（解码 56 个 v3 会话日志）显示：常驻 Pet executor（workspace-resident，`agentPreset` 为 `standard`）与普通会话**头部字段完全相同**；专用 Pet executor 与 Locus child 在本机**没有任何真实会话样本**（本机唯一位于专用 Pet workspace 目录下的会话只有 7 个事件，没有 `request/header`）。注意：此前拿来对比工具数与 Skill 目录的两个会话相隔近一个月（Pet 样本 2026-08-30 至 09-06，memex 09-19、Jev/spec-superflow 09-25 才装），**该差异不能说明 Pet 隔离了宿主层 provider**，已作废。因此“用 header 证明普通会话”这个 fail-closed 判定目前**无法被真实证据验证**。`tools.register()` 又按调用上下文 scope 落层、`tools.restrict()` 不约束 own 层（pitfalls §12），按会话动态发布的路由工具存在泄漏进 Pet/Locus 的风险。

所以**本 change 不向任何会话（全局或 agent-scoped）发布 `openspec_route` 或路由指导**。dispatcher 只通过一个进程内入口函数暴露（本 change 没有任何 Skill/slash 路径调用它），由注册表、token、测试 provider 与单测验证；会话工具发布、ordinary-session 判定与相应 Pet/Locus 隔离冒烟，留给拿到真实 Pet executor 与 Locus child 样本之后的单独 change。没有 provider 时零 routing 工具/指引/callback。本期仅 test provider；不开放自动选路。不宣称全量 Bash interception。

替代：schema-only hook容纳不了现有change necessity和external workflow；通用任意hook框架超范围；主插件内置Jev把provider凭据/故障/评估模式耦合进去。

## Risks / Trade-offs

- [官方内部API变化] → compat module、官方 renderer parity、未知工作流 fail closed、旧generation保留。
- [看见旧项目同名Skill] → 保持DSH native precedence，诊断标source；不自动删除项目副本。
- [消费hook/工具注册只声明未生效] → target 0.1.5真实Skill load/command dispatch/request header/tool调用证据；无 provider 时的 header 等于基线（negative 测试）；Pet 暴露缺口以“可检出的对照行”如实记录，不断言隔离。
- [源码和部署跨目录崩溃] → prepared journal、CAS rollback、crash注入测试、旧active继续，不用热更新宣传掩盖pending。
- [source pin升级触碰根依赖/权限] → helper通过受控Bash、exact目标、只更新受管依赖闭包、禁执行第三方scripts、不变全局安装。
- [真实Jev慢于5s] → 本期默认预算仅针对扩展契约；后续Jev迁移必须评估超时策略，不偷偷提高当前shadow权限。
- [初次generation增加磁盘、旧generation保留] → 以保守不删换取会话一致性，GC后续明确设计。

## Migration Plan

1. 先通过Anvil独立read-only review，再为每个scenario映射一个named test。
2. 在独立受控工作分支/Worktree Session内按red-green-refactor实现；本规划不创建远端仓库或部署。
3. 引入新写的 local package 与 NOTICE（致谢 prior art，不复制其源码）、exact官方pin/根lock、build inputs、manifest开关与官方依赖记录；generation与CLI不提交。
4. 隔离profile跑构建、两次sync、官方表面/版本/两个workspace/权限/init/update/router fixture、无 provider 的 header 基线冒烟，以及 Pet 暴露缺口对照行。不启动替代服务冒充当前GUI；生产reload另行确认。
5. 不移除项目OpenSpec Skills，用户可根据source诊断自行选是否清理。系统全局CLI保留。
6. 回滚official版本经显式管理流程恢复source pin/lock和旧generation；整个adapter可enabled:false + sync + user reload。保留项目changes、Jev MCP/shadow/recorder、Anvil和其它workflow资源。

## Open Questions

无未决定的产品范围。可行性探测 0.2–0.7 已完成，结论写入 tasks.md 与上文 D1/D2/D4/D7；它们触发了对 spec 的三处收缩（调用串改为附加分隔块、更新提示只附在下次消费结果、本 change 不发布会话路由工具），并经第 2 轮 Anvil 独立审查（第 1 轮已因内容变化作废）。审查进一步发现并经用户决定的事项：宿主层 provider 进入 Pet scope 的缺口先声明不修（D1）；manifest 记录只写散文、pin 校验改对 lockfile（D2）；`updateCheck`/`telemetry` 走 settings 服务。未验证项：专用 Pet executor 与 Locus child 的真实会话头样本，列为后续 change 的前置。远端仓库托管和npm发布留给明确后续请求。
