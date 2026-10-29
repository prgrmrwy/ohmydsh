## ADDED Requirements

### Requirement: AUTO 受管子会话范围

AUTO SHALL 只路由**受管子会话**：在官方 `subagent` 或 fresh `spawn_teammate` 工具执行上下文（AsyncLocalStorage）内，以 `source = "startup"` 创建、且 `parentSession` 等于执行该工具的会话的子会话。判定在子会话 `agent/created` 时一次完成：此刻根会话须为 AUTO、直接父会话 provider 须可读，并同步采样父配置。记录字段 `parentSelection` 形状为 `{provider: string, model?: string, reasoningEffort?: string}`，provider 非空，缺少模型或 effort 时相应退化候选不可用；该字段对新建初始记录必填，旧记录读取允许缺失，旧无 route 的 recommended 冷恢复直接 interrupted，不从现有父配置补造快照。已有 `.bound` 或 `source` 不是 `startup`（含 resume）时 MUST NOT 重写绑定。

**已知限制（用户 2026-10-28 确认接受）**：官方 0.2.0-rc.2 没有能把工具调用与目标子会话一一对应的接缝。实测（`scripts/probe-managed-identity.mjs`）表明：工具执行窗口内若有插件以同一父会话直接创建子会话（含会发布 `subagent/catalog` 的服务直建），它与工具目标不可区分，会被一并视为受管。系统 MUST 在文档与 `childRouting` 说明中如实写明该限制，MUST NOT 声称能区分。窗口之外创建的插件子会话（如 Pet locus 按飞书消息创建）不受影响。

其余 `origin = "subagent"` 会话（官方工具 ALS 上下文外插件直接创建的子会话，如 Pet locus、根会话为 MANUAL 时创建的子会话、`subagent_fork` 或 fork `spawn_teammate` 创建的子会话、父 provider 无法读取的子会话）SHALL 原样放行：MUST NOT 请求 Jev、MUST NOT 改写请求、MUST NOT 写决策记录或绑定标记、MUST NOT 抛错；`childRouting` 返回 `{status: "unsupported"}`。根会话之后切到 `AUTO` MUST NOT 使这些子会话变为受管。孙会话按同一规则判定，provider 与模型锚定其直接父会话。

受管子会话的完整性问题 SHALL 继续 fail closed（拒绝请求，不重新判断、不继承）：绑定标记存在但记录缺失或损坏、记录 `parentId` 与会话 `parentSession` 不符、已绑定 route 与实际请求头不符。

#### Scenario: 官方工具创建的子会话受管
- **GIVEN** 根会话 R 为 `AUTO`，provider `claude`、模型 `claude-opus-5-5`；目录与允许列表含 `claude-haiku-5-5`（支持 `low..xhigh`）；Jev 返回 bounded/baseline
- **WHEN** R 经官方 `subagent` 工具创建子会话 C，C 发出第 1 个请求
- **THEN** C 有绑定标记与决策记录；请求为 `claude` / `claude-haiku-5-5` / `medium`；记录状态为 `applied`

#### Scenario: 插件直接创建的子会话原样放行
- **GIVEN** 根会话 R 为 `AUTO`
- **WHEN** 在官方创建工具的 ALS 上下文之外，以 `meta: {origin: "subagent", parentSession: R}` 直接创建子会话 L 并让其发出第 1 轮请求
- **THEN** 回合正常结束，无抛错；请求配置与官方合成配置深度相等；Jev 请求数为 0；L 无绑定标记与记录文件；`childRouting(L)` 为 `{status: "unsupported"}`

#### Scenario: MANUAL 时创建的子会话在切到 AUTO 后仍放行
- **GIVEN** 根会话 R 为 `MANUAL`，经官方 `subagent` 工具创建子会话 C
- **WHEN** R 切到 `AUTO` 后 C 发出下一次请求
- **THEN** 请求与官方合成配置深度相等，无抛错，Jev 请求数为 0，C 无记录文件

#### Scenario: fork 子会话与父会话一致
- **GIVEN** 根会话 R 为 `AUTO`，本回合 AUTO 已把 R 的 effort 设为 `high`
- **WHEN** R 经官方 `subagent_fork` 创建子会话 F，F 发出第 1 个请求
- **THEN** 工具执行不抛错；F 的请求与官方合成配置深度相等；Jev 请求数不增加；F 无记录文件

#### Scenario: 孙会话以直接父会话为锚
- **GIVEN** 根会话 R 为 `AUTO`，受管子会话 C 已应用 route `claude` / `claude-sonnet-5-5` / `medium`
- **WHEN** C 经官方 `subagent` 工具创建 G，Jev 对 G 返回 bounded/baseline
- **THEN** G 受管，记录 `parentId` 为 C、`rootId` 为 R；G 的 route provider 为 `claude`

#### Scenario: 创建期间根会话离开 AUTO 则不受管
- **GIVEN** 根会话 R 为 `AUTO`，官方 `subagent` 工具已开始执行
- **WHEN** 在子会话 `agent/created` 之前 R 被切为 `MANUAL`，随后子会话 C 创建并发出首个请求
- **THEN** C 无绑定标记与记录文件；请求与官方合成配置深度相等；Jev 请求数为 0

#### Scenario: 恢复通知不重写已有绑定
- **GIVEN** 受管子会话 C 已有记录 route `claude` / `claude-haiku-5-5` / `medium`
- **WHEN** 插件重启后 C 以 `source = "resume"` 触发 `agent/created`，且此时处于另一次官方工具执行窗口内
- **THEN** C 的记录文件字节不变，不抛错；C 的下一次请求仍为原 route

#### Scenario: 工具窗口外创建的插件子会话不被接管
- **GIVEN** 根会话为 AUTO，官方 `subagent` 工具已执行完毕
- **WHEN** 插件随后分别以 `agents.create` 与 `subagents.startContinuable` 创建同父子会话 L1、L2，各进入首轮
- **THEN** L1、L2 无绑定标记与记录，Jev 请求数为 0，请求与官方合成配置深度相等

#### Scenario: 同窗口同父插件旁支一并受管且如实说明
- **GIVEN** 根会话 R 为 AUTO、父 provider 可读；目录、允许列表和 effort 支持目标 route；Jev 固定返回 bounded/baseline
- **WHEN** 分别在官方 `subagent` 与 fresh `spawn_teammate` 的 ALS 上下文内，在实际工具目标创建之前，以 R 为父调用 `subagents.startContinuable` 创建 startup 插件旁支 L，再让 L 发出首个请求
- **THEN** 两种工具各自的 L 均有绑定标记与记录，并进入受管首次路由；`childRouting(L).scopeNote` 恰为“按官方工具 ALS 上下文、同父与 startup 绑定；不能区分同窗口插件旁支，旁支可能一并受管。”；不以有无 `subagent/catalog` 决定绑定

#### Scenario: provider 与父配置在绑定边界同步采样
- **GIVEN** 官方工具入口时父配置为 A/Ma/Ea，子会话 `agent/created` 前已变为 B/Mb/Eb
- **WHEN** 分别不传 provider、显式传入 provider X 创建受管子会话
- **THEN** 两份 parentSelection 均为 B/Mb/Eb；前者解析 P 与 explicit.provider 为 B，后者为 X；不存在 A/Mb/Eb 的混合快照

#### Scenario: 新初始记录缺少父快照被拒
- **GIVEN** 一条本次新写 recommended 初始记录不含 parentSelection
- **WHEN** 调用创建绑定记录的写入 API
- **THEN** 写入被拒，记录与 bound 标记都不存在；旧 applied 记录无 parentSelection 仍能读取并按原 route 恢复

