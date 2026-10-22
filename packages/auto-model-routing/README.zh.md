# dsh-auto-model-routing

[English](README.md)

<!-- problem -->
主会话在 AUTO 下每个用户回合请 Jev 决策模型（经 OpenRouter）判断任务档位，只调整推理强度，保留 provider/model。Jev 任何失败都会让 AUTO 自动停用，并在芯片上显示原因；没有本地降级。默认禁用，会话默认 MANUAL。

## 使用

在主 checkout 的 `.env.local` 写入 `OPENROUTER_API_KEY=sk-or-...`，`bin/dsh` 启动时加载。芯片位于 GPT 速度芯片左侧，外观与模型选择器一致：点击切换模式，悬停查看插件本回合设定的 effort 与原因，以及最近一次 Jev 决策及其分布。AUTO 的每次决定都会写入官方模型选择，右侧选择器显示的就是实际使用的 effort。注意官方会同时把它保存为新会话的默认值，所以新会话会从最近一次 AUTO 的 effort 开始；想手动指定 effort，请先切到 MANUAL。

**外发数据**：AUTO 下每个用户回合会把你的消息（最多 8000 字符）连同上一轮的问答片段（上一条用户消息前 500 字、上一条助手回复末 1200 字）发送给 OpenRouter 与 TypeSafe（模型 `typesafe/jev-1.13`）；只有主会话为 AUTO 时，`route_subagent` 才外发子任务文本。外发前先按形态脱敏（密钥、Bearer、`token=` 一类赋值、URL 中的账号密码、IP 等），这是尽力而为，不保证移除所有敏感信息。OpenRouter 对该模型的数据保留与日志条款未确认，请在 OpenRouter 后台自行设置。

**判档规则**：只看把任务做对需要多少推理与验证，不看风险、规模或消息长短；规则唯一来源是 `src/rubric.json`，回归用例与脚本见 [`eval/`](eval/README.zh.md)。**effort** 从各模型的官方推荐起点上下浮动：standard 取起点，simple 降一级，complex 升一级，escalated 升两级，封顶 xhigh，自动路由永不选 max（Opus/Sonnet/Haiku/Sol 起点 medium，Fable/Luna 起点 high，Astra 起点 low）。

**Jev 失败时**（未配置 key、余额不足、key 无效、限流、地区受限、超时、响应无效），会话切到 MANUAL，芯片显示 `MANUAL · Jev 停用` 与原因；点 AUTO 重试。取消回合不算失败。不轮询、不查余额。

**决策提示（默认开启）**：每次 Jev 判档后在芯片上方显示 3 秒提示：谁判断的、档位 → （模型）effort 与耗时，第二行为分布（省略 0% 的档位），例如 `主会话判断 · complex → high · 0.78s` / `complex 61% / escalated 39%`。最多约 3 秒内出现。要关闭，在 `$DSH_HOME/plugins/dsh-auto-model-routing/config.json` 写入 `{"decisionToast": false}`，无需重启。

`route_subagent` 工具对子会话使用同一个 Jev 判断，返回 provider/model/reasoning_effort：Claude 依次为 Haiku、Sonnet、Opus、Opus，Codex 依次为 Luna、Sol、Sol、Sol，模型不受主会话当前模型限制，不自动选 Fable/Astra。它跟随所属主会话（子会话中调用时沿父链找到根会话）的模式：MANUAL 时不判档、不外发，返回 `routed: false`，主 Agent 按官方默认委派。配套 skill 要求主 Agent 显式传入，工具失败时暂停委派并询问你。这五条路由（haiku/sonnet/opus/luna/sol）须在设置页「子智能体 → Agent 可选择的模型」白名单中；白名单在会话创建时固定，改动只对新会话生效。

**判档记录与标注**：每次主会话判档会向 `$DSH_HOME/state/auto-model-routing/judgements.jsonl` 追加一行（会话 id、回合、档位、effort、模型、规则版本，不含消息文本）。有判档的回合，回复操作栏会多一个仪表按钮，悬停显示判档，点击可选择“这轮应该用哪档”。`node scripts/label-report.mjs` 按规则版本汇总一致、判高、判低。Host 重启后，重启前回合的按钮不再显示（记录不受影响）。

每个会话会记住上一次的档位（只存档位名），所以“继续”这类后续消息在 Host 重启后也会沿用该档位。

**MANUAL 只是停止自动调整**，不复原：会话保持 AUTO 最后一次的 effort，直到你在模型选择器里另选；Jev 失败后同样如此。模式与最近一次 Jev 失败保存在 `$DSH_HOME/state/auto-model-routing/sessions/`。不自行换模型，不绕过网络门禁或官方模型白名单。不保证 provider 的缓存命中。

## 开发验证

在仓库根目录安装依赖，再运行：

```sh
npm --prefix packages/auto-model-routing test
npm --prefix packages/auto-model-routing run typecheck
npm --prefix packages/auto-model-routing run build
```

测试使用真实 AgentLoop、假 LLM 流与本地回环假 Jev 服务，不访问 OpenRouter。离线测试不能替代现有 GUI 验收。

## 移除
<!-- section: removal -->

将插件 `enabled: false` 并构建即可。会话保持 AUTO 最后一次的 effort，需要时在官方模型选择器里另选。skill 有独立开关；插件未启用时，它会让主 Agent 按官方默认委派。
