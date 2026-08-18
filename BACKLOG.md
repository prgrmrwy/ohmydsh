# Backlog · 功能待办池

随时想到的功能都记在这里。条目按状态分组,状态流转:`想法 → 讨论中 → 已设计 → 实施中 → 已完成 / 已放弃`(任意状态可加「(暂停)」标记)。优先级在条目内用 P0 / P1 / P2 标注。

## 条目格式

```markdown
### [ID] 一句话标题
- **状态**: 想法 / 讨论中 / 已设计 / 实施中 / 已完成 / 已放弃
- **优先级**: P0 / P1 / P2(可选)
- **背景 / 动机**: 为什么要做
- **要点**: 方案要点、约束、开放问题
- **更新**: YYYY-MM-DD 一句话进展
```

---

## 讨论中

### [B001] 多角色 agent 协作流水线(架构师 / anti 审查 / QA)
- **状态**: 讨论中(暂停)
- **背景 / 动机**: 希望 DSH 接任务后按阶段自主分配角色:需求设计 → 架构师;coding 完成 → anti 代码审查;最后 → QA 黑白盒验收。
- **要点**(2026-08 讨论结论):
  - 符合 DSH 设计理念:DSH 是组合式 + 委派式架构,角色 = **subagent**(persona + 工具范围 + 可选独立模型),不是多个 preset 手动切换。
  - 编排者 = 一个 **tech-lead preset**,自带 subagent / workflow / goal 工具,负责阶段流转与门禁。
  - 角色定义:起步内嵌在 tech-lead 提示词;进阶注册进 host composition 的 subagent registry 跨会话复用。
  - 阶段交接物 = workspace 文件(design.md、AC 清单、review 报告);subagent 不继承父对话,workspace 是共享记忆。
  - 工具选型:常规串行用 subagent 工具;大规模 fan-out(QA 多 AC 并行)用 workflow;跨轮长任务用 goal;Ralph 不适合。
  - QA 阶段可复用 `verifying-acceptance` skill(黑盒自测 + AC 证据)。
  - 参考实现标记(2026-08-14):社区插件 [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) 已实现自然语言驱动的多角色团队(captain/members + 任务依赖 + 树形监控),做 B001 时优先评估复用,而非从零写。
- **开放问题**:
  1. 门禁强度:全程自主 vs 关键节点(设计定稿 / review 通过 / 验收通过)人工确认
  2. 是否需要独立 coder 角色,还是 tech-lead 自己写代码
  3. QA 以 AC 自动化证据为准,还是角色主观判断
  4. 是否给某些角色(如 anti)配不同模型
- **更新**: 2026-08-14 完成方案讨论,讨论进度已归档(要点 + 4 个开放问题);暂停跟进,待开放问题确认后进入设计。

---

## 想法

### [B002] 飞书助手:任务中 @ 助手,在飞书群发消息
- **状态**: 想法
- **背景 / 动机**: 理想情况是能在任务中 @ 助手,然后在飞书群里发消息,把 DSH 任务与飞书 IM 打通。
- **要点**:
  - 至少先做单向:任务节点/结果 → 飞书群消息推送;
  - 理想双向:飞书群里 @ 助手 → 触发或查询 DSH 任务;
  - 可复用现有 `lark-im`(收发消息)、`lark-event`(事件订阅)能力;需定义交互入口与鉴权(群→会话映射)。
- **更新**: 2026-08-14 新增

