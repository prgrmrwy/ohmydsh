## 0. 基础设施

- [x] 0.1 新增 `test/support/host.ts` 真实宿主夹具（真实 Cordis + LlmRuntime、外来 adapter、INVARIANT 监听器注入）与可失败的 SettingsStore writer
- [x] 0.2 `SettingsStore`/runtime：新增同步 `writeSettings(patch)`（以写入时刻 store 已知字段为基底），`cleanSettings`/`savePreferences`/pending 标记改走它；跑全量测试保持绿

## 1. 按网关归属注册 route

- [x] 1.1 Write failing test `test_owner_routes_01` in `packages/dsh-magpie-connector/test/owner-routes.test.ts` for「按 owned_by 分组且不按名字猜测」(assert it fails for the right reason)
- [x] 1.2 Implement「按 owned_by 分组且不按名字猜测」per design; run `test_owner_routes_01` to pass
- [x] 1.3 Refactor; rerun this group's tests, full suite stays green
- [x] 1.4 Write failing test `test_owner_routes_02` in `packages/dsh-magpie-connector/test/owner-routes.test.ts` for「不可信或大小写不同的 owned_by」(assert it fails for the right reason)
- [x] 1.5 Implement「不可信或大小写不同的 owned_by」per design; run `test_owner_routes_02` to pass
- [x] 1.6 Refactor; rerun this group's tests, full suite stays green
- [x] 1.7 Write failing test `test_owner_routes_03` in `packages/dsh-magpie-connector/test/owner-routes.test.ts` for「返回的 provider 等于被请求的 route」(assert it fails for the right reason)
- [x] 1.8 Implement「返回的 provider 等于被请求的 route」per design; run `test_owner_routes_03` to pass
- [x] 1.9 Refactor; rerun this group's tests, full suite stays green
- [x] 1.10 Write failing test `test_owner_routes_04` in `packages/dsh-magpie-connector/test/owner-routes.test.ts` for「可见性与 effort 在归属 route 上保持」(assert it fails for the right reason)
- [x] 1.11 Implement「可见性与 effort 在归属 route 上保持」per design; run `test_owner_routes_04` to pass
- [x] 1.12 Refactor; rerun this group's tests, full suite stays green
- [x] 1.13 Write failing test `test_owner_routes_05` in `packages/dsh-magpie-connector/test/owner-routes.test.ts` for「other 组内保留各自的可见性键」(assert it fails for the right reason)
- [x] 1.14 Implement「other 组内保留各自的可见性键」per design; run `test_owner_routes_05` to pass
- [x] 1.15 Refactor; rerun this group's tests, full suite stays green
- [x] 1.16 Write failing test `test_owner_routes_06` in `packages/dsh-magpie-connector/test/owner-routes.test.ts` for「原版宿主即可看到分组」(assert it fails for the right reason)
- [x] 1.17 Implement「原版宿主即可看到分组」per design; run `test_owner_routes_06` to pass
- [x] 1.18 Refactor; rerun this group's tests, full suite stays green

## 2. 插件身份与命名

- [x] 2.1 Write failing test `test_owner_identity_01` in `packages/dsh-magpie-connector/test/owner-identity.test.ts` for「只注册归属 route」(assert it fails for the right reason)
- [x] 2.2 Implement「只注册归属 route」per design; run `test_owner_identity_01` to pass
- [x] 2.3 Refactor; rerun this group's tests, full suite stays green
- [x] 2.4 Write failing test `test_owner_identity_02` in `packages/dsh-magpie-connector/test/owner-identity.test.ts` for「旧 route 选择不再可用」(assert it fails for the right reason)
- [x] 2.5 Implement「旧 route 选择不再可用」per design; run `test_owner_identity_02` to pass
- [x] 2.6 Refactor; rerun this group's tests, full suite stays green
- [x] 2.7 Write failing test `test_owner_identity_03` in `packages/dsh-magpie-connector/test/owner-identity.test.ts` for「凭据引用由稳定 id 绑定」(assert it fails for the right reason)
- [x] 2.8 Implement「凭据引用由稳定 id 绑定」per design; run `test_owner_identity_03` to pass
- [x] 2.9 Refactor; rerun this group's tests, full suite stays green

## 3. 原生回放身份跨 route 稳定

