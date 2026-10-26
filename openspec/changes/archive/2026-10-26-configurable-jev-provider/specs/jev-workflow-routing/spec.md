## MODIFIED Requirements

### Requirement: Routing evidence is bounded, private, and auditable
每条 shadow 记录 SHALL 使用稳定且可迁移的版本结构，至少包含有界的样本 provenance、候选集合及版本、推荐候选、概率、置信度/差值、决策状态、调用时间、完整 shadow 判断的 measured/unavailable 延迟状态、最终实际流程（若已知）、覆盖来源，以及实际处理该次调用的 Jev 服务方 `jevProvider`。provenance 只允许 `real-vibe`、`synthetic-fixture`、`unknown`。`jevProvider` 只允许 `typesafe`、`openrouter`、`unknown`。Agent SHALL 把每次 Jev 调用的有界投影以 `jevCalls`（至多 2 项）交给 recorder：成功调用为 `{outcome: "success", provider, semantic}`，其中 `provider` 取自结果 JSON 的 `provider` 字段，`semantic` 在结果无法完整解析、被截断、缺失或不符合 classify/decide 必需结构，或 classify 任一 `results[].status` / decide `recommendation.status` 为 `invalid_response` 时为 `invalid-response`；仅结果完整可解析且通过必需结构校验时为 `ok`；失败调用为 `{outcome: "error", message}`，`message` 截断到 512 字符。recorder SHALL 确定性计算，不读取 manifest、不猜测：
- **服务方**：成功调用取 `provider`（闭集外为 `unknown`）；失败调用只按锚定在开头的上游格式识别——`^OpenRouter decisions API ` 为 `openrouter`，`^TypeSafe API ` 为 `typesafe`，`^Jev provider (typesafe|openrouter):` 为对应值，否则为 `unknown`。两次调用中可识别的值一致或只有一个时取该值，冲突时为 `unknown`。
- **HTTP 状态**：只从锚定格式提取——`^OpenRouter decisions API (\d{3})\b`、`^TypeSafe API HTTP (\d{3})\b`、`^Jev provider \w+: .*\(HTTP (\d{3})\)$`；不在任意文本中搜索数字。
- **错误类别**：有失败调用时按首个失败调用归一化：状态 451 为 `region-blocked`，401/403 为 `unauthorized`，429 为 `rate-limited`，5xx 为 `provider-5xx`，其它状态为 `unknown`；无状态时，`^Jev request exceeded the \d+ms deadline` 或含 `timed out` / `timeout`（不区分大小写）为 `timeout`，含 `fetch failed`、`socket`、`ECONN`、`ENOTFOUND` 或 `network` 为 `network`，其余为 `unknown`。没有失败调用时，任一成功调用 `semantic` 为 `invalid-response` 则为 `malformed-response`；否则保留输入的 `errorCategory`（经闭集归一化；输入缺失时按现有规则为 `unknown`，因此 Agent 在调用全部成功时 SHALL 显式传 `errorCategory: none`），使 `missing-credential`、`cancelled`、`malformed-response` 等由 Agent 观察到的失败不会被改写为 `none`。`jevCalls` 缺失或形状不合法时视为未提供，`jevProvider` 为 `unknown`，`errorCategory` 取输入值。
`jevCalls` 与错误文本只用于上述计算，MUST NOT 持久化或出现在 recorder 的 stdout/stderr 中；stdin 不是合法 JSON 时，recorder SHALL 只输出固定诊断 `invalid JSON input` 并以非 0 退出，不回显输入片段。SKILL SHALL 要求 Agent 用文件写入工具把输入 JSON 写入临时文件，再以 `node recorder.mjs record < <file>` 传入，不得把工具输出文本拼入 shell 命令、heredoc 或命令参数。错误类别为闭集：`none`、`missing-credential`、`unauthorized`、`rate-limited`、`region-blocked`（服务方以 HTTP 451 拒绝出口地区）、`provider-5xx`、`network`、`timeout`、`cancelled`、`malformed-response`、`unknown`。系统 MUST NOT 记录、推断或按语言分类请求；provenance、latency 与 jevProvider 元数据 MUST NOT 被发送给 Jev。记录 MUST NOT 包含 API Key、凭据、完整会话历史、未裁剪附件、provider 原始错误体、不必要的源代码正文或自由文本摘要，并 SHALL 提供禁用与清理路径。报告 SHALL 提供按 `jevProvider` 拆分的 `real-vibe` 记录聚合（含 `unknown` 组，与其它 breakdowns 口径一致），并标明该拆分只覆盖可归属的记录、不是完整的服务可靠性；Phase 2 门槛计算不变。

