# dsh-magpie-connector Specification

## Purpose

把自托管的 Magpie 网关作为一个 LLM provider 接入 DeepSeek Harness：网关模型出现在选择器里，并能完成生成与工具往返；设置页按网关 provider 分组，只读展示账号和用量；模型可见性、默认 effort 和 Codex 速度在 DSH 侧配置。网关自身的管理（登录、代理、路由）不在插件范围内。

## Requirements

### Requirement: 插件身份与命名
插件的 package/npm 名、Cordis 插件 id、LLM route id 与设置目录 SHALL 统一为 `dsh-magpie-connector`。凭据引用 SHALL 保持 `MAGPIE_API_KEY`、`MAGPIE_ACCESS_CLIENT_ID`、`MAGPIE_ACCESS_CLIENT_SECRET` 不变，使既有 key 继续可用。

依赖真实 route id 的其它能力（AUTO 策略、出口守卫豁免列表、侧边栏品牌识别）SHALL 使用 `dsh-magpie-connector`。

#### Scenario: 只注册一个 route
- **GIVEN** `MAGPIE_API_KEY` 已配置
- **WHEN** 插件启动
- **THEN** DSH 的 provider 列表中本插件只注册 `dsh-magpie-connector`，生成时解析 `MAGPIE_API_KEY`

### Requirement: 网关连接与凭据
插件 SHALL 用一个网关地址和一个 gateway API key 连接 Magpie。

网关地址 SHALL 是带版本段的 `http(s)` API 根（例如 `http://114.114.114.223:3425/v1`），末尾斜杠会被去掉。地址 SHALL NOT 包含 userinfo、query 或 fragment，否则拒绝。

key SHALL 通过 DSH credentials 服务按固定引用 `MAGPIE_API_KEY` 存取。每个操作开始时解析一次 key，同一操作的后续请求复用该值。一个操作指一次目录同步、一次卡片读取或刷新，或一次生成（从 `prepareCall` 到流结束）。插件的任何 HTTP 响应、插件设置文件和日志 SHALL NOT 包含 key 明文，对外只报告 `configured` 与 `writable`。网关返回的任何文本在进入插件的 HTTP 响应或日志之前 SHALL 先脱敏：把当前代和仍在进行中的操作所用 key 的原文替换为 `[redacted]`。这些文本包括卡片字段、错误原因和生成错误。key 来自启动环境（不可写）时，SHALL 拒绝通过插件覆盖或清除。

地址或 key 缺任一项时，插件 SHALL 视为未配置：`dsh-magpie-connector` route 的模型目录为空；生成以 `kind: error` 结束，failure 消息包含 `MAGPIE_NOT_CONFIGURED`；不向网关发起任何请求。

#### Scenario: 保存 key 后不回显
- **GIVEN** credentials 服务可写，`MAGPIE_API_KEY` 未配置
- **WHEN** 客户端提交 key `mk-test-123`，然后读取设置
- **THEN** 设置响应含 `key: {configured: true, writable: true}`；该响应体、插件设置文件和插件日志输出中都不出现 `mk-test-123`

#### Scenario: 网关反射的 key 被脱敏
- **GIVEN** 当前 key 为 `mk-test-123`；网关 mock 的卡片端点返回 `{data: [{provider: "codex", error: "invalid Bearer mk-test-123"}], debug: {authorization: "Bearer mk-test-123"}}`，`/v1/responses` 返回 401，body 含 `mk-test-123`
- **WHEN** 读取卡片，并发起一次生成
- **THEN** 卡片 HTTP 响应不含 `debug` 字段；卡片 `error` 为 `invalid Bearer [redacted]`；生成的 failure 消息、卡片响应和插件日志中都不出现 `mk-test-123`

#### Scenario: 环境提供的 key 拒绝修改
- **GIVEN** credentials 服务对 `MAGPIE_API_KEY` 报告 `writable: false`
- **WHEN** 客户端提交新 key，或提交清除 key
- **THEN** 响应状态为 409，credentials 服务的 `set`/`unset` 都未被调用

#### Scenario: 非法设置输入被拒绝
- **GIVEN** 已保存地址 `http://114.114.114.223:3425/v1`，credentials 服务可写
- **WHEN** 客户端分别提交：空串 key、含空白的 key、超过 512 字符的 key、地址 `ftp://host/v1`、地址 `http://u:p@host/v1`、地址 `http://host/v1?k=x`
- **THEN** 每次响应状态都为 400，credentials 服务未被调用，已保存地址不变

#### Scenario: 未配置时不提供模型且不发请求
- **GIVEN** 地址已保存，`MAGPIE_API_KEY` 未配置
- **WHEN** DSH 列举 `dsh-magpie-connector` 的模型，并以该 route 发起一次生成
- **THEN** 模型列表为空；生成以 `kind: error` 结束，消息包含 `MAGPIE_NOT_CONFIGURED`；网关 mock 收到的请求数为 0

### Requirement: 连接接入方式（AMD4）
设置页 SHALL 默认只要求网关地址和 key，并提供默认展开的「高级连接」，其中「接入方式」只有「直连」（默认）和「Cloudflare Access」两项。接入方式 SHALL NOT 单独持久化：已保存 Access 凭据时显示为 Cloudflare Access，否则为直连。选择 Cloudflare Access 时才显示 Client ID/Secret 两项输入；从已保存凭据切回直连并保存，SHALL 在同一次设置写入中清除两项 Access 凭据。任一 Access 凭据来自启动环境时，接入方式 SHALL 为只读。

#### Scenario: 默认直连，选择 Cloudflare Access 后才出现令牌输入（AMD4）
- **GIVEN** 未保存 Access 凭据
- **WHEN** 打开设置页，再把接入方式切到 Cloudflare Access 并填写两项后保存
- **THEN** 打开时「高级连接」已展开、接入方式为「直连」、只有 key 一个密码输入；切换后出现两项输入；保存请求体只含 `accessClientId` 与 `accessClientSecret`

#### Scenario: 切回直连并保存即清除 Access 凭据（AMD4）
- **GIVEN** 两项 Access 凭据均已保存且可写
- **WHEN** 把接入方式切到「直连」并保存
- **THEN** 页面提示保存后将清除凭据；保存请求体为 `{accessClientId: null, accessClientSecret: null}`

### Requirement: 连接身份与代际隔离
插件 SHALL 把「规范化后的网关地址 + 当前 key」作为连接身份，并为每个身份维护一个代际。

身份变化有两类来源，插件 SHALL 都能感知：
- 插件自身的操作：保存了新地址，或通过插件设置或清除了 key；
- 外部改动：收到 `credentials/reference-updated(MAGPIE_API_KEY)` 事件。此外，每个新操作开始时解析出的 key 与当前代不同，也视为身份变化。

身份变化时，插件 SHALL 先换代，再开始新操作，并做到：
- 立即使上一代的目录、卡片和同步状态对外不可见；
- 不得用上一代的数据回退；
- 中止上一代的目录与卡片请求，并丢弃上一代发起、之后才返回的目录、卡片或刷新响应。

换代后，插件 SHALL 立即为新身份发起一次目录同步。

