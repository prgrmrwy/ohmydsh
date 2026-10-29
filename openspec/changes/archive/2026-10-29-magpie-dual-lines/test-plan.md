## Test Plan

依据 `openspec/changes/magpie-dual-lines/` 的 proposal/design 与三份 delta specs（20 requirements / 82 scenarios）。review.md round 3 为 `VERDICT: APPROVE_WITH_CHANGES`，RC10–RC16 应用并复核后 `CHANGES_APPLIED: yes` 方可进入 apply。

约定：每行对应**一个新的具名测试**（所在文件可已存在，测试函数必须新建），初始状态全部 🟢 green；apply 阶段逐个翻绿，verify 不允许残留 red。

| Requirement | Scenario | Test File | Test Name | Initial State |
|---|---|---|---|---|
| specs/dsh-magpie-connector/spec.md → 插件身份与命名 | 只注册一个 route | packages/dsh-magpie-connector/test/line-identity.test.ts | test_line_identity_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 插件身份与命名 | 凭据引用由稳定 id 绑定 | packages/dsh-magpie-connector/test/line-identity.test.ts | test_line_identity_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 保存 key 后不回显 | packages/dsh-magpie-connector/test/line-connection.test.ts | test_line_connection_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 网关反射的 key 被脱敏 | packages/dsh-magpie-connector/test/line-connection.test.ts | test_line_connection_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 环境提供的 key 拒绝修改 | packages/dsh-magpie-connector/test/line-connection.test.ts | test_line_connection_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 非法设置输入被拒绝 | packages/dsh-magpie-connector/test/line-connection.test.ts | test_line_connection_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 未配置时不提供模型且不发请求 | packages/dsh-magpie-connector/test/line-connection.test.ts | test_line_connection_05 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 请求不混用线路凭据 | packages/dsh-magpie-connector/test/line-connection.test.ts | test_line_connection_06 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 删除线路只清可写凭据 | packages/dsh-magpie-connector/test/line-connection.test.ts | test_line_connection_07 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 整表重排不丢凭据 | packages/dsh-magpie-connector/test/line-connection.test.ts | test_line_connection_08 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 网关连接与凭据 | 手改或损坏的持久设置被整体拒绝 | packages/dsh-magpie-connector/test/line-connection.test.ts | test_line_connection_09 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接接入方式（AMD4） | 默认直连，选择 Cloudflare Access 后才出现令牌输入（AMD4） | packages/dsh-magpie-connector/test/line-access.test.ts | test_line_access_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接接入方式（AMD4） | 切回直连并保存即清除 Access 凭据（AMD4） | packages/dsh-magpie-connector/test/line-access.test.ts | test_line_access_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接接入方式（AMD4） | Access 线路必须是 https | packages/dsh-magpie-connector/test/line-access.test.ts | test_line_access_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接接入方式（AMD4） | Access 凭据缺失时线路未完整 | packages/dsh-magpie-connector/test/line-access.test.ts | test_line_access_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接接入方式（AMD4） | 环境 Access 线路完整可用但只读 | packages/dsh-magpie-connector/test/line-access.test.ts | test_line_access_05 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接接入方式（AMD4） | 直连线路提交 Access 值被拒绝 | packages/dsh-magpie-connector/test/line-access.test.ts | test_line_access_06 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接接入方式（AMD4） | 环境 Access 使接入方式只读 | packages/dsh-magpie-connector/test/line-access.test.ts | test_line_access_07 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 换地址后不显示旧目录 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 换 key 后不显示旧卡片 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 旧代晚到的响应被丢弃 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 已准备的调用按捕获值跑完 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 进行中的生成不被换代中止 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_05 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 外部改 key 触发换代 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_06 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 未收到事件时新操作发现 key 变化 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_07 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 自动切线路保留目录并清空卡片 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_08 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 编辑非生效线路不换目录 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_09 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 删除生效线路后换线路并保留目录 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_10 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 非生效线路外部凭据变化不换代 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_11 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 随机 id 生效线路的外部凭据事件触发换代 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_12 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 连接身份与代际隔离 | 切换后同步失败保留继承目录 | packages/dsh-magpie-connector/test/line-generation.test.ts | test_line_generation_13 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 完整流程只触达白名单 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 重定向不被跟随 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 存在全局代理时仍直连 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 多线路时只触达生效线路 origin | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 明文 http 线路不携带 Access 头 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_05 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 探测只建 TCP 连接不发 HTTP | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_06 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 目录同步与发布 | 保存地址后自动同步并发布 | packages/dsh-magpie-connector/test/catalog-sync.test.ts | test_catalog_sync_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 目录同步与发布 | 同步失败保留当前代目录 | packages/dsh-magpie-connector/test/catalog-sync.test.ts | test_catalog_sync_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 目录同步与发布 | 同代重复触发只发一次请求 | packages/dsh-magpie-connector/test/catalog-sync.test.ts | test_catalog_sync_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 目录同步与发布 | 同步超时 | packages/dsh-magpie-connector/test/catalog-sync.test.ts | test_catalog_sync_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 目录同步与发布 | key 无效的分类 | packages/dsh-magpie-connector/test/catalog-sync.test.ts | test_catalog_sync_05 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 设置写入的凭据隔离与失败恢复 | 删除线路凭据清理失败时不提交删除 | packages/dsh-magpie-connector/test/settings-write-isolation.test.ts | test_settings_write_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 设置写入的凭据隔离与失败恢复 | 切回直连清 Access 失败时接入方式不变 | packages/dsh-magpie-connector/test/settings-write-isolation.test.ts | test_settings_write_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 设置写入的凭据隔离与失败恢复 | 删除线路凭据清理成功后提交删除 | packages/dsh-magpie-connector/test/settings-write-isolation.test.ts | test_settings_write_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → pending 恢复与完整重试 | 重启后设置读取仍可用并返回 pending | packages/dsh-magpie-connector/test/pending-recovery.test.ts | test_pending_recovery_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → pending 恢复与完整重试 | 完整重试清空 pending 后恢复 | packages/dsh-magpie-connector/test/pending-recovery.test.ts | test_pending_recovery_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → pending 恢复与完整重试 | 新建线路提交失败后按 pending 清理 orphan | packages/dsh-magpie-connector/test/pending-recovery.test.ts | test_pending_recovery_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 旧格式升级（BREAKING） | 升级后旧配置被忽略且不删除 | packages/dsh-magpie-connector/test/legacy-upgrade.test.ts | test_legacy_upgrade_01 | 🟢 green |
| specs/magpie-access-auth/spec.md → Optional Access service authentication | Protected gateway | packages/dsh-magpie-connector/test/access-auth.test.ts | test_access_auth_01 | 🟢 green |
| specs/magpie-access-auth/spec.md → Optional Access service authentication | LAN connection | packages/dsh-magpie-connector/test/access-auth.test.ts | test_access_auth_02 | 🟢 green |
| specs/magpie-access-auth/spec.md → Optional Access service authentication | Invalid pair | packages/dsh-magpie-connector/test/access-auth.test.ts | test_access_auth_03 | 🟢 green |
| specs/magpie-access-auth/spec.md → Credentials remain confidential | Settings read and failed request | packages/dsh-magpie-connector/test/access-auth.test.ts | test_access_confidential_01 | 🟢 green |
| specs/magpie-access-auth/spec.md → Credentials remain confidential | Read-only credential source | packages/dsh-magpie-connector/test/access-auth.test.ts | test_access_confidential_02 | 🟢 green |
| specs/magpie-access-auth/spec.md → Captured connection lifecycle | Access rotation during discovery | packages/dsh-magpie-connector/test/access-lifecycle.test.ts | test_access_lifecycle_01 | 🟢 green |
| specs/magpie-access-auth/spec.md → Captured connection lifecycle | Prepared operation | packages/dsh-magpie-connector/test/access-lifecycle.test.ts | test_access_lifecycle_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 首次安装为 0 条并提供添加入口 | packages/dsh-magpie-connector/test/line-list.test.ts | test_line_list_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 添加备用线路并调整优先级 | packages/dsh-magpie-connector/test/line-list.test.ts | test_line_list_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 删除线路且至少保留一条 | packages/dsh-magpie-connector/test/line-list.test.ts | test_line_list_03 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 未完整线路不参与自动选择 | packages/dsh-magpie-connector/test/line-list.test.ts | test_line_list_04 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 折叠线路可展开编辑 | packages/dsh-magpie-connector/test/line-list.test.ts | test_line_list_05 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 线路数量上限 | packages/dsh-magpie-connector/test/line-list.test.ts | test_line_list_06 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路 id 规则 | 新线路由 host 分配稳定 id | packages/dsh-magpie-connector/test/line-id.test.ts | test_line_id_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路 id 规则 | 非法 line id 被拒绝 | packages/dsh-magpie-connector/test/line-id.test.ts | test_line_id_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → active 展示 | 默认只展开 active 并显示 4×4 绿方块 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_active_ui_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → active 展示 | 无 active 时不显示方块 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_active_ui_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 静默规则与 info 说明 | 切换线路静默无提示 | packages/dsh-magpie-connector/test/line-silent-ui.test.tsx | test_line_silent_ui_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 静默规则与 info 说明 | info 图标说明优先级 | packages/dsh-magpie-connector/test/line-silent-ui.test.tsx | test_line_silent_ui_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 生效线路定义 | 设置读取返回并更新生效线路 | packages/dsh-magpie-connector/test/active-line.test.ts | test_active_line_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 生效线路定义 | 无完整线路时 active 为空 | packages/dsh-magpie-connector/test/active-line.test.ts | test_active_line_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 自动选择规则 | 单线路直接使用且不探测 | packages/dsh-magpie-connector/test/line-selection.test.ts | test_line_selection_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 自动选择规则 | 序号 1 可达时使用序号 1 | packages/dsh-magpie-connector/test/line-selection.test.ts | test_line_selection_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 自动选择规则 | 序号 1 不可达时自动使用序号 2 | packages/dsh-magpie-connector/test/line-selection.test.ts | test_line_selection_03 | 🟢 green |
| specs/magpie-line-selection/spec.md → 自动选择规则 | 全部不可达时用序号 1 并上抛真实错误 | packages/dsh-magpie-connector/test/line-selection.test.ts | test_line_selection_04 | 🟢 green |
| specs/magpie-line-selection/spec.md → 探测实现与缓存 | 负缓存期内不重复探测 | packages/dsh-magpie-connector/test/line-probe.test.ts | test_line_probe_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 探测实现与缓存 | 正缓存与地址编辑后失效 | packages/dsh-magpie-connector/test/line-probe.test.ts | test_line_probe_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 探测实现与缓存 | IPv6 字面量地址可被探测 | packages/dsh-magpie-connector/test/line-probe.test.ts | test_line_probe_03 | 🟢 green |
| specs/magpie-line-selection/spec.md → 探测实现与缓存 | dispose 中止探测 | packages/dsh-magpie-connector/test/line-probe.test.ts | test_line_probe_04 | 🟢 green |
| specs/magpie-line-selection/spec.md → 失败处理与不重放 | 连接阶段失败只失效缓存且不重放 | packages/dsh-magpie-connector/test/line-failure.test.ts | test_line_failure_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 失败处理与不重放 | 连接阶段失败后下一次操作改用备用线路并成功 | packages/dsh-magpie-connector/test/line-failure.test.ts | test_line_failure_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 失败处理与不重放 | 非连接阶段失败不重放 | packages/dsh-magpie-connector/test/line-failure.test.ts | test_line_failure_03 | 🟢 green |
| specs/magpie-line-selection/spec.md → 失败处理与不重放 | TCP 可达但网关报错时不自动换线 | packages/dsh-magpie-connector/test/line-failure.test.ts | test_line_failure_04 | 🟢 green |

