# Implementation Tasks

依据三份 delta spec（20 requirements / 82 scenarios）与 design D1–D11 的 red-green-refactor 顺序执行；每个 scenario 的具名测试见 [test-plan.md](test-plan.md)。先做基础设施与 lines 夹具，再按「schema/凭据/随机 id → 按线路 Access → 身份/继承 → 探测/选择 → UI/发布资产」分层，每层结束跑全量回归。

## 1. 基础设施、seam 与测试夹具

- [x] 1.1 `test/support/line.ts`：lines 夹具（固定合法 hex id、`lineCredentialRefs`、单线路 runtime 构造、`newId()` seam）
- [x] 1.2 `test/support/credentials.ts`：按 ref 读写、env 只读、可失败 set/unset，legacy helper 调用点全部迁移到 lines 夹具
- [x] 1.3 `test/support/gateway.ts`：多 mock 网关、不可达端口、https/Access MockAgent 组合
- [x] 1.4 `SettingsStore` 单版本 schema（lines/偏好/pending，无 baseUrl/nextLineId）：加载校验 fail-closed 与原子写
- [x] 1.5 客户端 fake `Api`/`settingsView` 改为 lines 形状（lines/activeLineId/pending/retainedCredentials/refs）

## 2. 插件身份与命名（specs/dsh-magpie-connector/spec.md）

- [x] 2.1 Write failing test `test_line_identity_01` in `packages/dsh-magpie-connector/test/line-identity.test.ts` for scenario「只注册一个 route」（assert it fails for the right reason）
- [x] 2.2 Implement「只注册一个 route」behavior per design；run `test_line_identity_01` to pass
- [x] 2.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 2.4 Write failing test `test_line_identity_02` in `packages/dsh-magpie-connector/test/line-identity.test.ts` for scenario「凭据引用由稳定 id 绑定」（assert it fails for the right reason）
- [x] 2.5 Implement「凭据引用由稳定 id 绑定」behavior per design；run `test_line_identity_02` to pass
- [x] 2.6 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 3. 网关连接与凭据（specs/dsh-magpie-connector/spec.md）

- [x] 3.1 Write failing test `test_line_connection_01` in `packages/dsh-magpie-connector/test/line-connection.test.ts` for scenario「保存 key 后不回显」（assert it fails for the right reason）
- [x] 3.2 Implement「保存 key 后不回显」behavior per design；run `test_line_connection_01` to pass
- [x] 3.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 3.4 Write failing test `test_line_connection_02` in `packages/dsh-magpie-connector/test/line-connection.test.ts` for scenario「网关反射的 key 被脱敏」（assert it fails for the right reason）
- [x] 3.5 Implement「网关反射的 key 被脱敏」behavior per design；run `test_line_connection_02` to pass
- [x] 3.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 3.7 Write failing test `test_line_connection_03` in `packages/dsh-magpie-connector/test/line-connection.test.ts` for scenario「环境提供的 key 拒绝修改」（assert it fails for the right reason）
- [x] 3.8 Implement「环境提供的 key 拒绝修改」behavior per design；run `test_line_connection_03` to pass
- [x] 3.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 3.10 Write failing test `test_line_connection_04` in `packages/dsh-magpie-connector/test/line-connection.test.ts` for scenario「非法设置输入被拒绝」（assert it fails for the right reason）
- [x] 3.11 Implement「非法设置输入被拒绝」behavior per design；run `test_line_connection_04` to pass
- [x] 3.12 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 3.13 Write failing test `test_line_connection_05` in `packages/dsh-magpie-connector/test/line-connection.test.ts` for scenario「未配置时不提供模型且不发请求」（assert it fails for the right reason）
- [x] 3.14 Implement「未配置时不提供模型且不发请求」behavior per design；run `test_line_connection_05` to pass
- [x] 3.15 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 3.16 Write failing test `test_line_connection_06` in `packages/dsh-magpie-connector/test/line-connection.test.ts` for scenario「请求不混用线路凭据」（assert it fails for the right reason）
- [x] 3.17 Implement「请求不混用线路凭据」behavior per design；run `test_line_connection_06` to pass
- [x] 3.18 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 3.19 Write failing test `test_line_connection_07` in `packages/dsh-magpie-connector/test/line-connection.test.ts` for scenario「删除线路只清可写凭据」（assert it fails for the right reason）
- [x] 3.20 Implement「删除线路只清可写凭据」behavior per design；run `test_line_connection_07` to pass
- [x] 3.21 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 3.22 Write failing test `test_line_connection_08` in `packages/dsh-magpie-connector/test/line-connection.test.ts` for scenario「整表重排不丢凭据」（assert it fails for the right reason）
- [x] 3.23 Implement「整表重排不丢凭据」behavior per design；run `test_line_connection_08` to pass
- [x] 3.24 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 3.25 Write failing test `test_line_connection_09` in `packages/dsh-magpie-connector/test/line-connection.test.ts` for scenario「手改或损坏的持久设置被整体拒绝」（assert it fails for the right reason）
- [x] 3.26 Implement「手改或损坏的持久设置被整体拒绝」behavior per design；run `test_line_connection_09` to pass
- [x] 3.27 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 4. 连接接入方式（AMD4）（specs/dsh-magpie-connector/spec.md）

