# Tasks

前置：review.md round 3 `VERDICT: APPROVE_WITH_CHANGES`，`CHANGES_APPLIED: yes`。实现在 ohmydsh `packages/dsh-magpie-connector/` 内；整合 #10/#11 时优先 cherry-pick 可用提交（保留原作者），改写部分加 `Co-authored-by`。

## 0. 准备

- [x] 0.1 拉取 PR #10、#11 分支，记录可直接 cherry-pick 的提交（#10 设置分区与 UI 测试、#11 真实 Host 测试与 ID 透传测试）；验证：列表写入本 change 的 `integration-notes.md`
- [x] 0.2 跑一次全量 `npx vitest run` 与 `npm run typecheck` 作为基线，全部通过并记录结果

## 1. 路由入口识别与归属映射（host）

- [x] 1.1 Write failing test `test_routing_entries_01`（场景「按前缀识别与分类」，见 test-plan）；确认因预期原因失败
- [x] 1.2 Implement：`mapCatalog` 按 id 前缀写 `owner`/`provider` = `routing` 与 `CatalogModel.routingKind`，设置响应 `groups` 下发 `routingKind`；`test_routing_entries_01` 通过
- [x] 1.3 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 1.4 Write failing test `test_routing_entries_03`（场景「路由入口归入 routing 而不随首个成员换组」，见 test-plan）；确认因预期原因失败
- [x] 1.5 Implement：路由入口不再按 `owned_by` 归属；`test_routing_entries_03` 通过
- [x] 1.6 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 1.7 Write failing test `test_routing_entries_05`（场景「名为 routing 的普通模型归入 other」，见 test-plan）；确认因预期原因失败
- [x] 1.8 Implement：非路由入口的 `routing` 归属键/可见性键改为 `other`；`test_routing_entries_05` 通过
- [x] 1.9 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）

## 2. routing 归属准入（host）

- [x] 2.1 Write failing test `test_routing_owners_02`（场景「首次同步时 routing 排在最前」，见 test-plan）；确认因预期原因失败
- [x] 2.2 Implement：新归属准入时 `routing` 排最前；`test_routing_owners_02` 通过
- [x] 2.3 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 2.4 Write failing test `test_routing_owners_01`（场景「routing 在同一次同步中优先准入」，见 test-plan）；确认因预期原因失败
- [x] 2.5 Implement：32 上限内 `routing` 优先；`test_routing_owners_01` 通过
- [x] 2.6 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 2.7 Write failing test `test_routing_owners_03`（场景「名额已满时 routing 被拒绝并报告」，见 test-plan）；确认因预期原因失败
- [x] 2.8 Implement：满额时 `routing` 进入被拒绝列表；`test_routing_owners_03` 通过
- [x] 2.9 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 2.10 Write failing test `test_routing_owners_04`（场景「routing route 被占用时 replace 冲突」，见 test-plan）；确认因预期原因失败
- [x] 2.11 Implement：沿用现有 replace 冲突撤回流程（确认无需新代码）；`test_routing_owners_04` 通过
- [x] 2.12 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 2.13 Write failing test `test_routing_entries_04`（场景「首次安装只有路由入口」，见 test-plan）；确认因预期原因失败
- [x] 2.14 Implement：首次只有路由入口时注册 `-routing`；`test_routing_entries_04` 通过
- [x] 2.15 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）

## 3. 透传与旧选择（host）

- [x] 3.1 Write failing test `test_routing_entries_02`（场景「透传 id 与 effort」，见 test-plan）；确认因预期原因失败
- [x] 3.2 Implement：路由入口生成时透传原始 id 与默认 effort；`test_routing_entries_02` 通过
- [x] 3.3 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 3.4 Write failing test `test_routing_entries_06`（场景「旧会话保存的厂商 route 路由入口不再可用」，见 test-plan）；确认因预期原因失败
- [x] 3.5 Implement：厂商 route 列举不含路由入口，默认 effort 仍按 id 生效；`test_routing_entries_06` 通过
- [x] 3.6 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）