#### Scenario: 受管子会话完整性问题仍拒绝
- **GIVEN** 受管子会话 C 有绑定标记，但其记录文件的 `parentId` 被改为其它会话
- **WHEN** C 发出请求
- **THEN** 请求被拒绝，模型请求与 Jev 请求数均为 0

### Requirement: 子任务路由退化链
受管子会话首次请求前，系统 SHALL 按以下顺序确定 route。记 P 为 provider（显式指定值，否则为创建快照中的父 provider），M0、E0 为创建快照中的父模型与 effort，“目录”指 P 的实时目录，“可用”指：该 provider/model 在目录中、在官方子会话允许列表中（状态须为 enabled）、在父会话 captured allowlist（存在时）中，且 effort 属于该模型支持序列并不超过 effort 上限。允许列表 MUST 对每个候选校验，包括 M0；系统 MUST NOT 为任何模型豁免允许列表。
1. **能力槽**：未显式指定模型且 M0 的家族已知时，按「模型家族策略注册表」的能力槽解析规则在目录中找槽位模型。effort 取显式 effort，否则按 depth 计算；候选可用则采用。
2. **保持模型、按 depth 调 effort**：第 1 步未采用时，模型取显式模型，否则 M0；effort 取显式 effort，否则按 depth 计算；可用则采用。
3. **父会话 effort**：仅当**未显式指定 effort**、第 2 步因按 depth 计算的 effort 不可得或不可用而未采用时，以第 2 步的模型与 E0 组成候选；可用则采用。
4. **不改写并告警**：以上均未采用，或子任务 Jev 失败/取消/返回 `insufficient_context`，或首次请求前根会话已离开 `AUTO`，或首次请求前发现初始决策中断（冷恢复后记录为 `recommended` 且无 route）时，系统 MUST NOT 改写该请求（交给 DSH 默认行为），写入 `status: "unsupported"` 与闭集 `reason`，并按「子任务未路由告警」告警。闭集为：`jev-<失败类别>`、`jev-cancelled`、`needs-context`、`mode-changed`、`interrupted`、`no-usable-route`、`explicit-unavailable`（显式指定的模型或 effort 在第 2 步不可用时使用）。

已有 route 的子会话每次请求 SHALL 重新校验当前目录、允许列表、存在的父 captured allowlist 与 effort cap；不满足或服务不可用时拒绝该次请求，模型请求数为零，记录保持不变、不重判、不换模型。此安全拒绝独立于首次路由退化链。

子初始判断 SHALL 捕获根模式 epoch，在每次异步 Jev/目录返回后以及保存 route 前复核。epoch 改变（包括 AUTO→MANUAL→AUTO）时丢弃旧结果，以 unsupported/mode-changed 结束，不写新 decision、根 disabled 或旧 Jev 失败 notice；可写 mode-changed notice。取消信号已中止时 MUST NOT 通过退化继续发请求，实际取消由宿主保持。

显式指定的维度 MUST NOT 被替换：显式 effort 不可用时不进入第 3 步。系统 MUST NOT 更换 provider，MUST NOT 选用第 1 步槽位与 M0/显式模型以外的模型。

决策记录 SHALL 满足以下状态组合，写入严格校验，读取时不满足即按「旧配置与旧记录只读兼容」fail closed：`recommended`（无 `actual`）；`applied`（有 `route` 与 `actual`）；`failed`（有 `route`，实际请求不匹配）；`unsupported`（无 `route` 与 `actual`）。新写入的 `unsupported` 的 `reason` MUST 属于上述闭集；读取时 `unsupported` 以及旧状态 `needs-context`、无 `route` 的 `failed` 接受任意不超过 240 字的 `reason`。读取到无 `route` 的 `unsupported`、`needs-context` 或 `failed` 时 SHALL 原样放行且不重新判断；有 `route` 的 `failed` 继续拒绝请求。

#### Scenario: 能力槽可用时按能力选模
- **GIVEN** 父会话 `codex` / `gpt-6.1-sol` / `medium`；目录与允许列表含 `gpt-6-luna`（支持 `low..xhigh`）；Jev 返回 bounded/baseline
- **WHEN** 创建受管子会话并发出首个请求
- **THEN** 请求为 `codex` / `gpt-6-luna` / `high`，记录 `applied`

#### Scenario: provider 没有能力槽模型时保持父模型
- **GIVEN** 父会话 `traex` / `GPT-5.6-Sol` / `medium`；traex 目录只有 `GPT-5.6-Sol`（支持 `low..xhigh`，目录默认 `medium`），允许列表含 `traex` / `GPT-5.6-Sol`；Jev 返回 bounded/higher
- **WHEN** 创建受管子会话并发出首个请求
- **THEN** 请求为 `traex` / `GPT-5.6-Sol` / `high`；记录 `applied`；provider 未变为 `codex` 或任何 Magpie provider

#### Scenario: 父模型不在允许列表时不改写
- **GIVEN** 父会话 `traex` / `GPT-5.6-Sol` / `medium`；traex 目录同上；允许列表分别为空、`disabled`、服务不可用
- **WHEN** 三种情况下各创建受管子会话并发出首个请求，Jev 返回 bounded/higher
- **THEN** 三个请求均与官方合成配置深度相等；记录均为 `{status: "unsupported", reason: "no-usable-route"}`

#### Scenario: depth effort 不可得时用父会话 effort
- **GIVEN** 父会话 `traex` / `GPT-5.6-Sol` / `medium`；目录支持 `low..xhigh` 但无目录默认、该模型也不在 `effortStarts` 中；允许列表含该模型；Jev 返回 bounded/higher
- **WHEN** 创建受管子会话并发出首个请求
- **THEN** 请求为 `traex` / `GPT-5.6-Sol` / `medium`，记录 `applied`

#### Scenario: 父会话 effort 也不可用时不改写并告警
- **GIVEN** 父会话 `traex` / `GPT-5.6-Sol` / `max`；目录只支持 `max`；允许列表含该模型；Jev 返回 bounded/baseline
- **WHEN** 创建受管子会话并发出首个请求
- **THEN** 请求与官方合成配置深度相等；记录 `{status: "unsupported", reason: "no-usable-route"}`；根会话状态出现 `childNotice`；无抛错

#### Scenario: 子任务 Jev 失败不改写
- **GIVEN** 根会话为 `AUTO`，子任务 Jev 返回 402
- **WHEN** 创建受管子会话并发出首个请求
- **THEN** 请求与官方合成配置深度相等；记录 `reason` 为 `jev-insufficient-credits`；根会话仍为 `AUTO` 且无 `disabled`；Jev 不重试

#### Scenario: 显式维度不可用时不替换
- **GIVEN** 根会话为 `AUTO`，effort 上限 `high`；父会话 `claude` / `claude-opus-5-5` / `medium`；目录与允许列表含 `claude-haiku-5-5`（支持 `low..xhigh`）与 `claude-opus-5-5`（只支持 `low`、`medium`）
- **WHEN** 分别以官方工具显式给出 `{model: claude-haiku-5-5, reasoning_effort: xhigh}`、`{reasoning_effort: xhigh}`、`{reasoning_effort: turbo}` 创建受管子会话（DSH 原生校验均已允许创建），各发出首个请求
- **THEN** 三个请求均与官方合成配置深度相等；记录 `reason` 均为 `explicit-unavailable`；第一个的 Jev 请求数为 0；没有任何请求的 effort 被改为 `medium` 或 `high`

