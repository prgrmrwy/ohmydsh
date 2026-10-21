## Why

日常使用中推理强度（effort）只能手动切换：简单消息开满 effort 浪费订阅额度与时延，复杂任务忘记升档又影响质量；子智能体创建时虽然支持显式指定 provider/model/effort，但主 Agent 缺少稳定依据，多数情况直接继承父会话路由。本 change 让主会话按任务复杂度自动调整 effort，并让子会话选模使用同一个判断，同时保持用户手选、显式指定与既有门禁的最高优先级。

**修订（2026-10-20）**：首版实现使用本地关键词规则分类，偏离了用户“AI + 快速决策”的目标。用户明确要求：判断必须由 Jev 这类专用决策模型完成；通用对话模型太慢，不采用；不接受本地规则降级——Jev 不可用时直接停用能力并让人类看到原因。TypeSafe 直连对当前出口地区返回 HTTP 451，spike（`spike-jev-openrouter.md`）证实经 OpenRouter 调用 Jev 可行（10/10 样本符合预期，p50 约 0.81s，约 $0.000017/次）。

**修订（2026-10-22，判档策略）**：上线后会话 `session-4390e037` 的一个普通运维请求（排查记忆库 git 作者身份）在 Opus 5.5 上被设为 `max`，用户预期 medium、最多 high。原因在本插件自己的策略，不是 Jev 故障：(1) 档位标准把“高风险”当成“难”，Jev 照字面判为 `escalated`；(2) 映射表按旧模型默认值设计（complex→xhigh、escalated→max），而 Anthropic 与 OpenAI 当前文档都以 medium 为 agentic coding 起点、xhigh/max 只用于实测有收益的场景（`eval/README.md` 记录出处与实测）。用本机 493 个真实用户回合重放还发现：只看本轮消息时，“继续/同意/apply”这类回合几乎全判 simple；子会话表的强档模型不在官方子会话白名单内，复杂委派会被拒。用户在讨论中确认：采用官方建议；Jev 只判难度，模型与 effort 查一张表；给 Jev 看上一轮问答；增加逐回合人工标注以便定期校准。

## What Changes