## 4. 设置页路由组分区（client）

注：4.4–4.12 中 `test_routing_settings_02/03/04` 写好即为绿——host 下发 `routing` 组后，现有 `ProviderGroup` 可见性 / 恢复跟随 / `providerOrder` 已满足这三个场景，无需新增实现（与 design D4「沿用现有逻辑」一致）；`01/05/06` 先红后绿。

- [x] 4.1 Write failing test `test_routing_settings_01`（场景「路由组只受 routing 键控制」，见 test-plan）；确认因预期原因失败
- [x] 4.2 Implement：「路由组」分区渲染（排最前、类型列、只受 `routing` 键控制）；`test_routing_settings_01` 通过
- [x] 4.3 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 4.4 Write failing test `test_routing_settings_02`（场景「只有路由组时仍能恢复跟随网关」，见 test-plan）；确认因预期原因失败
- [x] 4.5 Implement：分区「恢复跟随网关列表」只删 `routing` 键；`test_routing_settings_02` 通过
- [x] 4.6 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 4.7 Write failing test `test_routing_settings_03`（场景「provider 只剩路由入口时不留空分区」，见 test-plan）；确认因预期原因失败
- [x] 4.8 Implement：无模型且无卡片的 provider 分区不渲染；`test_routing_settings_03` 通过
- [x] 4.9 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 4.10 Write failing test `test_routing_settings_04`（场景「provider 只剩路由入口但有用量卡片时保留分区」，见 test-plan）；确认因预期原因失败
- [x] 4.11 Implement：有卡片时保留只含卡片的分区；`test_routing_settings_04` 通过
- [x] 4.12 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 4.13 Write failing test `test_routing_settings_05`（场景「路由组分区说明与无编辑控件」，见 test-plan）；确认因预期原因失败
- [x] 4.14 Implement：分区说明文案（中英）与控件范围；`test_routing_settings_05` 通过
- [x] 4.15 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 4.16 Write failing test `test_routing_settings_06`（场景「下拉文案与路由入口」，见 test-plan）；确认因预期原因失败
- [x] 4.17 Implement：`locales.ts` 未设置文案改为「默认：不指定」/`Default: not set`；`test_routing_settings_06` 通过
- [x] 4.18 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）

## 5. 合并前关卡与文档

- [x] 5.1 推理回放实测：在家庭 Magpie 上经 DSH 对「便宜优先」连续两轮生成（第一轮 low、第二轮 high，`X-Magpie-Model` 确认成员切换），第二轮被网关接受；不通过则停止合并并回报用户（2026-11-20：「便宜优先」在网关目录中缺失且请求 404，改用 `group/ds` 经真实插件两轮 low→high 回放被接受，finish=stop；当时两轮同一成员；用户重新开启「便宜优先」后补测，MiniMax → Claude Fable 5.2 跨成员回放被接受，见 verify）
- [x] 5.2 更新 README / README.zh（路由组分组、`knownOwners` 中 `routing` 优先准入）、CHANGELOG（两项 BREAKING：旧会话路由组需重选；路由组可见性回到跟随网关）；验证：`git diff` 中两份 README 与 CHANGELOG 均有对应条目
- [x] 5.3 按 `docs/SCREENSHOTS.md` 重拍选择器与设置截图（mock 网关含 `group/*` 与 `auto/*`），文件更新且说明文字注明为演示数据
- [x] 5.4 全量 `npx vitest run`、`npm run typecheck`、`npm run build` 通过；test-plan 全部行为 🟢

## Workflow follow-up

- 发整合 PR 前，按用户确认的草稿在 #10、#11 补评论（附 v5 视觉稿截图 PNG），说明改为整合 PR 并邀请评审；措辞不承诺旧选择继续可用。
- 整合 PR 合并后关闭 #10、#11，逐条写明采纳内容与提交；按 `publish-dsh-plugin` 发版。
- 本机部署：`dsh build` 两次（第二次无变更），由用户决定是否重启 Host。
- 另起 change：侧边栏同一厂商多账号分段。
