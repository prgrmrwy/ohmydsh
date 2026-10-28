## MODIFIED Requirements

### Requirement: 模型目录字段映射
插件 SHALL 按以下规则把网关 `GET /models` 的条目映射为 `dsh-magpie-connector` route 的模型：
- 模型 id 保持网关返回值原样；
- 显示名取 `display_name`，缺失或为空时取 id；
- effort 档位取 `reasoning_levels`，保持网关给出的顺序和取值；
- 网关给了正安全整数的 `context_window` 时作为上下文窗口下发给 DSH；
- 网关给了正安全整数的 `max_output_tokens` 时作为该模型的**最大输出能力**保留；DSH 的 `defaultMaxTokens` 取「默认请求输出预算」规则的结果，而不是直接取最大输出能力；
- `context_window`、`max_output_tokens` 不是正安全整数时（0、负数、小数、字符串、超出安全整数）视为缺失；
- 仅当 `modalities.input` 包含 `image` 时声明可收图；
- 缺 `id` 的条目丢弃，不影响其它条目。

#### Scenario: 字段映射
- **GIVEN** 网关返回以下 3 个模型：
  - `{id: "claude/claude-haiku-5-5", display_name: "Claude Haiku 5.5", reasoning_levels: ["low","high"], modalities: {input: ["text","image"]}, context_window: 1000000, max_output_tokens: 100}`
  - `{id: "opencode-go/kimi-k3", reasoning_levels: ["max"]}`
  - `{id: "deepseek/deepseek-v4-pro", display_name: "", modalities: {input: ["text"]}}`
- **WHEN** DSH 列举并解析这三个模型
- **THEN** 三者的 `name` 依次为 `Claude Haiku 5.5`、`opencode-go/kimi-k3`、`deepseek/deepseek-v4-pro`；第一个的 effort id 恰为 `["low","high"]`、上下文窗口为 1000000、`defaultMaxTokens` 为 100、声明图片输入；第二个的 effort id 恰为 `["max"]`；第三个不声明图片输入

#### Scenario: 畸形条目被丢弃
- **GIVEN** 网关返回的 `data` 中一个条目缺 `id`，另有 2 个合法条目
- **WHEN** 目录同步
- **THEN** 目录恰含 2 个模型，同步状态为成功

#### Scenario: 非法容量值视为缺失
- **GIVEN** 网关返回 5 个模型，id 依次为 `m0`…`m4`，`context_window` 与 `max_output_tokens` 依次同时取 `0`、`-1`、`2.5`、`"1000"`、`9007199254740992`
- **WHEN** 目录映射
- **THEN** 5 个模型都存在，且都不含 `context` 与 `defaultMaxTokens`

## ADDED Requirements

### Requirement: 默认请求输出预算
插件 SHALL 为同时具备上下文窗口 C 与最大输出能力 O 的模型计算默认请求输出预算 B = `min(O, max(1, floor(C/4), floor(C/2) − 65536))`，并作为 `defaultMaxTokens` 下发；65536 等于 DSH compaction-basic 默认的 `headroomTokens`。只有 O 没有 C 时，B = O。没有 O 时，SHALL NOT 下发 `defaultMaxTokens`。上下文窗口与最大输出能力本身 SHALL 保持网关原值。`/models` 不区分 Max output 是否为 Magpie 管理员手动设置，插件 SHALL 对所有模型一律按公式计算。

#### Scenario: 大输出模型为压缩保留空间
- **GIVEN** 网关模型 `{id: "m", context_window: 500000, max_output_tokens: 393216}`
- **WHEN** 目录映射并解析该模型
- **THEN** `defaultMaxTokens` 为 184464，上下文窗口仍为 500000，保留的最大输出能力仍为 393216

#### Scenario: 小窗口按四分之一窗口预留
- **GIVEN** 网关模型 `{id: "a", context_window: 131072, max_output_tokens: 65536}` 与在线实测容量 `{id: "b", context_window: 272000, max_output_tokens: 128000}`
- **WHEN** 目录映射
- **THEN** `a`、`b` 的 `defaultMaxTokens` 依次为 32768 和 70464