- [x] 4.1 Write failing test `test_line_access_01` in `packages/dsh-magpie-connector/test/line-access.test.ts` for scenario「默认直连，选择 Cloudflare Access 后才出现令牌输入（AMD4）」（assert it fails for the right reason）
- [x] 4.2 Implement「默认直连，选择 Cloudflare Access 后才出现令牌输入（AMD4）」behavior per design；run `test_line_access_01` to pass
- [x] 4.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 4.4 Write failing test `test_line_access_02` in `packages/dsh-magpie-connector/test/line-access.test.ts` for scenario「切回直连并保存即清除 Access 凭据（AMD4）」（assert it fails for the right reason）
- [x] 4.5 Implement「切回直连并保存即清除 Access 凭据（AMD4）」behavior per design；run `test_line_access_02` to pass
- [x] 4.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 4.7 Write failing test `test_line_access_03` in `packages/dsh-magpie-connector/test/line-access.test.ts` for scenario「Access 线路必须是 https」（assert it fails for the right reason）
- [x] 4.8 Implement「Access 线路必须是 https」behavior per design；run `test_line_access_03` to pass
- [x] 4.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 4.10 Write failing test `test_line_access_04` in `packages/dsh-magpie-connector/test/line-access.test.ts` for scenario「Access 凭据缺失时线路未完整」（assert it fails for the right reason）
- [x] 4.11 Implement「Access 凭据缺失时线路未完整」behavior per design；run `test_line_access_04` to pass
- [x] 4.12 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 4.13 Write failing test `test_line_access_05` in `packages/dsh-magpie-connector/test/line-access.test.ts` for scenario「环境 Access 线路完整可用但只读」（assert it fails for the right reason）
- [x] 4.14 Implement「环境 Access 线路完整可用但只读」behavior per design；run `test_line_access_05` to pass
- [x] 4.15 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 4.16 Write failing test `test_line_access_06` in `packages/dsh-magpie-connector/test/line-access.test.ts` for scenario「直连线路提交 Access 值被拒绝」（assert it fails for the right reason）
- [x] 4.17 Implement「直连线路提交 Access 值被拒绝」behavior per design；run `test_line_access_06` to pass
- [x] 4.18 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 4.19 Write failing test `test_line_access_07` in `packages/dsh-magpie-connector/test/line-access.test.ts` for scenario「环境 Access 使接入方式只读」（assert it fails for the right reason）
- [x] 4.20 Implement「环境 Access 使接入方式只读」behavior per design；run `test_line_access_07` to pass
- [x] 4.21 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 5. 连接身份与代际隔离（specs/dsh-magpie-connector/spec.md）