## Coverage Notes

- 测试命名：`test_<requirement slug>_<nn>` 是 test-plan 的规范名；实现时保持「文件+测试名→scenario」映射可审计。
- lines 夹具：所有测试通过 `test/support/line.ts` 构造 `{lines:[...]}`；单线路固定合法 hex id（可注入 `newId()` seam），不得再使用顶层 `baseUrl`/平铺设置 API。
- 双网关：`test/support/gateway.ts` 起多个 `127.0.0.1` mock 网关；不可达线路用未监听端口；https+Access 用 undici `MockAgent`。
- 凭据：`test/support/credentials.ts` 按 ref 读写；随机 id 场景用 `lineCredentialRefs(id)` 生成断言用的引用名。
- 随机 id：断言 `^[0-9a-f]{8}$`、去重、排序/重启后不变；host 分配新线路 id。
- 加载校验：手改/损坏 settings 场景需要临时 settings 文件 + 可控 credentials，断言「整体未配置、零请求、旧文件不变」。
- 客户端：fake `Api` 使用 lines 形状；DOM 断言 `data-line-id`/`data-expanded`/`data-active-line`（8 位 hex）/`--dmg-active`/info 文案/0 条空态。
- 时间：探测缓存 TTL 与超时用 `vi.useFakeTimers` / `vi.setSystemTime`。
- 发布资产（D10）与 BREAKING 升级文档由 tasks 集成组覆盖，不在此表映射。