- [x] 3.1 Write failing test `test_owner_replay_01` in `packages/dsh-magpie-connector/test/owner-replay.test.ts` for「归属 route 上续聊保留推理元数据」(assert it fails for the right reason)
- [x] 3.2 Implement「归属 route 上续聊保留推理元数据」per design; run `test_owner_replay_01` to pass
- [x] 3.3 Refactor; rerun this group's tests, full suite stays green
- [x] 3.4 Write failing test `test_owner_replay_02` in `packages/dsh-magpie-connector/test/owner-replay.test.ts` for「跨本插件 route 续聊仍视为同模型」(assert it fails for the right reason)
- [x] 3.5 Implement「跨本插件 route 续聊仍视为同模型」per design; run `test_owner_replay_02` to pass
- [x] 3.6 Refactor; rerun this group's tests, full suite stays green
- [x] 3.7 Write failing test `test_owner_replay_03` in `packages/dsh-magpie-connector/test/owner-replay.test.ts` for「篡改或外来回放退化为普通历史」(assert it fails for the right reason)
- [x] 3.8 Implement「篡改或外来回放退化为普通历史」per design; run `test_owner_replay_03` to pass
- [x] 3.9 Refactor; rerun this group's tests, full suite stays green

## 4. 归属 route 持久

- [x] 4.1 Write failing test `test_owner_persistence_01` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「重启后 route 身份在同步前即存在」(assert it fails for the right reason)
- [x] 4.2 Implement「重启后 route 身份在同步前即存在」per design; run `test_owner_persistence_01` to pass
- [x] 4.3 Refactor; rerun this group's tests, full suite stays green
- [x] 4.4 Write failing test `test_owner_persistence_02` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「首次安装在同步前不注册 route」(assert it fails for the right reason)
- [x] 4.5 Implement「首次安装在同步前不注册 route」per design; run `test_owner_persistence_02` to pass
- [x] 4.6 Refactor; rerun this group's tests, full suite stays green
- [x] 4.7 Write failing test `test_owner_persistence_03` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「首次配置经设置请求同步出归属后注册」(assert it fails for the right reason)
- [x] 4.8 Implement「首次配置经设置请求同步出归属后注册」per design; run `test_owner_persistence_03` to pass
- [x] 4.9 Refactor; rerun this group's tests, full suite stays green
- [x] 4.10 Write failing test `test_owner_persistence_04` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「resync 发现新归属不自锁」(assert it fails for the right reason)
- [x] 4.11 Implement「resync 发现新归属不自锁」per design; run `test_owner_persistence_04` to pass
- [x] 4.12 Refactor; rerun this group's tests, full suite stays green
- [x] 4.13 Write failing test `test_owner_persistence_05` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「新归属被持久并发布」(assert it fails for the right reason)
- [x] 4.14 Implement「新归属被持久并发布」per design; run `test_owner_persistence_05` to pass
- [x] 4.15 Refactor; rerun this group's tests, full suite stays green
- [x] 4.16 Write failing test `test_owner_persistence_06` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「保存 knownOwners 失败时仍发布已有 route 的目录变化」(assert it fails for the right reason)
- [x] 4.17 Implement「保存 knownOwners 失败时仍发布已有 route 的目录变化」per design; run `test_owner_persistence_06` to pass
- [x] 4.18 Refactor; rerun this group's tests, full suite stays green
- [x] 4.19 Write failing test `test_owner_persistence_07` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「replace 冲突时撤回追加并发布目录」(assert it fails for the right reason)
- [x] 4.20 Implement「replace 冲突时撤回追加并发布目录」per design; run `test_owner_persistence_07` to pass
- [x] 4.21 Refactor; rerun this group's tests, full suite stays green
- [x] 4.22 Write failing test `test_owner_persistence_08` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「撤回写入失败时下次启动按启动失败处理」(assert it fails for the right reason)
- [x] 4.23 Implement「撤回写入失败时下次启动按启动失败处理」per design; run `test_owner_persistence_08` to pass
- [x] 4.24 Refactor; rerun this group's tests, full suite stays green
- [x] 4.25 Write failing test `test_owner_persistence_09` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「首次注册 INVARIANT 不当作成功」(assert it fails for the right reason)
- [x] 4.26 Implement「首次注册 INVARIANT 不当作成功」per design; run `test_owner_persistence_09` to pass
- [x] 4.27 Refactor; rerun this group's tests, full suite stays green
- [x] 4.28 Write failing test `test_owner_persistence_10` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「线路保存期间的归属追加不被覆盖」(assert it fails for the right reason)
- [x] 4.29 Implement「线路保存期间的归属追加不被覆盖」per design; run `test_owner_persistence_10` to pass
- [x] 4.30 Refactor; rerun this group's tests, full suite stays green
- [x] 4.31 Write failing test `test_owner_persistence_11` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「非法 knownOwners 被整体重置且不影响连接」(assert it fails for the right reason)
- [x] 4.32 Implement「非法 knownOwners 被整体重置且不影响连接」per design; run `test_owner_persistence_11` to pass
- [x] 4.33 Refactor; rerun this group's tests, full suite stays green
- [x] 4.34 Write failing test `test_owner_persistence_12` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「归属下架后 route 保留」(assert it fails for the right reason)
- [x] 4.35 Implement「归属下架后 route 保留」per design; run `test_owner_persistence_12` to pass
- [x] 4.36 Refactor; rerun this group's tests, full suite stays green
- [x] 4.37 Write failing test `test_owner_persistence_13` in `packages/dsh-magpie-connector/test/owner-persistence.test.ts` for「归属上限按出现顺序截断」(assert it fails for the right reason)
- [x] 4.38 Implement「归属上限按出现顺序截断」per design; run `test_owner_persistence_13` to pass
- [x] 4.39 Refactor; rerun this group's tests, full suite stays green

