# dsh-auto-model-routing

[English](README.md) · 简体中文

<!-- problem -->
主会话在 AUTO 下每个用户回合请 Jev 决策模型（经 OpenRouter）判断任务档位，只调整推理强度，保留 provider/model。Jev 任何失败都会让 AUTO 自动停用，并在芯片上显示原因；没有本地降级。自动调整需主动启用；新普通会话缺省 MANUAL，可在设置中修改默认模式。

**安装**：在 ohmydsh 中，本包通过 `dsh.yaml` 管理（条目 `auto-model-routing`，`source: local`），配套 skill 条目为 `subagent-model-routing`：两者都设为 `enabled: true` 后运行 `dsh build`。本 README 不提供独立安装说明。所在仓库的全貌见[插件索引](../../README.zh.md#插件索引)。

## 架构
<!-- section: architecture -->

![auto-model-routing 架构图：芯片与 RPC 端点、agent/pre-step 钩子经 OpenRouter 请求 Jev、agent/request 钩子只改推理强度、route_subagent 工具共用同一判断](docs/architecture.dual.svg)

插件分 Host 与 Web 两半，不另起进程；虚线框内都运行在 DSH Host 中。

1. **判档（用户回合的第 1 步）**：`agent/pre-step` 监听先让官方链路决定，只在步骤真正进入时才动作。AUTO 下、本回合含用户消息时，组装脱敏并截断的 state（本条消息、上一档位、上一轮问答片段），向 OpenRouter 上的 Jev 发起一次请求，得到档位 `simple`/`standard`/`complex`/`escalated`。没有用户输入的回合（例如子会话完成通知）沿用上一档位，不外发。
2. **改写（该回合的每次请求）**：以 `prepend` 注册的 `agent/request` 监听位于官方模型选择监听外层：先等官方合成配置，再按实际选中的模型把档位映射为 effort（优先精确主映射，否则按官方起点 ± 档位偏移，受实际支持范围与配置上限约束，不选 `max`），只改 `reasoningEffort`，provider/model 原样保留。结果与官方选择不同时，不等待地调用官方 `sessionController.selectModel`，让模型选择器显示实际使用的 effort。
3. **失败即关闭**：Jev 任何失败（无 key、余额、鉴权、限流、地区、超时、响应无效）都会把 `MANUAL` 与失败类别写入会话状态文件，本回合不改写；没有本地分类器、不重试，由用户重新点 AUTO。
4. **子会话**：`route_subagent` 工具从调用方沿父链找到根会话；只有根会话为 AUTO 时才把任务文本交给同一套 Jev 判档规则，再解析显式子映射或内置缺省表，复核当前目录与允许列表。`subagent-model-routing` skill 与环境级派发规则要求主 Agent 每次委派前调用它，并显式传入这三个值。
5. **Web**：`conversation.input.right` 中的芯片每 3 秒轮询 `state` 端点，经 `setMode` 切换模式；`conversation.chat.assistant-actions` 中的仪表按钮经 `label` 读写档位标注。设置页使用 `settings`、`saveSettings`、`setKey`，六个端点都是官方已认证连接上的 POST 端点；设置操作不选择会话模型。

| 关注点 | 源码 |
|---|---|
| 钩子、端点、工具注册 | [`src/index.ts`](src/index.ts) |
| 回合簿记与 AUTO/MANUAL 规则 | [`src/router.ts`](src/router.ts)、[`src/state.ts`](src/state.ts) |
| Jev 请求、失败类别、脱敏 | [`src/jev.ts`](src/jev.ts)、[`src/context.ts`](src/context.ts) |
| 判档规则（唯一来源） | [`src/rubric.json`](src/rubric.json) |
| 档位 → effort、子会话模型表 | [`src/effort.ts`](src/effort.ts) |
| 设置存储、校验与凭据/目录适配 | [`src/settings.ts`](src/settings.ts)、[`src/settings-validation.ts`](src/settings-validation.ts)、[`src/settings-host.ts`](src/settings-host.ts) |
| 子会话工具 | [`src/subagent-tool.ts`](src/subagent-tool.ts) |
| 芯片、提示与回复栏按钮 | [`src/client/`](src/client/index.ts) |

架构图源文件为 [`docs/architecture.json`](docs/architecture.json)（archify，明确标注工作树来源，不声称不可变提交证据）；结构变化后用 archify 重新渲染并导出双主题 SVG。

## 使用

打开**设置 → 自动模型路由**配置 OpenRouter 凭据与路由。芯片位于 GPT 速度芯片左侧，外观与模型选择器一致：点击切换模式，悬停查看插件本回合设定的 effort 与原因，以及最近一次 Jev 决策及其分布。AUTO 的每次决定都会写入官方模型选择，右侧选择器显示的就是实际使用的 effort。注意官方会同时把它保存为新会话的默认值，所以新会话会从最近一次 AUTO 的 effort 开始；想手动指定 effort，请先切到 MANUAL。

### 设置与凭据迁移

页面分「判档服务」「会话」「路由映射」三个区块，提供六类设置：

| 设置 | 缺省值与行为 |
|---|---|
| OpenRouter API key | 经官方 DSH credentials 服务管理，只显示状态、来源与可写性，不回传值；留空保持现有 key，单独的删除动作移除 key。 |
| 新会话默认模式（`defaultMode`） | `MANUAL`；`AUTO` 只用于全新普通会话（包括普通 Pet 主会话），不影响恢复、清空、压缩、子会话或没有状态的已有会话。新 AUTO 会话每个用户回合都会请求 Jev。 |
| 推理强度上限（`effortCap`） | `xhigh`；可选 `low/medium/high/xhigh`，同时约束主、子路由，自动路由永不选 `max`。 |
| 判档等待上限（`jevTimeoutMs`） | `3000` 毫秒；整数范围 `1000–4500`，每次判档读取，不重试。 |
| 判档提示（`decisionToast`） | 开启；只控制临时提示，不影响路由和悬停面板。 |
| 路由映射（`mainEfforts`、`childRoutes`） | 稀疏的逐格覆盖；未覆盖的格子用内置缺省规则。 |

**Claude / GPT 分页**：GPT 是界面名称，内部 provider id 仍为 `codex`（Claude 为 `claude`）。每页四档、两列：主会话推理等级与子会话推荐。没有额外的主模型选择器；表格主列按 provider/tier 统一作用本体系所有主模型，未修改格显示「默认（随模型）」并保留实际模型起点算法。子映射按 provider/tier 保存完整 model + effort，不继承主映射。切换分页保留未保存草稿。档位 info 直接显示 [`src/rubric.json`](src/rubric.json) 的英文 criteria 原文。

主模型来自官方可用目录，不受子会话白名单限制；子模型只能选「本页 provider ∩ 当前目录 ∩ 已启用的官方子智能体允许列表」，effort 只能选模型实际支持且不超过上限的自动等级。换模型后原 effort 无效时，须主动重选再保存。被移除的旧路由仅显示为不可用，不成为菜单选项。允许列表未启用、为空或不可读取时禁用子 picker，不放宽范围；其它可验证设置仍能保存。官方允许列表还会在会话创建时保存快照，因此已有会话仍可能拒绝新配置的推荐；插件不绕过拒绝，也不偷偷换模型。

主列可选 effort 是当前目录本体系所有模型支持集合的交集，且不超过上限，不受子会话白名单限制。体系、模式、上限三个分段控件统一 28px 高、12px 字号，随内容自然占宽。

**冲突与恢复默认**：显式映射精确生效，不支持或超上限时拒绝，不静默截断。降低上限须在同一次保存中修复或恢复所有冲突格，包括其它页签。「恢复默认」只删除该格覆盖，不把整张缺省表固化。内置算法结果受上限约束：主模型无有效 effort 时透传（`no-effort-support`）；子推荐无有效 effort 时返回错误、暂停委派。目录变化或手改文件导致显式映射失效时，使用阶段返回设置错误：主会话 AUTO 请求被阻止，子工具要求暂停委派。这不是 Jev 失败，不写入 `disabled`，不回退到其它映射。

非密钥设置位于 `$DSH_HOME/plugins/dsh-auto-model-routing/config.json`（目录 0700、文件 0600、原子替换）。非法普通字段可独立回退缺省值；文件无法读取/解析时展示默认值与诊断，保存会覆盖损坏内容；非法显式路由保留可诊断状态，不静默消失。设置在下一次请求/工具调用生效，无需构建或重启；同回合复用已判档位，但重新解析映射。规则、脱敏/外发范围、服务地址/模型 id 与起点常量不在此开放编辑。

**把已有启动环境 key 迁入 GUI，顺序不能反过来：**

1. 在本机自行保留现有 key，不粘贴到对话或仓库文件。
2. 从启动来源删除 `OPENROUTER_API_KEY`（本部署为主 checkout 的 `.env.local`，由 `bin/dsh` 加载）。
3. 重启 DSH 一次，清除启动快照中的变量。**不能先在 GUI 保存再删变量/重启**：启动环境凭据优先且只读。
4. 再在设置页保存 key。此后替换/删除在下一次判档生效，不必再次重启。迁移间隙未配置时 AUTO 可能因 `missing-credential` 停用；保存 key 不会清除停用状态，需重新点 AUTO。

官方解析顺序为：启动环境 → 凭据存储 → 项目 `.env` → `$DSH_HOME/.env`。credentials 服务不存在时仍可读启动环境，但禁用 GUI key 管理。本地官方存储通常为 `~/.dsh/.credentials.yaml`（0600）；插件不把 key 写进配置、响应或日志。文件权限不能把 key 与同用户运行的 Agent 工具隔离。保存时不额外请求验证 key，不查余额。

底部「保存」协调的是 **key 与配置的独立提交**，不是跨存储事务。某部分成功、另一部分失败时分别报告；成功的 key 草稿清空，未保存的设置草稿保留供修复。回滚到 0.1.0 时需把 key 放回启动环境并重启：旧版不读凭据存储，只识别配置中的 `decisionToast`，忽略其它新字段。

**外发数据**：AUTO 下每个用户回合会把你的消息（最多 8000 字符）连同上一轮的问答片段（上一条用户消息前 500 字、上一条助手回复末 1200 字）发送给 OpenRouter 与 TypeSafe（模型 `typesafe/jev-1.13`）；只有主会话为 AUTO 时，`route_subagent` 才外发子任务文本。外发前先按形态脱敏（密钥、Bearer、`token=` 一类赋值、URL 中的账号密码、IP 等），这是尽力而为，不保证移除所有敏感信息。OpenRouter 对该模型的数据保留与日志条款未确认，请在 OpenRouter 后台自行设置。

**判档规则**：只看把任务做对需要多少推理与验证，不看风险、规模或消息长短；规则唯一来源是 `src/rubric.json`，回归用例与脚本见 [`eval/`](eval/README.zh.md)。**effort** 从各模型的官方推荐起点上下浮动：standard 取起点，simple 降一级，complex 升一级，escalated 升两级，受配置上限约束（缺省 xhigh），自动路由永不选 max（Opus/Sonnet/Haiku/Sol 起点 medium，Fable/Luna 起点 high，Astra 起点 low）。

**Jev 失败时**（未配置 key、余额不足、key 无效、限流、地区受限、超时、响应无效），会话切到 MANUAL，芯片显示 `MANUAL · Jev 停用` 与原因；点 AUTO 重试。取消回合不算失败。不轮询、不查余额。

**决策提示（默认开启）**：每次 Jev 判档后在芯片上方显示 3 秒提示：谁判断的、档位 → （模型）effort 与耗时，第二行为分布（省略 0% 的档位），例如 `主会话判断 · complex → high · 0.78s` / `complex 61% / escalated 39%`。最多约 3 秒内出现。在设置页关闭「判档提示」即可，无需重启。

`route_subagent` 工具对子会话使用同一个 Jev 判断，返回 provider/model/reasoning_effort：Claude 依次为 Haiku、Sonnet、Opus、Opus，Codex 依次为 Luna、Sol、Sol、Sol，模型不受主会话当前模型限制，缺省表不含 Fable/Astra，只有有效显式子映射才会选它们。它跟随所属主会话（子会话中调用时沿父链找到根会话）的模式：MANUAL 时不判档、不外发，返回 `routed: false`，主 Agent 按官方默认委派。配套 skill 要求主 Agent 显式传入，工具失败时暂停委派并询问你。这五条路由（haiku/sonnet/opus/luna/sol）须在设置页「子智能体 → Agent 可选择的模型」白名单中；白名单在会话创建时固定，改动只对新会话生效。

**判档记录与标注**：每次主会话判档会向 `$DSH_HOME/state/auto-model-routing/judgements.jsonl` 追加一行（会话 id、回合、档位、effort、模型、规则版本，不含消息文本）。有判档的回合，回复操作栏会多一个仪表按钮，悬停显示判档，点击可选择“这轮应该用哪档”。`node scripts/label-report.mjs` 按规则版本汇总一致、判高、判低。Host 重启后，重启前回合的按钮不再显示（记录不受影响）。

每个会话跨 Host 重启保留上一次档位（只存档位名）。用户发出的“继续”会结合上一档与有限上轮上下文重新判档；没有用户输入的回合才直接沿用档位、不再请求。

**MANUAL 只是停止自动调整**，不复原：会话保持 AUTO 最后一次的 effort，直到你在模型选择器里另选；Jev 失败后同样如此。模式与最近一次 Jev 失败保存在 `$DSH_HOME/state/auto-model-routing/sessions/`。不自行换模型，不绕过网络门禁或官方模型白名单。不保证 provider 的缓存命中。

## 开发验证

在仓库根目录安装依赖，再运行：

```sh
npm --prefix packages/auto-model-routing test
npm --prefix packages/auto-model-routing run typecheck
npm --prefix packages/auto-model-routing run build
```

测试使用真实 AgentLoop、假 LLM 流与本地回环假 Jev 服务，不访问 OpenRouter。离线测试不能替代现有 GUI 验收。

## 主仓中的规范与设计

本包属于 [ohmydsh](../../README.zh.md) 定制仓库，行为先写成规范再实现：

- **当前主规范（已同步设置行为）**：[`openspec/specs/auto-model-routing`](../../openspec/specs/auto-model-routing/spec.md)，本包必须满足的验收场景。
- **设置设计与已接受的验收缺口**：已归档的 [`auto-model-routing-settings`](../../openspec/changes/archive/2026-10-23-auto-model-routing-settings/proposal.md)、[设计](../../openspec/changes/archive/2026-10-23-auto-model-routing-settings/design.md)与 [delta spec](../../openspec/changes/archive/2026-10-23-auto-model-routing-settings/specs/auto-model-routing/spec.md)。主规范已同步；用户确认紧凑体系表 GUI 并同意带明确证据缺口归档。
- **设计与演进**：归档 change [`2026-10-22-auto-model-routing`](../../openspec/changes/archive/2026-10-22-auto-model-routing/design.md)（决策 D1–D14：为何只改 effort、为何没有本地降级、起点表、标注），以及 [Jev/OpenRouter 调研](../../openspec/changes/archive/2026-10-22-auto-model-routing/spike-jev-openrouter.md)与 [GUI 验收记录](../../openspec/changes/archive/2026-10-22-auto-model-routing/verify.md)。
- **manifest 条目与信任说明**：[`dsh.yaml`](../../dsh.yaml) 中的 `auto-model-routing` 与 `subagent-model-routing` 记录了外发内容、凭据位置与停用方式。
- **配套 skill**：[`skills/subagent-model-routing`](../../skills/subagent-model-routing/SKILL.md)；要求每次委派前调用 `route_subagent` 的「子会话派发」规则写在环境级指令 [`instructions/dsh-home.md`](../../instructions/dsh-home.md) 中（见[环境级 Agent 指令](../../docs/architecture/agent-instructions.md)）。
- **宿主集成陷阱**：修改钩子读取用户消息或会话事件的方式前，先读 [DSH 插件集成陷阱](../../docs/architecture/dsh-plugin-integration-pitfalls.md)。

## 移除
<!-- section: removal -->

将插件 `enabled: false` 并构建即可。会话保持 AUTO 最后一次的 effort，需要时在官方模型选择器里另选。skill 有独立开关；插件未启用时，它会让主 Agent 按官方默认委派。

旧逐模型主映射会显式诊断并阻止使用，不隐藏后继续生效，也不静默删除。不相关保存保留旧数据；可明确将该体系恢复默认或替换成新的 provider/tier 映射。历史验收 Loop 2 针对旧逐模型设计，不代表本次体系级修订已验收。
