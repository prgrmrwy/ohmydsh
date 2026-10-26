# Review: auto-routing-usage-report
ROUND: 1
REVIEWER: claude-opus-5-5
VERDICT: REVISE

范围：只读评审 proposal / spec / design / tasks；对照 `src/policy-host.ts`、`src/feedback.ts`、`src/judgements.ts`、`docs/feedback-evaluation.md`、主 spec 前 40 行；并只读抽查本机 `allocation-feedback.jsonl`（抽查时 267 行、16 个决策，账本仍在增长）、`judgements.jsonl`（152 行）、`state/auto-model-routing/sessions/*.json`，以及 `session-f0db3c96`（11538 行、1948 次 append 调用）与 `session-9552b479` 两个会话日志。均用 `zstd -dc` 解出，未转储消息正文。下文数字都来自这次抽查，仅在本机、当前 DSH 版本成立。

总体判断：方向合理，只读脚本加按需 skill 的形态没问题。但 spec 里"怎样把用量归给决策"和"怎样估覆盖缺口"这两条，在真实数据上会给出偏离事实的数字，并且是朝"看起来覆盖更好、用量更干净"的方向偏。前后对比的基线设计也有结构性混杂，现有措辞约束只能在结论层面弥补一部分。以下 3 个 Critical 需要先改 spec。

## Findings

### [Critical] 覆盖缺口估计的定义会漏掉最常见的缺口
- 位置：spec.md「覆盖与起点说明」；design.md D3「覆盖缺口」
- 问题：缺口被定义为"有 `request/header` 但没有任何记录的用户回合"。但 `policy-host.ts` 的绑定条件是：回合开始时 `applied.delete`，只有该回合内出现 `request/header` 且实际配置与推荐一致，才 `applied.set` 并在之后的 `assistant/message` 上 `feedback.bind`（L162–195）。也就是说没有 header 的回合不会产生记录。按 spec 的定义，这类回合恰好被排除在缺口之外，估计值会趋近 0，却被标成"上限估计"，读者会以为覆盖很好。
- 证据：`session-f0db3c96` 在 policy-v2 区间（turn 58–74，共 17 个有调用的回合）里：
  - 无 header 且无记录的回合有 7 个：T61、T62、T67、T69、T71、T72、T73，合计 110 次调用。
  - 有 header 但无记录的回合是 0 个；T68、T70 只是部分调用没有绑定（4 和 3 次）。
  - 整个会话 74 个回合中只有 49 个出现过 `request/header`，header 的 `reason` 只有 initial、change、series、resume，每回合并不都有。
  - 按 spec 的定义，上述缺口估计为 0，真实缺口是 7/17 个回合。
- 建议：
  - 把缺口定义为"首条记录之后，含用户输入（`turn/start` 之后 `user/message` 的 `source.kind==='user'`）、有 assistant append 调用、但没有任何已绑定 messageId 的回合"，不依赖 header。
  - 同时报告"部分回合未绑定调用数"（T68、T70 这类）。
  - 把"policy-v2 只记录实际应用的决策"改写成：只有回合内出现匹配的 `request/header` 才产生记录；没有 header 的回合不产生记录，其原因（推荐与当前配置相同、判档失败等）无法从账本区分。
  - 因此 policy-v2 组很可能是 AUTO 全部回合的非随机子集（偏向配置发生变化或续接的回合），这一点必须写进固定提示语。

### [Critical] 用量归属窗口与账本实际绑定不一致：既多计，又漏计
- 位置：design.md D3「policy-v2」；spec.md「用量关联」
- 问题：
  1. "requestSeq 之后到下一个 request/header 前的 append 调用归入该决策"会把没有被绑定的调用归入决策。绑定的是具体 messageId，窗口里的调用并不都在账本里。
  2. "同一 `(sessionId, decisionId)` 取第一条带 snapshot 的行"只取到第一个 requestSeq。但同一决策会在多个 header 下重复"应用"，每个 header 都会产生新的 `requestSeq`。
  3. 账本每行已带 `messageId`，会话日志里 `assistant/message.data.message.id` 无重复，可以直接精确连接，不需要窗口启发式。
- 证据：
  - 窗口多计：`session-f0db3c96` 的 3 个决策窗口里，窗口内 append 调用数与账本绑定数分别为 31 对 12、26 对 13、71 对 38。三个窗口合计 128 次调用，其中 65 次不在账本里。
  - 首个 snapshot 漏掉后续窗口：本机 16 个决策里有 3 个含多个 `requestSeq`。例如决策 `…635` 的窗口是 83、6、12 条绑定；`…639` 是 2 和 38；另一个决策（session-9552b479）是 6 和 11。按 spec 只取首个 snapshot，会漏掉后面的窗口，或把它们当成别的东西。
  - 精确连接可行：本机 f0 与 9552 两个会话里，账本 messageId 在日志 append 窗口中缺失数为 0（均为 0），同一决策内 model/effort/depth 不变（0 个决策有变化）。
  - 设计中"已验证 11 个带快照决策全部一致"已过时，现在是 234 行带快照，且已出现多 requestSeq 的情形。
- 建议：
  - policy-v2 的用量归属改为按 `(sessionId, messageId)` 精确连接：账本每个 messageId 对应日志里的一次 append 调用，用量取该消息的 `usage`。
  - header 只用于校验实际配置：用 `requestSeq` 找 header，核对 provider/model/effort，校验失败则该行计入"未关联"。
  - 计数单位仍是决策，但决策的用量是其所有已绑定消息之和，而不是"窗口"。
  - 窗口规则只保留一个用途：为未绑定的调用（缺口回合、首次记录前）推断"当时生效的配置"，即该调用之前最近一个 header 的 config。这是因为 header 只在配置变化、series、resume 时出现，不是每回合一个。
  - spec 场景"同一决策绑定 9 条消息只算一次"目前含义含糊，应改成可判定的断言：该决策关联 9 次调用，用量为这 9 次之和，决策数为 1。