#### Scenario: 只显式 effort 时能力槽须支持该 effort
- **GIVEN** 父会话 `claude` / `claude-opus-5-5` / `medium`；目录与允许列表含 `claude-haiku-5-5`（只支持 `low`、`medium`）与 `claude-opus-5-5`（支持 `low..xhigh`）；Jev 返回 bounded/baseline
- **WHEN** 以显式 `{reasoning_effort: high}` 创建受管子会话并发出首个请求
- **THEN** 请求为 `claude` / `claude-opus-5-5` / `high`

#### Scenario: 不改写的记录在重启后不重判
- **GIVEN** 三个子会话记录：`{status: "unsupported", reason: "no-usable-route"}`、旧 `{status: "needs-context", reason: "任务目标或范围不足"}`、旧 `{status: "failed", reason: "初始判断已取消"}`，均无 route
- **WHEN** 插件重启后各子会话再次发出请求
- **THEN** 三个请求均与官方合成配置深度相等，Jev 请求数为 0，无抛错

#### Scenario: 矛盾的记录组合被拒绝
- **GIVEN** 四个子会话记录：`unsupported` 但含 `route`；`applied` 但无 `route`；`recommended` 但含 `actual`；有 `route` 的 `failed`
- **WHEN** 各子会话发出请求，并尝试写入 `{status: "unsupported", reason: "whatever"}`
- **THEN** 四个请求均被拒绝，模型请求与 Jev 请求数均为 0；该写入抛错

#### Scenario: 冷恢复时初始决策中断
- **GIVEN** 子会话记录为 `recommended` 且无 route，插件已重启（内存中无 pending）
- **WHEN** 该子会话发出首个请求
- **THEN** 请求与官方合成配置深度相等；记录改写为 `{status: "unsupported", reason: "interrupted"}`；Jev 请求数为 0

#### Scenario: 已有 route 实时门禁失败仍拒绝
- **GIVEN** C 已应用 high route；分别发生 cap 降为 medium、允许列表撤销目标、目录不可用、允许列表不可用
- **WHEN** C 在各条件下发下一请求，含插件重启后的请求
- **THEN** 各次均被拒绝，模型与 Jev 请求数为零；C 记录字节不变；无新路由

#### Scenario: 子判断期间模式往返使旧结果失效
- **GIVEN** 根为 AUTO，子 Jev 或目录请求 pending
- **WHEN** 分别执行 AUTO→MANUAL、AUTO→MANUAL→AUTO，随后旧 Jev 返回成功或402（四组组合），或旧目录返回成功
- **THEN** 无 route 改写；记录 unsupported/mode-changed；不重判、无根 disabled、无 jev-insufficient-credits notice，无新 decision

### Requirement: 子任务未路由告警
退化链到达第 4 步时，系统 SHALL：以 Host logger 写一条 warn，只含子会话 id 与 `reason`，MUST NOT 含任务文本或凭据；在根会话的状态响应中返回 `childNotice = {id, childId, reason, at}`（仅内存，只保留最近一条，`id` 单调递增）。面板 SHALL 显示“最近子任务未路由：<reason>（按 DSH 默认运行）”。`decisionToast` 为 true 且出现新的 `childNotice.id` 时，client SHALL 以与决策提示相同的位置与时长显示该文本一次。`childNotice` MUST NOT 计入 `decision`，不改变「决策提示」中“判断失败不记录新决策”的规则。

#### Scenario: 未路由告警可见且只提示一次
- **GIVEN** 开关开启；根会话 R 的受管子会话因 `no-usable-route` 未路由
- **WHEN** 连续两次读取 R 的状态并渲染
- **THEN** 两次都含 `childNotice.reason = "no-usable-route"` 与同一 `id`；提示只显示一次，含“未路由”；面板含“按 DSH 默认运行”；Host logger 恰有一条含该子会话 id 的 warn

#### Scenario: 告警不泄漏任务文本且开关关闭不弹出
- **GIVEN** 开关关闭；子任务文本含 `SECRET-TASK`，子任务 Jev 返回 401
- **WHEN** 读取 R 状态、渲染芯片，并读取 logger 输出
- **THEN** 不弹出提示，面板仍显示 `jev-unauthorized`；状态响应、面板文本与日志均不含 `SECRET-TASK`；`decision` 未因此更新

### Requirement: 子会话不显示 AUTO 芯片
对 `origin = "subagent"` 会话，`state` 端点 SHALL 返回 200 与 `{applicable: false}`，不含模式等字段，不修改任何状态；该响应 MUST 在任何主会话支持判定、模式锁定或状态装饰之前返回，原始 HTTP 与 RPC envelope 两条路径的 value 都恰为 `{applicable: false}`。client 收到 `applicable: false` 时 SHALL 不渲染芯片、面板与提示，并停止对该会话的轮询与选择订阅；`sessionId` 切换为其它会话时 SHALL 按新会话重新开始。普通会话的芯片行为不变。

#### Scenario: 子会话不渲染芯片且停止轮询
- **GIVEN** 会话 C 为子会话
- **WHEN** client 挂载芯片并经过 10 秒，随后把 `sessionId` 切换为普通会话 S 再经过 4 秒
- **THEN** C 期间渲染结果为空，C 的状态 RPC 恰调用 1 次；切换后渲染 S 的芯片，S 的状态 RPC 至少调用 2 次

#### Scenario: 带旧 AUTO 状态的子会话不被改写
- **GIVEN** 子会话 C 的状态文件中有 `mode: AUTO`，C 的模型不在支持范围
- **WHEN** 分别以原始 HTTP 与 RPC envelope 调用 C 的 `state`
- **THEN** 两次 value 都恰为 `{applicable: false}`；C 的状态文件字节不变

#### Scenario: 状态读取失败的普通会话保持原行为
- **GIVEN** 普通会话 S 的首次状态 RPC 失败，之后恢复正常
- **WHEN** client 挂载芯片并经过两次轮询间隔
- **THEN** 芯片仍渲染（失败时显示错误），恢复后显示模式；轮询未停止

### Requirement: 模型家族策略注册表
系统 SHALL 把与模型家族相关的全部知识集中在包内 `src/strategies/`：每个家族一个策略文件，导出只读数据对象 `{id, label, modelPrefixes, effortStarts, childModels}`，MUST NOT 含 provider 或 transport 相关字段。注册表构造时 SHALL 校验：`id` 唯一；不同策略的 `modelPrefixes` 在忽略大小写后互不为前缀；`effortStarts` 的键在全体策略间唯一，值属于 `low | medium | high | xhigh`；`childModels` 三个槽位齐全且不含 `/`；策略对象不含上述五个以外的键。任一校验失败 SHALL 抛出指明冲突项的错误，插件加载失败，MUST NOT 以部分策略运行。

匹配规则（`bare(id)` 指 id 最后一个 `/` 之后的部分）：
- 家族：`bare(model)` 忽略大小写以某策略的 `modelPrefixes` 开头。主会话支持判定与子模型家族识别使用同一规则。
- effort 起点：`bare(model)` 大小写敏感地在 `effortStarts` 中查找；未找到时使用目录 `defaultEffort`。
- 能力槽解析：在 provider P 的目录中找同时满足以下两点的条目：`bare(entry.model)` 与槽位模型忽略大小写相等；`entry.model` 最后一个 `/` 之前的部分（无 `/` 时为空串）与父模型的这一部分完全相等。恰好一个时采用该条目的完整 id，否则视为未找到。