每次生成是一个操作：`prepareCall` SHALL 捕获当时这一代的 base origin、该操作解析出的 key 和模型能力，后续 `stream` SHALL 只使用捕获值，不重新解析 key、不重新读取地址。换代 SHALL NOT 中止已准备或正在进行的生成，它们按捕获值跑完。只有 DSH 传入的 `options.signal` 或插件 dispose 能中止生成。换代之后准备的调用 SHALL 使用新身份。

插件 SHALL NOT 把目录持久化到磁盘：上一次成功的目录只在当前代的内存中保留。

#### Scenario: 换地址后不显示旧目录
- **GIVEN** 网关 A 同步成功，有 13 个模型；网关 B 对 `/models` 返回 503
- **WHEN** 客户端把地址改为 B
- **THEN** DSH 列举 `dsh-magpie-connector` 的模型得到空列表，设置响应中 `lastSyncError` 非空；之后的生成请求只发往 B，不发往 A

#### Scenario: 换 key 后不显示旧卡片
- **GIVEN** 用 key K1 读到 3 张卡片；网关对 key K2 的卡片请求返回 403
- **WHEN** 客户端把 key 换成 K2，然后读取卡片
- **THEN** 卡片区状态为 `forbidden`，响应中不含任何 K1 时期的卡片

#### Scenario: 旧代晚到的响应被丢弃
- **GIVEN** 对网关 A 的目录同步已发出但尚未返回
- **WHEN** 客户端把地址改为 B，B 同步成功并返回 2 个模型，随后 A 的响应才返回 13 个模型
- **THEN** DSH 列举到的模型恰为 B 的 2 个

#### Scenario: 已准备的调用按捕获值跑完
- **GIVEN** 用网关 A 和 key K1 对 `codex/gpt-6.1-sol` 完成了 `prepareCall`
- **WHEN** 客户端把地址改为 B、key 改为 K2，然后调用该已准备对象的 `stream`；之后再准备并发起一次新的生成
- **THEN** 第一次请求发往 A，带 `Authorization: Bearer K1`，并以 `stop` 正常结束；第二次请求发往 B，带 K2

#### Scenario: 进行中的生成不被换代中止
- **GIVEN** 一次发往 A 的生成正在输出文本
- **WHEN** 客户端保存地址 B
- **THEN** 该生成继续输出，直到网关 mock 发出完成事件，并以 `stop` 结束；B 收到一次 `GET /v1/models`

#### Scenario: 外部改 key 触发换代
- **GIVEN** 用 K1 已同步目录并读到 3 张卡片；网关对 K2 的卡片请求返回 403
- **WHEN** credentials 中的 `MAGPIE_API_KEY` 在插件之外被改为 K2，并发出 `credentials/reference-updated`；随后读取卡片
- **THEN** 插件换代，并用 K2 发起一次 `GET /v1/models`；卡片响应状态为 `forbidden`，不含 K1 时期的任何卡片

#### Scenario: 未收到事件时新操作发现 key 变化
- **GIVEN** 用 K1 已同步目录；受控的 credentials mock 随后对 `resolve(MAGPIE_API_KEY)` 返回 K2，且没有发出事件
- **WHEN** 发起一次卡片读取
- **THEN** 插件在发出该卡片请求之前完成换代；卡片请求带 K2，结果提交到新代

### Requirement: 目录同步与发布
插件 SHALL 在以下时机从网关 `GET /models` 同步目录：插件启动且已配置时、连接身份变化时、用户在设置页点「刷新模型列表」时。插件 SHALL NOT 做定时后台目录轮询。每次同步 SHALL 有超时（15 秒），超时视为 `unreachable` 失败。同一代内同一时刻 SHALL 最多只有一个目录同步在进行：进行中又被触发时，复用进行中的那一次，不另发请求。

同步失败时，设置响应 SHALL 给出 `lastSyncError` 和错误分类：`unauthorized`（401）、`forbidden`（403）、`http`（其它非 2xx，附状态码）、`unreachable`（网络错误或超时）。同时 SHALL 保留当前代已有的目录，SHALL NOT 用空目录替换。

目录、可见性或默认 effort 任一项生效变化后，插件 SHALL 通过 adapter 注册句柄的 `replace` 发布更新，使 DSH 发出 `llm/adapters-updated`。这样已打开的官方模型选择器无需重启或刷新页面就能拿到新状态。

#### Scenario: 保存地址后自动同步并发布
- **GIVEN** 已配置 key，网关 mock 对 `/models` 返回 13 个模型，DSH 侧有一个 `llm/adapters-updated` 监听器
- **WHEN** 客户端保存地址
- **THEN** 网关 mock 收到 1 次 `GET /v1/models`；监听器至少收到一次事件；随后列举到 13 个模型

#### Scenario: 同步失败保留当前代目录
- **GIVEN** 当前代已有 13 个模型，网关随后返回 503
- **WHEN** 用户点「刷新模型列表」
- **THEN** 仍列举到那 13 个模型；设置响应 `lastSyncError` 非空、分类为 `http`，`lastSyncAt` 保持上次成功时间

#### Scenario: 同代重复触发只发一次请求
- **GIVEN** 一次目录同步已发出、尚未返回
- **WHEN** 两个设置页先后点击「刷新模型列表」
- **THEN** 网关 mock 只收到 1 次 `GET /v1/models`；三个调用方得到同一个结果

#### Scenario: 同步超时
- **GIVEN** 网关 mock 对 `/models` 不响应，测试使用虚拟时钟
- **WHEN** 用户点「刷新模型列表」，然后时钟前进 15 秒
- **THEN** 同步结束，错误分类为 `unreachable`；当前代已有的目录保持不变

#### Scenario: key 无效的分类
- **GIVEN** 网关 mock 对 `/models` 返回 401
- **WHEN** 用户点「刷新模型列表」
- **THEN** 设置响应中错误分类为 `unauthorized`

### Requirement: 模型目录字段映射
插件 SHALL 按以下规则把网关 `GET /models` 的条目映射为 `dsh-magpie-connector` route 的模型：
- 模型 id 保持网关返回值原样；
- 显示名取 `display_name`，缺失或为空时取 id；
- effort 档位取 `reasoning_levels`，保持网关给出的顺序和取值；
- 网关给了 `context_window`、`max_output_tokens` 时下发给 DSH；
- 仅当 `modalities.input` 包含 `image` 时声明可收图；
- 缺 `id` 的条目丢弃，不影响其它条目。

#### Scenario: 字段映射
- **GIVEN** 网关返回以下 3 个模型：
  - `{id: "claude/claude-haiku-5-5", display_name: "Claude Haiku 5.5", reasoning_levels: ["low","high"], modalities: {input: ["text","image"]}, context_window: 1000000}`
  - `{id: "opencode-go/kimi-k3", reasoning_levels: ["max"]}`
  - `{id: "deepseek/deepseek-v4-pro", display_name: "", modalities: {input: ["text"]}}`
- **WHEN** DSH 列举并解析这三个模型
- **THEN** 三者的 `name` 依次为 `Claude Haiku 5.5`、`opencode-go/kimi-k3`、`deepseek/deepseek-v4-pro`；第一个的 effort id 恰为 `["low","high"]`、上下文窗口为 1000000、声明图片输入；第二个的 effort id 恰为 `["max"]`；第三个不声明图片输入