### [Critical] "首次 AUTO 记录前 vs AUTO 期间"的对比设计有结构性混杂，且本机几乎没有可用的前期样本
- 位置：spec.md「策略分组与计数单位」「覆盖缺口与起点说明」；design.md D3
- 问题：
  1. 前期组定义为同一会话首个有记录回合之前的回合，天然就是"会话较早阶段"。上下文随会话增长，`inputTokens`、`cacheReadTokens` 随之上升，且中途会发生 compaction。早期回合的输入用量系统性偏低。AUTO 期间的回合在时间上更靠后，输入更高。两组的差异里混有位置效应，且方向偏不利于 AUTO，同样的混杂也能在相反方向制造"节省"的假象，取决于模型和 compaction 位置。
  2. 任务混合、模型切换、`effortCap`、`mappingVersion`、模型选择器变化、goal 续跑回合比例也会改变用量，而现有措辞约束只列了"起点差异"一项混杂。
  3. 本机数据里这个前期组几乎是空的：28 个 legacy 会话中 23 个首条记录就是 turn 1，只有 5 个会话（首记录回合 2、15、72、81、105）有前期回合；`session-f0db3c96` 的 legacy 覆盖 turn 1–40（未覆盖 7、8、9、11 等 goal 续跑回合），policy-v2 从 turn 58 开始，中间 turn 41–57 在两个账本里都没有记录，既不属于前期也不属于记录。
  4. "首个记录之前"也没定义是哪个账本：legacy 和 policy-v2 同时有记录的会话有 3 个。
- 证据：同上；会话 f0 turn1 在 2026-10-23，turn58 在 2026-10-25，前期窗口里并不能保证有 MANUAL。默认新会话是 AUTO，所以"首次记录前"很可能只是"之前没有走到会产生记录的路径"，而不是 AUTO 之前。
- 建议：
  - 二选一，在 spec 里写明：
    - (a) 删除"首次 AUTO 记录前"组作为对比组，只保留 AUTO 期间的分组、effort 分布和覆盖说明，不做前后用量对比。
    - (b) 保留，但标注为"不可比较的参照"：只展示，不进入"差异"结论；同时按上下文规模分层（例如按 `inputTokens + cacheReadTokens` 分桶），并在固定提示语中列出位置效应、compaction、任务混合、模型切换为混杂因素。
  - 无论选哪个，都要定义"首个记录"跨两个账本时的取法，并要求前期组也满足最小样本数（每模型）才展示对比。
  - 把"前期组在本机样本很可能为空"写进 design 的风险，并把"前后"改称"AUTO 期间的观察"，不要在 proposal 里暗示能回答"AUTO 前后是否变化"。

### [Moderate] legacy 与 policy-v2 的计数单位不对等；legacy 缺校验
- 位置：spec.md「策略分组与计数单位」「用量关联」；design.md D3
- 问题：
  - legacy 单位是"同 `turn` 的 append 调用"。`judgements.ts` 的 `assistant()` 说明续接回合（goal、tool-jobs 等非用户来源回合）的回复归属最近一个用户回合（L32–39）。policy-v2 的 messageId 绑定则天然包含这些续接回合，所以两组的"每单位调用数"口径不同。f0 里 turn 7、8、9、11 都是 goal 来源，分别有 21、30、11、4 次调用，legacy 的 turn 规则不会计入它们。
  - policy-v2 要校验 header 配置，legacy 只按 turn 关联，不核对账本 `model`、`effort` 与实际生效配置是否一致。legacy 行记录的是判档结果，不是已应用的证明。
  - `judgements.jsonl` 里有只含 `{sessionId, turn, label}` 的标注行（抽查有 1 行），"按最后一条折叠"必须先排除这类行，否则会覆盖掉判档行。
- 建议：legacy 也按"用户回合 + 其后续接回合直到下一个用户回合"归属，与 `JudgementBook.assistant` 一致；用该调用生效配置核对 `model`、`effort`，不符计入未关联；折叠前先过滤没有 `tier` 的行。

### [Moderate] "AUTO token 消耗"的范围声明缺失：子会话、压缩、判档与重试用量都不在内
- 位置：proposal.md「Why」；design.md Non-Goals；spec.md「结论措辞约束」
- 问题：报告只统计主会话 assistant 调用，但用户要回答的是"AUTO 是否减少 token 消耗"。
- 证据：
  - 本机 831 个会话日志中 694 个是子会话（`origin` 字段存在）；ledger 里的 30 个会话都是根会话，子会话用量完全不在内，而 AUTO 的子任务路由正是 policy-v2 的另一半。
  - f0 中 11 次 `compaction/summary` 自带 usage：输入 1,148,365，对比 assistant 调用输入 7,474,911，约 15%，不会被 `assistant/message` 统计。
  - 判档本身的开销（Jev）不计，被 design 列为非目标，但没有进入报告措辞。
  - `assistant/attempt` 加 `llm/retry`（f0 有 8 次 attempt、7 次 retry）的失败尝试没有 usage，实际消耗不可知，会让重试多的组被低估。
- 建议：报告固定声明"仅主会话 assistant 调用；不含子会话、压缩摘要、标题生成、Jev 判档、失败重试的用量"，并在 JSON 中同样带出，使"节省"类结论在口径上不可成立。若要估计压缩占比，可只读 `compaction/summary.usage` 并单独列出。

### [Moderate] 种子（seeded）会话与跨会话重复计数没有规则
- 位置：spec.md「会话日志完整读取」「策略分组与计数单位」
- 问题：`session` 头里 `isSeeded:true` 的会话在日志开头复制了父会话历史，消息 ID 和 usage 都会重复。spec 对此没有规则。若它进入"首次记录前"组，父会话的历史会被再次计数并被归到错误时间。
- 证据：本机 831 个会话里 69 个是 `isSeeded`（例如 nexus 的一个会话含 8079 条 assistant 消息，是复制出来的历史）。当前账本涉及的 30 个会话都不是 seeded、也不是子会话，所以现在不会出问题，但 fork 一旦被支持（主 spec 当前对 fork 报 unsupported）或用户从旧会话继承，就会出现。`session/end-seed` 在 f0 里出现 6 次，是会话中途的普通标记，不是历史复制边界。
- 建议：对 `isSeeded:true` 的会话，在前期组中排除复制段，或直接整体排除并计数"已排除的 seeded 会话"；所有 assistant 调用按 `message.id` 跨会话去重（抽查 f0 内无重复，但跨会话不保证）；`origin` 存在的会话明确"不统计，仅显示数量"。

