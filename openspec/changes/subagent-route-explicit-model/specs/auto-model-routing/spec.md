## MODIFIED Requirements

### Requirement: 子会话决策工具与 skill
系统 SHALL 注册 Host 工具 `route_subagent`，参数 `{task: string, provider: "claude" | "codex", model?: string}`，描述须说明会把任务文本发送给 OpenRouter/TypeSafe：以与主会话相同的 Jev 客户端、`TIER_QUESTIONS` 与失败类别判断档位（`state` 上一档位为 `none`），成功返回 `{tier, provider, model, reasoning_effort}`。子会话推荐 SHALL 按 provider/tier 读取设置中的完整 `childRoutes` 组合 `{model, reasoningEffort}`；未覆盖的格子用代码默认表（claude 为 Haiku/Sonnet/Opus/Opus，codex 为 Luna/Sol/Sol/Sol）与所选模型的缺省起点算法生成完整组合，再应用全局 effort 上限与模型支持范围。用户可在官方允许列表中选择 Fable/Astra；默认表不含它们。子会话推荐 MUST NOT 继承 `mainEfforts`，MUST NOT 受调用会话当前模型限制。调用方传入 `model` 时（用户或 lead 已指定子会话模型），工具 SHALL 只推荐 effort：返回的 `model` 等于传入值，MUST NOT 查默认表或 `childRoutes`（即使某格配置了同一模型也不采用其 effort），effort 按该模型的缺省起点算法、全局 effort 上限与模型支持范围计算；该模型不在当前模型目录、不属于所给 provider、不在当前官方允许列表或无可用 effort 时 SHALL 返回设置错误并要求暂停委派，MUST NOT 换成其它模型。所属主会话不是 AUTO 时，传入 `model` 也同样返回 `routed: false`，不判档、不外发。显式 effort MUST NOT 被静默改写；模型不在当前官方允许列表、effort 不被支持或超过上限、无有效默认 effort 时 SHALL 返回设置错误并要求暂停委派，不换模型、不回退到其它映射、不记为 Jev 失败、不改会话状态。工具使用时 SHALL 重新校验当前列表与模型能力，最终仍由官方创建校验和会话白名单快照把关。失败返回错误结果，内容为该类别提示与“暂停委派并询问用户”；`exec.signal` 取消时返回“已取消”错误结果，不含余额/凭据提示。工具 MUST NOT 改写任何会话状态。工具 SHALL 先确定**所属主会话**：调用会话为普通会话时即其本身；为子会话时经 `ctx.agents.get(header.parentSession)` 逐级向上，找到第一个非 `origin = subagent` 的会话；链上任一会话不在 live 注册表中时视为 MANUAL。模式按所属主会话 id 从插件状态读取。所属主会话模式不是 `AUTO`（含因 Jev 失败停用）时，工具 MUST NOT 请求 Jev、MUST NOT 外发任务文本，返回非错误结果 `{routed: false, reason: "manual"}`，渲染文本说明“主会话为 MANUAL：不判档，按官方默认委派；只传用户或 lead 指定的值（例如指定的模型），不传其它 provider/model/reasoning_effort”；只有所属主会话为 `AUTO` 时才判档。系统 SHALL 提供 skill `subagent-model-routing`，其文本须要求：(1) 委派前调用 `route_subagent`；用户或 lead 已同时指定模型与 effort（或只指定 effort）时不调用工具，按指定值委派；只指定模型时调用工具并传入该 `model`，其余规则不变；工具返回 `routed: false` 时只传用户或 lead 指定的值；(2) 将返回的 `provider`、`model`、`reasoning_effort` 全部显式传给官方 `subagent`；(3) 在 `description` 末尾以 `[model·effort]` 标注；(4) 默认 provider 为当前会话 provider，用户或 lead 要求独立体系时改用另一个；当前 provider 不是 `claude`/`codex` 时暂停委派并询问用户；(5) 工具失败时暂停委派并询问用户，MUST NOT 自行猜测档位、改由主会话完成或换用其它模型；(6) 复用已有子会话前比较其标注，更高或无法确认时新建；(7) `route_subagent` 工具不存在时告知用户“子会话 Jev 选模未启用”，按官方默认委派且不传 provider/model/reasoning_effort，不得猜档位；(8) 工具返回 `routed: false` 时按官方默认委派且不传 provider/model/reasoning_effort，不询问用户、不猜档位。路由器 MUST NOT 改写子会话的创建参数或请求。

