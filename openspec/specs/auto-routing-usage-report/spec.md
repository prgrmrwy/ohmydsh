# auto-routing-usage-report Specification

## Purpose

为 auto-model-routing 提供按需、只读的用量与判断观察报告：将 policy-v2 账本记录按消息关联到会话的实际 usage，按策略版本、depth 和模型分组，并固定说明覆盖缺口、统计范围与因果局限，让用户在使用一段时间后能看清 AUTO 期间实际发生了什么。

## Requirements

### Requirement: 按需调用边界
插件 SHALL 随包提供 skill `auto-model-routing-report`，并与插件一同安装和禁用。skill 的目录描述和正文 SHALL 写明触发限定：只有用户明确要求评估 AUTO 效果、观察 AUTO 用量，或点名该 skill 时才使用；MUST NOT 因会话处于 AUTO、普通 token 问题、路由判断或日常任务而主动执行，也 MUST NOT 创建定时任务或后台采集。skill SHALL 要求 agent 转述报告时保留 `conclusion` 与 `caveats` 字段的含义；把报告原文贴到当前会话之外前，SHALL 先请用户确认。上述要求是对 agent 的调用约束，不是权限层门禁，只能通过检查 skill 文案来验证。

#### Scenario: skill 文案含触发限定
- **WHEN** 读取已发布包内该 skill 的 frontmatter description 与正文
- **THEN** 两处都包含“仅当用户明确要求”的限定，以及“不得主动执行或创建定时任务”的禁止语句

### Requirement: 绝对只读与访问范围
统计入口 SHALL 只读取以下内容：`$DSH_HOME/state/auto-model-routing/` 下的两个账本及会话状态文件（只用其 `mode`），以及 `$DSH_HOME/sessions/` 下的会话日志。它 MUST NOT 写入任何文件、启动子进程、联网或调用模型，也 MUST NOT 访问 `$DSH_HOME`、自身包目录及其运行时依赖以外的路径。`$DSH_HOME` 未设置时 SHALL 回退到 `~/.dsh`。

#### Scenario: 权限受限下正常运行
- **WHEN** 在 `node --permission` 下仅授予测试 `DSH_HOME`、包目录及其运行时依赖目录的读权限，不授予写权限和子进程权限，然后运行
- **THEN** 报告正常生成，退出码为 0；测试 `DSH_HOME` 下所有文件在运行前后的字节内容不变

#### Scenario: 默认 DSH_HOME
- **WHEN** 未设置 `DSH_HOME`，且 `HOME` 指向一个含 `.dsh` 测试数据的临时目录
- **THEN** 读取该目录中 `.dsh` 下的数据

#### Scenario: 源码无出站能力
- **WHEN** 静态扫描统计入口源码
- **THEN** 不出现 `node:http`、`node:https`、`node:net`、`node:dns`、`node:child_process`、`fetch(`，也不出现任何写文件 API

### Requirement: 输出白名单与错误不回显
报告 SHALL 只以 JSON 输出到 stdout，且只包含以下内容：provider、model、effort、policyVersion、mappingVersion、depth、反馈类别、计数、token 字段数值及其出现次数、时间范围与时区、固定的失败类别名、`conclusion`，以及由固定标识组成的 `caveats`。报告 MUST NOT 包含任何会话标识。所有异常 SHALL 只映射为固定类别（`decode-failed`、`tail-incomplete`、`parse-failed`、`missing-log`）并计数；MUST NOT 输出异常消息、文件路径、工作区名或任何日志行内容。

#### Scenario: 损坏数据中的正文与路径不泄漏
- **GIVEN** 测试 `DSH_HOME` 中一个会话位于工作区 `/tmp/secret-ws`，其用户消息含 `SECRET-TEXT`；账本中有一行半截 JSON，片段含 `SECRET-TEXT`；另一个会话的中间帧损坏
- **WHEN** 运行报告
- **THEN** stdout 与 stderr 都不含 `SECRET-TEXT`、`secret-ws` 或任何 sessionId 片段；`parse-failed` 与 `decode-failed` 计数均为 1

### Requirement: 会话日志读取
会话日志 SHALL 以 magic `28 b5 2f fd` 切分为若干段，并逐段解码后拼接。只有最后一段解码失败时，SHALL 保留前面各段并计一次 `tail-incomplete`；其它任何一段失败时，整个会话计为 `decode-failed`，不贡献任何数据。只有 `surfaceOp` 缺失、为字符串 `"append"`，或为 `op === "append"` 的对象的 `assistant/message`，才 SHALL 计为一次模型调用；其它形态 MUST NOT 计入。同一会话内 SHALL 按 `message.id` 去重。

#### Scenario: 多帧完整读取
- **GIVEN** 一个由 3 个 zstd 帧组成的会话日志，后两帧各含 2 条带 usage 的 append 消息
- **WHEN** 读取该会话
- **THEN** 统计到 4 次调用