provider MUST NOT 从注册表派生，也 MUST NOT 用于过滤目录、允许列表、预览工具参数或决策记录。`src/` 中注册表以外的模块 MUST NOT 出现家族模型 id 或家族前缀字面量。

#### Scenario: 内置注册表可构造且不含 provider 知识
- **GIVEN** 内置两个策略，以及内置策略加合成策略 `deepseek`（`modelPrefixes: ["deepseek-"]`，`effortStarts: {"deepseek-v5": "medium"}`，三个能力槽均为 `deepseek-v5`）
- **WHEN** 分别构造注册表
- **THEN** 两次都成功；任何策略对象都没有 `transports` 键；注册表没有 `providers`、`hasProvider` 方法

#### Scenario: 冲突的注册表拒绝构造
- **GIVEN** 七份策略列表（内置策略加一个除所述缺陷外合法的合成策略）：`id` 重复为 `codex`；`modelPrefixes` 为 `GPT-6-`；起点为 `max`；`effortStarts` 重复内置键 `gpt-6-luna`；`childModels` 缺少 `frontier`；能力槽为 `codex/gpt-6-luna`；含 `transports` 键
- **WHEN** 分别构造注册表
- **THEN** 七次都抛错，错误信息分别含重复的 id、重叠的模型前缀、非法 effort、重复的起点键、缺失的槽位名、含 `/` 的槽位、未知键 `transports`；不返回部分注册表

#### Scenario: effort 起点按模型名查找且保持原结果
- **GIVEN** 内置注册表；目录支持 `low..max`；effort 上限 `xhigh`
- **WHEN** 分别以下列输入计算主 effort（模型、depth、目录默认 effort）
- **THEN** `claude-opus-5-5`、`claude-sonnet-5-5`、`claude-haiku-5-5`、`gpt-6.1-sol` 的 lower/baseline/higher 为 `low/medium/high`；`claude-fable-5-1`、`gpt-6-luna` 为 `medium/high/xhigh`；`gpt-6-astra` 为 `low/low/medium`；`claude/claude-opus-5-5` 与 Opus 相同；`opencode-go/gpt-6-luna`（目录默认 `low`）与 Luna 相同；`CLAUDE-OPUS-5-5`、`claude-unknown`、`gpt-7` 在目录默认 `low` 时为 `low/low/medium`，无目录默认时抛出 unsupported 错误

#### Scenario: effort 边界保持原结果
- **GIVEN** 内置注册表；除个别用例另行给出外，目录支持 `[low, medium, high, xhigh, max]`，effort 上限 `xhigh`
- **WHEN** 计算：Opus higher，支持 `[low, medium, xhigh, max]`；Luna higher，上限 `high`；Luna baseline，上限 `medium`；Astra lower，支持 `[low, medium]`；`deepseek-v4.1-flash` baseline，目录默认 `max`；Opus baseline，只支持 `[max]`
- **THEN** 依次为 `xhigh`、`high`、`medium`、`low`、抛出“起点不可验证”错误、抛出“起点不可验证”错误

#### Scenario: 新增家族只需新增策略
- **GIVEN** 测试以内置策略加合成策略 `deepseek` 构造注册表并注入插件；`opencode-go` 目录与官方允许列表含 `deepseek-v5`，支持 `low..xhigh`
- **WHEN** 主模型为 `opencode-go` / `deepseek-v5` 的 AUTO 会话收到 depth `higher`，经官方 fresh 子会话工具创建一个 Jev 判为 bounded/baseline 的子任务，随后重启插件（同一注册表）并让该子会话再发一次请求
- **THEN** `autoSupport.supported = true`，主请求 effort 为 `high`；子会话记录含 `family: "deepseek"` 与 route `opencode-go` / `deepseek-v5` / `medium`，状态 `applied`；重启后的请求使用同一 route 且 Jev 请求数不增加；注册表以外的源码文件没有修改

#### Scenario: 记录中的家族已不在注册表
- **GIVEN** 决策记录目录中有一个以合成 `deepseek` 注册表写入、已有 route 的子会话记录，插件改用只含内置策略的注册表重启
- **WHEN** 该子会话发出请求
- **THEN** 请求被拒绝且错误含“无法恢复”，Jev 请求数为 0，不改用其它路由；只含内置家族的记录照常恢复

#### Scenario: 家族知识只有一个来源
- **GIVEN** 包内 `src/` 源码
- **WHEN** 测试扫描 `src/strategies/` 以外的全部源码文件（含 client）
- **THEN** 不出现 `claude-haiku-5-5`、`claude-sonnet-5-5`、`claude-opus-5-5`、`claude-fable-5-1`、`gpt-6-luna`、`gpt-6.1-sol`、`gpt-6-astra` 字面量，不出现 `'claude' | 'codex'` 联合类型、`p.id === 'claude'` 一类 provider 判断，或以 `claude-`、`gpt-` 为前缀判定家族的正则与字符串比较；全部源码不出现标识符 `transports`、`hasProvider`

#### Scenario: 未登记的 provider 不被枚举拒绝
- **GIVEN** 根会话为 `AUTO`，父会话 provider `traex`
- **WHEN** 以 provider `traex` 写入并读回一条受管子会话记录，并以 `{provider: "traex"}` 调用 `route_subagent`
- **THEN** 记录写入与读回成功且 provider 为 `traex`；工具参数校验通过，结果不是“provider 不在已注册家族中”一类错误

### Requirement: 内置模型家族策略
内置注册表 SHALL 恰含两个策略：
- `claude`（label `Claude`）：`modelPrefixes: ["claude-"]`；`effortStarts`：`claude-opus-5-5`、`claude-sonnet-5-5`、`claude-haiku-5-5` 为 medium，`claude-fable-5-1` 为 high；`childModels`：bounded `claude-haiku-5-5`、analytical `claude-sonnet-5-5`、frontier `claude-opus-5-5`。
- `codex`（label `GPT`）：`modelPrefixes: ["gpt-"]`；`effortStarts`：`gpt-6.1-sol` 为 medium，`gpt-6-luna` 为 high，`gpt-6-astra` 为 low；`childModels`：bounded `gpt-6-luna`、analytical `gpt-6.1-sol`、frontier `gpt-6.1-sol`。

子模型的实际 id 取自 provider 目录中按能力槽解析规则找到的条目。

#### Scenario: 内置子路由与原行为一致
- **GIVEN** 内置注册表；`claude`、`codex`、`dsh-magpie-connector`、`dsh-magpie-connect` 的目录与允许列表含原有全部能力槽模型（Magpie 下为 `claude/…`、`codex/…`），均支持 `low..xhigh`
- **WHEN** 以父模型 `claude-opus-5-5`、`gpt-6.1-sol`、`claude/claude-opus-5-5`、`codex/gpt-6.1-sol` 在各自 provider 下计算 bounded/analytical/frontier × lower/baseline/higher 的子路由
- **THEN** 结果与本变更前 `choosePolicyRoute` 的输出深度相等，例如 `codex` bounded baseline → `gpt-6-luna` / `high`，`dsh-magpie-connector` + 父 `claude/…` frontier lower → `claude/claude-opus-5-5` / `low`，`claude` bounded baseline → `claude-haiku-5-5` / `medium`

