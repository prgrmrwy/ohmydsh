## Test Plan

review.md round 1 `APPROVE_WITH_CHANGES`，Required Changes 1–3 已应用并经评审者复核。实现先于本 artifact 完成（用户已在隔离预览中确认视觉效果），因此行状态直接为 🟢；新行为对应的测试为「组内同一窗口时窗口名提到组标题」「只有账号标识可截断」，以及评审要求补的两行结构、用量文案、浮层隐藏 Unknown/保留无限、非共享窗口四个回归测试。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-magpie-connector/spec.md → 侧边栏额度开关 | 开关关闭时不渲染也不请求 | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | 关闭时不渲染任何额度 UI，也不请求卡片 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏额度开关 | 开关持久化 | packages/dsh-magpie-connector/test/sidebar-setting.test.ts | sidebarUsage 默认关闭、可持久化、拒绝非布尔 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏卡片的展开、收起与读取（流内手风琴） | 标题行的开关负责展开与收起 | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | title 上的开关同时负责展开与收起 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏卡片的展开、收起与读取（流内手风琴） | 展开顶上去而不是盖住列表 | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | 标题行开关展开明细，5 行摘要让位、卡片在流内变高 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏卡片的展开、收起与读取（流内手风琴） | 正文与双箭头不触发展开 | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | 点击正文与双箭头不触发展开，只有标题行可以切换 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏卡片的展开、收起与读取（流内手风琴） | 双下箭头随滚动位置出现和消失 | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | 展开明细溢出时同样显示双箭头，滚到底后隐藏但保留高度 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏卡片的展开、收起与读取（流内手风琴） | 缺少重置时间显示破折号 | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | 网关没给重置时间时显示 — 并说明原因 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏卡片的展开、收起与读取（流内手风琴） | 侧栏收起只留 icon | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | 只渲染 icon，点击后在浮层里显示完整卡片 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 同一上游多账号分段 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "同一上游多账号分段" | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 多账号且勾选多个档位 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "多账号且勾选多个档位" | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 组内一个账号失败、一个只有余额 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "组内一个账号失败、一个只有余额" | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 侧栏收起时浮层也分段 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "侧栏收起时浮层也分段" | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 多账号缺少 user | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "多账号缺少 user" | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 账号标识过长时截断 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "账号标识过长时截断" | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 组内同一窗口时窗口名提到组标题 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "组内同一窗口时窗口名提到组标题" | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 只有账号标识可截断 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | regression: only the account shrinks; plan, expiry and reading keep full width | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏进度条只对百分比读数绘制 | 文字读数不画进度条 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "文字读数不画进度条" | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏进度条只对百分比读数绘制 | 档位窗口带 display 时仍是档位行 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "档位窗口带 display 时仍是档位行" | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏进度条只对百分比读数绘制 | 文字读数不参与回退选择 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "文字读数不参与回退选择" | 🟢 green |

## Coverage Notes

- 全部为 jsdom 渲染 `SidebarUsage` 的客户端测试，沿用 `fakeApi`。
