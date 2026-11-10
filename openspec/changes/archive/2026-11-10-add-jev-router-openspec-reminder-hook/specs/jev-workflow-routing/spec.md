## ADDED Requirements

### Requirement: Host reminds the agent to fetch routing advice when a change is about to be created
系统 SHALL 提供一个 Host 插件，在 agent 即将创建 OpenSpec change 的时机向该 agent 附加至多一条提醒，提示它在流程未定时先按 `jev-workflow-router` 取一次建议。触发时机为该 agent 的一次工具调用完成且满足以下之一：`skill` 调用的 `name` 为 `openspec-propose`；`bash` 调用的 `command` 含 `openspec new change`。仅当该 agent 此前未加载过 `jev-workflow-router` skill、未调用过名称以 `jev_classify` 或 `jev_decide` 结尾的工具、且未收到过本提醒时才附加。提醒 MUST 以带来源标签的附加上下文送达，MUST NOT 拦截、拒绝、改写工具调用或其结果，MUST NOT 自行调用 Jev、写入路由记录、创建 change 或切换 schema。是否调用 router 仍由 agent 按既有跳过规则决定。本要求是经 change `add-jev-router-openspec-reminder-hook` 单独批准的自动化，不放宽「一行建议」之外的任何限制。

#### Scenario: 加载 openspec-propose 时提醒一次
- **GIVEN** 某 agent 本次存活期内未加载 `jev-workflow-router`，也未调用 Jev
- **WHEN** 它成功调用 `skill`，参数 `name` 为 `openspec-propose`
- **THEN** 该工具结果原样保留，且附加恰好一条来源为 `jev-workflow-router-hook` 的提醒上下文

#### Scenario: bash 中的 openspec new change 作为兜底
- **GIVEN** 同上
- **WHEN** 它调用 `bash`，`command` 为 `openspec new change "x" && openspec status --change x`
- **THEN** 附加一条提醒上下文，`bash` 结果不变

#### Scenario: 已用过 router 不再提醒
- **WHEN** 该 agent 先调用过 `skill`（`name` 为 `jev-workflow-router`）或名称以 `jev_classify` 结尾的工具，之后再加载 `openspec-propose`
- **THEN** 不附加提醒

#### Scenario: 每个 agent 至多一次
- **WHEN** 同一 agent 已收到过一次提醒，之后又执行 `openspec new change`
- **THEN** 不再附加提醒

#### Scenario: 无关调用不受影响
- **WHEN** agent 调用 `skill`（`name` 为 `openspec-apply-change`），或 `bash` 执行 `openspec status`
- **THEN** 不附加提醒，结果不变

#### Scenario: 下游决定被保留
- **WHEN** 下游 post-execute 监听者返回 `block` 或已带有附加上下文
- **THEN** 本插件保留下游的决定种类、feedback 与原有附加上下文，只在其前面追加自己的提醒

#### Scenario: router 被禁用时静默
- **WHEN** `$DSH_HOME/skills/jev-workflow-router/SKILL.md` 不存在，或 `DSH_JEV_WORKFLOW_ROUTER_DISABLED` 为 `1`、`true`、`yes`、`on`（不区分大小写）
- **THEN** 插件对任何调用都不附加提醒

#### Scenario: 插件条目可独立移除
- **WHEN** 插件条目设为 `enabled: false` 并执行 `dsh build`、重启 Host
- **THEN** 提醒不再出现，router skill 与既有 OpenSpec 流程照常可用