#### Scenario: 工具成功返回表中条目
- **GIVEN** 调用会话为 `AUTO`
- **WHEN** Jev 依次返回四个档位，并分别以 `provider: claude` 与 `provider: codex` 调用 `route_subagent`
- **THEN** 8 个结果的 `{model, reasoning_effort}` 依次为：claude `haiku-5-5/low`、`sonnet-5-5/medium`、`opus-5-5/high`、`opus-5-5/xhigh`；codex `gpt-6-luna/medium`、`gpt-6.1-sol/medium`、`gpt-6.1-sol/high`、`gpt-6.1-sol/xhigh`（Claude 模型名带 `claude-` 前缀）

#### Scenario: 主会话为 MANUAL 时不判档、不外发
- **GIVEN** 会话 S1 为 `MANUAL`（分别为用户手动设置、因 Jev 402 停用两种情况）；S1 的子会话 C1；另有 AUTO 会话 S2 的子会话 C2，其父会话不在 live 注册表中
- **WHEN** 分别在 S1、C1、C2 中调用 `route_subagent`
- **THEN** 三次都返回非错误结果 `{routed: false, reason: manual}`，渲染文本含“按官方默认委派”；假 Jev 服务收到 0 个请求；S1 无新的 `decision`

#### Scenario: 子会话中调用按根会话模式判档
- **GIVEN** 会话 S1 为 `AUTO`，其子会话 C1 的子会话 C2，Jev 返回 `standard`
- **WHEN** 在 C2 中以 `provider: claude` 调用 `route_subagent`
- **THEN** 返回 `{standard, claude, claude-sonnet-5-5, medium}`；假 Jev 服务收到 1 个请求；S1 不新增 `decision`

#### Scenario: 子会话模型不受调用会话模型限制
- **GIVEN** 调用会话为 `AUTO` 且当前模型为 `claude-haiku-5-5`，子会话模型表为缺省值，Jev 对任务返回 `escalated`
- **WHEN** 以 `provider: claude` 调用 `route_subagent`
- **THEN** 返回 `{escalated, claude, claude-opus-5-5, xhigh}`；对四个档位与两个 provider 的全部组合，返回值中不出现 `claude-fable-5-1`、`gpt-6-astra` 或 `max`

#### Scenario: 子会话显式推荐按设置生效
- **GIVEN** 当前官方允许列表与模型目录允许 Fable/Astra；`claude.escalated` 配置 Fable/high，`codex.simple` 配置 Astra/low，上限 high
- **WHEN** Jev 分别判为 escalated 与 simple，工具按对应 provider 调用
- **THEN** 返回 Fable/high 与 Astra/low；未覆盖的 claude.standard 仍为 Sonnet/medium；修改主会话 Fable 的映射不影响子会话推荐

#### Scenario: 使用时发现推荐失效
- **GIVEN** 已保存子会话推荐 Sol/high，之后官方移除 Sol，或文件被改为超过上限的 effort
- **WHEN** AUTO 下调用 route_subagent 并判到该档
- **THEN** 返回明确设置错误并要求暂停委派，不返回另一个模型或较低 effort，不改变根会话模式和 disabled

#### Scenario: 指定模型时只推荐 effort
- **GIVEN** 调用会话为 `AUTO`；当前模型目录与官方允许列表包含 `gpt-6-astra`（支持 low..xhigh），上限 xhigh；`childRoutes.codex.complex` 配置为 Astra/high
- **WHEN** Jev 依次返回四个档位，每次以 `provider: codex, model: gpt-6-astra` 调用 `route_subagent`
- **THEN** 返回的 `model` 均为 `gpt-6-astra`，`reasoning_effort` 依次为 `low`、`low`、`medium`、`high`（不采用 `childRoutes` 中的 high）；假 Jev 服务收到 4 个请求