- 新增本地自研 package（Host + Web client），参考 `dsh-router-laya` 的交互与“判断 → 档位 → 映射表”拆分，但不安装、不扩展、不改造该插件。
- Composer 模型控制区新增 `AUTO / MANUAL` 芯片，位于模型选择器与 GPT“速度/标准”芯片左侧，不改写二者的状态；悬停显示面板：本回合 effort、原因、最近 20 条决定（仅内存）以及停用原因；外观与官方模型选择器一致。
- **主会话只调 effort**：AUTO 下保持用户手选的 provider 与 model 不变，只按任务档位调整 reasoning effort；不触发官方模型切换通知，不改变子会话继承的**模型**，但不保证各 provider 的缓存命中。AUTO 的结果由官方模型选择器自然显示。
- **切回 MANUAL 只停止自动调整**（2026-10-21 用户决定）：不复原、不保存锚点；effort 停在最后一次 AUTO 值，由用户在官方选择器中调整。卸载插件同理。
- **判断由 Jev 完成（替换本地规则）**：每个用户回合在 step 1 以一次 Jev `choice` 请求得出四级档位 `simple / standard / complex / escalated`；“继续”“重做”“用最高档”等意图交给 Jev 理解。删除本地关键词分类器、显式/延续/重做词表；非用户回合（如子会话完成通知）沿用上一用户回合档位，不调用 Jev。
- **档位只衡量推理难度（2026-10-22）**：判档标准改为“把任务做对需要多少推理与验证”，不看风险、规模或消息长短；步骤清楚的风险操作与大量机械改动属于 standard；调研已有方案并适配用户环境、排查单个报错属于 standard；`escalated` 只用于必须证明正确或找隐蔽缺陷、缺少先例的新架构、或此前 complex 尝试已失败。追问：批准/继续/选方案按上一轮 AI 回复中接下来要做的工作判档；整体失败或要求重做时升一级（代码在 `state` 中给出“上一档的上一级”）；部分仍有问题按新的小修复单独判档。
- **Jev 看到上一轮问答（2026-10-22）**：主会话判档的 `state` 除本轮用户文本外，加入上一用户回合的用户文本（截断 500 字）与上一轮最后一条助手回复的结尾（1200 字）。外发前对常见凭据形态与 IPv4 地址脱敏。外发范围因此扩大到助手回复片段（用户已同意）。
- **effort 按官方默认值上下浮动（2026-10-22）**：每个模型取官方推荐起点，`standard` 用起点，`simple` 降一级，`complex` 升一级，`escalated` 升两级且不超过 `xhigh`；自动路由永不选 `max`，不设下限。
- **MANUAL 同时关闭子会话判档（2026-10-22）**：`route_subagent` 跟随所属主会话（子会话中调用时沿父链找到根会话）的模式；不是 AUTO 时不调 Jev、不外发，返回 `routed: false`，skill 规定按官方默认委派、不询问用户。
- **子会话按难度选模型，不受主会话模型限制（2026-10-22）**：provider 跟随主会话；模型按档位查表（claude：haiku-5-5 / sonnet-5-5 / opus-5-5 / opus-5-5，codex：gpt-6-luna / gpt-6.1-sol ×3），effort 按同一张起点表；不自动选 Fable 或 Astra。官方子会话白名单须包含表中全部模型（用户在 DSH 设置中维护，不在本仓库）。
- **派发时机写入环境级指令（2026-10-22）**：何时派子会话由主 Agent 依据 `instructions/dsh-home.md` 中的规则决定（大块编码实施、独立评审、中间输出多的探索、可并行的独立工作才派；讨论、单个小修复、主上下文装得下的依赖链不派）；派出后由 `route_subagent` 判档。该文件由 ohmydsh 物化为 `$DSH_HOME/AGENTS.md`，作为会话开头的固定消息加载，不影响 prompt cache。
- **逐回合人工标注（2026-10-22）**：在助手回复操作栏（官方 `conversation.chat.assistant-actions` 插槽，位于点踩右侧、分支左侧）加一个档位按钮：悬停显示本轮判档，点开选择“这轮应该用哪档”。Host 持久记录每个 AUTO 判档回合的档位、分布、effort、模型、规则版本与用户标注（不存消息原文），并提供统计脚本列出判档与标注不一致的回合，用于定期调整规则。
- **Jev 承载方为 OpenRouter**：Host 直接调用 `POST https://openrouter.ai/api/alpha/decisions`，模型 `typesafe/jev-1.13`，凭据为 `OPENROUTER_API_KEY`（主 checkout `.env.local` 经 `bin/dsh` 注入，插件经官方 launch environment 读取；无此变量时为“未配置凭据”），单次请求期限 3 秒、不重试、不跟随重定向。判断在 pre-step 确认步骤进入后才发起，被拒的步骤不外发。不经 jev-mcp：其对 429/5xx 自动重试最长 60 秒，与“失败即停用”冲突。
- **失败即停用并提示（不降级）**：Jev 调用任何失败（含缺凭据、余额不足、超时）都把该会话切为 MANUAL（不复原）并记录闭集失败类别；芯片显示停用状态与原因，例如“Jev 余额不足（402），自动路由已停用”。停用保持到用户手动再点 AUTO；不轮询、不主动查询余额、不自动重试。失败按状态码分类：402 余额不足、401/403 凭据无效、429 限流、451 地区受限、其它 4xx 请求被拒、5xx/网络 服务不可用、超时、响应无效、缺凭据。用户取消不视为 Jev 失败。
- **子会话与主会话同构**：新增 Host 工具 `route_subagent`，与主会话共用同一 Jev 判断与失败分类，按调用方指定的 provider 返回档位及 `provider / model / reasoning_effort`；子会话档位表从 skill 移入代码，成为唯一来源。工具失败时返回失败类别，skill 要求主 Agent **暂停委派并询问用户**，不得自行猜测档位替代。
- 不加载插件即为禁用（`dsh.yaml enabled: false`）；不设运行时全局开关。

