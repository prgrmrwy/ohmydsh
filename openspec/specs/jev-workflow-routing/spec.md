# jev-workflow-routing Specification

## Purpose

定义 Jev 作为低成本结构化决策层，对日常开发请求是否需要 change 以及应采用何种既有社区流程给出可审计、可回退的推荐，而不让该推荐自行授权执行。

## Requirements

### Requirement: Workflow routing uses a closed set of unmodified community choices
系统 SHALL 只在以下闭集内推荐工作流：继续直接对话、仓库当前标准 OpenSpec `spec-driven`、未经本地改写的社区 Anvil、未经本地改写的 spec-superflow。系统 MUST NOT 为路由目的生成、fork 或静默修改一个个人混合 schema。

#### Scenario: A request reaches the workflow decision point
- **WHEN** 普通 vibe 对话出现是否需要 change 或应采用何种规划流程的决策点
- **THEN** 系统只在直接对话、标准 OpenSpec、Anvil 与 spec-superflow 中产生结构化推荐

#### Scenario: A community workflow is unavailable
- **WHEN** Anvil 或 spec-superflow 未安装、版本不受支持或健康检查失败
- **THEN** 系统不得推荐该候选为可执行路径，并 SHALL 保留标准 OpenSpec 作为可用回退

### Requirement: Deterministic authority precedes Jev judgment
用户显式选择和已有 change 的既定流程 SHALL 优先于 Jev 推荐。Jev 只能在尚无权威选择的普通对话决策点提供判断，MUST NOT 覆盖用户指令、改变现有 change 的 schema、降低既有门禁或授权写操作、依赖变更、外部副作用、合入、归档与清理。

#### Scenario: User explicitly chooses a workflow
- **WHEN** 用户明确要求标准 OpenSpec、Anvil、spec-superflow 或继续直接处理
- **THEN** 系统沿用该显式选择，且不以 Jev 结果替换它

#### Scenario: Work continues in an existing change
- **WHEN** 当前任务已经属于一个已创建的 OpenSpec 或 spec-superflow change
- **THEN** 系统沿用该 change 已记录的流程，不因新的 Jev 推荐切换控制平面

#### Scenario: Recommendation conflicts with a safety gate
- **WHEN** Jev 推荐较轻流程但现有安全、权限、Worktree Session、验证或合入规则要求更严格行为
- **THEN** 现有规则保持有效，Jev 推荐不得降级或绕过它们

### Requirement: Routing failures fail open to existing behavior and closed to new automation
缺失凭据、网络故障、超时、取消、限流、无效响应、未知候选、显式逃逸、低置信度或低胜者差距 SHALL 被视为未作出自动决定。系统 SHALL 在不阻塞普通对话的前提下维持接入前的标准行为，并 MUST NOT 把故障或不确定性解释为允许跳过 change。

#### Scenario: Jev is unavailable
- **WHEN** Jev 服务、凭据或 MCP 入口不可用
- **THEN** 普通对话和现有 OpenSpec 流程继续工作，且系统不产生可执行的自动路由结论

#### Scenario: Jev declines or is uncertain
- **WHEN** 返回 escape hatch、无效结构、低于阈值的置信度或不足的第一第二候选差值
- **THEN** 系统不输出候选建议、标记为需要人工/既有 Agent 判断，且不得静默选择 direct 或任何社区工作流

