## Test Plan

依据 `openspec/changes/magpie-owner-routes/` 的 proposal/design 与 delta spec（11 requirements / 62 scenarios）。review.md round 3 为 `VERDICT: APPROVE_WITH_CHANGES`，Required Changes 1–2 已应用并经评审者复核，`CHANGES_APPLIED: yes`。

约定：每行对应**一个新的具名测试**（测试函数必须新建；MODIFIED requirement 中沿用既有行为的场景，新测试以归属 route 重新断言，原有测试中写死旧 route `dsh-magpie-connector` 的断言在实现时一并改写）。初始状态全部 🔴 red，apply 阶段逐个翻绿，verify 不允许残留 red。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-magpie-connector/spec.md → 插件身份与命名 | 只注册归属 route | packages/dsh-magpie-connector/test/owner-identity.test.ts | test_owner_identity_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 插件身份与命名 | 旧 route 选择不再可用 | packages/dsh-magpie-connector/test/owner-identity.test.ts | test_owner_identity_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 插件身份与命名 | 凭据引用由稳定 id 绑定 | packages/dsh-magpie-connector/test/owner-identity.test.ts | test_owner_identity_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → Codex 速度切换 | 快速模式请求带 priority（两种协议） | packages/dsh-magpie-connector/test/owner-speed.test.tsx | test_owner_speed_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → Codex 速度切换 | 归属 route 上显示速度控件 | packages/dsh-magpie-connector/test/owner-speed.test.tsx | test_owner_speed_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → Codex 速度切换 | 标准模式与其它会话不带字段 | packages/dsh-magpie-connector/test/owner-speed.test.tsx | test_owner_speed_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → Codex 速度切换 | 不支持的模型不显示且不带字段 | packages/dsh-magpie-connector/test/owner-speed.test.tsx | test_owner_speed_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → Codex 速度切换 | host 重启后回到标准 | packages/dsh-magpie-connector/test/owner-speed.test.tsx | test_owner_speed_05 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → Codex 速度切换 | 非法 tier 被拒绝 | packages/dsh-magpie-connector/test/owner-speed.test.tsx | test_owner_speed_06 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 保存 key 后不回显 | packages/dsh-magpie-connector/test/owner-connection.test.ts | test_owner_connection_01 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 网关反射的 key 被脱敏 | packages/dsh-magpie-connector/test/owner-connection.test.ts | test_owner_connection_02 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 环境提供的 key 拒绝修改 | packages/dsh-magpie-connector/test/owner-connection.test.ts | test_owner_connection_03 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 非法设置输入被拒绝 | packages/dsh-magpie-connector/test/owner-connection.test.ts | test_owner_connection_04 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 未配置时不提供模型且不发请求 | packages/dsh-magpie-connector/test/owner-connection.test.ts | test_owner_connection_05 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 手改或损坏的持久设置被整体拒绝 | packages/dsh-magpie-connector/test/owner-connection.test.ts | test_owner_connection_06 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 请求不混用线路凭据 | packages/dsh-magpie-connector/test/owner-connection.test.ts | test_owner_connection_07 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 删除线路只清可写凭据 | packages/dsh-magpie-connector/test/owner-connection.test.ts | test_owner_connection_08 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 整表重排不丢凭据 | packages/dsh-magpie-connector/test/owner-connection.test.ts | test_owner_connection_09 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 换地址后不显示旧目录 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_01 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 换 key 后不显示旧卡片 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_02 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 旧代晚到的响应被丢弃 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_03 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 已准备的调用按捕获值跑完 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_04 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 进行中的生成不被换代中止 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_05 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 外部改 key 触发换代 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_06 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 未收到事件时新操作发现 key 变化 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_07 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 自动切线路保留目录并清空卡片 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_08 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 编辑非生效线路不换目录 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_09 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 删除生效线路后换线路并保留目录 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_10 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 非生效线路外部凭据变化不换代 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_11 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 随机 id 生效线路的外部凭据事件触发换代 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_12 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 切换后同步失败保留继承目录 | packages/dsh-magpie-connector/test/owner-generation.test.ts | test_owner_generation_13 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 模型目录字段映射 | 字段映射 | packages/dsh-magpie-connector/test/owner-catalog-mapping.test.ts | test_owner_catalog_mapping_01 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 模型目录字段映射 | 畸形条目被丢弃 | packages/dsh-magpie-connector/test/owner-catalog-mapping.test.ts | test_owner_catalog_mapping_02 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 模型目录字段映射 | 非法容量值视为缺失 | packages/dsh-magpie-connector/test/owner-catalog-mapping.test.ts | test_owner_catalog_mapping_03 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 禁用不删除用户数据 | dispose 不删除数据 | packages/dsh-magpie-connector/test/owner-dispose.test.ts | test_owner_dispose_01 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 禁用不删除用户数据 | dispose 时有进行中的请求 | packages/dsh-magpie-connector/test/owner-dispose.test.ts | test_owner_dispose_02 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 禁用不删除用户数据 | 注册句柄 dispose 抛错时其它清理仍执行 | packages/dsh-magpie-connector/test/owner-dispose.test.ts | test_owner_dispose_03 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 禁用不删除用户数据 | 尚未注册任何 route 时 dispose | packages/dsh-magpie-connector/test/owner-dispose.test.ts | test_owner_dispose_04 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 旧格式升级（BREAKING） | 升级后旧配置被忽略且不删除 | packages/dsh-magpie-connector/test/owner-legacy-upgrade.test.ts | test_owner_legacy_upgrade_01 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 旧格式升级（BREAKING） | 旧格式升级后配置线路即恢复 | packages/dsh-magpie-connector/test/owner-legacy-upgrade.test.ts | test_owner_legacy_upgrade_02 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 按 owned_by 分组且不按名字猜测 | packages/dsh-magpie-connector/test/owner-routes.test.ts | test_owner_routes_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 不可信或大小写不同的 owned_by | packages/dsh-magpie-connector/test/owner-routes.test.ts | test_owner_routes_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 返回的 provider 等于被请求的 route | packages/dsh-magpie-connector/test/owner-routes.test.ts | test_owner_routes_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 可见性与 effort 在归属 route 上保持 | packages/dsh-magpie-connector/test/owner-routes.test.ts | test_owner_routes_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | other 组内保留各自的可见性键 | packages/dsh-magpie-connector/test/owner-routes.test.ts | test_owner_routes_05 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 按网关归属注册 route | 原版宿主即可看到分组 | packages/dsh-magpie-connector/test/owner-routes.test.ts | test_owner_routes_06 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 原生回放身份跨 route 稳定 | 归属 route 上续聊保留推理元数据 | packages/dsh-magpie-connector/test/owner-replay.test.ts | test_owner_replay_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 原生回放身份跨 route 稳定 | 跨本插件 route 续聊仍视为同模型 | packages/dsh-magpie-connector/test/owner-replay.test.ts | test_owner_replay_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 原生回放身份跨 route 稳定 | 篡改或外来回放退化为普通历史 | packages/dsh-magpie-connector/test/owner-replay.test.ts | test_owner_replay_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 重启后 route 身份在同步前即存在 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_01 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 首次安装在同步前不注册 route | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_02 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 首次配置经设置请求同步出归属后注册 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_03 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | resync 发现新归属不自锁 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_04 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 新归属被持久并发布 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_05 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 保存 knownOwners 失败时仍发布已有 route 的目录变化 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_06 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | replace 冲突时撤回追加并发布目录 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_07 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 撤回写入失败时下次启动按启动失败处理 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_08 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 首次注册 INVARIANT 不当作成功 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_09 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 线路保存期间的归属追加不被覆盖 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_10 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 非法 knownOwners 被整体重置且不影响连接 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_11 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 归属下架后 route 保留 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_12 | 🔴 red |
| specs/dsh-magpie-connector/spec.md → 归属 route 持久 | 归属上限按出现顺序截断 | packages/dsh-magpie-connector/test/owner-persistence.test.ts | test_owner_persistence_13 | 🔴 red |

