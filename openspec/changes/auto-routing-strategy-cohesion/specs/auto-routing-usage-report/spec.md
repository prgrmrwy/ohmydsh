## MODIFIED Requirements

### Requirement: 输出白名单与错误不回显
报告 SHALL 只以 JSON 输出到 stdout，且只包含以下内容：provider、model、effort、分组标识（见「分组与用量字段」）、depth、反馈类别、计数、token 字段数值及其出现次数、时间范围与时区、固定的失败类别名、`conclusion`，以及由固定标识组成的 `caveats`。报告 MUST NOT 包含任何会话标识。所有异常 SHALL 只映射为固定类别（`decode-failed`、`tail-incomplete`、`parse-failed`、`missing-log`）并计数；MUST NOT 输出异常消息、文件路径、工作区名或任何日志行内容。

#### Scenario: 损坏数据中的正文与路径不泄漏
- **GIVEN** 测试 `DSH_HOME` 中一个会话位于工作区 `/tmp/secret-ws`，其用户消息含 `SECRET-TEXT`；账本中有一行半截 JSON，片段含 `SECRET-TEXT`；另一个会话的中间帧损坏
- **WHEN** 运行报告
- **THEN** stdout 与 stderr 都不含 `SECRET-TEXT`、`secret-ws` 或任何 sessionId 片段；`parse-failed` 与 `decode-failed` 计数均为 1

### Requirement: 账本关联
分配绑定 SHALL 通过插件已有的反馈账本读取逻辑（`FeedbackBook`）获取，与运行时的“首个绑定不可替换、按追加顺序折叠反馈”语义一致，不另行实现。会话日志中的每次调用 SHALL 按 `(sessionId, messageId)` 查找绑定；决策单位为 `(sessionId, decisionId)`，其用量是全部已关联调用 usage 之和。

历史账本 `judgements.jsonl` SHALL 只读取 `(sessionId, turn)`，用于确定每个会话的首个 AUTO 记录位置；本报告不统计其中的用量与标注，也不提供其它统计入口。

#### Scenario: 只计已绑定消息
- **GIVEN** 某决策生效后有 31 次调用，其中 12 条 messageId 在账本中
- **WHEN** 汇总该决策
- **THEN** 决策数为 1，关联调用数为 12，用量为这 12 次调用之和

#### Scenario: 同一决策跨多个请求
- **GIVEN** 一个决策在 requestSeq 274 下绑定 6 条消息，在 requestSeq 512 下绑定 11 条
- **WHEN** 汇总
- **THEN** 该决策关联 17 次调用

### Requirement: 分组与用量字段
绑定 SHALL 按分组标识分组：快照含 `strategy` 时为该策略家族 id；快照只有历史字段时为 `<policyVersion>/<mappingVersion>`（原样保留，标记为历史组）；无快照时为 `unknown`。报告输出 MUST NOT 含 `schema` 或其它版本键。每组下的比较子组为“实际模型 × depth”，子组下按实际 effort 列行。每个比较子组 SHALL 列出：决策数、会话数、关联调用数、每决策调用数的中位数与最大值，以及 `inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens` 各自的总和、每调用均值和出现次数/调用数。均值只基于出现该字段的调用计算；从未出现的字段为 `null`。不同字段 MUST NOT 相加或换算为费用。`caveats` SHALL 固定包含：不同 provider 的 token 口径可能不同，不得跨模型比较。

#### Scenario: 缺失字段与部分出现
- **GIVEN** 某子组 308 次调用中有 264 次带 `cacheWriteTokens`，所有调用都没有 `reasoningTokens`
- **WHEN** 生成报告
- **THEN** `cacheWriteTokens` 的出现次数为 264/308，均值以 264 为分母；`reasoningTokens` 为 `null`