## 5. 禁用不删除用户数据

- [x] 5.1 Write failing test `test_owner_dispose_01` in `packages/dsh-magpie-connector/test/owner-dispose.test.ts` for「dispose 不删除数据」(assert it fails for the right reason)
- [x] 5.2 Implement「dispose 不删除数据」per design; run `test_owner_dispose_01` to pass
- [x] 5.3 Refactor; rerun this group's tests, full suite stays green
- [x] 5.4 Write failing test `test_owner_dispose_02` in `packages/dsh-magpie-connector/test/owner-dispose.test.ts` for「dispose 时有进行中的请求」(assert it fails for the right reason)
- [x] 5.5 Implement「dispose 时有进行中的请求」per design; run `test_owner_dispose_02` to pass
- [x] 5.6 Refactor; rerun this group's tests, full suite stays green
- [x] 5.7 Write failing test `test_owner_dispose_03` in `packages/dsh-magpie-connector/test/owner-dispose.test.ts` for「注册句柄 dispose 抛错时其它清理仍执行」(assert it fails for the right reason)
- [x] 5.8 Implement「注册句柄 dispose 抛错时其它清理仍执行」per design; run `test_owner_dispose_03` to pass
- [x] 5.9 Refactor; rerun this group's tests, full suite stays green
- [x] 5.10 Write failing test `test_owner_dispose_04` in `packages/dsh-magpie-connector/test/owner-dispose.test.ts` for「尚未注册任何 route 时 dispose」(assert it fails for the right reason)
- [x] 5.11 Implement「尚未注册任何 route 时 dispose」per design; run `test_owner_dispose_04` to pass
- [x] 5.12 Refactor; rerun this group's tests, full suite stays green

## 6. 旧格式升级（BREAKING）

- [x] 6.1 Write failing test `test_owner_legacy_upgrade_01` in `packages/dsh-magpie-connector/test/owner-legacy-upgrade.test.ts` for「升级后旧配置被忽略且不删除」(assert it fails for the right reason)
- [x] 6.2 Implement「升级后旧配置被忽略且不删除」per design; run `test_owner_legacy_upgrade_01` to pass
- [x] 6.3 Refactor; rerun this group's tests, full suite stays green
- [x] 6.4 Write failing test `test_owner_legacy_upgrade_02` in `packages/dsh-magpie-connector/test/owner-legacy-upgrade.test.ts` for「旧格式升级后配置线路即恢复」(assert it fails for the right reason)
- [x] 6.5 Implement「旧格式升级后配置线路即恢复」per design; run `test_owner_legacy_upgrade_02` to pass
- [x] 6.6 Refactor; rerun this group's tests, full suite stays green

## 7. 网关连接与凭据