#### Scenario: 畸形条目被丢弃
- **GIVEN** 网关返回的 `data` 中一个条目缺 `id`，另有 2 个合法条目
- **WHEN** 目录同步
- **THEN** 目录恰含 2 个模型，同步状态为成功

### Requirement: 生成
插件 SHALL 把 DSH 的一次生成请求转发到网关，并把响应转换为 DSH 流。

**选择线协议**：模型的 `native_endpoints` 含 `/v1/responses` 时，用 `POST /responses`；`native_endpoints` 为空、缺失或只含其它端点时，用 `POST /chat/completions`。

**不支持 stop**：Magpie 无法对所有上游保证 stop 序列生效。例如 Codex 请求即使走 Chat，网关也会再转成不带 stop 的 Responses。因此请求带非空 `stop` 时，SHALL 在发请求前以 `kind: error` 结束，failure 消息包含 `MAGPIE_STOP_UNSUPPORTED`。

**请求内容**：
- SHALL 包含 DSH 给出的 system、messages（含工具结果）、工具 schema 和 `maxTokens`。输出上限字段：Responses 用 `max_output_tokens`，Chat 用 `max_completion_tokens`。开头的 system 内容 SHALL 作为第一条 `system` 或 `developer` 角色的消息发送（Responses 放在 `input` 里，Chat 放在 `messages` 里），或者放进 Responses 的 `instructions` 字段。Magpie 对这几种位置一视同仁，都并入 system（`chat.go:102`、`responses.go:361`）。system 内容 SHALL NOT 改写成 user 消息；
- 所选 effort 写入对应线协议的推理字段：Responses 写 `reasoning.effort`，Chat 写 `reasoning_effort`，值都取网关的档位 id 原文，显式选择的 `none` 也原样写入。未选 effort 时，两种协议都 SHALL NOT 写推理字段，包括不得由底层库自动补上 `none`，因为 Magpie 收到 `none` 会关闭推理；
- 图片：只对声明可收图的模型发送。插件通过 DSH 附件服务读取图片字节，编码为 data URL 后放入线协议的图片内容：Chat 为 `{type: "image_url", image_url: {url: <dataURL>}}`，Responses 为 `{type: "input_image", image_url: <dataURL>}`。附件读取失败，或向不可收图的模型发送图片，SHALL 在发请求前以 `kind: error` 失败。被 DSH 标记为 `offloaded` 的图片按 DSH 给出的占位文本发送；
- SHALL 带 DSH 要求的 `attributionHeaders()`；
- 每次请求都带 `Authorization: Bearer <key>`。

**输出**：SHALL 输出 DSH 流块，包括文本、推理、工具调用；工具参数为原始 JSON 字符串。SHALL 在终止块之前输出 usage。usage 中 `inputTokens` 只计未缓存的输入，按 `max(总输入 - 缓存读取 - 缓存写入, 0)` 计算。总输入取 Responses 的 `input_tokens` 或 Chat 的 `prompt_tokens`；缓存读取和缓存写入取 `input_tokens_details`/`prompt_tokens_details` 中的 `cached_tokens` 和 `cache_write_tokens`，分别计入 `cacheReadTokens` 和 `cacheWriteTokens`。网关没有给出缓存详情时，缓存视为 0，不推断缓存量。`totalTokens` 由插件推导：未缓存输入（`inputTokens`）大于 0 时，`totalTokens = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens`；未缓存输入为 0 时省略 `totalTokens`。未缓存输入为 0 有三种来源：网关没给完整输入、完整输入小于缓存读写之和（计数不一致），或者恰好全部命中缓存。前两种必须省略；第三种是保守省略，因为插件无法与前两种区分。网关自带的 `total_tokens` 和底层库的默认值都不直接采用，因为 Magpie 透传同协议上游时，可能不带 total，或者 total 与分项对不上。缓存字段只在值大于 0 时输出。终止原因按以下规则映射：
- 正常结束 → `stop`；
- 工具调用 → `tool-calls`；
- 达到输出上限 → `max-tokens`；
- 流在终止事件之前中断 → `error`，不得当作 `stop`；
- 流中出现错误事件 → `error`，即使之后还收到 `[DONE]` 或完成事件。错误事件包括 Chat 的 SSE `error` 对象、Responses 的 `error` 事件，以及 Responses 的 `response.failed`（不论是否带 error 对象）。

**取消与超时**：SHALL 响应 `options.signal` 并以 `aborted` 结束；超时见「流式空闲超时（AMD4）」。

#### Scenario: 两种协议的文本生成与 effort
- **GIVEN** Responses 模型 `codex/gpt-6.1-sol`（`native_endpoints` 含 `/v1/responses`）和 Chat 模型 `deepseek/deepseek-flash`；两个网关 mock 都返回文本 `hi`、usage、完成
- **WHEN** 以 effort `high` 对两个模型各发起一次生成
- **THEN**
  - Responses mock 收到 `POST /v1/responses`，请求体 `reasoning.effort` 为 `high`；
  - Chat mock 收到 `POST /v1/chat/completions`，请求体 `reasoning_effort` 为 `high`；
  - 两次请求都带 attribution 头；
  - 两次的流都依次包含文本 `hi`、一个 usage 块，finish 原因为 `stop`。

#### Scenario: Responses 工具往返
- **GIVEN** 模型 `codex/gpt-6.1-sol`；网关 mock 第一次返回 `function_call`（`call_id: "c1"`，名称 `read_file`，参数 `{"path":"a"}`），第二次返回文本 `done`
- **WHEN** DSH 发起生成，得到工具调用后，把工具结果 `ok` 追加进 messages 再次生成
- **THEN**
  - 第一次流的工具块参数原样为 `{"path":"a"}`，finish 原因为 `tool-calls`；
  - 第二次 `POST /v1/responses` 请求体的 `input` 依次含 `{type: "function_call", call_id: "c1", name: "read_file"}` 和 `{type: "function_call_output", call_id: "c1", output: "ok"}`；
  - 第二次流输出 `done`，finish 原因为 `stop`。

#### Scenario: Chat 工具往返
- **GIVEN** 模型 `claude/claude-opus-5-5` 的 `native_endpoints` 为空；网关 mock 第一次返回工具调用 `read_file` 与参数 `{"path":"a"}`，第二次返回文本 `done`
- **WHEN** DSH 发起生成，得到工具调用后，把工具结果追加进 messages 再次生成
- **THEN** 两次请求都发往 `POST /v1/chat/completions`；第一次流的工具块参数原样为 `{"path":"a"}`，finish 原因为 `tool-calls`；第二次请求体包含该工具结果，流输出 `done`，finish 原因为 `stop`