- [x] 5.1 Write failing test `test_line_generation_01` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「换地址后不显示旧目录」（assert it fails for the right reason）
- [x] 5.2 Implement「换地址后不显示旧目录」behavior per design；run `test_line_generation_01` to pass
- [x] 5.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 5.4 Write failing test `test_line_generation_02` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「换 key 后不显示旧卡片」（assert it fails for the right reason）
- [x] 5.5 Implement「换 key 后不显示旧卡片」behavior per design；run `test_line_generation_02` to pass
- [x] 5.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 5.7 Write failing test `test_line_generation_03` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「旧代晚到的响应被丢弃」（assert it fails for the right reason）
- [x] 5.8 Implement「旧代晚到的响应被丢弃」behavior per design；run `test_line_generation_03` to pass
- [x] 5.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 5.10 Write failing test `test_line_generation_04` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「已准备的调用按捕获值跑完」（assert it fails for the right reason）
- [x] 5.11 Implement「已准备的调用按捕获值跑完」behavior per design；run `test_line_generation_04` to pass
- [x] 5.12 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 5.13 Write failing test `test_line_generation_05` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「进行中的生成不被换代中止」（assert it fails for the right reason）
- [x] 5.14 Implement「进行中的生成不被换代中止」behavior per design；run `test_line_generation_05` to pass
- [x] 5.15 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 5.16 Write failing test `test_line_generation_06` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「外部改 key 触发换代」（assert it fails for the right reason）
- [x] 5.17 Implement「外部改 key 触发换代」behavior per design；run `test_line_generation_06` to pass
- [x] 5.18 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 5.19 Write failing test `test_line_generation_07` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「未收到事件时新操作发现 key 变化」（assert it fails for the right reason）
- [x] 5.20 Implement「未收到事件时新操作发现 key 变化」behavior per design；run `test_line_generation_07` to pass
- [x] 5.21 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 5.22 Write failing test `test_line_generation_08` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「自动切线路保留目录并清空卡片」（assert it fails for the right reason）
- [x] 5.23 Implement「自动切线路保留目录并清空卡片」behavior per design；run `test_line_generation_08` to pass
- [x] 5.24 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 5.25 Write failing test `test_line_generation_09` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「编辑非生效线路不换目录」（assert it fails for the right reason）
- [x] 5.26 Implement「编辑非生效线路不换目录」behavior per design；run `test_line_generation_09` to pass
- [x] 5.27 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 5.28 Write failing test `test_line_generation_10` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「删除生效线路后换线路并保留目录」（assert it fails for the right reason）
- [x] 5.29 Implement「删除生效线路后换线路并保留目录」behavior per design；run `test_line_generation_10` to pass
- [x] 5.30 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 5.31 Write failing test `test_line_generation_11` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「非生效线路外部凭据变化不换代」（assert it fails for the right reason）
- [x] 5.32 Implement「非生效线路外部凭据变化不换代」behavior per design；run `test_line_generation_11` to pass
- [x] 5.33 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 5.34 Write failing test `test_line_generation_12` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「随机 id 生效线路的外部凭据事件触发换代」（assert it fails for the right reason）
- [x] 5.35 Implement「随机 id 生效线路的外部凭据事件触发换代」behavior per design；run `test_line_generation_12` to pass
- [x] 5.36 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 5.37 Write failing test `test_line_generation_13` in `packages/dsh-magpie-connector/test/line-generation.test.ts` for scenario「切换后同步失败保留继承目录」（assert it fails for the right reason）
- [x] 5.38 Implement「切换后同步失败保留继承目录」behavior per design；run `test_line_generation_13` to pass
- [x] 5.39 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 6. 只读与传输边界（specs/dsh-magpie-connector/spec.md）