- [ ] 7.1 Write failing test `test_owner_connection_01` in `packages/dsh-magpie-connector/test/owner-connection.test.ts` for「保存 key 后不回显」(assert it fails for the right reason)
- [ ] 7.2 Implement「保存 key 后不回显」per design; run `test_owner_connection_01` to pass
- [ ] 7.3 Refactor; rerun this group's tests, full suite stays green
- [ ] 7.4 Write failing test `test_owner_connection_02` in `packages/dsh-magpie-connector/test/owner-connection.test.ts` for「网关反射的 key 被脱敏」(assert it fails for the right reason)
- [ ] 7.5 Implement「网关反射的 key 被脱敏」per design; run `test_owner_connection_02` to pass
- [ ] 7.6 Refactor; rerun this group's tests, full suite stays green
- [ ] 7.7 Write failing test `test_owner_connection_03` in `packages/dsh-magpie-connector/test/owner-connection.test.ts` for「环境提供的 key 拒绝修改」(assert it fails for the right reason)
- [ ] 7.8 Implement「环境提供的 key 拒绝修改」per design; run `test_owner_connection_03` to pass
- [ ] 7.9 Refactor; rerun this group's tests, full suite stays green
- [ ] 7.10 Write failing test `test_owner_connection_04` in `packages/dsh-magpie-connector/test/owner-connection.test.ts` for「非法设置输入被拒绝」(assert it fails for the right reason)
- [ ] 7.11 Implement「非法设置输入被拒绝」per design; run `test_owner_connection_04` to pass
- [ ] 7.12 Refactor; rerun this group's tests, full suite stays green
- [ ] 7.13 Write failing test `test_owner_connection_05` in `packages/dsh-magpie-connector/test/owner-connection.test.ts` for「未配置时不提供模型且不发请求」(assert it fails for the right reason)
- [ ] 7.14 Implement「未配置时不提供模型且不发请求」per design; run `test_owner_connection_05` to pass
- [ ] 7.15 Refactor; rerun this group's tests, full suite stays green
- [ ] 7.16 Write failing test `test_owner_connection_06` in `packages/dsh-magpie-connector/test/owner-connection.test.ts` for「手改或损坏的持久设置被整体拒绝」(assert it fails for the right reason)
- [ ] 7.17 Implement「手改或损坏的持久设置被整体拒绝」per design; run `test_owner_connection_06` to pass
- [ ] 7.18 Refactor; rerun this group's tests, full suite stays green
- [ ] 7.19 Write failing test `test_owner_connection_07` in `packages/dsh-magpie-connector/test/owner-connection.test.ts` for「请求不混用线路凭据」(assert it fails for the right reason)
- [ ] 7.20 Implement「请求不混用线路凭据」per design; run `test_owner_connection_07` to pass
- [ ] 7.21 Refactor; rerun this group's tests, full suite stays green
- [ ] 7.22 Write failing test `test_owner_connection_08` in `packages/dsh-magpie-connector/test/owner-connection.test.ts` for「删除线路只清可写凭据」(assert it fails for the right reason)
- [ ] 7.23 Implement「删除线路只清可写凭据」per design; run `test_owner_connection_08` to pass
- [ ] 7.24 Refactor; rerun this group's tests, full suite stays green
- [ ] 7.25 Write failing test `test_owner_connection_09` in `packages/dsh-magpie-connector/test/owner-connection.test.ts` for「整表重排不丢凭据」(assert it fails for the right reason)
- [ ] 7.26 Implement「整表重排不丢凭据」per design; run `test_owner_connection_09` to pass
- [ ] 7.27 Refactor; rerun this group's tests, full suite stays green

## 8. 连接身份与代际隔离