#### Scenario: 缺快照记录独立成组
- **GIVEN** 33 条无快照的绑定、191 条快照为 `{policyVersion: "policy-v2-d774ffe6", mappingVersion: "capability-slots-2-magpie"}` 的绑定，以及 12 条快照含 `strategy: "claude"` 的绑定
- **WHEN** 生成报告
- **THEN** 三者分属 `unknown`、`policy-v2-d774ffe6/capability-slots-2-magpie`（标记为历史组）与 `claude` 三组；报告顶层不含 `schema` 键

### Requirement: 覆盖与可见性
报告 SHALL 输出以下三项计数：
- 无记录回合：在有分配绑定（反馈账本中的绑定行，不论带历史版本字段还是不带版本字段）的会话中，从首条绑定所在用户回合开始，有 assistant 调用但没有任何已关联调用的用户回合数，以及参与统计的用户回合总数。
- 未关联绑定：账本中存在、但在日志中找不到对应调用的绑定行数。
- 当前为 AUTO 但两个账本（反馈账本与历史四档判档账本 `judgements.jsonl`）都无记录的会话数：读取状态文件的 `mode`，并用文件名（sessionId 的 sha256）与账本中的 sessionId 比对得出。

`caveats` SHALL 固定说明：账本只记录实际应用的决策，判断失败、MANUAL 或推荐未应用的回合不会产生记录，因此已统计的决策可能是 AUTO 回合中的非随机子集；模式切换历史未持久化，会话计数只是粗略参考。

#### Scenario: 无请求头的缺口回合可见
- **GIVEN** 某会话首条分配绑定之后有 17 个用户回合，其中 10 个有已关联调用，另有 7 个回合既无请求头也无记录
- **WHEN** 生成报告
- **THEN** 无记录回合为 7，参与统计的用户回合为 17

#### Scenario: 无记录的 AUTO 会话
- **GIVEN** 4 个状态文件为 AUTO，其中 1 个对应的会话在两个账本中都无记录
- **WHEN** 生成报告
- **THEN** 当前为 AUTO 但无记录的会话数为 1

#### Scenario: 不带版本字段的绑定同样计入覆盖
- **GIVEN** 与「无请求头的缺口回合可见」相同的会话与回合，但全部绑定快照只含 `strategy: "claude"`，不含任何版本字段
- **WHEN** 生成报告
- **THEN** 无记录回合为 7，参与统计的用户回合为 17

### Requirement: 前后 effort 起点参照
报告 SHALL 在独立字段 `referenceBeforeAuto` 中，为每个有记录的会话以两个账本中最早一条记录所在回合为分界：历史四档判档账本取其 turn，分配绑定（不论是否带历史版本字段）取首个关联调用所在回合。分界之前的根会话调用 SHALL 按实际模型列出调用数、会话数和实际 effort 分布，并与 AUTO 期间同一模型的 effort 分布并列。该字段 MUST NOT 包含 token 数值或差异百分比，MUST NOT 标注为 MANUAL，并 SHALL 在 `caveats` 中说明它只用于观察 effort 起点变化，存在位置效应、任务混合与模型切换等混杂。没有参照调用时，该字段为空数组。

#### Scenario: 旧版 AUTO 回合不算作参照
- **GIVEN** 某会话第 1–40 回合有历史四档判档记录，第 58 回合起有分配绑定
- **WHEN** 生成报告
- **THEN** 该会话的分界是第 1 回合，没有任何调用进入 `referenceBeforeAuto`

#### Scenario: 参照只含 effort 分布
- **GIVEN** 某会话第 1–5 回合无记录，第 6 回合起有分配绑定
- **WHEN** 生成报告
- **THEN** `referenceBeforeAuto` 列出第 1–5 回合的调用数与 effort 分布，不含 token 字段

#### Scenario: 不带版本字段的绑定确定同一分界
- **GIVEN** 与「参照只含 effort 分布」相同的会话，但第 6 回合起的绑定快照只含 `strategy: "codex"`
- **WHEN** 生成报告
- **THEN** `referenceBeforeAuto` 与带历史版本字段时的结果深度相等
