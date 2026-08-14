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

### [B003] IDE 集成:打开当前项目目录
- **状态**: 想法
- **背景 / 动机**: 增加用 IDE 打开当前项目目录的能力,暂时只支持 VSCode。
- **要点**:
  - 提供 tool/命令:调 `code <项目目录>` 或 vscode:// URI;
  - 明确"当前项目目录"来源(workspace 路径);
  - 未来可扩展 JetBrains 等其他 IDE。
- **更新**: 2026-08-14 新增

### [B004] AI provider 订阅制认证
- **状态**: 想法
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
- **更新**: 2026-08-14 新增,提升 P0;同日完成 GitHub 调研,确认官方现成方案;同日定范围:单机可用,多机/分布式暂缓。

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

---

## 已完成

(暂无)
