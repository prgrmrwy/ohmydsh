# Tasks

前置：review.md round 1 `APPROVE_WITH_CHANGES`，`CHANGES_APPLIED: yes`。

## 1. 侧边栏多账号分段与进度条规则（client）

- [x] 1.1 Write failing test `test_sidebar_accounts_01`（场景「同一上游多账号分段」）；确认因预期原因失败
- [x] 1.2 Implement 使 `test_sidebar_accounts_01` 通过
- [x] 1.3 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 1.4 Write failing test `test_sidebar_accounts_02`（场景「多账号且勾选多个档位」）；确认因预期原因失败
- [x] 1.5 Implement 使 `test_sidebar_accounts_02` 通过
- [x] 1.6 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 1.7 Write failing test `test_sidebar_accounts_03`（场景「组内一个账号失败、一个只有余额」）；确认因预期原因失败
- [x] 1.8 Implement 使 `test_sidebar_accounts_03` 通过
- [x] 1.9 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 1.10 Write failing test `test_sidebar_accounts_04`（场景「侧栏收起时浮层也分段」）；确认因预期原因失败
- [x] 1.11 Implement 使 `test_sidebar_accounts_04` 通过
- [x] 1.12 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 1.13 Write failing test `test_sidebar_accounts_05`（场景「多账号缺少 user」）；确认因预期原因失败
- [x] 1.14 Implement 使 `test_sidebar_accounts_05` 通过
- [x] 1.15 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 1.16 Write failing test `test_sidebar_accounts_06`（场景「账号标识过长时截断」）；确认因预期原因失败
- [x] 1.17 Implement 使 `test_sidebar_accounts_06` 通过
- [x] 1.18 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 1.19 Write failing test `test_sidebar_accounts_07`（场景「文字读数不画进度条」）；确认因预期原因失败
- [x] 1.20 Implement 使 `test_sidebar_accounts_07` 通过
- [x] 1.21 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 1.22 Write failing test `test_sidebar_accounts_08`（场景「档位窗口带 display 时仍是档位行」）；确认因预期原因失败
- [x] 1.23 Implement 使 `test_sidebar_accounts_08` 通过
- [x] 1.24 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 1.25 Write failing test `test_sidebar_accounts_09`（场景「文字读数不参与回退选择」）；确认因预期原因失败
- [x] 1.26 Implement 使 `test_sidebar_accounts_09` 通过
- [x] 1.27 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）
- [x] 1.28 Write failing test `test_sidebar_accounts_10`（场景「同一上游卡片不相邻时归到首次出现处」）；确认因预期原因失败
- [x] 1.29 Implement 使 `test_sidebar_accounts_10` 通过
- [x] 1.30 Refactor；全量测试保持绿（含 test-plan 中既有 🟢 行）

## 2. 文档、验收与发版准备

- [x] 2.1 README / README.zh 侧栏额度卡描述补充多账号分段与进度条规则；CHANGELOG 0.7.2；版本号 0.7.2（package.json、package-lock、dsh.yaml）；验证：`git diff` 中各处一致
- [x] 2.2 隔离验收：临时 DSH_HOME + 回环 mock 网关（同厂商多账号、Image generation 文字读数），浏览器核对收起、展开、浮层；重拍 `docs/usage(.en).png` 并更新 SCREENSHOTS.md；验收进程全部停止、不碰 3080
- [x] 2.3 全量 `npx vitest run`、`npm run typecheck`、`npm run build`、仓库 `npm test` 通过；test-plan 全部 🟢

## Workflow follow-up

- 提交并推送，镜像打 tag v0.7.2 后确认 npm 与 GitHub Release；归档本 change 与 magpie-routing-entries。