## Capabilities

### New Capabilities
- `auto-model-routing`: 定义 AUTO/MANUAL 交互、主会话 effort 路由、Jev 判断与失败即停用、级别与映射、子会话决策工具与 skill、显式优先、门禁一致性与 Host 端点边界。

### Modified Capabilities
- 无。（`jev-workflow-routing` 的错误类别与 MCP provider 切换由 `configurable-jev-provider` 负责，见 Impact。）

## Impact

- `packages/auto-model-routing/`：Host 插件（step-1 `agent/pre-step` 调 Jev、`agent/request` effort 改写、会话状态含停用原因、端点、`route_subagent` 工具、判档记录与标注）与 Web client（芯片与面板，含停用显示；回复操作栏档位按钮）。2026-10-22 修订改动 `jev.ts`（判档规则与 state 组装）、`effort.ts`（起点表与子会话表）、新增判档记录存储与标注端点、client 档位按钮。
- `skills/subagent-model-routing/`：改为“委派前调用 `route_subagent` 并显式传参；失败暂停并询问用户”，移除档位表。
- `instructions/dsh-home.md`：新增“何时派发子会话”一段（环境级指令，所有会话含子会话可见）。
- `openspec/changes/auto-model-routing/eval/`：判档规则回归资产（合成样本、由真实回合改写的样本、运行脚本、出处与实测记录），不含真实会话原文。
- `dsh.yaml`：note 写明外部数据处理方、外发范围（含助手回复片段）与凭据变量。
- **外部服务与隐私**：每个用户回合（AUTO）与每次子会话决策，都会把截断至 8000 字符的用户任务文本发送给 OpenRouter 及 TypeSafe；主会话判档另外发送上一轮用户文本（≤500 字）与上一轮助手回复结尾（≤1200 字），外发前脱敏常见凭据形态与 IPv4 地址（脱敏是尽力而为，不能保证移除所有敏感信息）。子会话判档只在所属主会话为 AUTO 时发生并外发（2026-10-22 修订，原为“启用插件即外发，与模式无关”）。OpenRouter 数据保留与日志条款**未确认**（端点元数据未公布），由用户在 OpenRouter 后台自行设置。凭据不写入仓库、状态文件、日志或错误信息；状态与面板只保存失败类别，不保存响应体。判档记录只存本机，不含消息原文。
- **外部配置**：官方子会话白名单（`subagent-model-selection-settings.allowedModels`，DSH 设置）须加入 `claude/claude-opus-5-5` 与 `codex/gpt-6.1-sol`；不在本仓库管理，由用户在设置中修改，验收时核对。
- **开关耦合**：插件与 skill 仍为两个 manifest 条目；只启用 skill 时，skill 指示主 Agent 告知用户“子会话 Jev 选模未启用”并按官方默认委派。
- 新增依赖：无（使用 Node 内置 `fetch`）。
- 不修改：官方模型选择、官方点赞/点踩反馈、`home-network-model-guard`、dsh-pet compat overlay、jev-mcp 接线与 `jev-workflow-router`。
- **已知代价**：Claude 订阅适配器把 effort 放在请求顶层，换 effort 会使 prompt cache 失效；真实回合重放中相邻回合 effort 不同的比例约 53%。用户选择不设下限、接受该代价，由标注统计观察后再议。
- **与 `configurable-jev-provider` 的契约**：本 change 自带 Jev 客户端（`src/jev.ts`）与人类提示用的失败类别闭集，**不依赖**该 change 的共享 transport。该 change 只负责 jev-mcp 与 `jev-workflow-router` 的 provider 切换；其草案中“供 auto-model-routing 使用”和“不可用降级”须删除（本次已在草案中标注），以免日后合并引入降级路径。类别命名与 recorder 的映射见 design D5。