#### Scenario: 请求体与 usage 映射（两种协议）
- **GIVEN** 一次生成：system 为 `S`，一条 user 消息 `U`，一个工具 schema `t`，`maxTokens` 为 100，effort 为 `none`；网关 mock 返回的 usage 为 prompt/input 1000、其中缓存读取 600、缓存写入 50、输出 20
- **WHEN** 分别对 Responses 模型 `codex/gpt-6.1-sol` 和 Chat 模型 `deepseek/deepseek-flash` 各发起一次
- **THEN**
  - Responses 请求体：`input` 的第一项是角色为 `system` 或 `developer`、内容为 `S` 的消息（或者 `instructions` 为 `S`），`input` 含 `U`，`tools` 含 `t`，`max_output_tokens` 为 100，`reasoning.effort` 为 `none`；
  - Chat 请求体：`messages[0]` 的角色为 `system` 或 `developer`、内容为 `S`，没有任何 `role: "user"` 的消息含有 `S`，`tools` 含 `t`，`max_completion_tokens` 为 100，且没有 `maxTokens` 键；`reasoning_effort` 为 `none`；
  - 两次的 usage 块都恰为 `{inputTokens: 350, cacheReadTokens: 600, cacheWriteTokens: 50, outputTokens: 20, totalTokens: 1020}`。

#### Scenario: 缺缓存详情、缺 total 与不一致计数
- **GIVEN** 网关 mock 依次返回四种 usage：(a) 总输入 1000、输出 20，没有缓存详情和 `total_tokens`；(b) Responses 透传上游的 `{input_tokens: 9, output_tokens: 2}`，没有 `total_tokens`；(c) 总输入 100、缓存读取 600、输出 20、`total_tokens` 120；(d) 只有输出 20，没有完整输入（Responses 为 `{output_tokens: 20}`，Chat 为 `{completion_tokens: 20}`）
- **WHEN** 各发起一次生成
- **THEN** (a) usage 恰为 `{inputTokens: 1000, outputTokens: 20, totalTokens: 1020}`；(b) 为 `{inputTokens: 9, outputTokens: 2, totalTokens: 11}`，`totalTokens` 不为 0；(c) `inputTokens` 为 0，不含 `totalTokens` 键；(d) 两种协议的 usage 都不含 `totalTokens` 键

#### Scenario: 未选 effort 时不写推理字段
- **GIVEN** Responses 模型 `codex/gpt-6.1-sol` 与 Chat 模型 `deepseek/deepseek-flash` 都有非空 `reasoning_levels`
- **WHEN** 不指定 effort，对两个模型各发起一次生成
- **THEN** Responses 请求体不含 `reasoning` 键，Chat 请求体不含 `reasoning_effort` 键

#### Scenario: 带 stop 的请求被拒绝
- **GIVEN** 模型分别为 `codex/gpt-6.1-sol` 和 `deepseek/deepseek-flash`
- **WHEN** 以 `stop: ["END"]` 各发起一次生成
- **THEN** 两次都以 `kind: error` 结束，消息包含 `MAGPIE_STOP_UNSUPPORTED`；网关 mock 收到的请求数为 0

#### Scenario: 两种协议发送图片
- **GIVEN** Chat 模型 `claude/claude-haiku-5-5` 与 Responses 模型 `codex/gpt-6.1-sol` 都声明图片输入；附件服务对某附件返回 PNG 字节 B
- **WHEN** 对两个模型各发起一次 user 消息含该图片的生成
- **THEN** Chat 请求体中该消息含 `{type: "image_url", image_url: {url: D}}`，Responses 请求体中含 `{type: "input_image", image_url: D}`；两处的 D 都以 `data:image/png;base64,` 开头，解码后等于 B

#### Scenario: 附件读取失败
- **GIVEN** 模型声明图片输入，附件服务读取该附件时抛错
- **WHEN** 发起含该图片的生成
- **THEN** 以 `kind: error` 结束，网关 mock 收到的请求数为 0

#### Scenario: 流中错误事件不当成功
- **GIVEN** 两个网关 mock：
  - Chat 模型的 mock 先输出文本，再发 SSE `{"error": {...}}`，然后发 finish 与 `[DONE]`；
  - Responses 模型的 mock 先输出文本，再发 `response.failed`，其 `response` 不带 `error` 对象。
- **WHEN** 各发起一次生成
- **THEN** 两次的流都以 `finish` 原因 `error` 结束

#### Scenario: 截断不当成功
- **GIVEN** 网关 mock 输出部分文本后关闭连接，没有发终止事件
- **WHEN** 发起一次生成
- **THEN** 流以 `finish` 原因 `error` 结束；mock 只收到 1 次请求（没有自动重放）

#### Scenario: 达到输出上限
- **GIVEN** 网关 mock 的终止事件表示因长度截断
- **WHEN** 发起一次生成
- **THEN** finish 原因为 `max-tokens`

#### Scenario: 取消
- **GIVEN** 网关 mock 持续输出文本、不结束
- **WHEN** 生成开始后触发 `options.signal` 的 abort
- **THEN** 流以 `aborted` 结束，到网关的连接被关闭

#### Scenario: 向不可收图模型发图
- **GIVEN** 模型 `deepseek/deepseek-v4-pro` 不声明图片输入
- **WHEN** 发起包含图片的生成
- **THEN** 以 `kind: error` 结束，网关 mock 收到的请求数为 0

### Requirement: 流式空闲超时（AMD4）
对齐 dsh-plugin-subscriptions：生成只有一个 300 秒空闲看门狗，从调用 pi-ai 前启动。网关返回的任何数据（响应头、任意 SSE 事件、SSE comments/心跳）都 SHALL 重新计时。连续 300 秒没有任何数据时 SHALL 关闭连接并以 `error` 结束，failure code 为 `TIMEOUT`，消息包含 `MAGPIE_STREAM_TIMEOUT`。最终 block 后直接 done 的正常完成 SHALL 立即结束。插件 SHALL NOT 自行重发或重放请求，重试见「失败分类交给 DSH 重试（AMD4）」。

#### Scenario: 空闲超时（AMD4）
- **GIVEN** 测试使用虚拟时钟；mock A 接受连接后不发任何数据，mock B 发出一段非空文本 delta 后停止发送
- **WHEN** 对 A 从调用 pi-ai 前前进 300 秒，对 B 从最后一次收到数据前进 300 秒
- **THEN** 两次在 299.999 秒时均未结束，到 300 秒以 `error` 结束，failure code 为 `TIMEOUT`、消息含 `MAGPIE_STREAM_TIMEOUT`，连接被关闭，各自 mock 只收到 1 次请求

#### Scenario: 任何网关数据都续期（AMD4）
- **GIVEN** mock 在 t=200/400/600 秒分别发 `response.created`/`response.in_progress`，在 t=800 秒发 SSE comment，之后不再发送；另一 mock 在 t=250 秒才返回响应头
- **WHEN** 推进虚拟时钟
- **THEN** 前者在 t=1100 秒才以 `TIMEOUT` 关闭；后者在 t=550 秒才以 `TIMEOUT` 关闭；两者都只有 1 个 POST

#### Scenario: 空 block start 后长时间推理仍能完成（AMD4）
- **GIVEN** mock 在 t=0 发出空 reasoning、message 或 function_call item start
- **WHEN** 在 t=280 秒发送对应非空 delta、最终 block 与完成事件
- **THEN** 三次都正常结束（文本/推理为 stop，工具为 tool-calls），每次仅 1 个 POST