#### Scenario: 能力槽只在父 provider 内解析
- **GIVEN** 父会话 `traex` / `GPT-5.6-Sol`；`codex` 目录与允许列表含 `gpt-6-luna`，`traex` 目录不含；允许列表含 `traex` / `GPT-5.6-Sol`
- **WHEN** 计算 bounded/baseline 子路由
- **THEN** route provider 为 `traex`，模型为 `GPT-5.6-Sol`；结果不含 `codex` 或 `gpt-6-luna`

#### Scenario: 能力槽须与父模型前缀相同
- **GIVEN** provider `dsh-magpie-connect`；目录与允许列表只含 `opencode-go/gpt-6-luna` 与 `codex/gpt-6.1-sol`（均支持 `low..xhigh`）；父模型为 `codex/gpt-6.1-sol`
- **WHEN** 计算 bounded/baseline 子路由
- **THEN** 能力槽视为未找到（`opencode-go/gpt-6-luna` 前缀不同）；route 为 `dsh-magpie-connect` / `codex/gpt-6.1-sol` / `medium`

## MODIFIED Requirements

### Requirement: 手动隔离与失败可见
MANUAL SHALL 不触发新判断或主请求覆盖；此前绑定的子实例 SHALL 恢复既定路由。输入 SHALL 仅使用官方 user 来源并脱敏限长。主判断失败 SHALL 可见停用 AUTO；子任务路由不可用或子任务判断失败 SHALL 按「子任务路由退化链」不改写并可见告警，MUST NOT 换 provider 或改用能力槽以外的模型。provider SHALL 保留完整 ID；未知能力家族保持父模型只调 effort，未知推荐 effort 不猜。OpenRouter只用于Jev。性能与成本缺少证据 SHALL 标未知。

#### Scenario: AUTO 不改主 provider/model
- **WHEN** AUTO 调整主 effort
- **THEN** 请求按支持范围生效，主 provider/model 保持；effort 变化时只以同 provider/model 经官方 selectModel 同步

#### Scenario: 子失败不换模且可见
- **GIVEN** 根会话为 `AUTO`，受管子任务 Jev 超时
- **WHEN** 子会话发出首个请求
- **THEN** 请求与官方合成配置深度相等（未换 provider/model）；根会话状态含 `childNotice.reason = "jev-timeout"`

### Requirement: Magpie 兼容不扩大权限与能力范围
新旧 Magpie 的候选 SHALL 同时满足精确 provider/model 的实时目录能力、自动 effort cap、当前官方允许列表及存在时的父会话 captured allowlist；不满足时 SHALL 按「子任务路由退化链」继续，MUST NOT 改写为该候选。兼容分类 SHALL NOT 将另一 transport 的许可视为本 transport 许可，不添加或放宽任何 allowlist 项，不静默突破能力或 effort cap；沿用父会话模型同样须满足上述全部条件。持久记录损坏 SHALL 继续 fail closed。

#### Scenario: GPT 主子保持同 transport 及支持的 effort
- **GIVEN** AUTO Magpie GPT 主模型与同 transport 的 bounded GPT 子模型均在目录/允许列表内且支持目标 effort
- **WHEN** 主请求和 fresh 子请求应用新默认策略
- **THEN** 主 provider/model 不变并应用支持的 effort；子使用同 transport 的 codex/gpt-6-luna，持久恢复后保持身份和 effort

#### Scenario: 更新全局目录不能扩大父 captured allowlist
- **GIVEN** 任一 Magpie 父会话 captured allowlist 不含当前目标，即使较新全局目录和列表已含该目标
- **WHEN** 创建需要该目标的子实例
- **THEN** 子请求不被改写为该目标（按退化链保持父模型只调 effort，或不改写并告警），无越权实际子请求；另一 Magpie transport 的许可与不支持/超过 cap 的 effort 也不能使该目标被选用

### Requirement: Jev 失败即停用并提示
主会话 Jev 调用失败时，系统 SHALL 把该会话转为 `MANUAL`（与用户切 MANUAL 相同：废止本回合 AUTO 决定，本回合不改写、不复原 effort），MUST NOT 改写 provider/model，同时持久记录 `disabled = {category, at}`；MUST NOT 以任何本地规则或其它模型得出判断。失败类别为闭集：`missing-credential`（凭据缺失，不发请求）、`insufficient-credits`（402）、`unauthorized`（401/403）、`rate-limited`（429）、`region-blocked`（451）、`rejected`（其它 4xx 或被拒绝的重定向）、`unavailable`（5xx 或网络错误）、`timeout`（期限到达）、`invalid-response`（非 JSON、缺所需维度的 choice，或 choice 不属于规则文件该维度的 criteria）。HTTP 200 但 body 含数字 `error.code` 时 SHALL 按该 code 套用上述映射。调用方取消（用户取消回合）MUST NOT 视为失败：不停用、不写 `disabled`、本回合不改写。停用 SHALL 保持到用户把模式设为 `AUTO`，此时清除 `disabled`；系统 MUST NOT 轮询、主动查询余额或自动恢复 AUTO。子任务判断失败、取消或返回 `insufficient_context` 时 SHALL 按「子任务路由退化链」第 4 步不改写并告警，MUST NOT 停用根会话或写入 `disabled`。`disabled`、错误结果与日志 MUST NOT 包含凭据或响应体。

#### Scenario: 各状态码映射为闭集类别
- **GIVEN** 假 Jev 服务分别返回 402、401、403、429、451、404、500、网络断开、超过期限无响应、200 但 body 非 JSON、200 但 depth choice 为 `huge`、200 但 body 为 `{error: {code: 402}}`，以及 launch environment 中缺少凭据
- **WHEN** 每种情况下 AUTO 会话发起一个用户回合
- **THEN** `disabled.category` 依次为 `insufficient-credits`、`unauthorized`、`unauthorized`、`rate-limited`、`region-blocked`、`rejected`、`unavailable`、`unavailable`、`timeout`、`invalid-response`、`invalid-response`、`insufficient-credits`、`missing-credential`；缺凭据时假服务未收到请求

#### Scenario: 停用后不再调用 Jev 且不改写
- **GIVEN** 上一回合 AUTO 已输出 `high`，官方此后合成 `high`，本回合 Jev 返回 402
- **WHEN** 本回合首个请求及下一用户回合请求发出
- **THEN** 会话为 `MANUAL` 且 `disabled.category` 为 `insufficient-credits`；两个请求均与官方合成配置深度相等（effort `high`）；下一用户回合 Jev 请求次数为 0，`disabled` 仍保留

#### Scenario: 用户重新点 AUTO 清除停用
- **GIVEN** 会话因 `timeout` 停用，主模型 `claude-opus-5-5`
- **WHEN** 用户把模式设为 `AUTO`，下一用户回合 Jev 返回 depth `lower`
- **THEN** `disabled` 被清除；该回合 Jev 请求 1 次，effort 为 `low`

#### Scenario: 用户取消不是失败
- **GIVEN** 会话为 `AUTO`，Jev 请求进行中
- **WHEN** 用户取消该回合
- **THEN** Jev 请求被中止；会话仍为 `AUTO`，无 `disabled`，下一用户回合重新请求 Jev

#### Scenario: 凭据与响应体不泄漏
- **GIVEN** 凭据为 `sk-or-test-SECRET`，假服务返回 401 且响应体含 `SECRET-BODY`
- **WHEN** 读取状态文件、状态端点响应与面板渲染文本
- **THEN** 均不含 `sk-or-test-SECRET` 或 `SECRET-BODY`