- [x] 6.1 Write failing test `test_line_transport_01` in `packages/dsh-magpie-connector/test/line-transport.test.ts` for scenario「完整流程只触达白名单」（assert it fails for the right reason）
- [x] 6.2 Implement「完整流程只触达白名单」behavior per design；run `test_line_transport_01` to pass
- [x] 6.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 6.4 Write failing test `test_line_transport_02` in `packages/dsh-magpie-connector/test/line-transport.test.ts` for scenario「重定向不被跟随」（assert it fails for the right reason）
- [x] 6.5 Implement「重定向不被跟随」behavior per design；run `test_line_transport_02` to pass
- [x] 6.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 6.7 Write failing test `test_line_transport_03` in `packages/dsh-magpie-connector/test/line-transport.test.ts` for scenario「存在全局代理时仍直连」（assert it fails for the right reason）
- [x] 6.8 Implement「存在全局代理时仍直连」behavior per design；run `test_line_transport_03` to pass
- [x] 6.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 6.10 Write failing test `test_line_transport_04` in `packages/dsh-magpie-connector/test/line-transport.test.ts` for scenario「多线路时只触达生效线路 origin」（assert it fails for the right reason）
- [x] 6.11 Implement「多线路时只触达生效线路 origin」behavior per design；run `test_line_transport_04` to pass
- [x] 6.12 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 6.13 Write failing test `test_line_transport_05` in `packages/dsh-magpie-connector/test/line-transport.test.ts` for scenario「明文 http 线路不携带 Access 头」（assert it fails for the right reason）
- [x] 6.14 Implement「明文 http 线路不携带 Access 头」behavior per design；run `test_line_transport_05` to pass
- [x] 6.15 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 6.16 Write failing test `test_line_transport_06` in `packages/dsh-magpie-connector/test/line-transport.test.ts` for scenario「探测只建 TCP 连接不发 HTTP」（assert it fails for the right reason）
- [x] 6.17 Implement「探测只建 TCP 连接不发 HTTP」behavior per design；run `test_line_transport_06` to pass
- [x] 6.18 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 7. 目录同步与发布（specs/dsh-magpie-connector/spec.md）

- [x] 7.1 Write failing test `test_catalog_sync_01` in `packages/dsh-magpie-connector/test/catalog-sync.test.ts` for scenario「保存地址后自动同步并发布」（assert it fails for the right reason）
- [x] 7.2 Implement「保存地址后自动同步并发布」behavior per design；run `test_catalog_sync_01` to pass
- [x] 7.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 7.4 Write failing test `test_catalog_sync_02` in `packages/dsh-magpie-connector/test/catalog-sync.test.ts` for scenario「同步失败保留当前代目录」（assert it fails for the right reason）
- [x] 7.5 Implement「同步失败保留当前代目录」behavior per design；run `test_catalog_sync_02` to pass
- [x] 7.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 7.7 Write failing test `test_catalog_sync_03` in `packages/dsh-magpie-connector/test/catalog-sync.test.ts` for scenario「同代重复触发只发一次请求」（assert it fails for the right reason）
- [x] 7.8 Implement「同代重复触发只发一次请求」behavior per design；run `test_catalog_sync_03` to pass
- [x] 7.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 7.10 Write failing test `test_catalog_sync_04` in `packages/dsh-magpie-connector/test/catalog-sync.test.ts` for scenario「同步超时」（assert it fails for the right reason）
- [x] 7.11 Implement「同步超时」behavior per design；run `test_catalog_sync_04` to pass
- [x] 7.12 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 7.13 Write failing test `test_catalog_sync_05` in `packages/dsh-magpie-connector/test/catalog-sync.test.ts` for scenario「key 无效的分类」（assert it fails for the right reason）
- [x] 7.14 Implement「key 无效的分类」behavior per design；run `test_catalog_sync_05` to pass
- [x] 7.15 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 8. 设置写入的凭据隔离与失败恢复（specs/dsh-magpie-connector/spec.md）