### [B004] AI provider 订阅制认证
- **状态**: 实施中
- **优先级**: P0
- **背景 / 动机**: 目前 Codex 和 Anthropics 只能填 api-key 接入,希望支持订阅账号直接授权(OAuth 登录),免去自备 key。
- **要点**:
  - 调研结论(2026-08-14):官方 master 已内置 `subagent-claude-code` / `subagent-codex` / `subagent-acp` 三个包,且已发布 npm `0.1.0-rc.6`(与运行版同版本);
  - 官方路线 = **CLI-as-subagent**:复用本机 `claude` / `codex` CLI 的订阅登录态,插件不做 OAuth;`claude-code` 走官方 Claude Agent SDK,合规性优于野生 token 代理;
  - 形态差异:subagent 委派(独立任务 → 回最终答案)vs provider 级(挂进 DSH 模型路由/选择器),B004 动机(免 api-key)满足,形态待确认;
  - 接入路径:`dsh plugin add` 装包 + `cordis.patch.yml` 两行(provider 行 + tool 行),preset 需启用工具行(默认 disabled);
  - 前置条件:本机安装并登录对应 CLI;ACP 后端仅在接入"只讲 ACP 的外部 agent"时才需要。
  - 范围决策(2026-08-14):**先做单机可用**(本机 `claude` / `codex` subagent);多机派发与分布式暂缓,以下相关条目归档备查;
  - 多机派发设计(暂缓):本机走 `subagent-claude-code`(官方 SDK,原生设置);远端机走 `subagent-acp` 多实例(`command: ssh <host> claude-code-acp`,providerName 区分机器,如 `claude-lumevm`),每实例一条 tool 行(toolName 带机器名)→ 模型按工具名选机器;
  - IO 隔离(暂缓):ACP-over-SSH 天然满足"各机操作各机 IO"(远端进程跑在远端盘);同路径约定(两机同一绝对路径 checkout)让 ACP workspace 参数直接可用;共享挂载目录是唯一风险,需约定禁止委派;
  - 待验证(暂缓):claude-code-acp 对 workspace 参数的处理、SSH 免密与远端进程终止语义、ACP 后端为 one-shot(无跨轮续聊);
  - selector 订阅方案(2026-08-14 补充):官方无订阅制 LlmAdapter;可行路径 = 自研 adapter 包装产品 CLI 登录态(Claude: `claude -p --output-format stream-json`;GPT: `codex app-server --stdio` JSON-RPC),限流/延迟/ToS 需注意,与 subagent 路线可并存;
  - 分布式能力(暂缓):官方件 = `dsh-acp`(ACP server,stdio,text-only)+ `subagent-acp`(client,command 可配)。"每台设备常驻一个 DSH ACP server,本机按 providerName 注册多实例,ssh 派发" = 官方支持的分布式 agent 池形态;daemon 长连接需自定义 provider。
  - 接线落地(2026-08-19):**codex 先行,claude 待本机可用**——首个按 repo-layout 落地的定制:官方 `@deepseek-ai/dsh-subagent-codex@0.1.0-rc.6` 按 `remote` 入 manifest(无 dsh.bundle,装为 plain dependency 不进 bundle 层),其缺失 peer `@deepseek-ai/dsh-sdk-protocol@0.1.0-rc.6` 入 manifest 顶层 `dependencies:`(新增支撑包契约,条目 `deps:` 引用归属,sync 校验悬空引用);provider+tool 两行接线放 `patches/subagent-codex-wiring.yml`(type: patch,sync 合并进生成 patch 层,直插 host 平面,工具 `subagent_codex` 全会话可见,preset 无需改动);sync 顺带修复 bundle-less 包不得进 bundle 层;本机 codex-cli 0.144.3(ChatGPT 登录态)app-server 握手实测通过(官方基线 0.147.0);2026-08-19 重启验收:provider+tool 两行激活,`subagent_codex` 工具已注入会话;同日真实委派验收通过(工具调用 codex 成功返回模型自述,GPT-5 Codex,本机登录态生效)。
- **更新**: 2026-08-14 新增,提升 P0;同日完成 GitHub 调研,确认官方现成方案;同日定范围:单机可用,多机/分布式暂缓;2026-08-19 codex 接线按「remote 包 + 顶层 dependencies + patches 覆盖」落地为 repo-layout 首个定制,重启 + 真实委派端到端验收通过,claude 对应接线待本机 claude 可用后另加。

### [B005] 新任务自动建 worktree,再 cwd 进入开始 agent 交互
- **状态**: 想法
- **背景 / 动机**: 创建新任务时,先用特定工具创建 git worktree,cwd 到 worktree 之后才开始 agent 交互,保证任务间文件隔离、并行任务互不干扰。
- **要点**:
  - 触发时机:新任务(会话)创建时,自动或可选地走 worktree 流程;
  - 现有基础:本会话已有 `sw` skill(start-by-worktree,面向 Nexus coding sessions),机制可参考/复用,先评估其可泛化程度;
  - 待设计:入口形态(skill / host 插件 / 任务创建钩子)、worktree 目录与分支命名约定、任务 ↔ worktree 映射与回收;
  - 注意:zydsh 是嵌套仓库、父仓库多项目,worktree 策略需考虑仓库结构。