#### Scenario: 指定模型不可用时不换模型
- **GIVEN** 调用会话为 `AUTO`
- **WHEN** 分别以 `provider: codex, model: gpt-6-astra`（不在官方允许列表）、`provider: claude, model: gpt-6-astra`（provider 不符）、`provider: claude, model: claude-unknown`（不在模型目录）调用 `route_subagent`
- **THEN** 三次都返回设置错误，含“暂停委派并询问用户”，不返回其它模型；会话模式与 `disabled` 不变

#### Scenario: 指定模型且主会话为 MANUAL
- **GIVEN** 会话 S1 为 `MANUAL`
- **WHEN** 以 `provider: codex, model: gpt-6-astra` 调用 `route_subagent`
- **THEN** 返回 `{routed: false, reason: manual}`，渲染文本含“只传用户或 lead 指定的值”；假 Jev 服务收到 0 个请求

#### Scenario: 工具失败返回类别且不改状态
- **GIVEN** Jev 返回 402，主会话 S1 为 `AUTO` 且无 `disabled`
- **WHEN** 调用 `route_subagent`
- **THEN** 结果为错误，内容含“余额不足”与“暂停委派并询问用户”；S1 仍为 `AUTO` 且无 `disabled`

#### Scenario: 主子会话问题定义相同
- **GIVEN** 主会话一个 AUTO 用户回合与一次 `route_subagent` 调用
- **WHEN** 记录二者发往假 Jev 服务的 body
- **THEN** 两个 body 的 `model` 与 `questions` 深度相等，仅 `state` 不同

#### Scenario: skill 文本包含八项规则
- **GIVEN** `skills/subagent-model-routing/SKILL.md`
- **WHEN** 测试读取其文本
- **THEN** 文本包含 `route_subagent`、`reasoning_effort`、`[model·effort]`、独立体系规则、非 claude/codex provider 时询问、“暂停委派并询问用户”、复用“新建”规则、“只指定模型”时传 `model` 的规则、“子会话 Jev 选模未启用”及 `routed: false` 时按官方默认委派，且不含档位表模型名

### Requirement: 子会话派发时机写入环境级指令
`instructions/dsh-home.md` SHALL 包含一节“子会话派发”，由主 Agent 决定是否派发，内容至少包括：
- 派发：实施已批准计划中工作量较大的编码任务；独立评审或复核（需要新上下文）；中间输出多的探索（大范围搜索、读日志、跑测试），只带回结论；彼此独立、可并行的多块工作。
- 不派发：与用户讨论或做决定的回合；前后依赖且主会话上下文装得下的工作；单个小修复。
- 本身是子会话时不再向下派发，除非任务明确要求。
- 派发前 MUST 先调用 `route_subagent`（工具存在时；已指定 effort 时除外）：只指定了模型时调用时传入该模型，工具只推荐 effort；返回 `routed: false` 时按官方默认委派、只传用户或 lead 指定的值；成功时把返回的 provider、model、reasoning_effort 全部显式传给官方子会话工具；工具出错时暂停委派并询问用户；详细规则见 `subagent-model-routing` skill。此步骤 SHALL 直接写在该节中，使 Agent 不必先加载 skill 也能执行（2026-10-22 验收：AUTO 回合中 Agent 未加载 skill 便直接委派，子会话继承了父会话 AUTO 设的 effort）。
该节 MUST NOT 引用具体模型名或 effort 值（唯一来源为插件代码）。本 change MUST NOT 新增物化机制，沿用 `agentInstructions` 将其物化为 `$DSH_HOME/AGENTS.md`（已有 `tests/sync-agent-instructions.test.mjs` 覆盖物化、幂等与撤销）。

#### Scenario: 环境级指令含派发规则且不含模型名
- **GIVEN** 仓库中的 `instructions/dsh-home.md`
- **WHEN** 测试读取其文本
- **THEN** 含标题“子会话派发”，含“独立评审”“并行”“route_subagent”“不派发”与“本身是子会话时不再向下派发”；含“必须先调用 `route_subagent`”“只指定了模型”“`routed: false`”“reasoning_effort”与“暂停委派并询问用户”；不含任何 `claude-`、`gpt-` 开头的模型名，也不匹配 `\bxhigh\b`、`\bmax\b`