- [x] 8.1 Write failing test `test_settings_write_01` in `packages/dsh-magpie-connector/test/settings-write-isolation.test.ts` for scenario「删除线路凭据清理失败时不提交删除」（assert it fails for the right reason）
- [x] 8.2 Implement「删除线路凭据清理失败时不提交删除」behavior per design；run `test_settings_write_01` to pass
- [x] 8.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 8.4 Write failing test `test_settings_write_02` in `packages/dsh-magpie-connector/test/settings-write-isolation.test.ts` for scenario「切回直连清 Access 失败时接入方式不变」（assert it fails for the right reason）
- [x] 8.5 Implement「切回直连清 Access 失败时接入方式不变」behavior per design；run `test_settings_write_02` to pass
- [x] 8.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 8.7 Write failing test `test_settings_write_03` in `packages/dsh-magpie-connector/test/settings-write-isolation.test.ts` for scenario「删除线路凭据清理成功后提交删除」（assert it fails for the right reason）
- [x] 8.8 Implement「删除线路凭据清理成功后提交删除」behavior per design；run `test_settings_write_03` to pass
- [x] 8.9 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 9. pending 恢复与完整重试（specs/dsh-magpie-connector/spec.md）

- [x] 9.1 Write failing test `test_pending_recovery_01` in `packages/dsh-magpie-connector/test/pending-recovery.test.ts` for scenario「重启后设置读取仍可用并返回 pending」（assert it fails for the right reason）
- [x] 9.2 Implement「重启后设置读取仍可用并返回 pending」behavior per design；run `test_pending_recovery_01` to pass
- [x] 9.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 9.4 Write failing test `test_pending_recovery_02` in `packages/dsh-magpie-connector/test/pending-recovery.test.ts` for scenario「完整重试清空 pending 后恢复」（assert it fails for the right reason）
- [x] 9.5 Implement「完整重试清空 pending 后恢复」behavior per design；run `test_pending_recovery_02` to pass
- [x] 9.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 9.7 Write failing test `test_pending_recovery_03` in `packages/dsh-magpie-connector/test/pending-recovery.test.ts` for scenario「新建线路提交失败后按 pending 清理 orphan」（assert it fails for the right reason）
- [x] 9.8 Implement「新建线路提交失败后按 pending 清理 orphan」behavior per design；run `test_pending_recovery_03` to pass
- [x] 9.9 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 10. 旧格式升级（BREAKING）（specs/dsh-magpie-connector/spec.md）

- [x] 10.1 Write failing test `test_legacy_upgrade_01` in `packages/dsh-magpie-connector/test/legacy-upgrade.test.ts` for scenario「升级后旧配置被忽略且不删除」（assert it fails for the right reason）
- [x] 10.2 Implement「升级后旧配置被忽略且不删除」behavior per design；run `test_legacy_upgrade_01` to pass
- [x] 10.3 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 11. Optional Access service authentication（specs/magpie-access-auth/spec.md）

- [x] 11.1 Write failing test `test_access_auth_01` in `packages/dsh-magpie-connector/test/access-auth.test.ts` for scenario「Protected gateway」（assert it fails for the right reason）
- [x] 11.2 Implement「Protected gateway」behavior per design；run `test_access_auth_01` to pass
- [x] 11.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 11.4 Write failing test `test_access_auth_02` in `packages/dsh-magpie-connector/test/access-auth.test.ts` for scenario「LAN connection」（assert it fails for the right reason）
- [x] 11.5 Implement「LAN connection」behavior per design；run `test_access_auth_02` to pass
- [x] 11.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 11.7 Write failing test `test_access_auth_03` in `packages/dsh-magpie-connector/test/access-auth.test.ts` for scenario「Invalid pair」（assert it fails for the right reason）
- [x] 11.8 Implement「Invalid pair」behavior per design；run `test_access_auth_03` to pass
- [x] 11.9 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 12. Credentials remain confidential（specs/magpie-access-auth/spec.md）