- [ ] 8.1 Write failing test `test_owner_generation_01` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「换地址后不显示旧目录」(assert it fails for the right reason)
- [ ] 8.2 Implement「换地址后不显示旧目录」per design; run `test_owner_generation_01` to pass
- [ ] 8.3 Refactor; rerun this group's tests, full suite stays green
- [ ] 8.4 Write failing test `test_owner_generation_02` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「换 key 后不显示旧卡片」(assert it fails for the right reason)
- [ ] 8.5 Implement「换 key 后不显示旧卡片」per design; run `test_owner_generation_02` to pass
- [ ] 8.6 Refactor; rerun this group's tests, full suite stays green
- [ ] 8.7 Write failing test `test_owner_generation_03` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「旧代晚到的响应被丢弃」(assert it fails for the right reason)
- [ ] 8.8 Implement「旧代晚到的响应被丢弃」per design; run `test_owner_generation_03` to pass
- [ ] 8.9 Refactor; rerun this group's tests, full suite stays green
- [ ] 8.10 Write failing test `test_owner_generation_04` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「已准备的调用按捕获值跑完」(assert it fails for the right reason)
- [ ] 8.11 Implement「已准备的调用按捕获值跑完」per design; run `test_owner_generation_04` to pass
- [ ] 8.12 Refactor; rerun this group's tests, full suite stays green
- [ ] 8.13 Write failing test `test_owner_generation_05` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「进行中的生成不被换代中止」(assert it fails for the right reason)
- [ ] 8.14 Implement「进行中的生成不被换代中止」per design; run `test_owner_generation_05` to pass
- [ ] 8.15 Refactor; rerun this group's tests, full suite stays green
- [ ] 8.16 Write failing test `test_owner_generation_06` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「外部改 key 触发换代」(assert it fails for the right reason)
- [ ] 8.17 Implement「外部改 key 触发换代」per design; run `test_owner_generation_06` to pass
- [ ] 8.18 Refactor; rerun this group's tests, full suite stays green
- [ ] 8.19 Write failing test `test_owner_generation_07` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「未收到事件时新操作发现 key 变化」(assert it fails for the right reason)
- [ ] 8.20 Implement「未收到事件时新操作发现 key 变化」per design; run `test_owner_generation_07` to pass
- [ ] 8.21 Refactor; rerun this group's tests, full suite stays green
- [ ] 8.22 Write failing test `test_owner_generation_08` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「自动切线路保留目录并清空卡片」(assert it fails for the right reason)
- [ ] 8.23 Implement「自动切线路保留目录并清空卡片」per design; run `test_owner_generation_08` to pass
- [ ] 8.24 Refactor; rerun this group's tests, full suite stays green
- [ ] 8.25 Write failing test `test_owner_generation_09` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「编辑非生效线路不换目录」(assert it fails for the right reason)
- [ ] 8.26 Implement「编辑非生效线路不换目录」per design; run `test_owner_generation_09` to pass
- [ ] 8.27 Refactor; rerun this group's tests, full suite stays green
- [ ] 8.28 Write failing test `test_owner_generation_10` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「删除生效线路后换线路并保留目录」(assert it fails for the right reason)
- [ ] 8.29 Implement「删除生效线路后换线路并保留目录」per design; run `test_owner_generation_10` to pass
- [ ] 8.30 Refactor; rerun this group's tests, full suite stays green
- [ ] 8.31 Write failing test `test_owner_generation_11` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「非生效线路外部凭据变化不换代」(assert it fails for the right reason)
- [ ] 8.32 Implement「非生效线路外部凭据变化不换代」per design; run `test_owner_generation_11` to pass
- [ ] 8.33 Refactor; rerun this group's tests, full suite stays green
- [ ] 8.34 Write failing test `test_owner_generation_12` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「随机 id 生效线路的外部凭据事件触发换代」(assert it fails for the right reason)
- [ ] 8.35 Implement「随机 id 生效线路的外部凭据事件触发换代」per design; run `test_owner_generation_12` to pass
- [ ] 8.36 Refactor; rerun this group's tests, full suite stays green
- [ ] 8.37 Write failing test `test_owner_generation_13` in `packages/dsh-magpie-connector/test/owner-generation.test.ts` for「切换后同步失败保留继承目录」(assert it fails for the right reason)
- [ ] 8.38 Implement「切换后同步失败保留继承目录」per design; run `test_owner_generation_13` to pass
- [ ] 8.39 Refactor; rerun this group's tests, full suite stays green

## 9. 模型目录字段映射