### Requirement: 失败分类交给 DSH 重试（AMD4）
适配器 SHALL 通过 `providerRetryPolicy` 声明与 dsh-plugin-subscriptions 相同的策略（normal、10 次、1s 起指数退避、上限 60s、±20% 抖动，可重试码为 dsh-llm 默认集合），并把生成失败归入 dsh-llm 标准 code：401/403 为 `AUTH`；429 为 `RATE_LIMIT`，有 `Retry-After` 时带 `providerRetryAfterMs`；上下文超限、额度用尽按 dsh-llm 判定；408/504 为 `TIMEOUT`；其它 5xx 为 `SERVER`；其它 4xx 为 `HTTP_<status>`；连接中断与流截断为 `TRANSPORT`；请求前可判定的插件错误保留原 code；无法识别的为 `MAGPIE_GENERATION_FAILED`。有 HTTP 响应时 SHALL 带 `status`。无内容的正常完成 SHALL 为 `EMPTY_RESPONSE`。用户取消为 `aborted`/`ABORTED`。消息先经脱敏。

#### Scenario: HTTP 失败只发一次并按状态分类
- **GIVEN** 网关 mock 对 `/v1/responses` 分别返回 429（`Retry-After: 7`）、503、504、401、400
- **WHEN** 各发起一次生成
- **THEN** 每次 mock 只收到 1 个请求；failure 依次为 `RATE_LIMIT`（`status: 429`、`providerRetryAfterMs: 7000`）、`SERVER`、`TIMEOUT`、`AUTH`、`HTTP_400`，且都带 `status`

#### Scenario: 连接中断可重试，未知失败不可重试
- **GIVEN** 流开始后 mock 的 body 以 `terminated` 出错；另一 mock 以无法识别的消息出错
- **WHEN** 各发起一次生成
- **THEN** 前者 failure code 为 `TRANSPORT`，后者为 `MAGPIE_GENERATION_FAILED`；均只有 1 个请求

#### Scenario: 空回复
- **GIVEN** mock 只发出 `response.completed`，没有任何输出项
- **WHEN** 发起一次生成
- **THEN** 以 `error` 结束，failure code 为 `EMPTY_RESPONSE`

### Requirement: 只读与传输边界
插件对 Magpie 的每个网络 hop SHALL 只落在已配置地址的同一 origin 上，并且只使用以下方法和路径（相对 API 根）：
- `GET /models`
- `POST /responses`
- `POST /chat/completions`
- `GET /magpie/quotas/cards`
- `POST /magpie/quotas/refresh`

插件 SHALL NOT 跟随 HTTP 重定向：收到 3xx 时以错误结束，不向重定向目标发送任何请求。插件 SHALL NOT 请求 Magpie GUI 的 `/api/*`，SHALL NOT 提供 Magpie 账号的登录、退出、添加或删除，SHALL NOT 修改 Magpie 配置。

插件发往网关的请求 SHALL 使用插件自己的直连传输，不经过 DSH 按 `HTTP(S)_PROXY` 安装的全局代理 dispatcher。插件 SHALL NOT 提供插件级代理配置。

#### Scenario: 完整流程只触达白名单
- **GIVEN** 网关 mock 记录收到的每个请求
- **WHEN** 依次执行：目录同步、一次生成、读取卡片、刷新一张卡片、刷新全部
- **THEN** 记录中的每个 `(method, path)` 都属于上述五项，且没有以 `/api/` 开头的路径

#### Scenario: 重定向不被跟随
- **GIVEN** 网关 mock 对 `POST /v1/responses` 返回 307，分别指向另一 origin 的 mock 和同 origin 的 `/api/usage`
- **WHEN** 发起一次生成
- **THEN** 生成以 `kind: error` 结束；另一 origin 的 mock 收到 0 个请求，同 origin 的 `/api/usage` 收到 0 个请求

#### Scenario: 存在全局代理时仍直连
- **GIVEN** 进程的全局 fetch dispatcher 被替换为会记录请求的代理 mock，网关 mock 在本机端口监听
- **WHEN** 插件执行一次目录同步
- **THEN** 网关 mock 收到 `GET /v1/models`，代理 mock 收到的请求数为 0

### Requirement: 按 provider 分组的模型可见性
设置页 SHALL 按网关模型的 `owned_by` 分组；没有 `owned_by` 的模型，取 id 中第一个 `/` 之前的部分作为分组。

每个 provider 的可见性语义：
- 没有保存过选择：跟随网关模型列表，全部可见；
- 保存过选择（包括空列表）：只显示列表中的模型，之后新上架的模型默认隐藏。

选择器 SHALL 只提供「网关目录 ∩ 可见集」中的模型。可见性是 DSH 侧本地偏好，SHALL NOT 回写网关。保存时只校验形状（provider → 字符串数组），不与当前目录比对。形状非法时 SHALL 以 400 拒绝。

#### Scenario: 未设置时跟随网关
- **GIVEN** `codex` 组未保存过可见性，网关新增 `codex/gpt-6-nova`
- **WHEN** 目录同步后列举模型
- **THEN** 列表包含 `codex/gpt-6-nova`

#### Scenario: 设置后严格按白名单与目录求交集
- **GIVEN** 以下状态同时成立：
  - `claude` 组保存了可见集 `[claude/claude-opus-5-5, claude/claude-haiku-5-5]`，其中 `claude/claude-haiku-5-5` 已不在网关目录中；
  - 网关新增了 `claude/claude-fable-5-2`；
  - `deepseek` 组保存了可见集 `[]`。
- **WHEN** 列举模型，并读取设置
- **THEN** `claude/` 前缀的模型恰为 `claude/claude-opus-5-5`；不含任何 `deepseek/` 前缀的模型；设置中 `claude/claude-fable-5-2` 为 `visible: false`；可见集记录仍保留 `claude/claude-haiku-5-5`

#### Scenario: 形状非法被拒绝
- **GIVEN** 已保存的可见性为 V
- **WHEN** 客户端提交 `{codex: "codex/gpt-6-luna"}`（值不是数组）
- **THEN** 响应状态为 400，已保存的可见性仍为 V

### Requirement: DSH 侧默认 effort
用户 SHALL 能为每个 `reasoning_levels` 非空的模型设置或清除一个默认 effort。默认 effort 保存在 DSH 侧，作为该模型的 `reasoning.defaultEffort` 下发给 DSH。

设置时，取值 SHALL 属于该模型当前的 `reasoning_levels`，否则以 400 拒绝。已保存的值因网关目录变化而不再属于当前档位时，SHALL NOT 下发，但存储中保留该值；网关恢复该档位后，SHALL 重新下发。没有设置默认值的模型，SHALL NOT 下发 `defaultEffort`。

#### Scenario: 设置与清除
- **GIVEN** `codex/gpt-6.1-sol` 的 `reasoning_levels` 含 `high`
- **WHEN** 客户端把其默认 effort 设为 `high`，解析一次模型信息；然后清除，再解析一次
- **THEN** 第一次 `reasoning.defaultEffort` 为 `high`；第二次没有 `reasoning.defaultEffort`

#### Scenario: 拒绝非法档位
- **GIVEN** `opencode-go/kimi-k3` 的 `reasoning_levels` 为 `["max"]`
- **WHEN** 客户端把其默认 effort 设为 `low`
- **THEN** 响应状态为 400，已保存的默认值不变