- [x] 12.1 Write failing test `test_access_confidential_01` in `packages/dsh-magpie-connector/test/access-auth.test.ts` for scenario「Settings read and failed request」（assert it fails for the right reason）
- [x] 12.2 Implement「Settings read and failed request」behavior per design；run `test_access_confidential_01` to pass
- [x] 12.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 12.4 Write failing test `test_access_confidential_02` in `packages/dsh-magpie-connector/test/access-auth.test.ts` for scenario「Read-only credential source」（assert it fails for the right reason）
- [x] 12.5 Implement「Read-only credential source」behavior per design；run `test_access_confidential_02` to pass
- [x] 12.6 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 13. Captured connection lifecycle（specs/magpie-access-auth/spec.md）

- [x] 13.1 Write failing test `test_access_lifecycle_01` in `packages/dsh-magpie-connector/test/access-lifecycle.test.ts` for scenario「Access rotation during discovery」（assert it fails for the right reason）
- [x] 13.2 Implement「Access rotation during discovery」behavior per design；run `test_access_lifecycle_01` to pass
- [x] 13.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 13.4 Write failing test `test_access_lifecycle_02` in `packages/dsh-magpie-connector/test/access-lifecycle.test.ts` for scenario「Prepared operation」（assert it fails for the right reason）
- [x] 13.5 Implement「Prepared operation」behavior per design；run `test_access_lifecycle_02` to pass
- [x] 13.6 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 14. 线路列表与优先级（specs/magpie-line-selection/spec.md）

- [x] 14.1 Write failing test `test_line_list_01` in `packages/dsh-magpie-connector/test/line-list.test.ts` for scenario「首次安装为 0 条并提供添加入口」（assert it fails for the right reason）
- [x] 14.2 Implement「首次安装为 0 条并提供添加入口」behavior per design；run `test_line_list_01` to pass
- [x] 14.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 14.4 Write failing test `test_line_list_02` in `packages/dsh-magpie-connector/test/line-list.test.ts` for scenario「添加备用线路并调整优先级」（assert it fails for the right reason）
- [x] 14.5 Implement「添加备用线路并调整优先级」behavior per design；run `test_line_list_02` to pass
- [x] 14.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 14.7 Write failing test `test_line_list_03` in `packages/dsh-magpie-connector/test/line-list.test.ts` for scenario「删除线路且至少保留一条」（assert it fails for the right reason）
- [x] 14.8 Implement「删除线路且至少保留一条」behavior per design；run `test_line_list_03` to pass
- [x] 14.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 14.10 Write failing test `test_line_list_04` in `packages/dsh-magpie-connector/test/line-list.test.ts` for scenario「未完整线路不参与自动选择」（assert it fails for the right reason）
- [x] 14.11 Implement「未完整线路不参与自动选择」behavior per design；run `test_line_list_04` to pass
- [x] 14.12 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 14.13 Write failing test `test_line_list_05` in `packages/dsh-magpie-connector/test/line-list.test.ts` for scenario「折叠线路可展开编辑」（assert it fails for the right reason）
- [x] 14.14 Implement「折叠线路可展开编辑」behavior per design；run `test_line_list_05` to pass
- [x] 14.15 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 14.16 Write failing test `test_line_list_06` in `packages/dsh-magpie-connector/test/line-list.test.ts` for scenario「线路数量上限」（assert it fails for the right reason）
- [x] 14.17 Implement「线路数量上限」behavior per design；run `test_line_list_06` to pass
- [x] 14.18 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 15. 线路 id 规则（specs/magpie-line-selection/spec.md）

- [x] 15.1 Write failing test `test_line_id_01` in `packages/dsh-magpie-connector/test/line-id.test.ts` for scenario「新线路由 host 分配稳定 id」（assert it fails for the right reason）
- [x] 15.2 Implement「新线路由 host 分配稳定 id」behavior per design；run `test_line_id_01` to pass
- [x] 15.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 15.4 Write failing test `test_line_id_02` in `packages/dsh-magpie-connector/test/line-id.test.ts` for scenario「非法 line id 被拒绝」（assert it fails for the right reason）
- [x] 15.5 Implement「非法 line id 被拒绝」behavior per design；run `test_line_id_02` to pass
- [x] 15.6 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 16. active 展示（specs/magpie-line-selection/spec.md）