#### Scenario: 输出能力不超过预算时保持不变
- **GIVEN** 网关模型 `{id: "a", context_window: 1000000, max_output_tokens: 393216}` 与 `{id: "b", context_window: 262144, max_output_tokens: 32768}`
- **WHEN** 目录映射
- **THEN** `a`、`b` 的 `defaultMaxTokens` 依次为 393216 和 32768

#### Scenario: 网关侧手动设置的输出上限同样收紧
- **GIVEN** 网关模型 `{id: "m", context_window: 524288, max_output_tokens: 393216}`（无论该值是否为 Magpie 管理员手动设置）
- **WHEN** 目录映射
- **THEN** `defaultMaxTokens` 为 196608

#### Scenario: 缺少上下文窗口时不收紧
- **GIVEN** 网关模型 `{id: "m", max_output_tokens: 4096}`，没有 `context_window`
- **WHEN** 目录映射
- **THEN** `defaultMaxTokens` 为 4096，模型信息不含 `context`

#### Scenario: 缺少最大输出能力时不下发预算
- **GIVEN** 网关模型 `{id: "m", context_window: 500000}`，没有 `max_output_tokens`
- **WHEN** 目录映射
- **THEN** 模型信息不含 `defaultMaxTokens`

### Requirement: 默认预算在适用窗口内通过宿主压缩检查
在 compaction-basic 默认配置（`headroomTokens` 65536、`thresholdRatio` 0.8、`retainRatio` 0.16）下，当 C ≥ 104026 时，对任意 O，默认请求输出预算 B SHALL 同时满足：压力预算 `C − B − 65536 > 0`；保留量 `floor((C − B) × 0.16)` 小于阈值 `floor(min(C × 0.8, C − B − 65536))`。C < 104026 时插件 SHALL 仍按同一公式计算、不丢弃该模型，但不保证通过这两项检查。

#### Scenario: 适用窗口内满足宿主两项压缩检查
- **GIVEN** 对每个容量组合构造一个带非空 id 的合法网关条目：(104026, 416104)、(131072, 65536)、(272000, 128000)、(500000, 393216)、(524288, 524288)、(1000000, 512000)、(1000000, 393216)、(262144, 32768)
- **WHEN** 逐个目录映射，用得到的 `defaultMaxTokens` 按上文两项检查计算
- **THEN** 每个组合的压力预算都大于 0，且保留量都小于阈值；其中 (524288, 524288) 与 (131072, 65536) 若直接以 O 作为预算，压力预算分别为 −65536 与 0

#### Scenario: 适用窗口以下不保证通过
- **GIVEN** 带非空 id 的合法网关条目 (104025, 416100)、(90000, 65536)
- **WHEN** 目录映射
- **THEN** 两者仍出现在目录中，`defaultMaxTokens` 依次为 26006 与 22500；按上文计算，两者都不满足“保留量小于阈值”

### Requirement: SDK 模型输出上限使用最大输出能力
适配器交给 pi-ai 的模型输出上限（`model.maxTokens`）SHALL 取模型的最大输出能力 O，而不是默认请求输出预算；没有 O 时 SHALL 保持既有的 16384 回退值。请求的 `maxTokens` 照旧原样转给 pi-ai。

#### Scenario: SDK 模型上限为最大输出能力
- **GIVEN** Responses 模型 `codex/gpt-6.1-sol` 与 Chat 模型 `deepseek/deepseek-flash`，两者都为 `{context_window: 500000, max_output_tokens: 393216}`
- **WHEN** 以 `maxTokens: 184464` 对两个模型各生成一次，截获交给 pi-ai 的模型参数
- **THEN** 两次 pi-ai 模型的 `maxTokens` 都为 393216；Responses 请求体 `max_output_tokens` 与 Chat 请求体 `max_completion_tokens` 都为 184464

#### Scenario: 没有最大输出能力时使用回退值
- **GIVEN** Chat 模型 `x/no-output` 只有 `context_window: 500000`
- **WHEN** 直接调用适配器、不带 `maxTokens` 生成一次，截获交给 pi-ai 的模型参数
- **THEN** pi-ai 模型的 `maxTokens` 为 16384，Chat 请求体不含 `max_completion_tokens` 键