### [Moderate] `surfaceOp` 的真实形态与 spec 描述不符
- 位置：spec.md「会话日志完整读取」场景 2；design.md Risks
- 问题：spec 把 append 说成缺失或 `{op: replace}` 之外的值。真实数据里 append 是字符串 `"append"`，replace 是对象 `{op:'replace', startSeq, endSeq}`。按"`surfaceOp.op`"读取会把所有 append 当成缺失，虽然结果碰巧相同，但实现如果写成 `surfaceOp?.op === 'append'` 会漏掉全部调用。
- 证据：9552 会话 831 条字符串 append，31 条对象 replace；f0 里 replace 只出现在 `system/message`（3）、`tool/result`（106）、`user/message`（11），assistant/message 的 replace 为 0。所以"视图替换不重复计数"场景所依赖的情形在真实数据里从未出现，compaction 的影响主要是 `compaction/prune` 事件，而不是 assistant 的重复。
- 建议：spec 写成"`surfaceOp` 缺失、为字符串 `append` 或 `op==='append'` 的对象视为 append；其它 op 一律不计"；并增加按 `message.id` 去重作为兜底。design 风险里"compaction 后重复请求"的说法可以删去或改写。

### [Moderate] "回合"没有可用的来源：header 无 turn 字段，`requestTurn` 全部缺失
- 位置：design.md D3；spec.md「策略分组与计数单位」
- 问题："首个有记录回合""回合数""legacy 的同 turn"都需要回合号，但：
  - `policy-host.ts` 写 `requestTurn` 取自 `request/header` 的 `data.turn`，而 header 的 `data` 只有 `header` 和 `reason`，所以该值从未写入。
  - "首个记录之前 7 天"需要时间。legacy 行没有任何时间字段，policy-v2 行有 `boundAt`（234/267 有），snapshot 有 `appliedAt`。spec 没说用哪个。
- 证据：234 条带 snapshot 的行中 `snapshot.requestTurn` 为 0 条；legacy 152 行时间字段为 0。助手消息的 `data.turn` 与所在 `turn/start` 的 turn 一致（f0 的 1948 条无不一致）。
- 建议：约定回合号一律从会话日志的 `turn/start` 与 assistant `data.turn` 推导，不依赖 `requestTurn`；时间一律取日志事件自带的 `time`（比如对应 `turn/start.time`），7 天窗口以此计算；写明 legacy 和 policy-v2 同时有记录时，"首个记录"取两者中日志时间更早者。

### [Moderate] 20 个样本的门槛对异质、聚集的单位不够
- 位置：spec.md「结论措辞约束」；design.md D5
- 问题：
  - 决策单位的体量差异极大：本机 16 个决策里每个绑定 1 到 101 条消息，均值会被少数巨型决策主导。
  - 样本高度聚集：267 行来自 5 个会话，f0 一个会话贡献 6 个决策、200 多行，20 个"已关联决策"可能只来自 1–2 个会话。
  - 门槛没有按模型或 effort 子组细分，一个模型有 20、另一个 3 就会出现不一致的"可判断"。
- 建议：门槛同时要求"每个比较子组 ≥ 20 个已关联单位且来自至少 3 个不同会话"；报告里同时列出会话数、每单位调用数的分位数和最大值；"同一模型只在一组出现"保留；所有门槛判断在模型和 effort 子组上进行。

### [Moderate] AUTO 但没有任何记录的会话完全不可见
- 位置：design.md D3「覆盖缺口」与 Risks（只读取账本涉及的会话）
- 问题：缺口估计只覆盖"首条记录之后的回合"，在账本里没有任何行的会话不会被扫描，但这些会话可能恰恰是 AUTO 完全没有产生记录的情形。另一方面，"会话状态文件显示当前为 AUTO"也会漏掉先 AUTO 后手动切回 MANUAL 的会话。
- 证据：本机 59 个状态文件里 34 个是 AUTO，其中 8 个不对应任何账本会话（约 24%）；账本涉及的 30 个会话里 4 个当前是 MANUAL。状态文件名是 `sha256(sessionId)`，不需要扫描日志就能与账本会话 ID 的哈希比对。
- 建议：报告里增加"状态为 AUTO 但账本无记录的会话数"（只比哈希，不解压日志），以及"当前 MANUAL 但有记录的会话数"，两者都标注为模式历史未持久化下的粗略数字。

### [Moderate] spec 与 `docs/feedback-evaluation.md` 的口径有遗漏
- 位置：spec.md「策略分组与计数单位」「结论措辞约束」；design.md D3
- 问题：doc 规定了以下几条，spec 没有完整继承，而 proposal/design 声称"不另立口径"：
  - 评估单位为 `(sessionId, decisionId)`，且反馈先按消息取最后事件、再按决策取最后反馈。
  - 多条消息评价冲突要单独报告。
  - 分组包含 depth（lower/baseline/higher）与实际路由。
  - 旧缺字段记录进独立的 unknown 组（spec 已有，一致）。
  - 反馈事件为 `type:feedback`，另有 `null` 撤销（spec 已覆盖撤销）。
- 证据：本机账本 depth 分布为 baseline 248、lower 19、higher 0，所以按 depth 分层有实际意义，"lower"才是预期省用量的决策。另外 spec 说"与 FeedbackBook 的首个绑定不可替换一致"，但 `FeedbackBook` 的键是 `(sessionId, messageId)` 而不是决策，写法不准确。
- 建议：spec 补充：反馈折叠顺序、冲突单独计数、按 depth 分组；把"与 FeedbackBook 一致"改成"按消息首个绑定不可替换，再按决策折叠"。