#### Scenario: 子任务判断失败不停用根会话
- **GIVEN** 根会话为 `AUTO`；子任务 Jev 依次返回 429 与 `insufficient_context`
- **WHEN** 两个受管子会话各发出首个请求
- **THEN** 两个请求均与官方合成配置深度相等；记录 `reason` 分别为 `jev-rate-limited`、`needs-context`；根会话仍为 `AUTO` 且无 `disabled`

### Requirement: Host 端点边界
本插件只提供以下经 `connection.fetch.register` 注册的端点：会话级的 `state`、`setMode`、`label`、`observe`、`childRouting`，以及不带会话的 `settings`、`saveSettings`、`setKey`、`testDecision`（后四者见「设置页」与 auto-decision-services-feedback，不读写任何会话状态）。会话级端点 SHALL 以请求体 `sessionId` 经官方会话控制器解析目标会话（与官方会话端点同一授权模型）；`sessionId` 缺失、非字符串或无法解析时 SHALL 返回 4xx 且不修改任何状态；指向 `origin = "subagent"` 会话时，`setMode`、`label`、`observe` SHALL 返回 4xx 且不修改任何状态，`state` SHALL 返回 200 与 `{applicable: false}`（见「子会话不显示 AUTO 芯片」），`childRouting` 只读，有记录时返回该子会话的决策记录，并在响应顶层附加 `scopeNote: "按官方工具 ALS 上下文、同父与 startup 绑定；不能区分同窗口插件旁支，旁支可能一并受管。"`（仅响应说明，不写回记录）；无记录时仍返回 `{status: "unsupported"}`。`setMode` SHALL 只修改该会话的模式与 `disabled`（设为 `AUTO` 时清除），`mode` 不属于 `AUTO | MANUAL` 时返回 4xx。`label` 参数为 `{sessionId, messageId, feedback?}`，语义见 auto-allocation-feedback；`observe` 参数为 `{sessionId, messageId}`。普通会话的 `state` SHALL 返回模式、`disabled`（如有）、`autoSupport`、最近决策与 `childNotice`（如有）。

#### Scenario: 无效会话被拒绝且无副作用
- **GIVEN** 会话 S1 为 `AUTO`；`session-unknown` 无法解析；`session-child` 为子会话
- **WHEN** 分别以无 `sessionId`、`sessionId: 42`、`session-unknown`、`session-child` 调用设置模式（`MANUAL`）
- **THEN** 四次均返回 4xx；S1 仍为 `AUTO`；所有会话状态不变

#### Scenario: 只修改目标会话
- **GIVEN** 会话 S1 与 S2 均为 `AUTO`
- **WHEN** 以 `sessionId: S1, mode: "MANUAL"` 调用设置模式
- **THEN** S1 为 `MANUAL`；S2 的模式与 `disabled` 不变

#### Scenario: label 响应以绑定是否存在区分
- **GIVEN** S1 的回复 m1 绑定了已应用主决策（depth `higher`、model `claude-opus-5-5`、effort `high`），回复 m2 无绑定
- **WHEN** 以 m1、m2 调用 `label`，并在 client 渲染两条回复的操作项且 m1 连续可见 3 秒
- **THEN** m1 响应含 `depth: higher`、`model`、`effort`，不含 `policy`；m2 响应为 `{}`；client 为 m1 渲染分配反馈按钮（Tooltip 以 `AUTO 分配：higher → high · claude-opus-5-5` 开头）并发出一次 `observe`，m2 渲染为空且不发出 `observe`

#### Scenario: 子会话状态返回不适用
- **GIVEN** `session-child` 为子会话，`session-unknown` 无法解析
- **WHEN** 分别以二者调用 `state`
- **THEN** 前者返回 200 且 body 恰为 `{applicable: false}`，状态文件不变；后者返回 4xx

### Requirement: 子会话派发时机写入环境级指令
`instructions/dsh-home.md` SHALL 包含一节“子会话派发”，由主 Agent 决定是否派发，内容至少包括：
- 派发：实施已批准计划中工作量较大的编码任务；独立评审或复核（需要新上下文）；中间输出多的探索（大范围搜索、读日志、跑测试），只带回结论；彼此独立、可并行的多块工作。
- 不派发：与用户讨论或做决定的回合；前后依赖且主会话上下文装得下的工作；单个小修复。
- 本身是子会话时不再向下派发，除非任务明确要求。
- 派发时直接使用官方 fresh 创建工具，只传用户或 lead 指定的 provider、model、reasoning_effort；AUTO 会在创建时自行选配。派发前不需要先调用 `route_subagent`，它只是可选预览，其推荐结果 MUST NOT 作为显式参数传给官方工具；预览返回错误时暂停委派并询问用户。详细规则见 `subagent-model-routing` skill。
该节 MUST NOT 引用具体模型名或 effort 值（唯一来源为插件代码）。本 change MUST NOT 新增物化机制，沿用 `agentInstructions` 将其物化为 `$DSH_HOME/AGENTS.md`（已有 `tests/sync-agent-instructions.test.mjs` 覆盖物化、幂等与撤销）。

#### Scenario: 环境级指令含派发规则且不含模型名
- **GIVEN** 仓库中的 `instructions/dsh-home.md`
- **WHEN** 测试读取其文本
- **THEN** 含标题“子会话派发”，含“独立评审”“并行”“route_subagent”“不派发”与“本身是子会话时不再向下派发”；含“官方 fresh 创建工具”“只传用户或 lead 指定”“不需要先调用 `route_subagent`”与“暂停委派并询问用户”；不含“必须先调用 `route_subagent`”与“全部显式传给”；不含任何 `claude-`、`gpt-` 开头的模型名，也不匹配 `\bxhigh\b`、`\bmax\b`

#### Scenario: 指令不要求把预览结果当显式参数
- **GIVEN** 仓库中的 `instructions/dsh-home.md` 与包内 `skills/subagent-model-routing/SKILL.md`
- **WHEN** 测试读取两者文本
- **THEN** 两者都不含“返回档位”或“全部显式传给子会话工具”一类要求；skill 中关于预览的条目与环境级指令都表述为可选

### Requirement: 插件安装自包含配套 skill
安装本插件 SHALL 同时提供 `route_subagent` 工具与 `subagent-model-routing`、`auto-model-routing-report` 两个 skill，不依赖 ohmydsh 根目录的 skills 或环境级指令。`subagent-model-routing` SHALL 只描述当前 AUTO 的子任务用法，并以不含版本的表述保留仍然成立的规则，至少包括：(1) 使用官方 fresh 创建工具并给出清楚的目标与范围；(2) 用户或 lead 显式指定的模型与 effort 照实传递，只指定一个维度时只判断另一个；(3) `route_subagent` 只是预览，`recommended` 不等于已应用，不把推荐当成用户显式约束；(4) 主会话为 MANUAL 时工具返回 `routed: false`，按官方默认委派，只传用户或 lead 指定的值；(5) 在 `description` 末尾以 `[model·effort]` 标注；(6) fork 与父会话保持一致、AUTO 不路由，需要按任务选配时改用 fresh；(7) 通过 `childRouting` 查看应用证据；(8) 派发不需要先预览，路由只在创建时判断一次；若调用了预览：返回 `status: "fallback"` 时按官方默认委派并向用户简要说明原因，返回 `status: "needs-context"` 时补充目标与范围后再派发，返回错误（含判断被取消）时暂停委派并询问用户，不猜测、不换模型、不改由主会话完成、不自治重试；(9) 工具不存在时告知“子会话 Jev 选模未启用”并按官方默认委派；(10) 复用已有子会话前比较其标注，需要更高投入、不同家族或无法确认时新建。skill MUST NOT 含四档规则或“原策略/旧策略/回滚”段落，MUST NOT 声称仅注册 skill 就能强制 Agent 每次委派前执行工具，MUST NOT 要求把预览结果作为显式参数传给官方工具，且 SHALL 与「子会话派发时机写入环境级指令」一致。ohmydsh SHALL 仅保留插件的 local customization；禁用插件并重新装配后，其工具及包内 skill SHALL 均不可用，用户设置与历史记录 SHALL 保留。