#### Scenario: 档位失效时不下发，恢复后重新下发
- **GIVEN** 已保存 `codex/gpt-6-astra` 的默认值 `ultra`
- **WHEN** 网关目录中该模型的 `reasoning_levels` 先变为不含 `ultra`，之后又恢复含 `ultra`，每次变化后各解析一次
- **THEN** 第一次没有 `reasoning.defaultEffort`；第二次为 `ultra`

### Requirement: 只读用量卡片
设置页 SHALL 用 `GET /magpie/quotas/cards` 的结果，按卡片的 `provider` 归入对应分组展示。卡片的 provider 在模型目录中没有对应分组时，SHALL 单独成组显示，不得丢弃。同一 provider 下的多张卡片按 `user` 分别显示。

host SHALL 把网关卡片投影为固定字段集合，再返回给浏览器，未列出的字段 SHALL NOT 跨过设置 API；所有字符串字段先按「网关连接与凭据」的规则脱敏。每张卡片 SHALL 展示网关给出的以下字段：
- `name`、`user`、`plan`、`until`、`renew`、`balance`；
- 读取时间（`readAt`，没有时取 `asOf`；有 `asOf` 时标明这是旧读数）；
- `error`；
- 每个窗口的 `name` 与读数。窗口读数规则：`unlimited` 为真时显示「无限」；否则有 `display` 时显示 `display`；否则显示 `used` 百分比，有 `resetsAt` 时附上重置时间；
- `resets`：显示剩余次数 `count`；有 `until` 时显示过期时间，缺失时不显示过期时间。

网关没给的字段 SHALL 省略，不显示占位值或推断值。带 `error` 的卡片 SHALL 显示该错误，不得被隐藏。

插件设置页只在打开时读取一次卡片；用户手动刷新后，用刷新响应更新显示。插件 SHALL NOT 定时请求卡片或刷新端点。卡片中的字符串一律作为文本渲染。

网关返回空集合或读取失败时，连接面板 SHALL 显示空状态「Magpie 未返回可见用量」（失败时为失败原因）和「获取模型与用量」入口（见「用量入口与颜色（AMD4）」）。全量刷新之后仍然为空时，SHALL 追加提示：受限的 gateway key 无法让 Magpie 首次读取用量，需要 Magpie 管理员先在 Magpie 中读取一次，或者改用不受限的 key。插件 SHALL NOT 承诺「获取模型与用量」一定能产生卡片，也 SHALL NOT 建议扩大网关权限或共享范围。

#### Scenario: 渲染卡片字段
- **GIVEN** 卡片端点返回两张卡片：
  - claude：`{provider: "claude", plan: "max", windows: [{name: "7 days", used: 83, resetsAt: "2026-10-27T11:00:00+08:00"}, {name: "Chat", unlimited: true, display: "Unlimited"}]}`；
  - codex：`{provider: "codex", resets: {count: 1, until: "2026-11-06T23:30:34Z"}}`。
- **WHEN** 渲染设置页
- **THEN** `claude` 分组显示 `max`、`7 days 83%` 和对应的重置时间，`Chat` 窗口显示「无限」而不是 `0%`；`codex` 分组显示重置次数 `1` 和该过期时间，且没有与重置关联的按钮

#### Scenario: 缺失字段不伪造
- **GIVEN** codex 卡片带 `resets: {count: 2}`（没有 `until`），且没有 `plan`
- **WHEN** 渲染设置页
- **THEN** 显示重置次数 `2`；渲染文本中不出现 `Invalid Date`、`undefined`、`null`，也没有计划行

#### Scenario: 带错误的卡片仍显示
- **GIVEN** 卡片端点返回一张带 `error: "token expired"` 的 codex 卡片
- **WHEN** 渲染设置页
- **THEN** `codex` 分组中显示文本 `token expired`

#### Scenario: 无权读取用量
- **GIVEN** 卡片端点返回 403
- **WHEN** 读取设置
- **THEN** 卡片区状态为 `forbidden`；模型列表与生成不受影响

#### Scenario: 冷启动空集合
- **GIVEN** 卡片端点返回 `200 {data: []}`
- **WHEN** 渲染设置页
- **THEN** 连接面板显示「Magpie 未返回可见用量」和「获取模型与用量」按钮；插件没有自动发出任何刷新请求

#### Scenario: 卡片字符串按字面渲染
- **GIVEN** 卡片 `name` 为 `<img src=x onerror=alert(1)>`，`error` 为 `<script>x</script>`
- **WHEN** 渲染设置页
- **THEN** 两个字符串按字面出现在渲染文本中，DOM 中没有 `img` 或 `script` 元素，也没有内联事件属性

### Requirement: 用量入口与颜色（AMD4）
设置页 SHALL NOT 提供独立的「用量」栏目或常驻「刷新全部」；刷新只在每张卡片上进行，单卡刷新的提示与失败原因显示在该卡片所在分组。没有卡片时，用量状态显示在连接面板，并在空或失败时提供「获取模型与用量」：先重新同步目录，成功后发一次全量刷新（`{all: true}`），同步失败则不刷新并显示原因。窗口用量条 SHALL 按 `used` 着色：≤70 蓝色（business），大于 70 且小于 90 橙色（warn），≥90 红色（error）。

#### Scenario: 用量条三档颜色（AMD4）
- **GIVEN** 卡片窗口 `used` 分别为 0、70、70.5、71、89.9、90、100
- **WHEN** 渲染设置页
- **THEN** 用量条档位依次为 normal、normal、warn、warn、warn、high、high

#### Scenario: 有卡片时没有整体刷新（AMD4）
- **GIVEN** 卡片端点返回一张 codex 卡片
- **WHEN** 渲染设置页
- **THEN** 页面没有「刷新全部」或「获取模型与用量」按钮，也没有用量状态栏；只有该卡片自己的「刷新」

#### Scenario: 目录同步失败时不发全量刷新
- **GIVEN** 卡片为空，设置写入（目录同步）返回 502
- **WHEN** 用户点击「获取模型与用量」
- **THEN** 不发出全量刷新，连接面板显示失败原因

### Requirement: 手动刷新用量
设置页 SHALL 提供两种刷新，都只由用户点击触发：
- 单张卡片的「刷新」：发送 `POST /magpie/quotas/refresh?provider=<provider>&user=<user>`；卡片没有 `user` 时省略该参数。provider SHALL 取自当前显示的这张卡片；
- 全量刷新：发送不带参数的 `POST /magpie/quotas/refresh`，界面上只经「获取模型与用量」触发（AMD4）。

host SHALL 只接受以下两种互斥的请求形状：`{all: true}`，或 `{provider, user?}`。单卡请求的 `(provider, user)` SHALL 与当前代最近一次读到的某张卡片完全一致，包括卡片有 `user` 时必须提供相同的 user；否则返回 400，不向网关发请求。两种形状混用或 provider 为空，同样返回 400。