- [x] 16.1 Write failing test `test_line_active_ui_01` in `packages/dsh-magpie-connector/test/line-active-ui.test.tsx` for scenario「默认只展开 active 并显示 4×4 绿方块」（assert it fails for the right reason）
- [x] 16.2 Implement「默认只展开 active 并显示 4×4 绿方块」behavior per design；run `test_line_active_ui_01` to pass
- [x] 16.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 16.4 Write failing test `test_line_active_ui_02` in `packages/dsh-magpie-connector/test/line-active-ui.test.tsx` for scenario「无 active 时不显示方块」（assert it fails for the right reason）
- [x] 16.5 Implement「无 active 时不显示方块」behavior per design；run `test_line_active_ui_02` to pass
- [x] 16.6 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 17. 静默规则与 info 说明（specs/magpie-line-selection/spec.md）

- [x] 17.1 Write failing test `test_line_silent_ui_01` in `packages/dsh-magpie-connector/test/line-silent-ui.test.tsx` for scenario「切换线路静默无提示」（assert it fails for the right reason）
- [x] 17.2 Implement「切换线路静默无提示」behavior per design；run `test_line_silent_ui_01` to pass
- [x] 17.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 17.4 Write failing test `test_line_silent_ui_02` in `packages/dsh-magpie-connector/test/line-silent-ui.test.tsx` for scenario「info 图标说明优先级」（assert it fails for the right reason）
- [x] 17.5 Implement「info 图标说明优先级」behavior per design；run `test_line_silent_ui_02` to pass
- [x] 17.6 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 18. 生效线路定义（specs/magpie-line-selection/spec.md）

- [x] 18.1 Write failing test `test_active_line_01` in `packages/dsh-magpie-connector/test/active-line.test.ts` for scenario「设置读取返回并更新生效线路」（assert it fails for the right reason）
- [x] 18.2 Implement「设置读取返回并更新生效线路」behavior per design；run `test_active_line_01` to pass
- [x] 18.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 18.4 Write failing test `test_active_line_02` in `packages/dsh-magpie-connector/test/active-line.test.ts` for scenario「无完整线路时 active 为空」（assert it fails for the right reason）
- [x] 18.5 Implement「无完整线路时 active 为空」behavior per design；run `test_active_line_02` to pass
- [x] 18.6 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 19. 自动选择规则（specs/magpie-line-selection/spec.md）

- [x] 19.1 Write failing test `test_line_selection_01` in `packages/dsh-magpie-connector/test/line-selection.test.ts` for scenario「单线路直接使用且不探测」（assert it fails for the right reason）
- [x] 19.2 Implement「单线路直接使用且不探测」behavior per design；run `test_line_selection_01` to pass
- [x] 19.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 19.4 Write failing test `test_line_selection_02` in `packages/dsh-magpie-connector/test/line-selection.test.ts` for scenario「序号 1 可达时使用序号 1」（assert it fails for the right reason）
- [x] 19.5 Implement「序号 1 可达时使用序号 1」behavior per design；run `test_line_selection_02` to pass
- [x] 19.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 19.7 Write failing test `test_line_selection_03` in `packages/dsh-magpie-connector/test/line-selection.test.ts` for scenario「序号 1 不可达时自动使用序号 2」（assert it fails for the right reason）
- [x] 19.8 Implement「序号 1 不可达时自动使用序号 2」behavior per design；run `test_line_selection_03` to pass
- [x] 19.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 19.10 Write failing test `test_line_selection_04` in `packages/dsh-magpie-connector/test/line-selection.test.ts` for scenario「全部不可达时用序号 1 并上抛真实错误」（assert it fails for the right reason）
- [x] 19.11 Implement「全部不可达时用序号 1 并上抛真实错误」behavior per design；run `test_line_selection_04` to pass
- [x] 19.12 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 20. 探测实现与缓存（specs/magpie-line-selection/spec.md）

