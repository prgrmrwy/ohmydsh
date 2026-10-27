## ADDED Requirements

### Requirement: AUTO 主模型支持范围与不可用锁定

AUTO SHALL 只处理 Claude / GPT 系列主模型：主模型 id 去掉 transport 前缀后（Magpie 的 `claude/...`、`codex/...` 取其最后一个 `/` 之后的部分）以 `claude-` 或 `gpt-` 开头（大小写不敏感）即视为支持；其余模型 SHALL 视为不支持。当前主模型不在支持范围时，系统 MUST NOT 发起 Jev 判断、MUST NOT 改写该请求，并 SHALL 把会话模式持久化为 `MANUAL`；状态接口 SHALL 返回当前选择与 `autoSupport = { supported: false, provider, model }`。模式按主模型切换实时推导：切回受支持模型后 `autoSupport.supported` SHALL 为 `true` 且芯片恢复可点击，模式保持 `MANUAL`，MUST NOT 自动恢复 `AUTO`。主模型在支持范围内但自动 effort 映射不可得（目录没有可用 `low|medium|high|xhigh`、推荐起点不可验证、或自动 effort 上限排除全部候选）时，主请求 SHALL 保持官方合成配置、`reason` 为 `no-effort-support`，MUST NOT 阻断请求、停用 AUTO 或记为 Jev 失败。子任务路由仍 SHALL 在无法给出可用 effort 时返回可见设置错误并要求暂停委派；`policy: legacy` 回滚路径 MUST NOT 套用本要求。

#### Scenario: 切换到不支持的主模型自动锁定
- **GIVEN** 会话为 `AUTO`，主模型为 `opencode-go/deepseek-v4.1-flash`（不以 `claude-`/`gpt-` 开头）
- **WHEN** 用户切换模型后读取状态或发出下一回合请求
- **THEN** 模式持久化为 `MANUAL`；状态含 `autoSupport = { supported: false, provider: 'opencode-go', model: 'deepseek-v4.1-flash' }`；该回合 Jev 请求次数为 0，模型请求的 provider/model/effort 与官方合成配置深度相等

#### Scenario: 不支持模型的请求不再导致整轮失败
- **GIVEN** 会话此前在 AUTO 下正常完成过回合，用户随后把主模型切换为不支持范围
- **WHEN** 用户发出下一回合请求
- **THEN** 回合正常结束（`turn/end` 不为 error）；请求照常发出且未被改写；会话保持 `MANUAL`，不产生 `disabled` 记录

#### Scenario: 芯片锁定态与悬停提示
- **GIVEN** 状态接口返回 `mode: 'MANUAL'` 与 `autoSupport = { supported: false, provider: 'opencode-go', model: 'deepseek-v4.1-flash' }`
- **WHEN** 渲染芯片并悬停或聚焦整个按钮
- **THEN** 芯片可见文本为 `MANUAL`，其后是描边 info 图标（不是切换箭头），按钮带 `aria-disabled` 标记且点击不发出 `setMode` 请求；面板说明 AUTO 目前仅支持 Claude / GPT 系列模型，并给出 `https://github.com/prgrmrwy/dsh-auto-model-routing` 的 issue/PR 链接；锁定时不使用 Jev 停用的红色警示样式

#### Scenario: 切回受支持模型后恢复可切换
- **GIVEN** 会话因主模型不支持而处于 `MANUAL` 锁定态
- **WHEN** 主模型切回 `claude` / `gpt` 系列
- **THEN** 状态返回 `autoSupport.supported = true`；芯片恢复普通 `MANUAL` 显示与切换图标且可点击；用户点击后才进入 `AUTO`，系统 MUST NOT 自动恢复

#### Scenario: 支持范围内映射不可得不阻断请求
- **GIVEN** 会话为 `AUTO`，主模型属于 Claude / GPT 系列，但官方目录只提供 `max`（或自动 effort 上限排除了全部可用候选）
- **WHEN** 本回合首个请求经过路由器
- **THEN** 请求配置与官方合成配置深度相等，`reason` 为 `no-effort-support`；请求成功发出，AUTO 未被停用，未记为 Jev 失败