#### Scenario: 活动会话尾帧不完整
- **GIVEN** 一个会话的最后一帧被截去 5 字节，前面的帧含 6 次调用
- **WHEN** 运行报告
- **THEN** 该会话统计到 6 次调用，`tail-incomplete` 为 1，`decode-failed` 为 0

#### Scenario: 中间帧损坏
- **GIVEN** 一个会话共 5 帧，第 3 帧内容被破坏
- **WHEN** 运行报告
- **THEN** `decode-failed` 为 1，该会话不贡献任何调用

#### Scenario: 非 append 与会话内重复不计
- **GIVEN** 同一会话中有两次 `surfaceOp: "append"` 调用、一条 `surfaceOp: {op: "replace"}` 的 assistant 消息，以及一次与第一条 `message.id` 相同的 append 调用
- **WHEN** 汇总
- **THEN** 只计 2 次调用

### Requirement: 统计范围与会话筛选
报告 SHALL 只统计根会话（会话头无 `origin`）中 `isSeeded` 不为 true 的会话里的 assistant 调用；子会话与 seeded 会话 SHALL 排除，并分别计数。`caveats` SHALL 固定包含范围声明：不含子会话、压缩摘要、标题生成、Jev 判档和失败重试的用量，因此不能据此得出“节省”结论。

#### Scenario: 子会话与 seeded 会话被排除
- **GIVEN** 测试数据含 1 个根会话、2 个子会话和 1 个 seeded 会话，且全部在账本中有记录
- **WHEN** 生成报告
- **THEN** 只统计根会话的用量；排除计数为子会话 2、seeded 1；`caveats` 含范围声明

### Requirement: 回合、时间与时间范围
回合号 SHALL 取自会话日志中的 `turn/start` 与 assistant 消息的 `data.turn`；时间 SHALL 取自日志事件自带的 `time`。“用户回合”是指 `turn/start` 之后存在 `source.kind === "user"` 的 `user/message` 的回合。`--since` 接受 `YYYY-MM-DD`，按运行进程的本地时区解释为该日 00:00 起（含）；不提供结束时间参数。决策单位 SHALL 按其首次关联调用的时间整体归属，单位内的调用不拆分；反馈随所属决策归属。报告 SHALL 输出实际使用的起始时间与时区偏移。

#### Scenario: 跨边界的决策整体归属
- **GIVEN** 时区为 Asia/Shanghai；某决策首次关联调用在 2026-10-24 23:50，其余调用在 2026-10-25 00:10
- **WHEN** 以 `--since 2026-10-25` 运行
- **THEN** 该决策及其全部调用都不计入；报告的起始时间为 `2026-10-25T00:00:00+08:00`

### Requirement: 账本关联
policy-v2 绑定 SHALL 通过插件已有的反馈账本读取逻辑（`FeedbackBook`）获取，与运行时的“首个绑定不可替换、按追加顺序折叠反馈”语义一致，不另行实现。会话日志中的每次调用 SHALL 按 `(sessionId, messageId)` 查找绑定；决策单位为 `(sessionId, decisionId)`，其用量是全部已关联调用 usage 之和。

legacy 账本 `judgements.jsonl` SHALL 只读取 `(sessionId, turn)`，用于确定每个会话的首个 AUTO 记录位置；本报告不统计 legacy 的用量与标注，legacy 时期的判断统计沿用 `scripts/label-report.mjs`。

#### Scenario: 只计已绑定消息
- **GIVEN** 某决策生效后有 31 次调用，其中 12 条 messageId 在账本中
- **WHEN** 汇总该决策
- **THEN** 决策数为 1，关联调用数为 12，用量为这 12 次调用之和

#### Scenario: 同一决策跨多个请求
- **GIVEN** 一个决策在 requestSeq 274 下绑定 6 条消息，在 requestSeq 512 下绑定 11 条
- **WHEN** 汇总
- **THEN** 该决策关联 17 次调用

### Requirement: 分组与用量字段
policy-v2 SHALL 按 snapshot 中的 `policyVersion`/`mappingVersion` 分组；无 snapshot 的绑定归入“版本未知”组。每个版本组下的比较子组为“实际模型 × depth”，子组下按实际 effort 列行。每个比较子组 SHALL 列出：决策数、会话数、关联调用数、每决策调用数的中位数与最大值，以及 `inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens` 各自的总和、每调用均值和出现次数/调用数。均值只基于出现该字段的调用计算；从未出现的字段为 `null`。不同字段 MUST NOT 相加或换算为费用。`caveats` SHALL 固定包含：不同 provider 的 token 口径可能不同，不得跨模型比较。

