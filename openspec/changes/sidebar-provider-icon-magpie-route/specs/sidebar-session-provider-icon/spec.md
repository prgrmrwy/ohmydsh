## MODIFIED Requirements

### Requirement: 使用下载落盘的真实品牌资产
系统 SHALL 使用下载后随包保存的品牌 SVG，而不是代码中手绘的近似 path。已知映射 SHALL 至少覆盖 DeepSeek 鲸鱼、OpenAI/GPT 螺旋、OpenCode、Anthropic/Claude、Grok、Kimi、GLM/智谱、MiniMax、Pi、OpenClaw、Hermes Agent（含 `hermas` 兼容别名）、Trae（含 `traex` route）与 Magpie（含 `dsh-magpie-connect` route）；model 维度 SHALL 另外覆盖 Qwen、腾讯混元（含 `hy<数字>` 系列）、美团 LongCat、小米 MiMo、Google Gemini、NVIDIA（Nemotron）、Meta（Muse Spark / Llama）、蚂蚁（Ling/Ring）、OpenRouter（`openrouter-*`）与字节跳动 Seed（`Seed-*`），使 OpenCode Go/Zen 与 TraeX 当前模型目录中有可识别厂商或平台的模型族都能得到品牌子图标。品牌判定 SHALL 优先识别已知 provider route 作为主品牌；仅当 route 未知/通用时再按 model id 作为主品牌 fallback。当 provider route 识别为网关型品牌（Magpie）时，model id 形如 `<上游provider>/<model>`：model 维度品牌 SHALL 先按 `/` 前的上游 provider 段识别，识别不出再按 `/` 后的模型名识别；该解析 SHALL 只对网关型 route 生效，不改变其它 route 的判定。未知选择 SHALL 使用中性 fallback，不得冒充已知品牌。浏览器运行时 SHALL 不为品牌图访问外部 CDN。

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

#### Scenario: Magpie route 显示 Magpie 品牌
- **WHEN** 当前选择的 provider route 为 `dsh-magpie-connect`、`magpie` 或以 `magpie-` 开头
- **THEN** 主图使用下载落盘的 Magpie SVG（magpie 官方仓库按 commit pin 的资产），而不是按 model 名显示 Anthropic、OpenAI 或 DeepSeek

#### Scenario: Magpie 只按精确名或前缀匹配
- **WHEN** provider route 只是在中间包含 `magpie` 子串（如 `not-magpie`），且不属于其它已知品牌
- **THEN** 不识别为 Magpie，按 model fallback 处理

#### Scenario: 网关模型 id 按上游 provider 段识别
- **WHEN** 当前选择为 `dsh-magpie-connect` 下的 `claude/claude-haiku-5-5`、`codex/gpt-6-luna` 或 `opencode-go/deepseek-v4-flash`
- **THEN** model 维度品牌分别为 Anthropic、OpenAI、OpenCode（上游段优先于 `/` 后的模型名）

#### Scenario: 上游段无法识别时退回模型名
- **WHEN** 当前选择为 `dsh-magpie-connect` 下的 `auto/claude-haiku-5.5` 或 `group/deepseek-v4-flash`
- **THEN** model 维度品牌按 `/` 后的模型名分别识别为 Anthropic、DeepSeek

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

#### Scenario: Magpie 网关显示复合 icon
- **WHEN** 当前选择为 `dsh-magpie-connect / claude/claude-haiku-5-5` 或 `dsh-magpie-connect / codex/gpt-6-luna`
- **THEN** 主图为 Magpie，右下角子图标分别为 Anthropic、OpenAI；tooltip 仍为精确的 `provider · model`

#### Scenario: Magpie 下无法识别的模型只显示 Magpie
- **WHEN** 当前选择为 `dsh-magpie-connect` 下上游段与模型名都无法识别的模型（如 `custom/omen-alpha`）
- **THEN** 只显示 Magpie 单一 logo，不叠加中性首字母子图标
