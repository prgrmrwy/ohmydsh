## Test Plan

review.md round 1 为 `VERDICT: APPROVE_WITH_CHANGES`，Required Changes 1–5 已应用并经评审者复核，`CHANGES_APPLIED: yes`。MODIFIED「侧边栏常驻额度卡」中原样保留的场景沿用 `sidebar-usage.test.tsx` 的既有测试，apply 期间保持绿。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 同一上游多账号分段 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | test_sidebar_accounts_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 多账号且勾选多个档位 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | test_sidebar_accounts_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 组内一个账号失败、一个只有余额 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | test_sidebar_accounts_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 侧栏收起时浮层也分段 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | test_sidebar_accounts_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 多账号缺少 user | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | test_sidebar_accounts_05 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 账号标识过长时截断 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | test_sidebar_accounts_06 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏进度条只对百分比读数绘制 | 文字读数不画进度条 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | test_sidebar_accounts_07 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏进度条只对百分比读数绘制 | 档位窗口带 display 时仍是档位行 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | test_sidebar_accounts_08 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏进度条只对百分比读数绘制 | 文字读数不参与回退选择 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | test_sidebar_accounts_09 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏常驻额度卡 | 默认档位只显示周窗口 | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | spec Scenario "默认档位只显示周窗口"（既有） | 🟢 green（回归保持） |
| specs/dsh-magpie-connector/spec.md → 侧边栏常驻额度卡 | 收起行显示到期时间 | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | spec Scenario "收起行显示到期时间"（既有） | 🟢 green（回归保持） |
| specs/dsh-magpie-connector/spec.md → 侧边栏常驻额度卡 | 缺少勾选档位时回退到最紧窗口 | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | spec Scenario "缺少勾选档位时回退到最紧窗口"（既有） | 🟢 green（回归保持） |
| specs/dsh-magpie-connector/spec.md → 侧边栏常驻额度卡 | 只有余额的上游不显示破折号 | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | spec Scenario "只有余额的上游不显示破折号"（既有） | 🟢 green（回归保持） |
| specs/dsh-magpie-connector/spec.md → 侧边栏常驻额度卡 | 读取失败的行不伪造读数 | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | spec Scenario "读取失败的行不伪造读数"（既有） | 🟢 green（回归保持） |
| specs/dsh-magpie-connector/spec.md → 侧边栏常驻额度卡 | 单一刷新入口 | packages/dsh-magpie-connector/test/sidebar-usage.test.tsx | spec Scenario "单一刷新入口"（既有） | 🟢 green（回归保持） |
| specs/dsh-magpie-connector/spec.md → 侧边栏常驻额度卡 | 同一上游卡片不相邻时归到首次出现处 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | test_sidebar_accounts_10 | 🟢 green |

## Coverage Notes

- 全部新测试用 jsdom 渲染 `SidebarUsage`，`fakeApi` 返回卡片；浮层场景 `wide:false` 后点击 `[data-dmg-sidebar-rail]`。
- 截断场景断言 `title`、类名以及 `styles.ts` 中 `.dmg-sidebar-account` 的声明（jsdom 不做布局）。
- 重复 key：在渲染期间监听 `console.error`，断言没有 "same key" 警告。