#### Scenario: 缺失字段与部分出现
- **GIVEN** 某子组 308 次调用中有 264 次带 `cacheWriteTokens`，所有调用都没有 `reasoningTokens`
- **WHEN** 生成报告
- **THEN** `cacheWriteTokens` 的出现次数为 264/308，均值以 264 为分母；`reasoningTokens` 为 `null`

#### Scenario: 缺快照记录独立成组
- **GIVEN** 33 条无 snapshot 的绑定与 191 条 `policy-v2-d774ffe6` 绑定
- **WHEN** 生成报告
- **THEN** 两者分属“版本未知”和 `policy-v2-d774ffe6` 组

### Requirement: 覆盖与可见性
报告 SHALL 输出以下三项计数：
- 无记录回合：在有 policy-v2 记录的会话中，从首条记录所在用户回合开始，有 assistant 调用但没有任何已关联调用的用户回合数，以及参与统计的用户回合总数。
- 未关联绑定：账本中存在、但在日志中找不到对应调用的绑定行数。
- 当前为 AUTO 但两个账本都无记录的会话数：读取状态文件的 `mode`，并用文件名（sessionId 的 sha256）与账本中的 sessionId 比对得出。

`caveats` SHALL 固定说明：账本只记录实际应用的决策，判档失败、MANUAL 或推荐未应用的回合不会产生记录，因此已统计的决策可能是 AUTO 回合中的非随机子集；模式切换历史未持久化，会话计数只是粗略参考。

#### Scenario: 无请求头的缺口回合可见
- **GIVEN** 某会话首条 policy-v2 记录之后有 17 个用户回合，其中 10 个有已关联调用，另有 7 个回合既无请求头也无记录
- **WHEN** 生成报告
- **THEN** 无记录回合为 7，参与统计的用户回合为 17

#### Scenario: 无记录的 AUTO 会话
- **GIVEN** 4 个状态文件为 AUTO，其中 1 个对应的会话在两个账本中都无记录
- **WHEN** 生成报告
- **THEN** 当前为 AUTO 但无记录的会话数为 1

### Requirement: 前后 effort 起点参照
报告 SHALL 在独立字段 `referenceBeforeAuto` 中，为每个有记录的会话以两个账本中最早一条记录所在回合为分界：legacy 取其 turn，policy-v2 取首个关联调用所在回合。分界之前的根会话调用 SHALL 按实际模型列出调用数、会话数和实际 effort 分布，并与 AUTO 期间同一模型的 effort 分布并列。该字段 MUST NOT 包含 token 数值或差异百分比，MUST NOT 标注为 MANUAL，并 SHALL 在 `caveats` 中说明它只用于观察 effort 起点变化，存在位置效应、任务混合与模型切换等混杂。没有参照调用时，该字段为空数组。

#### Scenario: 旧版 AUTO 回合不算作参照
- **GIVEN** 某会话第 1–40 回合有 legacy 记录，第 58 回合起有 policy-v2 记录
- **WHEN** 生成报告
- **THEN** 该会话的分界是第 1 回合，没有任何调用进入 `referenceBeforeAuto`

#### Scenario: 参照只含 effort 分布
- **GIVEN** 某会话第 1–5 回合无记录，第 6 回合起有 policy-v2 记录
- **WHEN** 生成报告
- **THEN** `referenceBeforeAuto` 列出第 1–5 回合的调用数与 effort 分布，不含 token 字段

### Requirement: 样本门槛与结论
每个比较子组只有在“至少 20 个决策且来自至少 3 个不同会话”时，`conclusion` 才可为 `observed`；否则 SHALL 为 `insufficient-sample`，但数字仍照常输出。报告 MUST NOT 输出节省比例、“质量不变”或因果判断，`caveats` SHALL 固定说明：这是观察数据，不是受控对照，不能替代 `auto-routing-policy-and-enforcement` 任务 4.3。

#### Scenario: 聚集样本不足
- **GIVEN** 某子组有 25 个决策，但全部来自 2 个会话
- **WHEN** 生成报告
- **THEN** 该子组 `conclusion` 为 `insufficient-sample`

### Requirement: 人工反馈统计
每个决策的反馈 SHALL 由其已关联消息在 `FeedbackBook` 中查得的反馈值汇总，分别计数合适、偏高、偏低和无法判断。同一决策的多条消息有效评价不一致时，计为“冲突”；没有任何有效评价时，计为“未评价”（含撤销后为 `null` 的情况）。冲突与未评价 MUST NOT 计为合适。反馈 SHALL 按实际模型 × depth 分组。

#### Scenario: 冲突与未评价
- **GIVEN** 决策 D1 的两条消息分别评价为合适和偏高；决策 D2 评价后被撤销；决策 D3 从未评价
- **WHEN** 汇总
- **THEN** 冲突为 1，未评价为 2，合适为 0

