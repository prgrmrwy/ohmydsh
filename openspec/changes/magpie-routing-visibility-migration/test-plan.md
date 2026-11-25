## Test Plan

review.md round 1 `APPROVE_WITH_CHANGES`，M1–M3 已应用并复核（`CHANGES_APPLIED: yes`）。新迁移测试先红（无迁移时失败）后绿；紧凑行布局在用户隔离预览确认后实现。另有回归测试：写盘失败重试、routing 未准入时迁移、第二行整体换行。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 未设置时跟随网关 | packages/dsh-magpie-connector/test/visibility.test.ts | spec Scenario "未设置时跟随网关"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 设置后严格按白名单与目录求交集 | packages/dsh-magpie-connector/test/visibility.test.ts | spec Scenario "设置后严格按白名单与目录求交集"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 形状非法被拒绝 | packages/dsh-magpie-connector/test/visibility.test.ts | spec Scenario "形状非法被拒绝"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 路由组只受 routing 键控制 | packages/dsh-magpie-connector/test/routing-settings.test.tsx | spec Scenario "路由组只受 routing 键控制"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 只有路由组时仍能恢复跟随网关 | packages/dsh-magpie-connector/test/routing-settings.test.tsx | spec Scenario "只有路由组时仍能恢复跟随网关"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | provider 只剩路由入口时不留空分区 | packages/dsh-magpie-connector/test/routing-settings.test.tsx | spec Scenario "provider 只剩路由入口时不留空分区"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | provider 只剩路由入口但有用量卡片时保留分区 | packages/dsh-magpie-connector/test/routing-settings.test.tsx | spec Scenario "provider 只剩路由入口但有用量卡片时保留分区"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 路由组分区说明与无编辑控件 | packages/dsh-magpie-connector/test/routing-settings.test.tsx | spec Scenario "路由组分区说明与无编辑控件"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 0.7 之前保存在厂商键下的路由入口可见性被迁移 | packages/dsh-magpie-connector/test/routing-visibility-migration.test.ts | pre-0.7 vendor-key visibility of routing entries moves to the routing key | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 无需迁移或已有 routing 键时不改写 | packages/dsh-magpie-connector/test/routing-visibility-migration.test.ts | nothing to migrate: settings stay as they are, and a routing key already saved is never overwritten | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 同一上游多账号分段 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "同一上游多账号分段"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 多账号且勾选多个档位 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "多账号且勾选多个档位"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 组内一个账号失败、一个只有余额 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "组内一个账号失败、一个只有余额"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 侧栏收起时浮层也分段 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "侧栏收起时浮层也分段"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 多账号缺少 user | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "多账号缺少 user"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 账号标识过长时截断 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "账号标识过长时截断"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 组内同一窗口时窗口名提到组标题 | packages/dsh-magpie-connector/test/sidebar-accounts.test.tsx | spec Scenario "组内同一窗口时窗口名提到组标题"（既有） | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 侧边栏多账号分段 | 只有账号标识可截断 | packages/dsh-magpie-connector/test/visibility.test.ts / sidebar-accounts.test.tsx | spec Scenario "只有账号标识可截断"（既有） | 🟢 green |
