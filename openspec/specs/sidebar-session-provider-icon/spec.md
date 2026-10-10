# sidebar-session-provider-icon Specification

## Purpose

在 Web GUI 侧边栏每个 session 标题前展示该会话输入框当前选中的模型品牌 logo（provider 与 model 分属不同品牌时以复合 icon 同时表达两者）；选择器切换后立即更新，同时以最近实际请求作为冷历史 fallback，并保证不干扰官方任务状态点及其余行内 UI。

## Requirements

### Requirement: 输入框当前模型选择为活动会话的 logo 真相源
系统 SHALL 对当前打开的普通 session 订阅官方 model-selection 插件的 per-session `ModelDirectory.store.current`。当输入框模型选择成功改变 provider/model 时，系统 SHALL 无需用户发送消息、无需刷新页面，即更新该 session 行的品牌 logo。空白 session 只要存在当前选择，也 SHALL 显示对应 logo。

#### Scenario: 输入框切模型后立即更新
- **WHEN** 当前 session 的输入框从模型 A 成功切换为模型 B，且尚未发送下一条消息
- **THEN** 该 session 行立即显示模型 B 的品牌 logo，不继续显示模型 A

#### Scenario: 空白 session 显示选择
- **WHEN** 一个尚未发过消息的空白 session 已加载模型选择器并拥有当前选择
- **THEN** 该行显示当前选择的品牌 logo

#### Scenario: 选择失败不提前切换
- **WHEN** 用户尝试选择模型 B，但官方 `session.selectModel` 返回失败
- **THEN** logo 继续表示官方 store 中已确认的旧选择，不显示未成功的 B

### Requirement: 最后实际请求投影仅作冷历史 fallback
系统 SHALL 通过 session-projection 维护最近一次实际 assistant 请求的 provider/model。对于尚未在本浏览器进程加载 model-selector store 的历史 session，客户端 SHALL 使用该投影作为 fallback；一旦观察到 selector 的 `current`，selector 值 SHALL 覆盖投影。该 fallback SHALL 在 DSH 重启后可用且不依赖 localStorage。

#### Scenario: 冷历史 session 使用 fallback
- **WHEN** 一个历史 session 尚未打开/加载选择器，但有最近请求投影
- **THEN** 侧边栏按投影显示对应品牌 logo

#### Scenario: selector 覆盖旧投影
- **WHEN** 某 session 的最近请求投影为模型 A，而 selector store 的当前选择为模型 B
- **THEN** 侧边栏显示模型 B 的品牌 logo

#### Scenario: 两类数据都不存在
- **WHEN** session 无 selector 当前值且无请求投影
- **THEN** 该行不插入 logo

### Requirement: 使用下载落盘的真实品牌资产
系统 SHALL 使用下载后随包保存的品牌 SVG，而不是代码中手绘的近似 path。已知映射 SHALL 至少覆盖 DeepSeek 鲸鱼、OpenAI/GPT 螺旋、OpenCode、Anthropic/Claude、Grok、Kimi、GLM/智谱、MiniMax、Pi、OpenClaw、Hermes Agent（含 `hermas` 兼容别名）与 Trae（含 `traex` route）；model 维度 SHALL 另外覆盖 Qwen、腾讯混元（含 `hy<数字>` 系列）、美团 LongCat、小米 MiMo、Google Gemini、NVIDIA（Nemotron）、Meta（Muse Spark / Llama）、蚂蚁（Ling/Ring）、OpenRouter（`openrouter-*`）与字节跳动 Seed（`Seed-*`），使 OpenCode Go/Zen 与 TraeX 当前模型目录中有可识别厂商或平台的模型族都能得到品牌子图标。品牌判定 SHALL 优先识别已知 provider route 作为主品牌；仅当 route 未知/通用时再按 model id 作为主品牌 fallback。未知选择 SHALL 使用中性 fallback，不得冒充已知品牌。浏览器运行时 SHALL 不为品牌图访问外部 CDN。

#### Scenario: DeepSeek/OpenAI/OpenCode 显示正确品牌
- **WHEN** 当前选择分别属于 DeepSeek、GPT/Codex 或 OpenCode
- **THEN** 行中分别使用下载落盘的 DeepSeek 鲸鱼、OpenAI 螺旋或 OpenCode SVG

#### Scenario: Kimi/GLM/MiniMax/Pi 显示正确品牌
- **WHEN** 当前选择的 provider route 或明确 model id 属于 Kimi、GLM/智谱、MiniMax 或 Pi
- **THEN** 行中使用对应的下载落盘 SVG，不使用中性首字母 fallback

#### Scenario: OpenClaw/Hermes 显示正确品牌
- **WHEN** 当前选择的 provider route 或明确 model id 属于 OpenClaw、Hermes Agent、NousResearch，或使用 `hermas` 兼容拼写
- **THEN** 行中使用对应的 OpenClaw 或 Hermes Agent SVG，不使用中性首字母 fallback