### Requirement: 自包含分发
统计入口 SHALL 作为插件源码的一部分，构建进 `lib/` 后随包发布；它只依赖 Node 内置模块和插件已声明的运行时依赖，不依赖系统命令，也不引用插件包外的文件。

#### Scenario: 发布包包含入口与 skill
- **WHEN** 检查 `npm pack --dry-run` 输出
- **THEN** 包含 `lib/usage-report.js` 与 `skills/auto-model-routing-report/SKILL.md`

### Requirement: 隐式信号分布
报告 SHALL 从已读取的会话日志中推导每个决策单位的两项事实：
- 决策所在回合：决策最后一次关联调用**实际所在**的回合（不是其归属的用户回合；被子会话结果、定时提醒等唤醒的后续回合也算）。
- 回合结束类别：决策所在回合的 `turn/end` 原因，映射为 `completed`、`aborted-user`（取消原因为用户）、`aborted-other`、`blocked`、`other`；该回合没有 `turn/end`（会话仍在进行或日志尾段不完整）时为 `unknown`。
- 继续：决策所在回合之后同一会话存在由用户发起的新回合；第一个这样的回合的开始时间记为“继续时间”。
- 有效曝光：账本中存在曝光事实，且其时间早于继续时间；没有继续时，任何曝光都有效。晚于继续时间的曝光（例如事后翻看旧会话）SHALL 视为无曝光。

结合有效曝光与账本中的切换 MANUAL 事实，报告 SHALL 在每个比较子组下输出 `implicit` 字段，把每个决策单位按以下优先级归入且只归入一类：
1. `explicit`：存在有效显式评价（撤销后为空的不算），并按评价值细分计数。
2. `negative`：回合结束类别为 `aborted-user`，或存在切换 MANUAL 事实；分别计数，同时满足时只计入总数一次。
3. `implicit-ok`：有有效曝光、结束类别为 `completed`、已继续，且无负向事实。
4. `inconclusive`：有有效曝光但不满足上一类（未继续、结束类别未知或其它非负向类别）。
5. `unobserved`：没有有效曝光。

五类计数之和 SHALL 等于该子组的决策数。报告 SHALL 另外输出“有效曝光且有显式评价”的决策中各评价值的计数，作为隐式口径的参照。`caveats` SHALL 固定包含：`implicit-ok` 只表示用户看过且未干预，不等于分配合适；曝光判定依赖页面可见性，不代表用户读过内容；曝光事实上线之前的决策全部归为 `unobserved`；继续之后才发生的曝光不计入。报告仍 MUST 遵守既有的只读、输出白名单与不回显要求，新增字段只包含类别名与计数。

#### Scenario: 五类互斥归类
- **GIVEN** 某子组 6 个决策：一个有显式“偏高”且回合被用户中止；一个被用户中止；一个曝光、完成、继续；一个曝光、完成但之后没有用户回合；一个无曝光；一个曝光、完成、继续但记录了切换 MANUAL
- **WHEN** 生成报告
- **THEN** `explicit` 为 1（too-high 1）、`negative` 为 2、`implicit-ok` 为 1、`inconclusive` 为 1、`unobserved` 为 1，合计 6

#### Scenario: 父会话取消不算负向
- **GIVEN** 某决策曝光且已继续，其回合的 `turn/end` 为 aborted 且取消原因为 parent
- **WHEN** 生成报告
- **THEN** 该决策归入 `inconclusive`，不计入 `negative`

#### Scenario: 日志尾段不完整
- **GIVEN** 某决策曝光，其所在回合位于日志被截断的尾段，没有 `turn/end`
- **WHEN** 生成报告
- **THEN** 该决策归入 `inconclusive`，`tail-incomplete` 照常计数

#### Scenario: 事后翻看不算看过
- **GIVEN** 某决策回合完成，用户在下一回合继续，之后才记录了该决策的曝光
- **WHEN** 生成报告
- **THEN** 该决策归入 `unobserved`，不计入 `implicit-ok`

#### Scenario: 后续非用户回合被中止
- **GIVEN** 某决策的用户回合正常结束，子会话结果唤醒了一个新回合并沿用该决策，用户中止了这个新回合
- **WHEN** 生成报告
- **THEN** 该决策的结束类别为 `aborted-user`，归入 `negative`

#### Scenario: 旧数据不被当作看过
- **GIVEN** 账本只含本变更之前的绑定与显式反馈
- **WHEN** 生成报告
- **THEN** 无显式评价的决策全部归入 `unobserved`，`implicit-ok` 为 0，`caveats` 含隐式说明

#### Scenario: 新字段不泄漏
- **GIVEN** 测试数据的会话含正文 `SECRET-TEXT`，并带有隐式事实事件
- **WHEN** 生成报告
- **THEN** 输出不含 `SECRET-TEXT` 或任何 sessionId 片段，`implicit` 只含类别名与计数
