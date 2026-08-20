## Purpose

在 Web GUI 侧边栏的每个 session 行标题前展示该会话当前在用的 provider 的动态 logo（基于最后一次实际发送的 assistant 请求折叠而来，重启后依然准确），同时保证不干扰官方任务状态点与其余行内 UI。

## ADDED Requirements

### Requirement: host 侧维护并发布每个会话的 provider 投影值
系统 SHALL 通过 session-projection 机制为每个会话维护一个 `provider` 投影值，记录该会话**最后一次实际发送的 assistant 请求**的 provider 与 model；该投影值 SHALL 随官方会话投影通道（列表帧的 `projectionValues`）下发到 Web 客户端，任何已产生过请求的历史会话——包括 DSH 重启后未再次打开过的会话——都能取到该值，且不依赖浏览器 localStorage。从未产生过 assistant 请求的会话（如空白"新会话"占位）SHALL 不发布 provider 值。

#### Scenario: 会话使用过 provider 后投影可见
- **WHEN** 一个会话至少完成过一次 assistant 请求
- **THEN** 该会话的 provider 投影值等于最近一次请求实际使用的 provider 与 model，并随会话列表下发到 Web 客户端

#### Scenario: 会话中途切换 provider
- **WHEN** 会话在历史请求中以 provider A 运行，随后一次请求切换为 provider B
- **THEN** 该会话的 provider 投影值为 provider B（最后一次实际请求）

#### Scenario: 重启后历史会话仍可取到 provider
- **WHEN** DSH 重启，且某历史会话自上次运行后未再被打开
- **THEN** 该会话的 provider 投影值仍可用，且等于其最近一次请求实际使用的 provider

#### Scenario: 空白会话无 provider 值
- **WHEN** 一个会话从未产生过 assistant 请求（空白"新会话"）
- **THEN** 该会话无 provider 投影值，客户端据此不展示任何 logo

### Requirement: 侧边栏 session 行标题前展示 provider logo
系统 SHALL 在 Web 侧边栏的 session 列表行中，为每个拥有 provider 投影值的会话，在其标题文本前渲染对应 provider 的官方 logo 图标（约 12~14px 内联 SVG）。logo 显示 SHALL 是动态的：当某会话的 provider 投影值发生变化（会话切换了 provider）时，该行的 logo 无需整页刷新即随之更新；不应对没有 provider 值的行做任何插入。logo 不得显示在空白/无请求会话行上。

#### Scenario: 展示 provider logo
- **WHEN** 侧边栏渲染一个拥有 provider 投影值的会话行
- **THEN** 该行标题前出现对应 provider 的官方 logo 图标

#### Scenario: logo 随 provider 变化而更新
- **WHEN** 一个已显示 provider A logo 的会话实际切换为 provider B 并完成请求
- **THEN** 该行 logo 自动更新为 provider B 的图标，用户无需刷新页面

#### Scenario: 无 provider 值的行不插入 logo
- **WHEN** 侧边栏渲染一个无 provider 投影值的会话行（如空白新会话）
- **THEN** 该行不插入任何 logo 元素，行内容与官方渲染一致

### Requirement: 不影响官方行内 UI 与任务状态点
系统 SHALL 只读使用官方 session 行 DOM，不得替换、移动、隐藏或改写官方渲染的状态点 `StateDot`（运行/等待审批/计划待审/完成等状态指示）、时间标签、右键菜单或拖拽排序行为。logo 元素 SHALL 作为独立的追加元素插入标题旁，与官方元素互不覆盖；当官方行结构在 DSH 升级后发生变化时，无法可靠定位行的部分 SHALL 安全地不展示 logo（降级为不显示），不得报错或破坏页面其余功能。

#### Scenario: 状态点保持官方原样
- **WHEN** 拥有 provider logo 的会话行进渲染
- **THEN** 其官方状态点（运行/等待/完成等）的显示逻辑与外观与未安装该功能时完全一致

#### Scenario: 官方行结构变化时安全降级
- **WHEN** DSH 升级导致 session 行 DOM 结构不再可被可靠定位
- **THEN** 插件不向任何行插入 logo，不抛出未捕获异常，其余页面功能不受影响