### [Moderate] 隐私承诺：错误信息、路径与输出通道存在泄露面
- 位置：spec.md「只读与隐私边界」；design.md D6
- 问题：
  - `JSON.parse` 的错误消息在较新 V8 里会带出源文本片段（形如 `Unexpected token …, "…" is not valid JSON`），读取失败、读取错误或被跳过的行如果回显 `err.message`，会把消息正文片段带进报告。当前场景只测了"成功解析后的正文"，没有测"损坏行里夹带 `SECRET-TEXT`"。
  - 会话日志路径形如 `sessions/--Users-…-<workspace>--/<sessionId>/…`，文件系统错误消息会包含完整路径，即 cwd。spec 禁止输出 cwd，但没规定错误输出。
  - 默认报告虽不含会话 ID，但"读取失败"列表和 `--details` 一旦出现 ID，就进入 agent 转述链路，也就进入模型提供方的上下文；"不联网"只约束脚本本身，不约束输出被 agent 转发。
  - 模型名、provider 名在自定义端点下可能含主机名或内部名称，当前清单只说"模型名之外"，没有对此给出约束。
- 建议：
  - 脚本只输出固定的失败类别（如 `decode-failed`、`parse-failed`、`missing-log`）与计数，绝不回显异常消息、路径或行内容；对应加一个测试：损坏行和损坏帧里含 `SECRET-TEXT` 和敏感 cwd，断言 stdout、stderr 和快照都不含。
  - `--details` 默认只列会话 ID 的前 8 位或哈希，完整 ID 需要再加一个显式开关；skill 要求 agent 不得主动加该开关。
  - 在 spec 里列出所有输出字段的白名单（provider、model、effort、policyVersion、mappingVersion、计数、token 字段、时间范围）。

### [Moderate] 活动会话的尾帧被写入中会让整个会话"读取失败"
- 位置：spec.md「会话日志完整读取」场景 3；design.md D2
- 问题：会话日志是追加写的 zstd 多帧文件。正在使用的会话（评估时往往就是当前会话）尾部可能有半个帧，按 spec 会整体计为"读取失败"并丢掉该会话已完整的全部帧，从而恰好丢掉最新的数据。
- 证据：每个完整帧都以换行结尾（9552 会话 1159 帧全部以 `\n` 结尾，0 个例外），帧与行对齐，所以丢弃末尾一个不完整帧不会破坏已解出的行；把最后一帧截去 5 字节后 `zstdDecompressSync` 抛 `Z_BUF_ERROR`，确实会失败。
- 建议：只有最后一帧解压失败时，保留前面的帧并报"尾部不完整，已忽略"，不计入读取失败；中间帧失败才算读取失败。加一个对应的测试场景。

### [Moderate] 用量字段的语义与缺失处理不够精确
- 位置：spec.md「用量关联」
- 问题：
  - 字段并非每次调用都出现：f0 里 `cacheWriteTokens` 只在部分调用里有（9552 会话 308 条里 264 条有），`reasoningTokens` 在一些调用里为 0、在另一些里缺失。"某字段在某组从未出现才显示未知"之外，对"部分出现"没有规定均值分母。
  - 不同 provider 的 `inputTokens` 是否含缓存读取不同（claude 与 codex 口径不一致，本次未能从数据验证）。分模型列出可以避开跨模型相加，但跨 provider 比较"inputTokens"仍会误导。
- 建议：每个字段给出"出现次数/总调用数"，均值只在出现的调用上计算并注明；`inputTokens` 与 `cacheReadTokens` 并列展示且不相加；固定声明不同 provider 的 token 口径可能不同，不得跨模型比较。

### [Moderate] 可测试性：场景与 tasks 有缺口
- 位置：spec.md 各场景；tasks.md 2.2、3.4、4.2–4.4
- 问题：
  - "日常任务不触发"是 agent 行为，无法自动判定；只能检查 skill 描述里有触发限定文案（可做静态断言），不能写成测试场景。
  - 缺场景：同一决策跨多个 `requestSeq`；无 header 回合的缺口；seeded 与子会话；活动会话尾帧不完整；effort 分布；反馈冲突；legacy 标注行过滤；`$DSH_HOME` 未设置回退到 `~/.dsh`；Node 不提供 zstd 时非零退出。
  - "覆盖缺口"场景（10 回合 7 条记录）应由合成日志生成回合，并包含无 header 的缺口回合，否则会通过但不反映真实情形。
  - 任务 3.4 的"与 10-24 手工统计的 legacy 结果一致"依赖不可复现的人工数字，不能作为验收；建议改成"对本机数据只读运行一次，并核对：解析失败数为 0、已关联率、同一输入重复运行输出字节一致"。
  - 任务 4.2 说"确认 content 测试中的包边界约束覆盖新文件"，但 `test/content.test.ts` 目前只读取 subagent-model-routing 的 SKILL.md，并没有包边界约束；`package.json` 的 `files` 现在列的是 `scripts/label-report.mjs` 单个文件，新脚本必须逐个加入，否则不会进 npm 包。
  - 任务 4.3 的"确认不访问包外路径"没有判定方法。
- 建议：
  - 用 `node --permission --allow-fs-read=<测试 DSH_HOME> --allow-fs-read=<包目录>` 运行脚本，作为"只读且不访问包外路径"的判定：我实测该标志下读取其它路径、`child_process` 均返回 `ERR_ACCESS_DENIED`。
  - 要注意 Node 24 的 permission 模型不拦截网络（`fetch` 仍然尝试连接），所以"不联网"要另用静态检查（脚本中不出现 `node:http(s)`、`net`、`dns`、`fetch`）加上审查。
  - 快照写入测试再给一个 `--allow-fs-write=<reports 目录>`。
  - 补充 content 测试：`files` 数组包含新脚本与 skill 目录。

### [Suggestion] 按 depth 分层，并记录 effortCap 与映射版本
- 位置：spec.md「策略分组与计数单位」
- 说明：Jev 决策为 lower 的决策才预期节省用量，baseline 回合的用量与 AUTO 无关。把 depth 分层作为固定维度（本机 baseline 248 行、lower 19 行、higher 0），可以避免 baseline 回合稀释或掩盖 lower 回合的差异。`effortCap` 设置若能在状态里得到，也应并列展示，否则注明未知。

