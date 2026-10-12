## MODIFIED Requirements

### Requirement: 输入框当前模型选择为活动会话的 logo 真相源

系统 SHALL 对当前打开的普通 session 订阅官方 model-selection 插件的 per-session `ModelDirectory.store.current`。当输入框模型选择成功改变 provider/model 时，系统 SHALL 无需用户发送消息、无需刷新页面，即更新该 session 行的品牌 logo。空白 session 只要存在当前选择，也 SHALL 显示对应 logo。

订阅 SHALL 以 **store 身份**为绑定依据，而不是 session id：客户端 Session scope 被回收再物化会给同一个 session id 一个新的目录与 store，每次会话列表或 DOM 信号 SHALL 重新解析当前打开 session 的目录；store 身份变化时 SHALL 重订阅并立即重新读取快照，身份未变时也 SHALL 重新读取当前快照。系统 MUST NOT 假定一次建立的订阅永久有效，MUST NOT 依赖用户切换标签页或刷新页面来纠正。

即时观测值 SHALL 只在可核验期间生效：仅当其 session 是当前打开的 session、且该 session 的 selector 目录仍可解析时，观测值才可以覆盖持久投影。一旦视图离开该 session、或该目录不再可解析，系统 SHALL 丢弃该观测值并改用持久投影回答，MUST NOT 让无法再核验的旧观测值继续决定该行的 logo。

#### Scenario: 输入框切模型后立即更新

- **WHEN** 当前 session 的输入框从模型 A 成功切换为模型 B，且尚未发送下一条消息
- **THEN** 该 session 行立即显示模型 B 的品牌 logo，不继续显示模型 A

#### Scenario: 空白 session 显示选择

- **WHEN** 一个尚未发过消息的空白 session 已加载模型选择器并拥有当前选择
- **THEN** 该行显示当前选择的品牌 logo

#### Scenario: 选择失败不提前切换

- **WHEN** 用户尝试选择模型 B，但官方 `session.selectModel` 返回失败
- **THEN** logo 继续表示官方 store 中已确认的旧选择，不显示未成功的 B

#### Scenario: 会话代际替换后切换照样即时更新

- **WHEN** 当前 session 的客户端 Session scope 被回收并重新物化（同一个 session id 得到新的 selector 目录与 store），随后其输入框从模型 A 成功切换为模型 B
- **THEN** 该行显示模型 B 的品牌 logo，不需要刷新页面，也不停留在旧代际 store 的旧值上

#### Scenario: 未推送的变化在下一次信号被重新读取

- **WHEN** selector store 的当前选择已经变化，但该变化没有推送到客户端订阅（漏发、订阅曾失效、或订阅建立前已变化）
- **THEN** 下一次会话列表或 DOM 信号后该行显示新选择的品牌 logo

#### Scenario: 离开会话后不再使用无法核验的观测值

- **WHEN** 当前 session 的观测值为模型 A，用户切换到另一个会话，而该 session 的 selector 目录不再可解析
- **THEN** 该行改为按持久投影显示，不继续显示无法核验的模型 A

### Requirement: 最后实际请求投影仅作冷历史 fallback

系统 SHALL 通过 session-projection 维护最近一次实际 assistant 请求的 provider/model。当没有可核验的即时观测值时，客户端 SHALL 按以下顺序使用持久数据回答该行的 logo：先取官方 `modelSelection` 投影的 `next`（该 session 下一次请求将使用的选择，包含已选但尚未发送的选择），缺省时再取本插件维护的最近一次实际请求投影。一旦存在可核验的 selector 观测值，该观测值 SHALL 覆盖这两者。这些持久数据 SHALL 在 DSH 重启后可用且不依赖 localStorage。

#### Scenario: 冷历史 session 使用 fallback

- **WHEN** 一个历史 session 尚未打开/加载选择器，但有最近请求投影
- **THEN** 侧边栏按投影显示对应品牌 logo

#### Scenario: selector 覆盖旧投影

- **WHEN** 某 session 的最近请求投影为模型 A，而 selector store 的当前选择为模型 B
- **THEN** 侧边栏显示模型 B 的品牌 logo

#### Scenario: 已选未发送的选择在观测结束后仍被保留

- **WHEN** 某 session 的选择器当前选择为模型 B（尚未发送任何消息），而最近一次实际请求的投影为模型 A，用户随后离开该 session
- **THEN** 该行仍显示模型 B 的品牌 logo，不因观测值被丢弃而退回模型 A

#### Scenario: 两类数据都不存在

- **WHEN** session 无 selector 当前值且无请求投影
- **THEN** 该行不插入 logo