### Requirement: Routing evidence is bounded, private, and auditable
每条路由记录 SHALL 使用稳定且可迁移的版本结构，至少包含有界的样本 provenance、候选集合及版本、推荐候选、概率、置信度/差值、决策状态、调用时间、完整判断的 measured/unavailable 延迟状态、最终实际流程（若已知）、覆盖来源，以及实际处理该次调用的 Jev 服务方 `jevProvider`。provenance 只允许 `real-vibe`、`synthetic-fixture`、`unknown`。`jevProvider` 只允许 `typesafe`、`openrouter`、`unknown`。Agent SHALL 把每次 Jev 调用的有界投影以 `jevCalls`（至多 2 项）交给 recorder：成功调用为 `{outcome: "success", provider, semantic}`，其中 `provider` 取自结果 JSON 的 `provider` 字段，`semantic` 在结果无法完整解析、被截断、缺失或不符合 classify/decide 必需结构，或 classify 任一 `results[].status` / decide `recommendation.status` 为 `invalid_response` 时为 `invalid-response`；仅结果完整可解析且通过必需结构校验时为 `ok`；失败调用为 `{outcome: "error", message}`，`message` 截断到 512 字符。recorder SHALL 确定性计算，不读取 manifest、不猜测：
- **服务方**：成功调用取 `provider`（闭集外为 `unknown`）；失败调用只按锚定在开头的上游格式识别——`^OpenRouter decisions API ` 为 `openrouter`，`^TypeSafe API ` 为 `typesafe`，`^Jev provider (typesafe|openrouter):` 为对应值，否则为 `unknown`。两次调用中可识别的值一致或只有一个时取该值，冲突时为 `unknown`。
- **HTTP 状态**：只从锚定格式提取——`^OpenRouter decisions API (\d{3})\b`、`^TypeSafe API HTTP (\d{3})\b`、`^Jev provider \w+: .*\(HTTP (\d{3})\)$`；不在任意文本中搜索数字。
- **错误类别**：有失败调用时按首个失败调用归一化：状态 451 为 `region-blocked`，401/403 为 `unauthorized`，429 为 `rate-limited`，5xx 为 `provider-5xx`，其它状态为 `unknown`；无状态时，`^Jev request exceeded the \d+ms deadline` 或含 `timed out` / `timeout`（不区分大小写）为 `timeout`，含 `fetch failed`、`socket`、`ECONN`、`ENOTFOUND` 或 `network` 为 `network`，其余为 `unknown`。没有失败调用时，任一成功调用 `semantic` 为 `invalid-response` 则为 `malformed-response`；否则保留输入的 `errorCategory`（经闭集归一化；输入缺失时按现有规则为 `unknown`，因此 Agent 在调用全部成功时 SHALL 显式传 `errorCategory: none`），使 `missing-credential`、`cancelled`、`malformed-response` 等由 Agent 观察到的失败不会被改写为 `none`。`jevCalls` 缺失或形状不合法时视为未提供，`jevProvider` 为 `unknown`，`errorCategory` 取输入值。
`jevCalls` 与错误文本只用于上述计算，MUST NOT 持久化或出现在 recorder 的 stdout/stderr 中；stdin 不是合法 JSON 时，recorder SHALL 只输出固定诊断 `invalid JSON input` 并以非 0 退出，不回显输入片段。SKILL SHALL 要求 Agent 用文件写入工具把输入 JSON 写入临时文件，再以 `node recorder.mjs record < <file>` 传入，不得把工具输出文本拼入 shell 命令、heredoc 或命令参数。错误类别为闭集：`none`、`missing-credential`、`unauthorized`、`rate-limited`、`region-blocked`（服务方以 HTTP 451 拒绝出口地区）、`provider-5xx`、`network`、`timeout`、`cancelled`、`malformed-response`、`unknown`。系统 MUST NOT 记录、推断或按语言分类请求；provenance、latency 与 jevProvider 元数据 MUST NOT 被发送给 Jev。记录 MUST NOT 包含 API Key、凭据、完整会话历史、未裁剪附件、provider 原始错误体、不必要的源代码正文或自由文本摘要，并 SHALL 提供禁用与清理路径。报告 SHALL 提供按 `jevProvider` 拆分的 `real-vibe` 记录聚合（含 `unknown` 组，与其它 breakdowns 口径一致），并标明该拆分只覆盖可归属的记录、不是完整的服务可靠性；Phase 2 门槛计算不变。

#### Scenario: A routing sample is recorded
- **WHEN** 普通 Agent 在真实流程选择点调用 Jev 并获得可解析结果
- **THEN** 系统保存 `real-vibe` provenance、measured/unavailable latency 与 `jevProvider`，以及足以比较推荐与实际流程的有限证据，且不保存密钥、完整对话或语言分类

#### Scenario: A synthetic fixture is recorded
- **WHEN** 测试或明确的离线 fixture 产生路由记录
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

### Requirement: Advisory routing emits at most one non-blocking suggestion
到达工作流决策点时，系统 SHALL 至多给出一条中文非阻断建议，包含推荐候选、置信度与「可无视」说明；MUST NOT 以提问、选项卡片或要求用户确认的形式出现，MUST NOT 阻塞或延后后续步骤。用户已显式指定流程、或任务已属于一个既有 change 时，系统 SHALL 不给出建议且不发起任何 Jev 调用。

#### Scenario: 高置信度建议只出现一行
- **WHEN** 用户请求到达「直接处理还是开 change」的决策点，且 Jev 返回 confidence 0.77、margin 0.70 推荐 `formal-workflow`
- **THEN** 输出中出现一行中文建议，包含推荐候选与置信度，并明确说明可以无视；该行之后同一回合照常继续原有工作，不追加追问

