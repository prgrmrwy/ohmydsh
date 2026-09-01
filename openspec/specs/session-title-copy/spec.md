# session-title-copy Specification

## Purpose

Web GUI 对话区 header 中当前会话标题支持点击复制当前 session id，并显示可点击的悬停指针与轻量复制反馈；为 cockpit/脚本/日志排查提供零成本取 id 的路径，同时保证对官方 UI 的最小侵入与安全降级。

## Requirements

### Requirement: 点击当前会话标题复制当前 session id
系统 SHALL 在对话区 header 面包屑中，使用官方 sessions list 的当前 id（`current`）作为真相源；当用户点击当前会话标题（面包屑最后一项）时，系统 SHALL 将当前 session id 复制到系统剪贴板，并不得触发会话打开或页面导航。祖先面包屑（非当前项）SHALL 保持官方「点击打开对应会话」行为，不参与复制。

#### Scenario: 点击当前会话标题复制当前 id
- **WHEN** 用户点击对话区 header 中当前会话的标题
- **THEN** 系统剪贴板获得当前 session id，且当前会话不被重新打开、不发生页面导航

#### Scenario: 祖先面包屑保持官方打开行为
- **WHEN** 用户点击面包屑中的祖先会话标题（非当前项）
- **THEN** 系统执行官方打开该祖先会话的行为，不复制任何 session id

#### Scenario: 剪贴板操作失败安全降级
- **WHEN** 剪贴板 API 不可用或被拒绝
- **THEN** 系统不抛出未捕获异常、不打断页面其余功能，会话保持当前状态

#### Scenario: 会话切换后复制新当前 id
- **WHEN** 用户切换到另一个会话后再次点击标题
- **THEN** 剪贴板获得新当前会话的 id（而非旧会话的 id）

### Requirement: 当前会话标题悬停显示 pointer 指针
系统 SHALL 使当前会话标题在悬停时显示 pointer 指针，且悬停时显示官方 crumb 的交互底色，以与「可点击复制」的语义一致。

#### Scenario: 悬停标题显示指针
- **WHEN** 用户的指针悬停在当前会话标题上
- **THEN** 标题元素显示 pointer 指针与悬停底色

### Requirement: 标题点击复制给出轻量即时反馈
系统 SHALL 在复制成功后显示轻量、瞬态的「已复制」反馈；该反馈 SHALL 不改变页面布局、不透传点击、不残留 DOM。

#### Scenario: 复制成功出现瞬态提示
- **WHEN** 用户点击标题且复制成功
- **THEN** 页面出现短暂「已复制」提示并在有限时间内自动消失，页面布局与交互不受影响

### Requirement: 官方 DOM 结构变化时安全降级
系统 SHALL 将官方 DOM 结构知识隔离于单一 locator 模块；当官方结构变化导致标题无法可靠定位时，系统 SHALL 不注入任何元素、不抛未捕获异常，页面其余功能不受影响。

#### Scenario: 无法定位标题时不注入
- **WHEN** 官方 header 结构与插件预期的结构不匹配（如升级后类名/结构改变）
- **THEN** 插件不修改任何 DOM、不产生未捕获异常，其余功能保持官方行为

#### Scenario: 标题刷新后重新接线
- **WHEN** 会话标题随会话切换或标题生成/更新而重新渲染
- **THEN** 插件在新标题上重新生效（可点击复制 + pointer 指针），不残留旧接线