### [Suggestion] YAGNI：快照与 `--baseline` 对比可以砍掉，改用时间参数
- 位置：proposal.md「What Changes」；design.md D4；spec.md「基线快照与对比」
- 说明：账本与会话日志都是追加写的持久文件，重复运行同一数据结果确定。若支持 `--since` 和 `--until`（按日志事件时间），"冻结基线"可以由重新计算得到，不必保存快照，也就不需要 `reports/` 写路径、`schemaVersion` 与口径变化提示、快照差异比较。这样脚本可以做到"绝对只读"，隐私与只读承诺最容易验证，tasks 里 2.2 与 3.3 的多项场景也随之消失。
- 例外：若用户担心会话日志被清理导致以后无法重算，再保留 `--save`，但只存聚合数字，并作为第二阶段。建议第一版只做 `--json`、`--since`、`--until`、`--details`。

### [Suggestion] 帧切分的"失败即合并重试"可简化并加行对齐校验
- 位置：design.md D2
- 说明：本机 9552 会话 1133 个 magic 命中全部是真实帧起点，0 次误切，逐帧解压总字节与 `zstd -dc` 一致（7,526,247）。`zlib.zstdDecompressSync` 与 `createZstdDecompress` 都只解第一帧（实测只得到 221 字节），所以自行切帧是必要的。误切概率极低，合并重试逻辑保留可以，但应加上"每帧以换行结尾"的校验作为误切信号，并在测试里用一个帧内含 magic 字节的构造样例覆盖。

## 与重点审查项的对应

| 重点 | 结论 |
|---|---|
| 1 统计口径 | 3 个 Critical（缺口定义、窗口归属、前后基线）；单位不对等、范围声明、seeded 去重、回合来源、门槛、不可见会话为 Moderate。子会话、重试、compaction 摘要已逐项核对，处理见上。 |
| 2 spec 与代码、数据一致 | 与 `policy-host.ts` 的绑定逻辑有偏差（窗口与 messageId 绑定、header 触发条件）；与 `feedback-evaluation.md` 有遗漏；`surfaceOp` 形态和 `requestTurn` 与实际数据不符。 |
| 3 隐私与只读 | 有泄露面（错误消息、路径、输出通道）；可用 `node --permission` 验证只读与路径边界，但网络需静态检查。 |
| 4 可测试性 | 场景缺口较多，tasks 里 3.4、4.2、4.3 的验收项不可判定，见上。 |
| 5 复杂度 | 快照与基线对比可砍；其余保持零依赖单脚本即可。 |

## 建议的修订顺序
1. 先改"用量归属"与"覆盖缺口"两条（Critical 1、2），把 messageId 精确连接写进 spec 与 design。
2. 决定前后对比的去留（Critical 3），并同步改 proposal 的措辞。
3. 补齐范围声明、seeded 与去重、回合与时间来源、门槛、隐私错误处理。
4. 根据上面的场景缺口更新 tasks，再进入实现。

---
# Review: auto-routing-usage-report
ROUND: 2
REVIEWER: claude-opus-5-5
VERDICT: APPROVE_WITH_CHANGES
CHANGES_APPLIED: yes

范围：只读复审修订后的 proposal / spec / design / tasks，对照 `src/policy-host.ts`、`src/feedback.ts`、`src/judgements.ts`、`docs/feedback-evaluation.md`、`package.json`，并只读抽查本机账本（275 行）、`judgements.jsonl` 和 `session-f0db3c96` 日志（`zstd -dc`，未转储正文）。用户已定的两个决定（参照章节改为"仅供参考"、去掉快照改用 `--since/--until`）不再讨论，只检查其落地是否自洽。数字仅在本机、当前 DSH 版本成立。

结论：3 个 Critical 均已解决，没有未解决的 Critical。修订引入 6 个 Moderate（多为"定义不闭合、实现时会各自猜"），另有 3 条精简建议。修完 Required Changes 即可进入实现。

## 第 1 轮意见处理情况