- **更新**: 2026-08-14 新增

### [B006] DeepSeek 模型下支持图片能力
- **状态**: 想法
- **优先级**: P0
- **背景 / 动机**: 希望用 deepseek 模型时也能处理图片输入(截图理解、读图等)。
- **要点**:
  - 先核实能力边界:deepseek 模型(deepseek-v4-pro / chat 等)官方 API 是否原生支持图片输入;
  - 若原生支持 → 落在 LLM 消息协议(image 内容块)+ `dsh-llm-deepseek` 适配器,属插件层改造;
  - 若不支持 → 备选:视觉路由(图片任务转发到视觉模型)、本地 OCR/描述预处理,或混用方案;
  - 现状排查:DSH 已有 `dsh-attachment` 与 `read_image` 等图片管道,确认 harness 侧缺口在协议、适配器还是 UI 上传;
  - 闸门定位(2026-08-14 代码级确认):① 发送层 `dsh-host-apiproxy` 在提交时检测消息含图片,路由模型 `inputModalities` 不含 image 即拒(`model-unavailable`,deepseek 声明 `["text"]`);② 模型层 `dsh-llm-deepseek` 的 `assertTextOnly` 对图片块显式抛 `UNSUPPORTED_CONTENT`。图片进不了会话,主 agent 无委派机会;
  - 可行路径候选:图片落 workspace + 消息转文本路径 + 委派给视觉子代理(与 B004 的 `subagent-claude-code` 协同);或做视觉路由/输入层转换。
- **更新**: 2026-08-14 新增,提升 P0;同日完成闸门定位调研。

### [B007] 类似 Claude 的 /btw 沟通模式
- **状态**: 想法
- **背景 / 动机**: 增加类似 Claude Code `/btw`(by the way)的沟通方式:发一条消息让 agent 只记录、不立即处理,不打断当前任务。
- **要点**:
  - 入口形态:slash 命令或输入触发;先查 DSH 现有 command/input-trigger 机制(`dsh-client-ui-commands`、`dsh-client-ui-input-trigger`)的扩展点;
  - 语义:低优先级侧注,不触发即时行动,写入持久记忆;
  - 存储位置待设计:会话内记忆 vs workspace 文件(如 NOTES.md)vs 任务级;
  - 消费时机:当前任务完成后回顾,或后续任务开始时带上;
  - 待设计:多任务并行时 btw 的归属(属于哪个任务/会话)、与 goal/todo 列表的交互。
- **更新**: 2026-08-14 新增

### [B008] 会话(任务)看板视图
- **状态**: 想法
- **背景 / 动机**: 支持会话(任务)以看板形式呈现,可在 todo / doing / reviewing / done / canceled / blocked 几个状态间切换,多任务并行时一眼看清整体进度。
- **要点**:
  - 形态:会话/任务列表的看板视图,列 = 状态,支持拖动或按钮切换;
  - 数据模型:状态字段挂在会话/任务上,与现有 session / goal / todo 机制衔接(参考 `dsh-tool-goal` 的 blocked、`dsh-tool-todo`);
  - 联动:reviewing 可与 B001 的 anti 审查阶段衔接;blocked 与 goal 阻塞语义呼应;canceled 对应会话终止;
  - 落点预估:client UI 插件(看板渲染 + 交互)+ host 侧状态持久化/API;
  - 待设计:状态与会话生命周期事件的映射、看板入口位置、与现有 sidebar/会话列表共存方式。
- **更新**: 2026-08-14 新增