#### Scenario: 用户显式指定流程时不调用 Jev
- **WHEN** 用户明确说「用 Anvil 做这个」或「直接改就行」
- **THEN** 系统沿用该选择，`mcp__jev__jev_classify` 与 `mcp__jev__jev_decide` 的调用次数为 0，输出中不含任何建议行

#### Scenario: 已有 change 沿用既定控制平面
- **WHEN** 当前任务已属于一个已创建的 OpenSpec 或 spec-superflow change
- **THEN** 系统的 Jev 调用次数为 0，不输出建议行，也不改变该 change 的 schema

#### Scenario: 建议不产生副作用
- **WHEN** Jev 给出高置信度推荐
- **THEN** 不创建 change、不选择或切换 schema、不调用 `ssf`、不修改任何文件、不授权任何工具，记录文件是唯一被写入的本地产物

### Requirement: Advisory uncertainty and failures stay silent and never reroute
低置信度、胜者差距不足、escape hatch、无效响应、超时、取消、限流或缺失凭据时，系统 SHALL 不输出候选建议，继续沿既有确定性规则推进；MUST NOT 把失败或不确定性解释为选择 `direct` 或跳过 change 的许可，也 MUST NOT 因 Jev 不可用而阻塞普通对话。

#### Scenario: Jev 不可用时静默继续
- **WHEN** Jev MCP 未提供工具、凭据缺失或调用超时
- **THEN** 输出中不出现建议行，当前任务按既有规则继续，记录该次调用失败类别与 `jevProvider: unknown`

#### Scenario: 低置信度不出建议
- **WHEN** classify 返回 confidence 0.45、margin 0.37
- **THEN** 不输出候选建议，任务按确定性规则继续，该次判断以 `needs-review` 状态记录

### Requirement: Advisory latency comes from session event timestamps
每次 advisory 判断的延迟 SHALL 由会话事件日志中对应 Jev 工具调用的 `tool/call` 与 `tool/result` 时间戳之差得出，并以一次判断内各次调用之和作为完整序列延迟；MUST NOT 以 agent 自身两次模型步骤之间的墙钟差充当 Jev 延迟，也 MUST NOT 对超出任何存储上限的值静默截断。

#### Scenario: 两次调用相加
- **WHEN** 一次判断依次调用 classify 与 decide，日志时间戳得出 1801ms 与 1700ms
- **THEN** 记录的序列延迟为 3501ms，且 `availability` 为 `measured`

#### Scenario: 日志不可解码
- **WHEN** 会话日志缺失、损坏或无法完整解码
- **THEN** 记录的延迟为 `{availability: "unavailable", milliseconds: null}` 并给出可操作原因，不写入猜测值

#### Scenario: 超长样本不被静默压平
- **WHEN** 实测序列延迟为 80057ms
- **THEN** 存储值与报告保留 80057ms，不出现 60000ms 这类无标识截断

### Requirement: Reports expose continuous health instead of an unreachable admission gate
报告 SHALL 提供调用失败率、建议与实际路径不一致率、以及真实样本延迟 p50/p95 三项持续指标；MUST NOT 再以 100 条带标签样本、≥10 个工作日、每条路线 ≥15 条或每类高危 ≥10 条的覆盖门槛阻塞 advisory。零样本时报告 SHALL 明确标注样本不足，但 advisory 照常工作。

#### Scenario: 零样本下 advisory 仍可用
- **WHEN** 记录文件不存在或为空
- **THEN** 报告的三项指标显示为样本不足，advisory 行为不受影响

#### Scenario: 指标可计算
- **WHEN** 存在 10 条 `real-vibe` 记录，其中 1 条调用失败、2 条建议与实际路径不同
- **THEN** 报告给出失败率 0.1、不一致率 0.2 与基于 9 条实测样本的 p50/p95

### Requirement: Anything beyond one-off advice needs a separate approved change
超出「一次性非阻断建议」的任何自动化 SHALL 仍需单独 OpenSpec change 与用户显式批准，包括自动创建 change、自动选择或切换 schema、自动调用 `ssf`、改写既有 change 的控制平面、或依据高置信度触发实施；此类行为 MUST NOT 由本能力累积的指标、置信度或默认配置自动开启。

#### Scenario: 高置信度不授予执行权
- **WHEN** Jev 建议 `anvil` 且 confidence 为 0.95
- **THEN** 系统仍只输出一行建议，实际流程由用户或既有确定性规则决定

#### Scenario: 无批准不启用自动化
- **WHEN** 未存在单独批准的自动化 change
- **THEN** 任何自动建 change、切 schema、调用 `ssf` 的路径都不可达