- [ ] 9.1 Write failing test `test_owner_catalog_mapping_01` in `packages/dsh-magpie-connector/test/owner-catalog-mapping.test.ts` for「字段映射」(assert it fails for the right reason)
- [ ] 9.2 Implement「字段映射」per design; run `test_owner_catalog_mapping_01` to pass
- [ ] 9.3 Refactor; rerun this group's tests, full suite stays green
- [ ] 9.4 Write failing test `test_owner_catalog_mapping_02` in `packages/dsh-magpie-connector/test/owner-catalog-mapping.test.ts` for「畸形条目被丢弃」(assert it fails for the right reason)
- [ ] 9.5 Implement「畸形条目被丢弃」per design; run `test_owner_catalog_mapping_02` to pass
- [ ] 9.6 Refactor; rerun this group's tests, full suite stays green
- [ ] 9.7 Write failing test `test_owner_catalog_mapping_03` in `packages/dsh-magpie-connector/test/owner-catalog-mapping.test.ts` for「非法容量值视为缺失」(assert it fails for the right reason)
- [ ] 9.8 Implement「非法容量值视为缺失」per design; run `test_owner_catalog_mapping_03` to pass
- [ ] 9.9 Refactor; rerun this group's tests, full suite stays green

## 10. Codex 速度切换

- [x] 10.1 Write failing test `test_owner_speed_01` in `packages/dsh-magpie-connector/test/owner-speed.test.tsx` for「快速模式请求带 priority（两种协议）」(assert it fails for the right reason)
- [x] 10.2 Implement「快速模式请求带 priority（两种协议）」per design; run `test_owner_speed_01` to pass
- [x] 10.3 Refactor; rerun this group's tests, full suite stays green
- [x] 10.4 Write failing test `test_owner_speed_02` in `packages/dsh-magpie-connector/test/owner-speed.test.tsx` for「归属 route 上显示速度控件」(assert it fails for the right reason)
- [x] 10.5 Implement「归属 route 上显示速度控件」per design; run `test_owner_speed_02` to pass
- [x] 10.6 Refactor; rerun this group's tests, full suite stays green
- [x] 10.7 Write failing test `test_owner_speed_03` in `packages/dsh-magpie-connector/test/owner-speed.test.tsx` for「标准模式与其它会话不带字段」(assert it fails for the right reason)
- [x] 10.8 Implement「标准模式与其它会话不带字段」per design; run `test_owner_speed_03` to pass
- [x] 10.9 Refactor; rerun this group's tests, full suite stays green
- [x] 10.10 Write failing test `test_owner_speed_04` in `packages/dsh-magpie-connector/test/owner-speed.test.tsx` for「不支持的模型不显示且不带字段」(assert it fails for the right reason)
- [x] 10.11 Implement「不支持的模型不显示且不带字段」per design; run `test_owner_speed_04` to pass
- [x] 10.12 Refactor; rerun this group's tests, full suite stays green
- [x] 10.13 Write failing test `test_owner_speed_05` in `packages/dsh-magpie-connector/test/owner-speed.test.tsx` for「host 重启后回到标准」(assert it fails for the right reason)
- [x] 10.14 Implement「host 重启后回到标准」per design; run `test_owner_speed_05` to pass
- [x] 10.15 Refactor; rerun this group's tests, full suite stays green
- [x] 10.16 Write failing test `test_owner_speed_06` in `packages/dsh-magpie-connector/test/owner-speed.test.tsx` for「非法 tier 被拒绝」(assert it fails for the right reason)
- [x] 10.17 Implement「非法 tier 被拒绝」per design; run `test_owner_speed_06` to pass
- [x] 10.18 Refactor; rerun this group's tests, full suite stays green

## 11. 收尾、文档与发布

- [ ] 11.1 删除 `test/display-group.test.ts` 与 `displayGroup` 相关类型；改写其余写死旧 route 的既有测试；全量测试绿
- [ ] 11.2 `packages/dsh-magpie-connector`：运行 build、typecheck、test；仓库 `npm test`、`npm run check:artifacts`、`openspec validate magpie-owner-routes --strict`
- [ ] 11.3 `package.json` 0.3.0；CHANGELOG（BREAKING：多 route、旧 route 退役、旧会话/默认模型需重选、AUTO/出口守卫需另行适配）；README / README.zh 去掉「需要 Host 扩展」限制并说明 knownOwners 与重启恢复
- [ ] 11.4 `dsh.yaml` 本插件条目 brief/note 与版本更新
- [ ] 11.5 与用户确认 AUTO / 出口守卫适配的上线顺序后再 `dsh build`（两次，第二次无变更），请用户重启并在 GUI 确认 `Magpie (Claude|Codex|Opencode-go|Deepseek)` 分组
- [ ] 11.6 按 `publish-dsh-plugin` skill 发版 0.3.0，更新商店 PR #10211 条目描述并回复维护者