## Coverage Notes

- **真实宿主夹具**：新增 `test/support/host.ts`，用真实 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-llm` 的 `LlmRuntime` 挂载插件，提供 `listProviders`、`listModels`、`resolveModelInfo`、`prepareCall`，以及可注入「抛 INVARIANT 的 adapters-updated 监听器」「预先占用某 route 的外来 adapter」。所有标注「原版宿主」「真实 Cordis」「经宿主」的场景都用它，不用 mock 冒充宿主校验（INVALID_CATALOG / INVALID_MODEL_INFO / NO_ADAPTER / DUPLICATE_ADAPTER 必须由真实宿主抛出）。
- **原版目录**：「原版宿主即可看到分组」「保存 knownOwners 失败…」用 `@deepseek-ai/dsh-api-session-controller` 的 `buildModelCatalog`（仓库依赖为原版 rc.2，未打 model-display.patch；测试先断言其 lib 中不含 `displayGroup` 字样以证明是原版）。
- **回放**：复用 `test/replay.test.ts` 的 Responses SSE 夹具（`encrypted_content: "opaque-encrypted-reasoning"`）；assistant 历史经真实 `createAssistantMessage` 以 `source.provider = <归属 route>` 构造。
- **设置写入失败**：`SettingsStore` 注入可切换失败的 writer；「不自锁」场景用 5 秒 vitest timeout 作为判据。
- **设置页渲染**：沿用 `test/client-support/fake-api.ts`，扩展 `routeRegistrationError` / `knownOwnersReset` / `ownerLimitReached` 字段。
- **既有测试改写**：`test/display-group.test.ts` 删除（被 `owner-routes` 取代）；其余写死 `provider: 'dsh-magpie-connector'` 或 `replace(['dsh-magpie-connector'])` 的既有断言随实现改为归属 route，属于 refactor 步骤，不另列行。