#### Scenario: A shadow sample is recorded
- **WHEN** 普通 Agent 在真实流程选择点调用 Jev 并获得可解析结果
- **THEN** 系统保存 `real-vibe` provenance、measured/unavailable latency 与 `jevProvider`，以及足以比较推荐与实际流程的有限证据，且不保存密钥、完整对话或语言分类

#### Scenario: A synthetic fixture is recorded
- **WHEN** 测试或明确的离线 fixture 产生 shadow 记录
- **THEN** 记录使用 `synthetic-fixture` provenance，报告不得把它计入真实 vibe 样本覆盖

#### Scenario: Legacy record lacks new dimensions
- **WHEN** 系统读取旧 schema 记录且其中没有 provenance、measured latency 或 `jevProvider`
- **THEN** 系统将对应维度保守表示为 `unknown` 或 `unavailable`，不从历史正文、时间、路由结果或其它代理字段猜测，也不原地改写旧记录

#### Scenario: Provider echoes sensitive content in an error
- **WHEN** 外部端点的错误响应包含请求或凭据相关内容
- **THEN** 系统只记录规范化错误类别，不持久化原始错误体

#### Scenario: Region rejection is recorded as its own category
- **GIVEN** 一条输入记录的 `errorCategory` 为 `region-blocked`
- **WHEN** 经 `recorder.mjs record` 写入后运行 `summary`
- **THEN** 存储记录的 `errorCategory` 为 `region-blocked`（不被归为 `unknown`），`summary` 的错误计数中 `region-blocked` 为 1

#### Scenario: Unknown provider value is bounded
- **GIVEN** 一条输入记录的 `jevProvider` 为 `cloudflare`，另一条缺失该字段
- **WHEN** 经 `recorder.mjs record` 写入
- **THEN** 两条存储记录的 `jevProvider` 均为 `unknown`

#### Scenario: Report separates samples by provider including unattributed
- **GIVEN** 记录文件含 2 条 `jevProvider: typesafe` 的失败记录、1 条 `jevProvider: openrouter` 的成功记录、1 条 `jevProvider: unknown` 的失败记录，均为 `real-vibe`
- **WHEN** 运行 `recorder.mjs report`
- **THEN** `breakdowns.jevProvider.typesafe.providerFailures` 为 2，`breakdowns.jevProvider.openrouter.providerFailures` 为 0，`breakdowns.jevProvider.openrouter.total` 为 1，`breakdowns.jevProvider.unknown.providerFailures` 为 1，`breakdowns.jevProviderScope` 为 `attributed-records-only`，`coverage.gates.providerFailureRate.actual` 为 0.75

