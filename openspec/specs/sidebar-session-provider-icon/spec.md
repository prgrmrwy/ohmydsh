# sidebar-session-provider-icon Specification

## Purpose

在 Web GUI 侧边栏每个 session 标题前展示该会话输入框当前选中的模型品牌 logo；选择器切换后立即更新，同时以最近实际请求作为冷历史 fallback，并保证不干扰官方任务状态点及其余行内 UI。

## Requirements

### Requirement: 输入框当前模型选择为活动会话的 logo 真相源
系统 SHALL 对当前打开的普通 session 订阅官方 model-selection 插件的 per-session `ModelDirectory.store.current`。当输入框模型选择成功改变 provider/model 时，系统 SHALL 无需用户发送消息、无需刷新页面，即更新该 session 行的品牌 logo。空白 session 只要存在当前选择，也 SHALL 显示对应 logo。

#### Scenario: 输入框切模型后立即更新
- **WHEN** 当前 session 的输入框从模型 A 成功切换为模型 B，且尚未发送下一条消息
- **THEN** 该 session 行立即显示模型 B 的品牌 logo，不继续显示模型 A

#### Scenario: 空白 session 显示选择
- **WHEN** 一个尚未发过消息的空白 session 已加载模型选择器并拥有当前选择
- **THEN** 该行显示当前选择的品牌 logo

#### Scenario: 选择失败不提前切换
- **WHEN** 用户尝试选择模型 B，但官方 `session.selectModel` 返回失败
- **THEN** logo 继续表示官方 store 中已确认的旧选择，不显示未成功的 B

### Requirement: 最后实际请求投影仅作冷历史 fallback
系统 SHALL 通过 session-projection 维护最近一次实际 assistant 请求的 provider/model。对于尚未在本浏览器进程加载 model-selector store 的历史 session，客户端 SHALL 使用该投影作为 fallback；一旦观察到 selector 的 `current`，selector 值 SHALL 覆盖投影。该 fallback SHALL 在 DSH 重启后可用且不依赖 localStorage。

#### Scenario: 冷历史 session 使用 fallback
- **WHEN** 一个历史 session 尚未打开/加载选择器，但有最近请求投影
- **THEN** 侧边栏按投影显示对应品牌 logo

#### Scenario: selector 覆盖旧投影
- **WHEN** 某 session 的最近请求投影为模型 A，而 selector store 的当前选择为模型 B
- **THEN** 侧边栏显示模型 B 的品牌 logo

#### Scenario: 两类数据都不存在
- **WHEN** session 无 selector 当前值且无请求投影
- **THEN** 该行不插入 logo

### Requirement: 使用下载落盘的真实品牌资产
系统 SHALL 使用下载后随包保存的品牌 SVG，而不是代码中手绘的近似 path。已知映射 SHALL 至少覆盖 DeepSeek 鲸鱼、OpenAI/GPT 螺旋、OpenCode、Anthropic/Claude 与 Grok。品牌判定 SHALL 优先识别已知 provider route；仅当 route 未知/通用时再按 model id fallback。未知选择 SHALL 使用中性 fallback，不得冒充已知品牌。浏览器运行时 SHALL 不为品牌图访问外部 CDN。

#### Scenario: DeepSeek/OpenAI/OpenCode 显示正确品牌
- **WHEN** 当前选择分别属于 DeepSeek、GPT/Codex 或 OpenCode
- **THEN** 行中分别使用下载落盘的 DeepSeek 鲸鱼、OpenAI 螺旋或 OpenCode SVG

#### Scenario: OpenCode route 不被模型名误判
- **WHEN** 当前选择为真实路由 `opencode-go/deepseek-v4-flash`
- **THEN** 显示 OpenCode logo，而不是 DeepSeek logo

#### Scenario: 未知兼容 route 使用 model fallback
- **WHEN** provider route 未知/通用，但 model id 明确属于 GPT 或 DeepSeek
- **THEN** 显示对应 OpenAI 或 DeepSeek logo

### Requirement: 不影响官方行内 UI 与任务状态点
系统 SHALL 只读使用官方 session 行 DOM，不得替换、移动、隐藏或改写官方 `StateDot`、时间标签、右键菜单或拖拽行为。logo SHALL 作为标题前独立元素；无法可靠定位时 SHALL 安全降级为不显示。

#### Scenario: 状态点保持官方原样
- **WHEN** session 行展示模型 logo
- **THEN** 官方状态点的显示逻辑、外观与位置保持不变

#### Scenario: 官方行结构变化时安全降级
- **WHEN** DSH 升级导致 session 行无法可靠定位
- **THEN** 插件不向错误行插入 logo、不抛未捕获异常，其余页面功能不受影响