host SHALL 对每一代维护一个刷新闸门：同一时刻最多只有一个刷新请求（单卡或全部）发往网关。新请求先按上文规则校验，非法则返回 400，并且不影响闸门。闸门被占用时：
- 进行中的刷新覆盖新请求的目标（进行中的是「刷新全部」，或者两者是同一张卡片）：新请求等待它结束，直接得到它的结果，不另发请求；
- 不覆盖（进行中的是单卡，而新请求是「刷新全部」或另一张卡片）：新请求等进行中的刷新结束（不论成功或失败），重新检查当前代和闸门，再按自己的目标发出一次刷新。等待期间发生换代时，按代际规则丢弃，不发请求。

刷新进行中，客户端的刷新按钮 SHALL 处于禁用态。

刷新进行中时到达的卡片读取（GET），SHALL 等待该刷新结束并直接返回刷新的结果，不另向网关发 `GET /magpie/quotas/cards`。没有刷新进行时，同代内同一时刻最多一个卡片读取在进行，重复请求复用它的结果。只有卡片读取或刷新的 2xx 结果才能更新卡片状态，且必须同时满足两个条件：属于当前代，并且该结果的序号大于当前已提交结果的序号。序号属于真正发往网关的那次请求：取得闸门、确认当前代之后，在实际发出请求的那一刻分配。复用进行中刷新的请求，以及跟随刷新的 GET，都沿用被复用那次请求的序号，不另外分配，也不会自己推进提交水位。400 和请求失败都不是卡片结果，SHALL NOT 更新卡片、推进序号，也不得释放其它请求持有的刷新闸门。

刷新返回 2xx，且未被序号规则丢弃时，SHALL 用响应中的卡片集合替换当前显示。显示的读取时间 SHALL 取自响应，不由插件生成。读取时间没有变化时，SHALL 提示「Magpie 未重新读取（可能处于节流间隔内）」，不得宣称数据已更新。刷新失败（非 2xx 或网络错误）时，SHALL 保留刷新前的卡片，并显示失败原因。

#### Scenario: 刷新单张卡片
- **GIVEN** 显示一张 `provider: "codex"`、`user: "u@example.com"` 的卡片
- **WHEN** 用户点击它的刷新
- **THEN** 网关 mock 恰好收到 1 个 `POST /v1/magpie/quotas/refresh?provider=codex&user=u%40example.com`；卡片读取时间更新为响应中的值；刷新进行中按钮为禁用态

#### Scenario: 冷启动时获取模型与用量
- **GIVEN** 卡片区为空状态，网关 mock 对不带参数的刷新返回 2 张卡片
- **WHEN** 用户点击「获取模型与用量」
- **THEN** 先发出一次目录重新同步，成功后 mock 收到 1 个不带 query 的 `POST /v1/magpie/quotas/refresh`，之后显示 2 张卡片，「获取模型与用量」按钮消失

#### Scenario: 节流期内返回旧读数
- **GIVEN** 卡片读取时间为 T，网关 mock 对刷新返回 200，读取时间仍为 T
- **WHEN** 用户点击该卡片的刷新
- **THEN** 显示的读取时间仍为 T，并显示「未重新读取」提示

#### Scenario: 非法刷新目标被拒绝
- **GIVEN** 当前代读到的卡片只有 `{provider: "codex", user: "u@example.com"}`
- **WHEN** 客户端分别提交：`{provider: ""}`、`{provider: "codex"}`（省略 user）、`{provider: "codex", user: "other@example.com"}`、`{provider: "codex", user: "u@example.com", all: true}`
- **THEN** 每次响应状态都为 400，网关 mock 收到的刷新请求数为 0

#### Scenario: 并发刷新复用进行中的那一次
- **GIVEN** 客户端 1 发起的全量刷新尚未返回
- **WHEN** 客户端 2 对 codex 卡片发起单卡刷新，之后客户端 1 的刷新返回读取时间 T2
- **THEN** 网关 mock 总共只收到 1 个刷新请求；两个客户端都得到状态 200、读取时间为 T2 的卡片结果

#### Scenario: 旧响应晚到不覆盖新结果
- **GIVEN** 先发起的卡片读取 R1 被 mock 延迟；之后发起的刷新 R2 先返回，读取时间为 T2
- **WHEN** R1 带着读取时间 T1 晚到（T1 < T2）
- **THEN** 显示的卡片仍为 R2 的结果，读取时间为 T2

#### Scenario: 刷新进行中打开的页面得到刷新结果
- **GIVEN** 刷新 F 已发出且尚未返回；网关 mock 的缓存读数为 T1，F 将返回 T2
- **WHEN** 另一页面此时读取卡片（G），之后 F 返回
- **THEN** G 不发出 `GET /v1/magpie/quotas/cards`，等 F 结束后得到读取时间 T2；最终显示的读取时间为 T2

#### Scenario: 单卡刷新进行中时发起全量刷新
- **GIVEN** 当前卡片有 `{provider: "codex", user: "u@example.com"}`；对它的单卡刷新 A 已发出、尚未返回
- **WHEN** 另一个客户端发起全量刷新，之后 A 返回
- **THEN** A 返回之后，网关 mock 才收到 1 个不带 query 的 `POST /v1/magpie/quotas/refresh`；任何时刻同时进行的刷新请求都不超过 1 个；全量刷新的调用方拿到的是这次全量刷新的结果

#### Scenario: 等待中的刷新不被跟随者压过
- **GIVEN** 当前卡片有 A、B 两张；单卡刷新 A 已发出、尚未返回，A 的响应 T_A 中 B 仍是旧值
- **WHEN** 依次发生：客户端请求刷新单卡 B（不覆盖 A，于是等待）；另一页面读取卡片 G（跟随 A）；A 返回 T_A；B 取得闸门并发出，mock 延迟后返回带 B 新值的 T_B
- **THEN** G 得到 T_A，且不额外发出 `GET /v1/magpie/quotas/cards`；最终显示的卡片为 T_B；网关先后只收到 A、B 两个刷新请求，任何时刻同时进行的都不超过 1 个

#### Scenario: 刷新失败后闸门释放
- **GIVEN** 刷新 F 持有闸门，网关 mock 对 F 返回 502，当前卡片读取时间为 T0
- **WHEN** F 结束后，用户再次刷新，mock 这次返回 T2
- **THEN** F 失败后卡片仍为 T0；第二次刷新正常发出并得到 T2

#### Scenario: 受限 key 冷启动获取用量仍为空
- **GIVEN** 卡片端点返回 `200 {data: []}`，网关 mock 对不带参数的刷新也返回 `200 {data: []}`
- **WHEN** 用户点击「获取模型与用量」
- **THEN** 卡片区仍为空状态，并追加显示需要 Magpie 管理员先读取一次的提示；提示中没有「打开共享」或「增加权限」字样

#### Scenario: 刷新失败保留原卡片
- **GIVEN** 网关 mock 对刷新返回 502
- **WHEN** 用户点击某张卡片的刷新
- **THEN** 卡片内容与刷新前一致，并显示包含 `502` 的错误

### Requirement: Codex 速度切换
对网关目录中 `service_tiers` 含 id `priority` 的模型，输入框右侧 SHALL 显示「速度」选择（标准 / 快速）。

速度状态 SHALL 只在 host 进程内存中保存「选择了快速」的会话集合：默认为标准；选标准时从集合中移除；host 重启后全部恢复为标准。