## MODIFIED Requirements

### Requirement: 状态可见且不改写其它控件

系统 SHALL 在 composer 的 `conversation.input.right` 列表以负的 `order` 注册 `AUTO / MANUAL` 芯片（GPT 速度芯片为 `order: 0`）。芯片 SHALL 是单个按钮：可见文本为模式名，其后跟一个切换图标；无边框、无底色，hover 时显示官方交互底色；点击即切换模式。状态面板 SHALL 在鼠标悬停或键盘聚焦芯片时显示、离开芯片与面板时收起，内容为插件本回合实际输出的 effort 与 `reason`，以及该会话最近一次 Jev 决策（与决策提示同一格式的两行：谁判断、档位 → （模型）effort、耗时；非 0% 档位分布），无决策时不显示该段；面板 MUST NOT 渲染决定历史（Host 仍在内存保留最近 20 条并经状态接口返回，供排查，重启后清空、不落盘）；面板 MUST NOT 声称官方选择器总能反映 AUTO 结果（存在待生效手选时二者不同）。`reason` 取值为闭集 `jev | continued | no-effort-support | jev-failed`（`continued` 为非用户回合沿用上一级别）。会话存在 `disabled` 时，芯片**可见文本** SHALL 为 `MANUAL · Jev 停用` 并以警示色显示，title SHALL 给出该失败类别的人类可读提示；面板 SHALL 显示类别、提示、发生时间及“点击 AUTO 重试”。芯片 MUST NOT 调用官方模型选择接口或速度芯片的设置接口。当状态接口返回 `autoSupport.supported = false` 时，芯片 SHALL 改用「AUTO 主模型支持范围与不可用锁定」定义的锁定态渲染（以 info 图标替代切换图标、点击不切换、面板改为支持范围说明与反馈链接），该锁定态不改变本要求中 `disabled`（Jev 停用）的“点击 AUTO 重试”语义。

#### Scenario: 芯片注册在速度芯片左侧
- **GIVEN** client bundle 已加载
- **WHEN** 读取 `conversation.input.right` 的注册项
- **THEN** 本芯片 `order` 小于 0

#### Scenario: 面板展示本回合状态，历史只留在 Host
- **GIVEN** Host 已为某会话产生 25 条决定，最新一条为 `{effort: xhigh, reason: jev}`
- **WHEN** 读取状态接口并渲染面板
- **THEN** 状态接口历史恰含 20 条；面板文本包含 `xhigh`、`jev`，且不渲染历史列表

#### Scenario: 停用状态在芯片与面板可见
- **GIVEN** 会话 `disabled = {category: insufficient-credits}`，模式为 `MANUAL`
- **WHEN** 渲染芯片与面板
- **THEN** 芯片可见文本含“Jev 停用”且带警示标记，title 含“余额不足”；面板含 `insufficient-credits`、“余额不足”与“点击 AUTO 重试”；无 `disabled` 时芯片可见文本不含“Jev 停用”且不带警示标记

#### Scenario: 悬停面板显示最近一次决策分布
- **GIVEN** 会话最近一次决策为 `{source: main, tier: complex, effort: high, probabilities: {complex: 0.61, escalated: 0.39}}`，提示开关关闭
- **WHEN** 悬停芯片打开面板
- **THEN** 面板含 `主会话判断 · complex → high` 与 `complex 61% / escalated 39%`；无决策时面板不含“最近决策”段

#### Scenario: 芯片样式与悬停面板
- **GIVEN** client bundle 已加载，会话为 `MANUAL`
- **WHEN** 渲染芯片
- **THEN** 芯片是单个按钮，可见文本 `MANUAL` 在前、切换图标在后，无边框；面板默认不渲染；面板开关逻辑对进入/聚焦返回打开、对离开/失焦返回收起（真实悬停与延迟由 GUI 复验）

#### Scenario: 切换模式只调用插件接口
- **GIVEN** 用户点击芯片切换模式
- **WHEN** 记录本次交互发出的 RPC
- **THEN** 只调用本插件的设置模式接口，未调用官方模型选择或 `subscriptions-auth.setSpeed`