### [B010] 任意页面查看 API 使用量
- **状态**: 想法
- **优先级**: P2
- **背景 / 动机**: 希望不切换到专门页面,在 Web GUI 任意页面(会话、设置等)都能随时看到 API 用量(请求数 / token / 费用 / 余额 / 配额)。
- **要点**:
  - 调研结论(2026-08-18):社区已有大量现成产品,npm 均已发布,无需从零自研,优先评估复用:
    - **全局可见类**(任意页面常驻):[dsh-cost-meter](https://www.npmjs.com/package/dsh-cost-meter) v1.5.9 功能最全(本会话费用、当日费用、官方余额、OpenCode Go 额度、Coding Plan 六家额度、90+ 模型价格目录,侧边栏 / 输入区 / dock 多位置可配);[@kenz1117/dsh-ui-usage-billing](https://www.npmjs.com/package/@kenz1117/dsh-ui-usage-billing) v0.2.6(侧边栏入口胶囊 + 完整计费仪表盘,30s 自动刷新);[dsh-usage-dashboard](https://www.npmjs.com/package/dsh-usage-dashboard) v0.1.0(侧边栏底部余额 + 今日花费);[@faith1688/dsh-usage-meter-harness](https://www.npmjs.com/package/@faith1688/dsh-usage-meter-harness) v0.1.2(输入框旁 tokens / 费用 / 真实余额);dsh-account-meter v0.1.3(右侧多账户余额计量框);
    - **专用页类**:[@abcdefu_cja/dsh-usage-stats](https://www.npmjs.com/package/@abcdefu_cja/dsh-usage-stats) v0.1.0(设置页「用量统计」Tab + 会话页用量按钮,精确 token 计数);dsh-usage-insights v0.2.0 / dsh-activity-report(本地只读用量 / 性能分析);
    - **其他**:dsh-usage-balance(会话成本 chips + token 热图)、@az7627/dsh-token-usage(会话内 token 时间线)、dsh-token-price;GitHub 侧 [dsh-usage-dashboard-plus](https://github.com/1HelloMan1/dsh-usage-dashboard-plus)(余额 / 日花费 / 分模型统计 / 调用日志 / 缓存率 / TTFT / CSV 导出);社区插件目录 [awesome-dsh-plugin](https://awesome-dsh-plugin.com);
    - 通用方案(非 DSH 专属,tokmon 本地代理仪表盘、Langfuse / Helicone 等观测平台)与「Web GUI 任意页面常驻」诉求直接相关度低,不优先。
  - 建议路径:先试用 dsh-cost-meter 或 @kenz1117/dsh-ui-usage-billing,满足即用(评估后归档本条目),不满足再自研(落点 = client UI 全局组件 + host 侧聚合 API);
  - 待确认:指标范围(余额 / 当日费用 / 会话费用 / 配额)、入口位置偏好、是否要多厂商。
- **更新**: 2026-08-18 新增;完成社区调研,确认存在成熟现成产品,结论为「评估复用优先」。

### [B011] 输入框 @ 唤起 subagent 选择并指派任务 + subagent 管理面板
- **状态**: 想法
- **优先级**: P1
- **背景 / 动机**: B004 落地后 subagent 会变多(claude-code / codex / 多机实例),希望用户能在输入框直接 `@` 唤起 subagent 选择器、显式指派任务给某个 subagent,而不是只能靠主 agent 自主决定委派;同时需要一个管理面板统一查看/配置这些 subagent。
- **要点**:
  - 前置条件:先验证 B004 单机 subagent 好用(openspec 4.4),「好用」再决定本条优先级;
  - 入口形态:复用 `dsh-client-ui-input-trigger` 的 trigger 机制(现有 `/` slash-menu 即由它注册,支持 lexicon 候选 + `ReferenceInsert` / `ConsumeTokenRequest` 等契约),新增 `@` trigger 大概率不动会话主链路;UI 参考 `dsh-client-ui-model-selection` 的两级菜单;
  - 数据源:subagent 注册表 = host 侧 subagent registry / tool 清单(`subagent-claude-code` 每实例一条 tool 行,天然可按 providerName / toolName 列出);也可混入当前会话树里的活跃 subagent(类似 `list_agents` 的 children 视图);
  - 指派语义(待设计):选中后把输入内容作为委派请求直接发给该 subagent(用户显式选目标,等价于主 agent 调 subagent 工具但由人指定),还是生成一条指令让主 agent 转发;结果如何回流展示;
  - 管理面板:subagent 列表(名称 / provider / 模型 / 机器 / 状态 / 任务数),配置(增删、默认模型、persona 提示词),任务历史;落点 = client UI(设置页 Tab 或侧栏面板)+ host 侧配置持久化;
  - 与 B001 关系:B001 是 agent 自主编排(tech-lead 派活),本条是用户手动指派,互补;面板可复用一个 subagent registry 设计,避免两处各建一套;
  - 与 B008 可联动:面板里 subagent 的任务状态可进会话看板。
- **更新**: 2026-08-19 新增

---

## 已完成

### [B009] 仓库结构定稿:总配置 + 可插拔定制(monorepo)
- **状态**: 已完成
- **优先级**: P0
- **背景 / 动机**: zydsh 预期承载大量 DSH 定制(preset、插件包、skill、profile patch 等),期望一个总配置统一管理,各项定制可插拔开关、各自独立发布维护,但都放在同一仓库内。
- **要点**:
  - 目标形态:monorepo;根级"总配置"(manifest)声明启用哪些定制;每项定制独立目录(或包),可单独启用/禁用;
  - 定制类型盘点:agent preset、host 插件包(llm provider / subagent 接线 / 工具)、skill、cordis.patch 片段、启动脚本(`scripts/dsh.fish` 已有);
  - 发布/维护:每项定制独立版本(各自 package.json 或独立版本记录),总配置按版本引用;
  - 部署同步:总配置 → `~/.dsh` 落点(`.agent-presets/`、`profiles/web/cordis.patch.yml`、profile node_modules)的同步工具(`dsh plugin add` / 脚本);
  - 结合此前草案:`plugins/`、`presets/`、`profile/`、`skills/` 布局;与 openspec 工作流、BACKLOG.md 配合;
  - 待设计:目录布局、总配置格式(JSON/YAML)、开关粒度(全局 vs per-session)、多定制间依赖关系。
  - 方向定稿(2026-08-14):定制单元采用社区 `dsh.bundle` 标准(package.json 声明 bundle + 自带 cordis.patch.yml + src/),patch 跟包走;presets 走官方 `.agent-presets` 机制;skills 跟包或 project 源;总配置 manifest + sync 为自研薄层。
  - 结构定稿文档位置(2026-08-19):`README.md`(目录结构 + 真相源约定 + sync 用法)、`dsh.yaml`(manifest 契约:customizations / 顶层 `dependencies` / 字段约定)、`packages/README.md` / `presets/README.md` / `patches/README.md` / `skills/README.md`(各类定制单元规范);设计过程见 openspec change `repo-layout`(design D7/D8 定稿,归档后移入 `openspec/changes/archive/`)。
- **更新**: 2026-08-14 新增,即定 P0;同日方向定稿,进入 openspec 设计(change: repo-layout);设计定稿 + 实施完成(骨架 / `dsh.yaml` / `scripts/sync.mjs` / 迁移,spike 与 spec 场景验收通过),首个 remote 定制 cost-meter 纳入,首个按新结构落地的定制 subagent-codex(remote 包 + 顶层 dependencies + patches 接线)落地(2026-08-19);4.6 重启验收通过(cost-meter host+client 加载、subagent 两行激活、`dsh restart` 子命令补充);2026-08-19 openspec 归档完成(`2026-08-19-repo-layout`,主 specs 8 需求/16 场景),B004 codex 委派端到端验收通过,本条目完成。

### [B003] IDE 集成:打开当前项目目录
- **状态**: 已完成
- **背景 / 动机**: 增加用 IDE 打开当前项目目录的能力,暂时只支持 VSCode。
- **要点**:
  - 方案定稿(2026-08-19):复用社区插件 [dsh-open-in-vscode](https://github.com/omdsh-dev/dsh-open-in-vscode) v0.1.6——workspace 行 `…` 菜单「在 VSCode 中打开」,host 侧 spawn `code <path>`(进程分离);MIT,源码已审,无模型可见面;
  - npm 0.2.0 已 unpublished,按官方 README 用 tag v0.1.6 tarball 直装(manifest id: `open-in-vscode`,非 npm spec 显式 `name` 字段);sync 为此支持非 npm spec;
  - 未来扩展:JetBrains 等——插件 config 的 `command`/`args` 可配任意编辑器 CLI。
- **更新**: 2026-08-14 新增;2026-08-19 落地社区插件方案,重启验收通过(菜单打开 VSCode 正常),本条目完成。
