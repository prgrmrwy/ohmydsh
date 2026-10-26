## MODIFIED Requirements

### Requirement: 使用下载落盘的真实品牌资产
系统 SHALL 使用下载后随包保存的品牌 SVG，而不是代码中手绘的近似 path。已知映射 SHALL 至少覆盖 DeepSeek 鲸鱼、OpenAI/GPT 螺旋、OpenCode、Anthropic/Claude、Grok、Kimi、GLM/智谱、MiniMax、Pi、OpenClaw、Hermes Agent（含 `hermas` 兼容别名）、Trae（含 `traex` route）与 Magpie（含 `dsh-magpie`、`dsh-magpie-connect` route）；model 维度 SHALL 另外覆盖 Qwen、腾讯混元（含 `hy<数字>` 系列）、美团 LongCat、小米 MiMo、Google Gemini、NVIDIA（Nemotron）、Meta（Muse Spark / Llama）、蚂蚁（Ling/Ring）、OpenRouter（`openrouter-*`）与字节跳动 Seed（`Seed-*`），使 OpenCode Go/Zen 与 TraeX 当前模型目录中有可识别厂商或平台的模型族都能得到品牌子图标。品牌判定 SHALL 优先识别已知 provider route 作为主品牌；仅当 route 未知/通用时再按 model id 作为主品牌 fallback。当 provider route 识别为网关型品牌（Magpie）时，model id 形如 `<上游provider>/<model>`，系统 SHALL 分别识别两个维度：model 维度品牌 SHALL 先按 `/` 后的模型名识别模型厂商，模型名识别不出时再按 `/` 前的上游段识别；中转维度品牌 SHALL 仅当 `/` 前的上游段本身可识别为品牌时才存在，且 SHALL 与 model 维度品牌相互独立。该解析 SHALL 只对网关型 route 生效，不改变其它 route 的判定。未知选择 SHALL 使用中性 fallback，不得冒充已知品牌。浏览器运行时 SHALL 不为品牌图访问外部 CDN。

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
- **WHEN** 当前选择的 provider route 为 `dsh-magpie`、`dsh-magpie-connect`、`magpie` 或以 `magpie-` 开头
- **THEN** 主图使用下载落盘的 Magpie SVG（magpie 官方仓库按 commit pin 的资产），而不是按 model 名显示 Anthropic、OpenAI 或 DeepSeek

#### Scenario: Magpie 只按精确名或前缀匹配
- **WHEN** provider route 只是在中间包含 `magpie` 子串（如 `not-magpie`），且不属于其它已知品牌
- **THEN** 不识别为 Magpie，按 model fallback 处理

#### Scenario: 网关模型 id 按上游 provider 段识别
- **WHEN** 当前选择为 `dsh-magpie` 或 `dsh-magpie-connect` 下的 `opencode-go/private-model`（`/` 后的模型名认不出厂商）
- **THEN** model 维度品牌退回 `/` 前的上游 provider 段，识别为 OpenCode

#### Scenario: 上游段无法识别时退回模型名
- **WHEN** 当前选择为 `dsh-magpie` 或 `dsh-magpie-connect` 下的 `auto/claude-haiku-5.5` 或 `group/deepseek-v4-flash`
- **THEN** model 维度品牌按 `/` 后的模型名分别识别为 Anthropic、DeepSeek

#### Scenario: 网关小图标取模型厂商而不是上游平台
- **WHEN** 当前选择为 `dsh-magpie` 或 `dsh-magpie-connect` 下的 `opencode-go/deepseek-v4.1-flash`、`claude/claude-haiku-5-5` 或 `codex/gpt-6-luna`
- **THEN** model 维度品牌分别为 DeepSeek、Anthropic、OpenAI：按 `/` 后的模型名识别模型厂商，而不是按 `/` 前的上游平台段识别为 OpenCode

#### Scenario: 模型名优先于上游段
- **WHEN** 当前选择为 `dsh-magpie` 或 `dsh-magpie-connect` 下 `/` 前是平台段、`/` 后是可识别模型名的组合（如 `opencode-go/glm-5.3-flash`）
- **THEN** 小图标显示模型厂商品牌（GLM），而不是平台品牌（OpenCode）

#### Scenario: 网关中转层单独识别
- **WHEN** 当前选择为 `dsh-magpie` 或 `dsh-magpie-connect` 下的 `opencode-go/deepseek-v4.1-flash`、`opencode-go/glm-5.3-flash`
- **THEN** 中转维度品牌为 OpenCode，与 model 维度品牌（DeepSeek、GLM）相互独立地得出，两者都可用于渲染

#### Scenario: 上游段不是品牌时没有中转层
- **WHEN** 当前选择为 `dsh-magpie` 或 `dsh-magpie-connect` 下的 `auto/claude-haiku-5.5`、`group/deepseek-v4-flash` 或 `custom/omen-alpha`
- **THEN** 中转维度品牌不存在（`auto`、`group`、`custom` 都不是品牌），不得用中性首字母冒充

#### Scenario: 相似但不同的 route 名不被识别
- **GIVEN** provider route 为 `dsh-magpie2`（规范化为 `magpie2`，不等于 `magpie`，也不以 `magpie-` 开头）
- **WHEN** 计算该行品牌
- **THEN** 不识别为 Magpie，按 model fallback 处理
