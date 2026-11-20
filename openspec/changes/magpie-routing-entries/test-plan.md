## Test Plan

依据本 change 的 delta spec（6 requirements / 41 scenarios）。review.md round 3 为 `VERDICT: APPROVE_WITH_CHANGES`，Required Changes M1–M4 已应用并经评审者复核，`CHANGES_APPLIED: yes`。

约定：本 change 新增的 16 个场景各对应一个新建的具名测试，初始 🔴 red。MODIFIED requirement 中原样保留的场景沿用既有测试（来自已归档的 `magpie-owner-routes` 与更早的可见性 / 默认 effort 测试），当前为 🟢 green，apply 期间必须保持绿；若实现使其变红，修实现而不是放宽断言。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-magpie-connector/spec.md → 路由入口识别 | 按前缀识别与分类 | packages/dsh-magpie-connector/test/routing-entries.test.ts | test_routing_entries_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 路由入口原样透传 | 透传 id 与 effort | packages/dsh-magpie-connector/test/routing-entries.test.ts | test_routing_entries_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 按 owned_by 分组且不按名字猜测 | packages/dsh-magpie-connector/test/owner-routes.test.ts | test_owner_routes_01 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 不可信或大小写不同的 owned_by | packages/dsh-magpie-connector/test/owner-routes.test.ts | test_owner_routes_02 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 返回的 provider 等于被请求的 route | packages/dsh-magpie-connector/test/owner-routes.test.ts | test_owner_routes_03 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 可见性与 effort 在归属 route 上保持 | packages/dsh-magpie-connector/test/owner-routes.test.ts | test_owner_routes_04 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | other 组内保留各自的可见性键 | packages/dsh-magpie-connector/test/owner-routes.test.ts | test_owner_routes_05 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 原版宿主即可看到分组 | packages/dsh-magpie-connector/test/owner-routes.test.ts | test_owner_routes_06 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 路由入口归入 routing 而不随首个成员换组 | packages/dsh-magpie-connector/test/routing-entries.test.ts | test_routing_entries_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 首次安装只有路由入口 | packages/dsh-magpie-connector/test/routing-entries.test.ts | test_routing_entries_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 名为 routing 的普通模型归入 other | packages/dsh-magpie-connector/test/routing-entries.test.ts | test_routing_entries_05 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 旧会话保存的厂商 route 路由入口不再可用 | packages/dsh-magpie-connector/test/routing-entries.test.ts | test_routing_entries_06 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 重启后 route 身份在同步前即存在 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_01 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 首次安装在同步前不注册 route | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_02 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 首次配置经设置请求同步出归属后注册 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_03 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | resync 发现新归属不自锁 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_04 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 新归属被持久并发布 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_05 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 保存 knownOwners 失败时仍发布已有 route 的目录变化 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_06 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | replace 冲突时撤回追加并发布目录 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_07 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 撤回写入失败时下次启动按启动失败处理 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_08 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 首次注册 INVARIANT 不当作成功 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_09 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 线路保存期间的归属追加不被覆盖 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_10 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 非法 knownOwners 被整体重置且不影响连接 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_11 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 归属下架后 route 保留 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_12 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 归属上限按出现顺序截断 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_13 | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | routing 在同一次同步中优先准入 | packages/dsh-magpie-connector/test/routing-owners.test.ts | test_routing_owners_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 首次同步时 routing 排在最前 | packages/dsh-magpie-connector/test/routing-owners.test.ts | test_routing_owners_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 名额已满时 routing 被拒绝并报告 | packages/dsh-magpie-connector/test/routing-owners.test.ts | test_routing_owners_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | routing route 被占用时 replace 冲突 | packages/dsh-magpie-connector/test/routing-owners.test.ts | test_routing_owners_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 未设置时跟随网关 | packages/dsh-magpie-connector/test/visibility.test.ts | spec Scenario "未设置时跟随网关" | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 设置后严格按白名单与目录求交集 | packages/dsh-magpie-connector/test/visibility.test.ts | spec Scenario "设置后严格按白名单与目录求交集" | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 形状非法被拒绝 | packages/dsh-magpie-connector/test/visibility.test.ts | spec Scenario "形状非法被拒绝" | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 路由组只受 routing 键控制 | packages/dsh-magpie-connector/test/routing-settings.test.tsx | test_routing_settings_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 只有路由组时仍能恢复跟随网关 | packages/dsh-magpie-connector/test/routing-settings.test.tsx | test_routing_settings_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | provider 只剩路由入口时不留空分区 | packages/dsh-magpie-connector/test/routing-settings.test.tsx | test_routing_settings_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | provider 只剩路由入口但有用量卡片时保留分区 | packages/dsh-magpie-connector/test/routing-settings.test.tsx | test_routing_settings_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按 provider 分组的模型可见性 | 路由组分区说明与无编辑控件 | packages/dsh-magpie-connector/test/routing-settings.test.tsx | test_routing_settings_05 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → DSH 侧默认 effort | 设置与清除 | packages/dsh-magpie-connector/test/default-effort.test.ts | spec Scenario "设置与清除" | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → DSH 侧默认 effort | 拒绝非法档位 | packages/dsh-magpie-connector/test/default-effort.test.ts | spec Scenario "拒绝非法档位" | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → DSH 侧默认 effort | 档位失效时不下发，恢复后重新下发 | packages/dsh-magpie-connector/test/default-effort.test.ts | spec Scenario "档位失效时不下发，恢复后重新下发" | 🟢 green（既有测试，回归保持） |
| specs/dsh-magpie-connector/spec.md → DSH 侧默认 effort | 下拉文案与路由入口 | packages/dsh-magpie-connector/test/routing-settings.test.tsx | test_routing_settings_06 | 🟢 green |

## Coverage Notes

- Host 侧（目录映射、归属准入、route 注册、透传）复用 `test/support/host.ts` 的真实宿主夹具（真实 Cordis + `@deepseek-ai/dsh-llm`）与网关 mock；`test_routing_owners_04` 用夹具中的外来 adapter 预先占用 `dsh-magpie-connector-routing`。
- 设置页场景用 jsdom 渲染 `SettingsPage`，网关 mock 同时返回 `/models` 与 `/magpie/quotas/cards`。
- `test_routing_entries_02` 断言网关 mock 收到的请求体字段 `model` 与 `reasoning_effort`。
- 非场景实测（不进上表，作为 tasks 中的合并前关卡）：对家庭 Magpie 的「便宜优先」连续两轮生成，第一轮 low、第二轮 high（成员由 MiniMax 切到 Claude Fable），确认带推理回放的第二轮被网关接受；若被拒，暂停合并并另行评估对路由入口关闭原生回放。