| # | 标题 | 状态 | 依据 |
|---|---|---|---|
| 1 | [Critical] 覆盖缺口定义漏掉无 header 回合 | 已解决 | spec「覆盖与可见性」改为按用户回合统计"无记录回合/部分未关联回合"，明确"不依赖是否出现 request/header"，并有 17 回合中 7 个无 header 缺口的场景；固定说明"policy-v2 只在出现一致请求头时才写入，已统计组可能是非随机子集"，与 `policy-host.ts` L178–195 一致。遗留的小问题见 N5。 |
| 2 | [Critical] 用量归属窗口与绑定不一致 | 已解决 | design D3 / spec「账本关联」改为 `(sessionId, messageId)` 精确连接，决策用量为全部已关联消息之和、跨 requestSeq 全计；窗口方案在 design 里作为被否决备选并给出 65/128 的证据；"只计已绑定消息"（12/31）与"跨请求 17 次"场景可判定。窗口只保留为"推断未绑定调用的生效配置"一个用途。 |
| 3 | [Critical] 前后对比的结构性混杂 | 已解决（按用户决定落地） | proposal 改称"观察统计，不回答是否节省"；spec「前后对照仅供参考」要求独立章节、标题与 JSON 字段标明"不可比较"、列出位置效应/压缩/任务混合/模型切换/effortCap/起点差异、不输出百分比、不参与结论；design Risks 写明本机参照组可能几乎为空。该章节自身的定义缺口见 N2，按 Moderate 处理。 |
| 4 | [Moderate] legacy 与 policy-v2 单位不对等、legacy 缺校验 | 已解决 | spec「回合与时间来源」定义用户回合与续接回合归属，与 `JudgementBook.assistant`（judgements.ts L32–39）一致；「账本关联」要求 legacy 先滤无 `tier` 的标注行，并用"调用前最近 header"校验 model、effort；有"标注行不覆盖判档"场景。校验的实际行为见 N5。 |
| 5 | [Moderate] 统计范围声明（子会话/压缩/判档/重试） | 已解决 | spec「统计范围与会话筛选」固定声明"不含子会话、压缩摘要、标题生成、Jev 判档、失败重试，不能得出节省结论"，并单独列出压缩 usage 合计。 |
| 6 | [Moderate] seeded 与跨会话重复计数 | 部分解决 | seeded 与子会话整体排除并计数，已解决。但"按 message.id 跨会话去重"与按 `(sessionId,messageId)` 关联互相冲突、且结果依赖遍历顺序，见 N3。 |
| 7 | [Moderate] `surfaceOp` 形态 | 已解决 | spec「会话日志读取」改为"缺失、字符串 `append`、或 `op==='append'` 的对象才计"，场景含对象 replace；已删去 compaction 重复的错误说法。 |
| 8 | [Moderate] 回合与时间无来源（`requestTurn` 缺失） | 已解决 | spec「回合与时间来源」：回合取自 `turn/start` 与 `data.turn`，时间取日志事件 `time`，不依赖 `requestTurn`。（legacy 时间的表述有矛盾，见 N2。） |
| 9 | [Moderate] 20 样本门槛对聚集样本不足 | 已解决 | spec「样本门槛与结论措辞」要求每子组 ≥20 单位且 ≥3 会话，并有"25 决策来自 2 会话"场景；分组要求列会话数与每单位调用数分布。门槛适用于哪一级子组有歧义，见 S1。 |
| 10 | [Moderate] AUTO 但无记录的会话不可见 | 已解决 | spec「覆盖与可见性」增加"当前为 AUTO 但账本无记录/当前为 MANUAL 但有记录"两项计数，仅比对状态文件名哈希，并注明模式历史未持久化。 |
| 11 | [Moderate] 与 feedback-evaluation.md 口径遗漏 | 部分解决 | spec「人工反馈统计」已含撤销、冲突单独计数、未评价不算合适、按 depth 分组；未覆盖 `feedback.ts` L28 的旧式整行反馈，见 N6。 |
| 12 | [Moderate] 隐私泄露面 | 已解决 | spec「输出白名单与错误不回显」列出字段白名单、异常只映射固定类别、`--details` 只显示 sha256 前 8 位，场景含半截 JSON 夹 `SECRET-TEXT`、敏感 cwd、中间帧损坏，并要求 stdout/stderr 均不含。 |
| 13 | [Moderate] 活动会话尾帧写入中 | 部分解决 | spec 与 design D2 已区分 `tail-incomplete` 与 `decode-failed`，有场景；但 D2 的"失败即合并重试"与"中间帧失败"在算法上无法区分，见 N1。 |
| 14 | [Moderate] 用量字段语义与缺失 | 已解决 | spec「分组与用量字段」要求每字段标注"出现次数/调用数"、均值仅基于出现者、从未出现显示未知、字段不相加、固定声明 provider 口径不同；有 264/308 场景。 |
| 15 | [Moderate] 可测试性 | 部分解决 | "日常任务不触发"已改为静态文案检查；`package.json` 的 `files` 确实只有 `scripts/label-report.mjs`（已核对），tasks 4.2 已要求加入新脚本与 content 测试；3.4 的手工数字改为 3.5 的自洽检查；补了 `node --permission`、静态扫描、默认 `DSH_HOME` 场景。仍有：zstd 缺失要求无场景（S1）、3.5"关联率合理"不可判定（S2）。 |
| 16 | [Suggestion] depth 分层与 effortCap | 已解决 | 分组要求按 depth 细分；effortCap 列为混杂因素。 |
| 17 | [Suggestion] 砍快照改 `--since/--until` | 已解决（按用户决定） | proposal、design D1/Non-Goals、spec 中已无快照、`--baseline`、`reports/` 写路径；脚本绝对只读。`--since/--until` 的语义不闭合，见 N4。 |
| 18 | [Suggestion] 帧切分简化与行对齐校验 | 已解决 | design D2 加入"解码结果须以换行结尾"的误切信号，spec 有帧内含 magic 的场景。 |

## New Findings

### [Moderate] N1 D2 的"合并重试"让"中间帧损坏"与"尾帧不完整"无法区分
- 位置：design.md D2 第 2、3 步；spec.md「会话日志读取」场景 3 与「损坏数据」场景
- 问题：按 D2，解码失败就与下一段合并重试。若第 i 段是真正损坏的中间帧，合并 i+1、i+2…直到末尾也都会失败，最终走到"最后一段仍失败"，被判为 `tail-incomplete`，其后的所有好帧被静默丢弃，却不计入 `decode-failed`。这样 spec 里"中间帧损坏计 1 个 decode-failed"的场景按 D2 实现不可能通过，而且会把大段数据悄悄丢掉并标成"只是尾部不完整"。
- 证据：本机帧全部以换行结尾、无误切（第 1 轮已验证），所以合并重试只对"帧内容含 magic"这种极少数情形有意义；其代价是破坏了失败分类。
- 建议：给出确定性规则，例如：以候选边界为起点逐个解码；某起点 p 失败时，只尝试"p 与后续段合并"直到解码成功；若直到末尾都没成功，则当 p 是最后一个候选边界、或 p 之后所有候选都无法单独成功解码时记 `tail-incomplete`，否则（p 之后存在可单独解码成功的段）记 `decode-failed` 并整会话不统计。测试要补"损坏中间帧之后还有 2 个好帧"的用例，断言结果是 `decode-failed` 而不是 `tail-incomplete`。

### [Moderate] N2 "前后对照"章节仍有定义缺口，且与"不得推测 legacy 时间"矛盾
- 位置：spec.md「前后对照仅供参考」「回合与时间来源」；design D3
- 问题：
  1. "两个账本中日志时间最早的那条记录"：legacy 行没有时间，spec 又写"不得为 legacy 行推测时间"，两句互相矛盾。可行的做法是 legacy 行经 `(sessionId, turn)` 对应日志里该回合的 `turn/start.time`，这不是推测，应当明写。policy-v2 同理取其 messageId 对应调用的事件时间。
  2. 门槛按"单位数"，但参照组的统计对象是"调用"，没有决策或判档回合的单位，门槛无法计算；"任一模型低于门槛就只显示样本数"没说比较的是哪个单位。
  3. "7 天"相对于分界，但同一会话内分界之前的调用通常在同一天；7 天窗口的实际作用是什么没有说明。本机 28 个 legacy 会话中 23 个从 turn 1 开始，该章节大概率为空，这个常态应明确写成输出"无参照数据"，并写进场景。
  4. 与 `--since/--until` 的交互未定义（参照调用是否也要落在时间范围内）。