#### Scenario: OpenCode 目录模型族得到品牌
- **WHEN** 当前选择为 `opencode-go` 下的 `qwen3.8-flash`、`hy3`、`longcat-2.0`、`mimo-v2.5`、`gemini-3.5-flash`、`nemotron-3-ultra-free`、`muse-spark-1.3-contributor` 或 `ling-3.0-flash-fin-free`
- **THEN** 子图标分别为 Qwen、混元、LongCat、MiMo、Gemini、NVIDIA、Meta、蚂蚁的下载落盘 SVG

#### Scenario: Trae route 显示 Trae 品牌
- **WHEN** 当前选择的 provider route 为 `traex` 或 `trae`
- **THEN** 主图使用下载落盘的 Trae SVG，而不是按 model 名显示 OpenAI 或 DeepSeek

#### Scenario: TraeX 目录模型族得到品牌
- **WHEN** 当前选择为 `traex` 下的 `GPT-*`、`DeepSeek-*`、`Gemini-*`、`openrouter-*` 或 `Seed-*`
- **THEN** 主图保持 Trae，子图标分别使用 OpenAI、DeepSeek、Gemini、OpenRouter 或 ByteDance 的下载落盘 SVG

#### Scenario: OpenCode route 不被模型名误判
- **WHEN** 当前选择为真实路由 `opencode-go/deepseek-v4-flash`
- **THEN** 主图显示 OpenCode logo，而不是 DeepSeek logo；DeepSeek 只能以复合 icon 的子图标出现

#### Scenario: 未知兼容 route 使用 model fallback
- **WHEN** provider route 未知/通用，但 model id 明确属于 GPT 或 DeepSeek
- **THEN** 显示对应 OpenAI 或 DeepSeek 的单一 logo，不叠加子图标

### Requirement: provider 与 model 品牌不同时显示复合 icon
当 provider route 识别为已知品牌 P、且 model id 独立识别为已知品牌 M 并且 M ≠ P 时，系统 SHALL 显示复合 icon：主图为 P 的品牌 logo，右下角叠加缩小的 M 品牌子图标。当 M = P、M 无法识别、或 provider route 未知时，系统 SHALL 只显示单一品牌 logo（或中性 fallback），不叠加子图标。复合 icon SHALL 保持与单一 logo 相同的行内占位尺寸，不推挤标题；子图标 SHALL 以不加底板、描边或内边距的品牌 glyph 呈现，尺寸不小于主图的 70%，并溢出主图右下角，使其在侧边栏实际尺寸下可辨认。tooltip SHALL 继续展示精确的 `provider · model`。当 selector 当前选择改变导致复合与否或子图标品牌改变时，系统 SHALL 与单 logo 同样即时更新。

#### Scenario: 同品牌只显示单一 logo
- **WHEN** 当前选择为 `claude/claude-opus-5` 或 `codex/gpt-6-luna`
- **THEN** 行中只显示 Anthropic 或 OpenAI 单一 logo，没有右下角子图标

#### Scenario: 聚合 route 显示复合 icon
- **WHEN** 当前选择为 `opencode-go/deepseek-v4-flash`、`opencode-go/minimax-m3` 或 `traex/GPT-5.6-Sol[1m]`
- **THEN** 主图分别为 OpenCode、OpenCode、Trae，右下角子图标分别为 DeepSeek、MiniMax、OpenAI

#### Scenario: model 品牌无法识别时不叠加
- **WHEN** provider route 为已知品牌（如 `opencode-go`），但 model id 不属于任何已知品牌
- **THEN** 只显示 provider 品牌单一 logo，不显示中性首字母子图标

#### Scenario: 切换模型后子图标即时更新
- **WHEN** 当前 session 从 `opencode-go/deepseek-v4-flash` 成功切换为 `opencode-go/minimax-m3`，或切换为 `claude/claude-opus-5`
- **THEN** 子图标立即变为 MiniMax，或复合 icon 立即变回单一 Anthropic logo，无需发送消息或刷新

#### Scenario: 子图标实际尺寸可辨认
- **WHEN** 复合 icon 在侧边栏以实际尺寸显示
- **THEN** 子图标没有圆底、描边或内边距占用像素，品牌 glyph 本身尺寸不小于主图的 70%

#### Scenario: 复合 icon 不改变行内布局
- **WHEN** 某行由单一 logo 变为复合 icon
- **THEN** badge 在行内占据的宽高不变，标题与官方 StateDot、时间、菜单的位置保持不变

### Requirement: 不影响官方行内 UI 与任务状态点
系统 SHALL 只读使用官方 session 行 DOM，不得替换、移动、隐藏或改写官方 `StateDot`、时间标签、右键菜单或拖拽行为。logo SHALL 作为标题前独立元素；无法可靠定位时 SHALL 安全降级为不显示。

#### Scenario: 状态点保持官方原样
- **WHEN** session 行展示模型 logo
- **THEN** 官方状态点的显示逻辑、外观与位置保持不变

#### Scenario: 官方行结构变化时安全降级
- **WHEN** DSH 升级导致 session 行无法可靠定位
- **THEN** 插件不向错误行插入 logo、不抛未捕获异常，其余页面功能不受影响