#### Scenario: Provider attribution from realistic tool outcomes
- **GIVEN** 六条合法的 `record` 输入，均显式提供 `errorCategory: none`；成功调用均为 `{outcome: "success", provider: 下述值, semantic: "ok"}`，失败调用均为 `{outcome: "error", message: 下述文本}`。各自的 `jevCalls` 依次为：(a) `[{outcome: success, provider: openrouter, semantic: ok}]`；(b) `[{outcome: error, message: "OpenRouter decisions API 451"}]`；(c) `[{outcome: error, message: "Jev provider typesafe: request failed (HTTP 451)"}]`；(d) `[{outcome: success, provider: openrouter, semantic: ok}, {outcome: error, message: "fetch failed"}]`；(e) `[{outcome: success, provider: openrouter, semantic: ok}, {outcome: success, provider: typesafe, semantic: ok}]`；(f) `[{outcome: error, message: "socket hang up SECRET-ECHO"}]`
- **WHEN** 逐条经 `recorder.mjs record` 写入
- **THEN** 存储记录的 `jevProvider`/`errorCategory` 依次为 (a) `openrouter`/`none`，(b) `openrouter`/`region-blocked`，(c) `typesafe`/`region-blocked`，(d) `openrouter`/`network`，(e) `unknown`/`none`，(f) `unknown`/`network`；记录文件、stdout 与 stderr 均不含 `jevCalls`、`SECRET-ECHO` 或任何错误原文

#### Scenario: Non-HTTP numbers and pinned deadline text are normalized correctly
- **GIVEN** 三条 `record` 输入，均带 `errorCategory: none`，各自只有一个失败调用 `{outcome: error, message}`，`message` 依次为：`socket hang up on port 451`、`network failed after 503 ms`、`Jev request exceeded the 60000ms deadline.`
- **WHEN** 逐条经 `recorder.mjs record` 写入
- **THEN** 存储的 `errorCategory` 依次为 `network`、`network`、`timeout`，三条的 `jevProvider` 均为 `unknown`

#### Scenario: Semantic and agent-observed failures are not overwritten with none
- **GIVEN** 一个空记录文件，以及六条 `real-vibe` 的 `record` 输入，成功调用的 `ok` 投影均为 `{outcome: "success", provider: "openrouter", semantic: "ok"}`：(a) 输入 `errorCategory: none`，`jevCalls: [{outcome: success, provider: openrouter, semantic: invalid-response}]`（classify `results[].status` 为 `invalid_response`）；(b) 输入 `errorCategory: none`，`jevCalls: [ok 投影, {outcome: success, provider: openrouter, semantic: invalid-response}]`（decide `recommendation.status` 为 `invalid_response`）；(c) 无 `jevCalls`、输入 `errorCategory: missing-credential`；(d) 输入 `errorCategory: cancelled`，`jevCalls: [ok 投影]`；(e) 输入 `errorCategory: none`，`jevCalls: [{outcome: success, provider: openrouter, semantic: invalid-response}]`（成功结果被截断无法解析）；(f) 输入 `errorCategory: none`，`jevCalls: [{outcome: success, provider: openrouter, semantic: invalid-response}]`（可解析但缺少必需结构）；六条输入的 `recommendation.status` 均为 `auto-candidate`
- **WHEN** 逐条写入后运行 `report`
- **THEN** 存储的 `errorCategory` 依次为 `malformed-response`、`malformed-response`、`missing-credential`、`cancelled`、`malformed-response`、`malformed-response`；六条都不存为 `auto-candidate`，按现有保守规则存为 `needs-review`（输入显式 `unavailable` 时仍保持 `unavailable`）；`quality.providerFailures` 为 6

#### Scenario: Malformed input and shell-shaped text stay inert and unechoed
- **GIVEN** 一份 stdin 为非法 JSON 且含 `SECRET-ECHO-ONLY-FIXTURE`；另一份合法输入的失败调用文本为 `'"; EOF $(touch PWNED) `touch PWNED2` SECRET-ECHO-ONLY-FIXTURE`
- **WHEN** 分别在临时目录以 `node recorder.mjs record < <file>` 运行
- **THEN** 第一份退出码非 0，stderr 恰为 `jev-workflow-router recorder: invalid JSON input`，不新增记录；第二份退出码为 0；两次的 stdout、stderr 与记录文件都不含 `SECRET-ECHO-ONLY-FIXTURE`，临时目录中不存在 `PWNED` 或 `PWNED2`

#### Scenario: Routing is disabled
- **WHEN** 用户关闭该定制或执行安全清理
- **THEN** 新的 Jev 调用停止，既有标准 OpenSpec 与普通对话仍可用，并可按明确规则清理 shadow 记录