- 建议：把参照组简化为"每个有记录的会话，分界之前的根会话调用"，去掉 7 天窗口；单位就用调用数，门槛写成"调用数 ≥ 20 且来自 ≥ 3 会话才展示数值，否则只显示数量"；写明 legacy 分界取对应 `turn/start.time`；写明 `--since/--until` 只作用于调用事件时间，两组一视同仁。补一个"参照为空"的场景。

### [Moderate] N3 跨会话 `message.id` 去重与账本连接冲突，且不确定
- 位置：spec.md「会话日志读取」"调用 SHALL 按 `message.id` 跨会话去重"及"非 append 与重复消息不计"场景
- 问题：(1) 账本以 `(sessionId, messageId)` 为键，若某会话的调用因与另一会话重复而被丢弃，该会话的账本行就变成"未关联"，规则互相打架；(2) 保留哪个会话的副本取决于遍历顺序，输出不可重现，而 D5 要求字节一致。seeded 与子会话已整体排除，剩下的跨会话重复在现实里基本不存在，这条规则是在为已被排除的情形付复杂度。
- 建议：改为"会话内按 `message.id` 去重"；跨会话重复不处理（seeded、子会话已排除）；删除对应场景里的第二个会话部分，或明确"按 sessionId 升序，先到者保留"。

### [Moderate] N4 `--since/--until` 语义不闭合
- 位置：spec.md「回合与时间来源」场景「时间范围筛选」；proposal「What Changes」
- 问题：(1) 日期无时区约定（10-25 是本地时区还是 UTC），而输出要求字节一致、测试要可复现；(2) 按调用事件时间筛选，但统计单位是决策/用户回合，单位跨越边界时是整单位计入、按调用拆分，还是整单位排除，没有规定，直接影响"单位数""已关联率""门槛"；(3) 反馈事件与 legacy 判档没有时间，是否随单位走未说明；(4) `--until` 是否含当天未说明。
- 建议：约定输入为 ISO 日期、按 UTC（或明确本地时区），区间 `[since, until)`；单位归属以其第一次调用事件时间为准、单位内调用不拆分；反馈随所属决策；并补一个"决策跨越 since 边界"的场景。

### [Moderate] N5 legacy 校验的实际行为与覆盖章节对 legacy 的说明不足
- 位置：spec.md「账本关联」legacy 段、「覆盖与可见性」；design D3
- 问题：
  1. 对本机 legacy 数据按 spec 规则粗略试算（以调用前最近 header 的 model 与 effort 对比判档行），2784 次可对应判档回合的调用中约 219 次（约 8%）会被判为不一致，例如判档行为 `gpt-6-astra/low` 而最近 header 是 `gpt-6.1-sol/medium`。这是否说明 legacy 判档并未生效、还是 header 推断本身不可靠，目前不可知。若实现者照字面做，约 8% 的调用会被计为"未关联"，却没有任何原因分类。
  2. 判档行的 `effort` 是可选字段（`JudgementLine.effort?`），缺失时如何比较没有规定。
  3. 覆盖章节的"非随机子集"说明只写了 policy-v2；legacy 同样只记录被判档的用户回合，未判档（Jev 失败、MANUAL）的回合同样是缺口。
  4. "无记录回合"以"已关联调用"为准，会把"因配置不符而未关联"的回合算成"无记录回合"，两种原因被混在一起。
- 建议：legacy 校验结果按原因计数（配置不符、缺 header、effort 缺失不比较 effort）；effort 缺失时只比 model；覆盖说明同时适用于两个账本；"无记录回合"与"配置不符回合"分开列。实现时把 3.5 的真实数据核对改成"列出不一致原因分布并人工看一眼"，不要预设它是 bug 或是正常。

### [Moderate] N6 反馈口径遗漏旧式整行反馈与决策不匹配事件
- 位置：spec.md「人工反馈统计」；对照 `src/feedback.ts` L12–13、L23–28
- 问题：账本里存在两种反馈形态：独立的 `type:'feedback'` 事件，以及旧式带 `feedback` 字段的整行（本机有 1 行）。`FeedbackBook` 对事件要求 `decisionId` 与已有绑定一致才生效，旧整行在 `decisionId` 相同且含 `feedback` 键时才折叠进去。spec 只描述了事件与撤销，没有说旧整行是否计入、决策不匹配的事件如何处理。另外 spec 写"每条消息取最后一个反馈事件"，旧整行没有 `type`，按"事件"读取会漏掉它。
- 建议：spec 写明"绑定行内的 `feedback` 字段与 `type:'feedback'` 事件按文件追加顺序统一折叠，同一消息取最后一个；事件的 decisionId 与绑定不一致时忽略并计入固定类别"；补一个旧整行场景，或明确声明不支持并计数。