#### Scenario: 干净安装获得唯一 skill
- **WHEN** 在不含 ohmydsh 指令或全局 skill 的干净 DSH profile 安装并加载发布包
- **THEN** 真实 Host 的 skill catalog 中 `subagent-model-routing` 恰好出现一次；工具集包含 `route_subagent`

#### Scenario: skill 只含当前用法
- **WHEN** 测试读取包内 `skills/subagent-model-routing/SKILL.md`
- **THEN** 文本含 `route_subagent`、`fresh`、`recommended`、`routed: false`、`fallback`、`needs-context`、“不需要先预览”、`[model·effort]`、`fork`、`childRouting`、“暂停委派并询问用户”、“子会话 Jev 选模未启用”与“新建”；不含“fork 不支持”、“显式传给”、`simple`、`escalated`、`legacy`、`原策略`、`旧策略`、`回滚`，也不含任何 `claude-`、`gpt-` 开头的模型名

#### Scenario: 旧部署迁移无重复来源
- **GIVEN** 上一版本通过 manifest 的独立 skill 条目产生受管副本
- **WHEN** 升级并连续执行两次隔离 sync，再重新装配 Host
- **THEN** 旧受管副本不再存在，包内 skill 恰好注册一次，第二次 sync 为 no-op；现有配置、模式与历史记录未被修改

#### Scenario: 插件禁用撤销 skill 与工具
- **WHEN** 从 profile 移除插件或在 ohmydsh 禁用插件后同步并重新装配
- **THEN** 本插件提供的 skill 和工具不再注册；非插件管理的 skill 与既有数据不被删除

### Requirement: AUTO 主模型支持范围与不可用锁定
AUTO SHALL 只处理注册表中有策略匹配的主模型：主模型 id 去掉最后一个 `/` 及其之前部分后，以某策略的任一 `modelPrefixes` 开头（大小写不敏感）即视为支持；当前内置注册表即 `claude-` 与 `gpt-`。其余模型 SHALL 视为不支持。当前主模型不在支持范围时，系统 MUST NOT 发起 Jev 判断、MUST NOT 改写该请求，并 SHALL 把会话模式持久化为 `MANUAL`；状态接口 SHALL 返回当前选择与 `autoSupport = { supported: false, provider, model }`。模式按主模型切换实时推导：切回受支持模型后 `autoSupport.supported` SHALL 为 `true` 且芯片恢复可点击，模式保持 `MANUAL`，MUST NOT 自动恢复 `AUTO`。主模型在支持范围内但自动 effort 映射不可得（目录没有可用 `low|medium|high|xhigh`、推荐起点不可验证、或自动 effort 上限排除全部候选）时，主请求 SHALL 保持官方合成配置、`reason` 为 `no-effort-support`，MUST NOT 阻断请求、停用 AUTO 或记为 Jev 失败。子任务无法给出可用 effort 时 SHALL 按「子任务路由退化链」处理，MUST NOT 阻断子请求。锁定态面板 SHALL 以注册表各家族 label 说明支持范围。

#### Scenario: 切换到不支持的主模型自动锁定
- **GIVEN** 会话为 `AUTO`，主模型为 `opencode-go/deepseek-v4.1-flash`
- **WHEN** 用户切换模型后读取状态或发出下一回合请求
- **THEN** 模式持久化为 `MANUAL`；状态含 `autoSupport = { supported: false, provider: 'opencode-go', model: 'deepseek-v4.1-flash' }`；该回合 Jev 请求次数为 0，模型请求的 provider/model/effort 与官方合成配置深度相等

#### Scenario: 不支持模型的请求不再导致整轮失败
- **GIVEN** 会话此前在 AUTO 下正常完成过回合，用户随后把主模型切换为不支持范围
- **WHEN** 用户发出下一回合请求
- **THEN** 回合正常结束（`turn/end` 不为 error）；请求照常发出且未被改写；会话保持 `MANUAL`，不产生 `disabled` 记录

#### Scenario: 芯片锁定态与悬停提示
- **GIVEN** 状态接口返回 `mode: 'MANUAL'` 与 `autoSupport = { supported: false, provider: 'opencode-go', model: 'deepseek-v4.1-flash' }`
- **WHEN** 渲染芯片并悬停或聚焦整个按钮
- **THEN** 芯片可见文本为 `MANUAL`，其后是描边 info 图标；按钮带 `aria-disabled` 标记且点击不发出 `setMode` 请求；面板说明 AUTO 目前仅支持 Claude / GPT 系列模型，并给出 `https://github.com/prgrmrwy/dsh-auto-model-routing` 链接；锁定时不使用 Jev 停用的红色警示样式

#### Scenario: 切回受支持模型后恢复可切换
- **GIVEN** 会话因主模型不支持而处于 `MANUAL` 锁定态
- **WHEN** 主模型切回 `claude` / `gpt` 系列
- **THEN** 状态返回 `autoSupport.supported = true`；芯片恢复普通 `MANUAL` 显示与切换图标且可点击；用户点击后才进入 `AUTO`

#### Scenario: 支持范围判定只依据注册表
- **GIVEN** 内置注册表
- **WHEN** 判定 `claude-opus-5-5`、`gpt-6-astra`、`GPT-5.6-Sol`、`CLAUDE-fable-5-1`、`claude/claude-opus-5-5`、`codex/gpt-6.1-sol`，以及 `deepseek-v4.1-flash`、`glm-5.3`、`kimi-k3`、`opencode-go/deepseek-v4.1-flash`、空串、undefined
- **THEN** 前六个为支持，其余为不支持

#### Scenario: 支持范围内映射不可得不阻断请求
- **GIVEN** 会话为 `AUTO`，主模型属于 Claude / GPT 系列，但官方目录只提供 `max`（或自动 effort 上限排除了全部可用候选）
- **WHEN** 本回合首个请求发出
- **THEN** 请求配置与官方合成配置深度相等，`reason` 为 `no-effort-support`；请求成功发出，AUTO 未被停用，未记为 Jev 失败

### Requirement: AUTO 决策与执行
主会话 SHALL 仅判断 depth=lower/baseline/higher，并在模型支持序列中以所属家族策略的推荐起点最多移动一档，不修改 provider/model；选定 effort 与官方合成值不同时，按「AUTO 主 effort 同步官方选择」经官方 selectModel 同步。子任务 SHALL 只在「AUTO 受管子会话范围」内路由：独立判断 capability=bounded/analytical/frontier 或 insufficient_context，按「子任务路由退化链」确定 route，保留显式模型/effort，完全显式时不调用 Jev。受管子会话 SHALL 按精确 child ID 绑定、持久化，实际请求匹配后标 applied；恢复不重判。fork 不属于受管范围，SHALL 与父会话保持一致、原样放行，MUST NOT 报错或悄悄改为 fresh。Agent 保留编排和验收权，不实现自主重试升级。

#### Scenario: Magpie 自动子路由
- **WHEN** Magpie GPT 主会话为 AUTO 且创建 bounded 子任务
- **THEN** 从允许列表和实时目录验证同 transport 的 codex/gpt-6-luna 及支持 effort，持久绑定精确 child；不得转到本地入口