- [x] 20.1 Write failing test `test_line_probe_01` in `packages/dsh-magpie-connector/test/line-probe.test.ts` for scenario「负缓存期内不重复探测」（assert it fails for the right reason）
- [x] 20.2 Implement「负缓存期内不重复探测」behavior per design；run `test_line_probe_01` to pass
- [x] 20.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 20.4 Write failing test `test_line_probe_02` in `packages/dsh-magpie-connector/test/line-probe.test.ts` for scenario「正缓存与地址编辑后失效」（assert it fails for the right reason）
- [x] 20.5 Implement「正缓存与地址编辑后失效」behavior per design；run `test_line_probe_02` to pass
- [x] 20.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 20.7 Write failing test `test_line_probe_03` in `packages/dsh-magpie-connector/test/line-probe.test.ts` for scenario「IPv6 字面量地址可被探测」（assert it fails for the right reason）
- [x] 20.8 Implement「IPv6 字面量地址可被探测」behavior per design；run `test_line_probe_03` to pass
- [x] 20.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 20.10 Write failing test `test_line_probe_04` in `packages/dsh-magpie-connector/test/line-probe.test.ts` for scenario「dispose 中止探测」（assert it fails for the right reason）
- [x] 20.11 Implement「dispose 中止探测」behavior per design；run `test_line_probe_04` to pass
- [x] 20.12 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 21. 失败处理与不重放（specs/magpie-line-selection/spec.md）

- [x] 21.1 Write failing test `test_line_failure_01` in `packages/dsh-magpie-connector/test/line-failure.test.ts` for scenario「连接阶段失败只失效缓存且不重放」（assert it fails for the right reason）
- [x] 21.2 Implement「连接阶段失败只失效缓存且不重放」behavior per design；run `test_line_failure_01` to pass
- [x] 21.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 21.4 Write failing test `test_line_failure_02` in `packages/dsh-magpie-connector/test/line-failure.test.ts` for scenario「连接阶段失败后下一次操作改用备用线路并成功」（assert it fails for the right reason）
- [x] 21.5 Implement「连接阶段失败后下一次操作改用备用线路并成功」behavior per design；run `test_line_failure_02` to pass
- [x] 21.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 21.7 Write failing test `test_line_failure_03` in `packages/dsh-magpie-connector/test/line-failure.test.ts` for scenario「非连接阶段失败不重放」（assert it fails for the right reason）
- [x] 21.8 Implement「非连接阶段失败不重放」behavior per design；run `test_line_failure_03` to pass
- [x] 21.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [x] 21.10 Write failing test `test_line_failure_04` in `packages/dsh-magpie-connector/test/line-failure.test.ts` for scenario「TCP 可达但网关报错时不自动换线」（assert it fails for the right reason）
- [x] 21.11 Implement「TCP 可达但网关报错时不自动换线」behavior per design；run `test_line_failure_04` to pass
- [x] 21.12 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 22. 集成验证与发布资产（D10）

- [x] 22.1 单线路回归：全量测试 + typecheck + build，确认 lines 夹具下行为符合单一版本设计
- [x] 22.2 双线路集成：本地两网关验证「线路 1 不可达→自动落线路 2→恢复后回线路 1」，目录不闪断、卡片清空重读
- [x] 22.3 发布资产：README 双语（BREAKING 重配步骤）、CHANGELOG 0.2.0 BREAKING、architecture json/svg、internal-api、SCREENSHOTS、dsh.yaml note/version；旧 settings 录屏不发布
- [x] 22.4 `npm pack` 产物检查 + 连续两次 build 幂等记录；不执行生产部署（用户执行）
- [x] 22.5 生成 verify.md：review gate、test-plan 全绿、全量测试命令与结果、交付/部署状态

