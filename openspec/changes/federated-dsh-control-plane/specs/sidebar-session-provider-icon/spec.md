## MODIFIED Requirements

### Requirement: 不影响官方或联邦行内 UI 与任务状态点
系统 SHALL 根据当前活动的 Workspace 浏览器选择安全集成方式：官方侧栏处于活动状态时，只读使用官方 session 行 DOM，logo SHALL 作为标题前独立元素且无法可靠定位时安全降级；联邦侧栏处于活动状态时，logo SHALL 由联邦 Session Row 通过正式数据/渲染契约直接呈现，旧 DOM 注入 SHALL 自动退场。两种模式均不得替换、移动、隐藏或改写任务 `StateDot`、时间标签、菜单或拖拽行为，也不得产生重复 logo。

#### Scenario: 状态点保持官方原样
- **WHEN** session 行展示模型 logo
- **THEN** 状态点的显示逻辑、外观、优先级与位置保持对应侧栏实现的原样

#### Scenario: 官方行结构变化时安全降级
- **WHEN** 官方单机模式下 DSH 升级导致 session 行无法可靠定位
- **THEN** 插件不向错误行插入 logo、不抛未捕获异常，其余页面功能不受影响

#### Scenario: 联邦侧栏正式渲染 logo
- **WHEN** 联邦 Workspace 浏览器成功激活并渲染本机或远端 session 行
- **THEN** 官方 Row embed seam 以 federated session id 读取该会话的 selector 当前值并优先渲染一个 logo；未加载 selector 时使用同一 federated id 的最近请求投影 fallback，DOM MutationObserver 不再向这些行注入 badge

#### Scenario: 远端模型切换成功或失败
- **WHEN** 远端活动 session 的 `selectModel` 成功或失败
- **THEN** 成功时对应 federated session 行即时显示已确认新选择，失败时保留旧选择，不影响其他节点同 native id 的行

#### Scenario: 远端断线后的 logo
- **WHEN** 远端节点断线且 selector 状态标记为 stale
- **THEN** 行可以继续显示最后已确认 logo并随节点 stale 状态一起呈现，但不得把中央或其他节点的 selector 值覆盖到该行

#### Scenario: 联邦激活失败回退官方模式
- **WHEN** 联邦侧栏未提交激活或已回滚为官方 Workspace 浏览器
- **THEN** provider-icon 恢复官方 DOM 兼容路径，不因联邦插件存在但未激活而丢失本机 logo
