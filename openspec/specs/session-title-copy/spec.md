# session-title-copy Specification

## Purpose

Web GUI 对话区当前会话标题右侧显示 session id 短标识徽标（去 `session-` 前缀后的前 6 位），悬停可见完整 id，点击复制完整当前 session id；标题本身保持官方 disabled 原样，为 cockpit/脚本/日志排查提供零成本取 id 的路径，同时保证对官方 UI 的最小侵入与安全降级。

## Requirements

### Requirement: 标题旁显示当前会话 id 短标识徽标
系统 SHALL 在当前会话标题（面包屑）右侧插入一个自建徽标，显示当前 session id 的短标识：完整 id 去除 `session-` 前缀后的前 6 位（如 `session-9af69be9-…` 显示 `9af69b`）。徽标 SHALL 使用插件自有标记属性（自拥命名空间），不修改、不替换、不覆盖官方面包屑及其它标题区元素。

#### Scenario: 打开会话后标题旁出现 6 位短标识
- **WHEN** 用户打开一个已有标题的会话
- **THEN** 标题右侧出现显示该会话 id 短标识（去掉 `session-` 前缀的前 6 位）的徽标，面包屑标题及其它 header 元素保持官方样式

#### Scenario: 会话切换后徽标跟随当前 id
- **WHEN** 用户切换到另一个会话
- **THEN** 徽标文本与复制目标跟随新当前会话 id，不残留旧会话的标识

#### Scenario: 空白/无标题会话不显示徽标
- **WHEN** 会话尚未有标题（header 隐藏或面包屑不存在）
- **THEN** 不插入徽标，页面保持官方状态

### Requirement: 点击徽标复制完整 session id
系统 SHALL 在用户点击该徽标时，将**完整**当前 session id 复制到系统剪贴板（短标识仅为可识别前缀，复制必须为完整 id），且不触发任何会话打开或页面导航。当前会话标题 SHALL 保持官方行为（disabled、cursor default、无点击复制语义），插件 SHALL 不再对标题做任何改造。祖先面包屑 SHALL 保持官方「点击打开对应会话」行为，不参与复制。

#### Scenario: 点击徽标复制完整 id
- **WHEN** 用户点击标题旁的徽标
- **THEN** 系统剪贴板获得完整当前 session id，且不发生会话切换或页面导航

#### Scenario: 标题保持官方行为
- **WHEN** 用户点击或悬停当前会话标题（面包屑本身）
- **THEN** 标题保持官方 disabled 态（无点击行为、cursor default），不复制任何内容

#### Scenario: 祖先面包屑保持官方打开行为
- **WHEN** 用户点击面包屑中的祖先会话标题（非当前项）
- **THEN** 系统执行官方打开该祖先会话的行为，不复制任何 session id

#### Scenario: 剪贴板操作失败安全降级
- **WHEN** 剪贴板 API 不可用或被拒绝
- **THEN** 系统不抛出未捕获异常、不打断页面其余功能，会话保持当前状态

### Requirement: 徽标 hover 提示与复制后轻量反馈
系统 SHALL 使徽标在悬停时显示 pointer 指针与交互底色，并提示完整 session id（tooltip）；点击复制成功后 SHALL 显示轻量、瞬态的「已复制」提示，不改变页面布局、不残留 DOM。

#### Scenario: 悬停徽标显示指针与完整 id 提示
- **WHEN** 用户的指针悬停在徽标上
- **THEN** 徽标显示 pointer 指针与悬停底色，tooltip 展示完整会话 id

#### Scenario: 复制成功出现瞬态提示
- **WHEN** 用户点击徽标且复制成功
- **THEN** 页面出现短暂「已复制」提示并在有限时间内自动消失，页面布局与交互不受影响

### Requirement: 官方 DOM 结构变化时安全降级
系统 SHALL 将官方 DOM 结构知识隔离于单一 locator 模块；当官方结构变化导致标题区/插入点无法可靠定位时，系统 SHALL 不注入任何元素、不抛未捕获异常，页面其余功能不受影响；插件清理/停用时 SHALL 移除自建徽标与提示，不残留 DOM。

#### Scenario: 无法定位标题时不注入
- **WHEN** 官方 header 结构与插件预期的结构不匹配（如升级后类名/结构改变）
- **THEN** 插件不插入徽标、不产生未捕获异常，其余功能保持官方行为

#### Scenario: 标题刷新后重新接线
- **WHEN** 会话标题区随会话切换或标题生成/更新而重新渲染
- **THEN** 插件在新标题区重新插入并更新徽标（短标识 + 复制目标为当前 id），不残留旧徽标
