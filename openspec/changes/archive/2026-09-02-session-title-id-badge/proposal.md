# session-title-id-badge

## Why

实机使用标题点击复制后反馈：点击前不知道能复制、复制时也不确定复制的是哪个会话（session id 不可见），且「点击标题」的语义对面包屑控件有违直觉。改为在标题**后面**显示一个 6 位识别徽标（当前 session id 去 `session-` 前缀后的前 6 位），用户能直接看到会话短标识，点击徽标复制**完整** session id；标题本身恢复官方 disabled 原样，不再承担点击行为。

## What Changes

- 移除对官方标题 crumb 的一切改造：不再移除 `disabled`、不再拦截 click、不再设置 pointer/tooltip —— 标题恢复官方原样（disabled 死按钮，cursor default）。
- 在标题面包屑右侧（titleCluster 内 nav 之后）插入自建徽标按钮：
  - 显示当前 session id 的短标识 = 完整 id 去掉 `session-` 前缀后的前 6 位（如 `session-9af69be9-…` → `9af69b`；前缀直接截取会导致前 6 位是 “sessio”，无辨识度）；
  - hover 显示 pointer + 底色，`title` 提示完整 session id（悬停可看全 id）；
  - 点击复制**完整**当前 session id，复制成功显示瞬态「会话 ID 已复制」提示（沿用现有 toast）。
- 祖先面包屑保持官方「点击打开」行为不变。
- 安全降级不变：官方结构无法定位插入点时不注入；会话切换/标题更新后徽标内容与复制目标跟随当前 id；剪贴板失败静默；插件仍无 host 能力、无网络请求。
- **BREAKING**：无（替换本仓 v0.1.0 的标题点击行为，官方 UI 不受影响）。

## Capabilities

### New Capabilities
<!-- 无。 -->

### Modified Capabilities
- `session-title-copy`: 标题点击复制 → 标题旁 6 位 ID 徽标显示 + 徽标点击复制完整 session id；标题恢复官方 disabled 行为；toast 与安全降级语义保留（主体改为徽标）。

## Impact

- `packages/session-title-copy/`：`title-locator.ts` 改为定位标题区域（crumb nav + 插入点父容器）；`wiring.ts` 改为徽标渲染/更新/点击复制；`index.ts` 观察与订阅逻辑不变（对象从标题按钮变为徽标）；版本 0.1.0 → 0.1.1。
- 测试：locator（定位 nav/区域、未知结构降级）、badge（短标识推导、幂等插入、会话切换更新、点击复制完整 id、清理）。
- `dsh.yaml` manifest 条目 version/note 更新；backlog B018 追加修订记录。