生成时：会话在快速集合中、且请求模型支持 `priority`，请求体带 `service_tier: "priority"`；其它情况请求体不含 `service_tier` 键。当前模型不支持 `priority` 时，速度控件 SHALL 不显示。设置速度时，`tier` 不是 `standard` 或 `fast` 的请求 SHALL 被拒绝（400）。

#### Scenario: 快速模式请求带 priority（两种协议）
- **GIVEN** 会话 S 设为快速；Responses 模型 `codex/gpt-6.1-sol` 与一个 `native_endpoints` 为空、`service_tiers` 含 `priority` 的 Chat 模型
- **WHEN** S 分别用这两个模型各发送一条消息
- **THEN** `POST /v1/responses` 与 `POST /v1/chat/completions` 的请求体都含 `"service_tier": "priority"`

#### Scenario: 标准模式与其它会话不带字段
- **GIVEN** 会话 A 设为快速，会话 B 从未设置
- **WHEN** B 用 `codex/gpt-6.1-sol` 发送一条消息；然后 A 改回标准，也发送一条
- **THEN** 这两次请求体都不含 `service_tier` 键

#### Scenario: 不支持的模型不显示且不带字段
- **GIVEN** 会话 S 在 Codex 模型上选了快速，随后切换到 `deepseek/deepseek-flash`
- **WHEN** 渲染输入框，然后 S 发送一条消息
- **THEN** 速度控件不在 DOM 中；请求体不含 `service_tier` 键

#### Scenario: host 重启后回到标准
- **GIVEN** 会话 S 设为快速
- **WHEN** 重建速度控制器（模拟 host 重启）后，S 用 `codex/gpt-6.1-sol` 发送一条消息
- **THEN** 请求体不含 `service_tier` 键

#### Scenario: 非法 tier 被拒绝
- **GIVEN** 会话 S 处于标准
- **WHEN** 客户端为 S 设置速度 `turbo`
- **THEN** 响应状态为 400，S 仍为标准

### Requirement: 选择器按网关归属展示分组（AMD2）
模型选择菜单 SHALL 按网关 `owned_by` 显示组标题及具体型号：`claude` 显示 `Magpie (Claude)`、`codex` 显示 `Magpie (GPT)`，其它非空归属显示 `Magpie (<owned_by>)`。缺失归属 SHALL 显示 `Magpie (Other)`，SHALL NOT 按模型名猜测归属。该展示分组 SHALL 通过官方逐模型展示扩展实现；真实 route SHALL 始终是单一 `dsh-magpie-connector`，模型 id SHALL 保持网关原值。

统一搜索 SHALL 同时覆盖展示组标签与具体型号/id；可见性过滤和 effort SHALL 保持既有行为，`/model` 搜索与 actions SHALL 使用同一真实身份。缺少官方字段的 rc.2 SHALL 经本轮已授权的 Pet 现有 compat 唯一 owner 受管 patch 增加可选 resolved-model `displayGroup {id,label}`，经 LLM 校验/detach、host catalog 与原选择器展示 buckets；没有该字段的模型 SHALL 保持原展示。SHALL NOT 新建 runtime owner、手改 generated dirs、注册伪 provider 或 hack DOM 文本改变实际路由；插件 SHALL NOT 为映射展示组修改既有 CatalogModel.provider fallback 或设置偏好键。

#### Scenario: owned_by 分组不随型号名猜测
- **GIVEN** 网关模型 id 为 `custom/claude-looking`、显示名含 Claude，但 `owned_by` 为 `codex`；另有 owned_by 为 claude 的模型
- **WHEN** 打开官方模型菜单
- **THEN** 前者在 `Magpie (GPT)` 下，后者在 `Magpie (Claude)` 下；选中任何一项的 provider 都是 `dsh-magpie-connector`，model 为原 id

#### Scenario: 分组搜索保留可见性与 effort
- **GIVEN** Claude/GPT 组均有可见模型，另有隐藏模型，可见模型具有已保存默认 effort
- **WHEN** 在统一菜单按组标签或型号/id 搜索并选择可见模型
- **THEN** 能匹配对应可见型号，隐藏模型不出现，选中后真实 provider/model 与默认 effort 保持不变

#### Scenario: 缺失归属不冒充分组
- **GIVEN** 模型名含 GPT，但没有 owned_by
- **WHEN** 打开官方模型菜单
- **THEN** 它属于 `Magpie (Other)`，不属于按名字推测的 GPT 组；既有设置分组 fallback 与偏好键不变，普通无 displayGroup 的宿主模型仍使用原 provider 展示；畸形 displayGroup 在宿主 resolve 边界报 INVALID_MODEL_INFO，不以错误元数据改变路由

### Requirement: 设置导航自身行使用 Magpie 鸟形图标（AMD2）
插件 SHALL 在自身 Magpie 设置导航行显示本地鸟形品牌图标，随 `currentColor` 适应主题，保留文字、点击和可访问性语义。若宿主没有官方 icon 字段，SHALL 仅对可唯一定位的自身导航行添加私有 marker 并使用限定 CSS；SHALL NOT 修改旧 connect 或其它设置行。重复同名无法唯一定位、唯一行已带 foreign connect marker、缺 document/body/head 时 SHALL 静默保留宿主行为。

插件 SHALL 管理 observer 和样式的生命周期：支持对话框晚挂载和重建，卸载时断开 observer、清除 marker 和自身样式。来源许可 SHALL 随包保留。

#### Scenario: 鸟形图标只标记自身导航行
- **GIVEN** 设置导航中同时有本插件 Magpie 行、旧 connect 行和其它行
- **WHEN** client apply，之后导航重新挂载
- **THEN** 只有本插件行带私有 marker 和 currentColor 鸟形图标 CSS，旧 connect/其它行及自身原始 SVG/文字/点击行为不被改写

#### Scenario: 卸载清理与缺失入口静默降级
- **GIVEN** observer 已安装，本插件入口可能不存在或有重复同名行
- **WHEN** 导航变化，然后卸载 client，再重新插入导航
- **THEN** 无法唯一定位时不标记；卸载后无 marker/自身样式且不再标记新行，无 DOM 环境不抛错

### Requirement: 禁用不删除用户数据
在 manifest 中把插件设为 `enabled: false` 并重新 build 后，插件 SHALL NOT 删除 credentials 中的 `MAGPIE_API_KEY`，也 SHALL NOT 删除插件设置文件。插件的 dispose 路径 SHALL 只释放 route 注册、设置路由、计时器与连接，不执行任何删除操作。

#### Scenario: dispose 不删除数据
- **GIVEN** 已保存 key 与设置文件，插件处于挂载状态
- **WHEN** 卸载插件（dispose）
- **THEN** credentials 服务的 `unset` 未被调用，设置文件仍存在且字节不变，`dsh-magpie-connector` route 已不在 provider 列表中

#### Scenario: dispose 时有进行中的请求
- **GIVEN** 一次目录同步正在进行
- **WHEN** 卸载插件
- **THEN** 该同步被中止，之后它的响应不会写入任何状态，进程中没有未处理的 Promise rejection

<!-- AMD3 2026-10-26：本文件的分组/真实身份与品牌要求保留；AUTO effort 官方同步及单值展示仅见同 change auto-model-routing delta，不改变 adapter/传输或 sidebar 源码。 -->