#### Scenario: 未登记 provider 的 GPT 主会话可以派子任务
- **GIVEN** 根会话为 `AUTO`，provider `traex`、模型 `GPT-5.6-Sol`
- **WHEN** 经官方 `subagent` 工具创建子会话（不传 provider/model/effort）
- **THEN** 工具执行不抛错；子会话受管，记录 `explicit.provider` 为 `traex`、`family` 为 `codex`；首个请求 provider 为 `traex`

### Requirement: 子任务路由预览工具
系统 SHALL 注册 Host 工具 `route_subagent`，参数 `{task: string, provider: string, model?: string, reasoning_effort?: string, path?: "ordinary" | "fork" | "teammate"}`；`provider` 为任意非空字符串，不设枚举。描述 SHALL 说明：该工具是可选预览，派发不需要先调用它；它只给出推荐，不代表已应用，推荐结果不应作为显式参数传给官方工具；正式自动路由在官方 fresh 创建工具创建的精确子会话首次请求前独立完成；会把脱敏任务文本发送给所选决策服务。

工具 SHALL 先按子会话链找到所属主会话（链上任一会话不在 live 注册表中时视为 MANUAL）。所属主会话不是 `AUTO` 时 SHALL 返回非错误结果 `{routed: false, reason: "manual"}`，MUST NOT 请求 Jev。`path` 为 `fork` 时 SHALL 返回非错误结果 `{routed: false, status: "unsupported", reason: "fork"}`，MUST NOT 请求 Jev。`model` 与 `reasoning_effort` 都给出时 MUST NOT 请求 Jev；只给出一个时只判断另一维度；都未给出时判断 capability 与 depth。capability 为 `insufficient_context` 时 SHALL 返回 `{routed: false, status: "needs-context"}`。路由 SHALL 以调用会话此刻的 provider/模型/effort 为父快照，按「子任务路由退化链」与「模型家族策略注册表」计算；退化链到达第 4 步或 Jev 失败时 SHALL 返回非错误结果 `{routed: false, status: "fallback", reason}`，MUST NOT 返回其它模型；Jev 被取消时 SHALL 返回错误，内容含“已取消”与“暂停委派并询问用户”。成功时 SHALL 返回 `{status: "recommended", capability?, depth, provider, model, reasoning_effort}`。工具内部异常 SHALL 返回错误，内容含“暂停委派并询问用户”。工具 MUST NOT 写入任何会话状态或决策记录。插件 SHALL 随包提供 skill `subagent-model-routing`。

#### Scenario: AUTO 下返回推荐且保留显式维度
- **GIVEN** 所属主会话为 `AUTO`，主模型 `claude` / `claude-opus-5-5`；目录与允许列表含 `claude-haiku-5-5`（支持 `low..xhigh`）；Jev 返回 capability `bounded`、depth `baseline`
- **WHEN** 依次以 `{provider: claude}`、`{provider: claude, model: claude-haiku-5-5, reasoning_effort: high}`、`{provider: claude, path: fork}` 调用
- **THEN** 第一次返回 `{status: recommended, model: claude-haiku-5-5, reasoning_effort: medium}`；第二次返回 `reasoning_effort: high`；第三次返回非错误的 `status: unsupported`；假 Jev 服务共收到 1 个请求

#### Scenario: MANUAL 与不可用路由
- **GIVEN** 会话 S1 为 `MANUAL`；会话 S2 为 `AUTO`，主模型 `codex` / `gpt-6.1-sol`、effort `max`，官方允许列表为空，目录中该模型只支持 `max`
- **WHEN** 在 S1 与 S2 中各以 `{provider: codex}` 调用
- **THEN** S1 返回 `{routed: false, reason: manual}` 且 Jev 请求数为 0；S2 返回非错误的 `{routed: false, status: fallback}`，`reason` 为 `no-usable-route`，不返回任何模型；两个会话的模式与 `disabled` 不变

#### Scenario: 预览失败与取消的区分
- **GIVEN** 会话 S 为 `AUTO`，目录与允许列表正常
- **WHEN** 分别在假 Jev 返回 insufficient_context、返回 402、以及调用方中止信号触发时以 `{provider: claude}` 调用
- **THEN** 第一次返回非错误 `{routed: false, status: needs-context}`；第二次返回非错误 `{routed: false, status: fallback, reason: jev-insufficient-credits}`；第三次返回错误且内容含“已取消”；S 的模式与 `disabled` 不变，无决策记录写入

### Requirement: AUTO 的双 Magpie 精确 transport 兼容
AUTO SHALL 在目录、子任务路由、预览工具与持久化恢复中保持 `dsh-magpie-connector`、`dsh-magpie-connect` 及其它任意 provider 的精确 provider 与完整 model ID，不把两者互为 alias，也不转到本地 claude/codex；这些 provider 无需任何登记。模型不属于任何已注册家族且未显式给出模型时，SHALL 保持父会话模型、按退化链只调 effort；显式给出此类模型时，effort 须可由目录默认验证，否则按退化链处理。所属根会话为 MANUAL 时预览工具 SHALL 返回 `{routed: false, reason: "manual"}`，不判断、不外发、不写状态；此前已绑定实例继续按既定精确身份恢复。

#### Scenario: 新旧 Magpie 子实例保持精确身份并恢复
- **GIVEN** AUTO 主会话，transport 分别为新旧 Magpie，目录和允许列表包含同 transport 的目标模型
- **WHEN** 创建 bounded 子实例，再重载插件、切父 MANUAL 并恢复该已绑定实例
- **THEN** 初始持久绑定及后续实际请求仍为原 transport 和完整 model ID；恢复不重判、不迁移到另一个 Magpie 或本地入口

#### Scenario: 未注册家族的 Magpie 模型需显式模型与可验证 effort
- **GIVEN** 所属根会话为 AUTO（主模型 `codex/gpt-6.1-sol`、effort `medium`），transport 为任一 Magpie；目录与允许列表含 `opencode-go/kimi-k3`（支持 `low`、`high`，目录默认 `high`）
- **WHEN** 分别以 `{model: "opencode-go/kimi-k3"}`、目录默认缺失时的 `{model: "opencode-go/kimi-k3"}`、目录默认缺失时的 `{model: "opencode-go/kimi-k3", reasoning_effort: "low"}`、`{model: "../kimi-k3", reasoning_effort: "low"}` 调用 `route_subagent`；前两次只给出模型，Jev 返回 depth `baseline`
- **THEN** 第一次返回该模型与 `high`；第二次与第四次返回非错误的 `status: fallback`；第三次返回该模型与 `low`；四次调用共发出 2 次 Jev 请求；任何一次都不返回其它模型

## REMOVED Requirements

### Requirement: 家族策略注册表
**Reason**: 注册表中的 `transports` 把 provider 当作白名单，导致未登记的 provider（如 `traex`）下的同家族子会话在创建前被拒；策略应只跟模型走。
**Migration**: 由「模型家族策略注册表」取代：删除 `transports` 字段，provider 改为沿用直接父会话，家族与能力槽按模型名解析。

### Requirement: 内置家族策略
**Reason**: 内置策略含 `transports` 数据，随注册表一起改为不含 provider 知识。
**Migration**: 由「内置模型家族策略」取代，`modelPrefixes`、`effortStarts`、`childModels` 数据不变，Magpie 下的 `claude/`、`codex/` 前缀改为从目录按模型名解析得到。