### [Suggestion] S1 还可以再砍（小工具，建议第一版就瘦身）
按"砍掉后报告是否更难被误读"排序：
1. **Node 无 zstd 时非零退出**：`engines` 是 `>=22.19`，已内置 zstd，该要求永远不会触发，也没有场景和测试。删除；只保留 `engines` 声明。
2. **`--details` 与 sha256 前 8 位**：每多一个会话级输出就多一个隐私面，且报告的用户问题是聚合观察，不需要会话级清单。第一版整体删除，同时删掉 skill 里"不得主动加开关"的子句；需要排查时用现有调试手段。
3. **用量统计的中位数与 p90**：每字段 5 个统计 × 5 个字段，输出量大且分位数要求实现排序。只保留"总和、出现次数/调用数、均值"；每单位调用数只保留中位数与最大值（保留最大值是为了暴露巨型决策）。
4. **policy-v2 的 header 配置校验**：绑定行只在 header 配置与推荐一致时才创建（`policy-host.ts` L178–195），校验对带 snapshot 的行近乎恒真，对无 snapshot 的 32 行又无法做。可以改成"仅计数不一致，不影响归属"或直接删除；legacy 校验才是有信息量的。同时 spec 写"校验 provider"，而绑定行本身没有 provider 字段（只有 snapshot.provider），按字面也无法实现。
5. **压缩 usage 合计单列**：已有"不含压缩摘要"的固定声明，再单独解析 `compaction/summary` 是额外代码。可删，仅保留声明。
6. **"当前为 MANUAL 但有记录"计数**：对结论几乎无帮助，保留"当前 AUTO 但无记录"一项即可。
7. **样本门槛的适用层级**：分组细到 `policyVersion × mappingVersion × depth × model × effort`，门槛说"模型 × depth 或 tier"，两者不在同一层。建议统一为"模型 × depth/tier"才判断；其下的 effort 行只展示数字。

### [Suggestion] S2 tasks.md 里仍有不可判定项
- 3.5 的"两个账本关联率合理"不可判定，改为"输出关联率与未关联原因分布，人工确认没有单一原因占绝大多数而无解释"；"人工抽查结论不提交真实数据"可保留。
- 1.3 提到"连续两轮 REVISE 时停下来交给用户"，本轮不是 REVISE，可以勾选；修完 N1–N6 不需要第 3 轮完整复审，由作者自查并在 review.md 记录即可。

### [Suggestion] S3 隐私白名单里模型与 provider 名
自定义端点下 provider/model 名可能含内部主机名或项目名。白名单已列出，属于可接受的残余风险，建议 skill 里提醒 agent：把报告原文贴到会话外之前先由用户确认。不需要改脚本。

## Required Changes（APPROVE_WITH_CHANGES 必须修改项）
1. N1：D2 与 spec 给出可区分 `tail-incomplete` / `decode-failed` 的确定性规则，并补"损坏中间帧之后仍有好帧"的测试。
2. N2：补全参照章节：legacy 分界时间的取法（`turn/start.time`）、门槛单位、与 `--since/--until` 的关系、参照为空的场景；删除"7 天"或写清其作用。
3. N3：去重改为会话内，或写明确定性的取舍顺序；与账本连接保持一致。
4. N4：写明日期格式与时区、区间开闭、跨边界单位的归属和反馈随单位走；补一个跨边界场景。
5. N5：legacy 校验按原因计数、effort 缺失只比 model；覆盖说明适用于两个账本；"无记录回合"与"配置不符"分开。
6. N6：反馈折叠覆盖绑定行内 `feedback` 字段与事件，决策不匹配的处理，并补场景。

S1–S3 为建议项，可不改；其中 S1.1、S1.4 建议一并改掉，因为按字面无法实现或无信息量。

## 作者处理记录（第 2 轮 Required Changes）

| # | 处理 | 位置 |
|---|---|---|
| N1 | 改为确定性规则：逐步扩展到成功；到末尾仍失败时，若其后存在可单独解码的片段，计 `decode-failed`，否则计 `tail-incomplete`；补“中间帧损坏后仍有好帧”场景 | spec「会话日志读取」；design D2 |
| N2 | legacy 分界取 `turn/start.time`（日志事实，不是推测）；参照组以调用为单位，门槛为 ≥20 次且来自 ≥3 个会话；去掉 7 天窗口；参照组同样受 `--since/--until` 约束；补“参照为空”场景 | spec「回合、时间与时间范围」「前后对照仅供参考」；design D3a |
| N3 | 改为会话内按 `message.id` 去重；跨会话不去重（子会话和 seeded 会话已排除） | spec「会话日志读取」；design D3 |
| N4 | 日期格式 `YYYY-MM-DD`，按本地时区解释，半开区间；单位按首次调用整体归属，反馈随决策；补跨边界场景 | spec「回合、时间与时间范围」 |
| N5 | legacy 按 `config-mismatch`/`no-header` 计数；缺 effort 时只比 model；覆盖章节按账本分别统计“无记录回合”“关联失败回合”“部分未关联回合”，说明同样适用于 legacy | spec「账本关联」「覆盖与可见性」；design D3 |
| N6 | 按追加顺序统一折叠事件与旧式整行反馈；decisionId 不匹配时计 `feedback-mismatch`；补对应场景 | spec「人工反馈统计」 |

精简建议：
- S1：均已采纳。删除 zstd 缺失退出、`--details`、中位数/p90（每单位调用数保留中位数与最大值）、policy-v2 header 校验、压缩 usage 合计与“MANUAL 但有记录”计数；门槛统一为“模型 × depth/tier”。
- S2：3.5 改为输出原因分布并由人工确认；1.3 已勾选。
- S3：skill 要求报告原文贴到会话外之前先请用户确认。

按复审意见，不进行第 3 轮完整复审。

## 过度设计审查（ponytail-review，2026-10-26，用户要求）

在第 2 轮之后，用户要求检查是否过度设计。采纳以下 7 条，均为删减或复用，不新增行为：

1. legacy 账本只读取 `(sessionId, turn)`，用于确定首个 AUTO 记录的位置；不再统计 legacy 用量、配置校验和标注（数据已冻结，不能与 v2 比较；标注已有 `label-report.mjs`）。原 N5 因此不再适用。
2. 统计入口改为 `src/usage-report.ts`，复用 `FeedbackBook`；不再重写反馈折叠规则，原 N6 的语义也由此与运行时一致。
3. 切帧简化为“最后一段失败记为 tail-incomplete，其它失败记为 decode-failed”；删除向后扩展重试和“帧内含 magic”场景，原 N1 规则同时简化。
4. 只输出 JSON，`conclusion`/`caveats` 使用固定标识，由 skill 解释。
5. 覆盖只保留三项：无记录回合、未关联绑定，以及 AUTO 但无记录的会话。
6. AUTO 前参照只输出调用数和 effort 分布，不输出 token。
7. 只保留 `--since`。

所有删减都没有放宽隐私、只读或结论措辞要求。由于只做减法，不再另行复审。
