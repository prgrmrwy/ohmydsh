## 0. 前置

- [x] 0.1 核对 `magpie-owner-routes` 11.5/11.6 仍未结清；多 route 已由当前源码、运行图和本次 GUI 验收证实生效。本 change 自持 AMD2 旧要求删除 delta，解除对独立发布及关联 change 整体归档的不必要依赖，不代勾或归档其它 change。修订依据见 design 的收尾依赖说明

## 1. 删除 seam

- [x] 1.1 删除 `compat/subagent/{model-display.patch,model-display.package.template.json,model-display.vitest.config.mjs,verify-model-display.mjs}` 与 `packages/dsh-pet/test/model-display-*`（5 个）
- [x] 1.2 `build.mjs`：删除 hash 常量与校验、cache 指纹输入、apply/check、exit hook 中的反向 apply、专用 vitest 与五包上游测试、五包 client tsc/tsdown；产物目录改为 `team-membership-artifacts`，只遍历 team 模板
- [x] 1.3 `build-launcher.cjs`：删除 hash/template 常量、自证中的五包检查与 verifier 调用、fingerprint 输入；staging 复制、依赖与 overrides 只保留 team 包（`hostPackageOverrides`）
- [x] 1.4 全仓 grep `model-display|modelDisplay` 确认 compat 与 Pet 无残留；connector 的「不含 displayGroup」断言保留；`test/team-membership-builder.test.cjs` 新增回归，断言 seam 不再回到 build/launcher

## 2. 文档

- [x] 2.1 compat `README.md` 与 `README.zh.md`：删除 model-display 章节，改为在「已移除的 seam」中登记；更新 overlay 包清单与 fingerprint 输入
- [x] 2.2 `dsh.yaml` 中 dsh-magpie-connector 的 note 删去「不依赖 model-display.patch」

## 3. 验证

- [x] 3.1 `packages/dsh-pet`：`npm run typecheck` 与 `npx vitest run` 均 exit 0
- [x] 3.2 compat 脚本测试（`test-packaging`、`test-native-*`、`team-membership-builder`）全部通过。仓库 `npm test` 共 707 项：699 通过、2 失败、6 跳过，2 个失败均为已有问题，与本 change 无关：一是 dsh-magpie-connector 的 note 在 HEAD 已有 654 字符，超过 600 上限，本次改动后为 630；二是 case-verify 的 `test_cv_068` 在 HEAD 独立 worktree 中同样失败。`npm run check:artifacts` 通过
- [x] 3.3 `npm_config_registry=https://registry.npmjs.org/ node build-launcher.cjs --isolated-output <tmp>` exit 0（`~/.npmrc` 指向的 bnpm 当前不可达，首次运行在 npm install 阶段失败）；源码阶段 continuation 与 Team 测试通过，native/inquiry/tools-guard 探针全部 PASS；隔离图中五个宿主包解析为官方 `0.2.0-rc.2`（无 `dsh_compat`），Team 为 `0.2.0-rc.2-team-membership.1`，subagent 为 compat；`dsh --version` 为 0.2.0-rc.2；`.upstream` 构建后工作区干净
- [x] 3.4 `node scripts/sync.mjs` 连续两次：第一次 1 change，第二次 no changes
- [x] 3.5 `openspec validate retire-compat-model-display --strict` 通过
- [x] 3.6 用户授权后已构建并重启 Host：restartId `20261102-105309-88127-9a174c` 为 ready，新 fingerprint `b1daa72527ceefb145b56361cb8f3f227c326c7d672e6aaa81d532f4a677ae39`。2026-11-03 按已确认的 case-verify plan_rev=1 完成 GUI 只读验收：14 pass、0 fail/blocked/partial/pending，Magpie 四个归属分组、模型名搜索、目录无 displayGroup、MANUAL/AUTO 单值 effort 均有证据；最终执行门禁通过。DL-5、DL-9 两项人工交互已由用户反馈“没问题”并明确确认验收通过；不改写自动观察或宣称独立抓包已覆盖。oracle 同源且 lint 67%，工具自动验收资格仍保留 needs-human。首次认证首页有 GUI 自动 session/create 请求，HTTP 200 不代表语义创建成功；未触发模型调用。详情见 `verify.md` 和本地 `checking/report.md`
