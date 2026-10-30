## Verification Results

### Task Completion

- [x] All tasks marked `[x]` in tasks.md
- Remaining open tasks: none（96 项全部完成；重基后 delta 44 个 scenario，其中 16 个沿用既有测试、无任务）

### TDD Integrity

- [x] Every test-plan.md entry exists as a real test（重基后 44 行全部对应真实测试；16 行是既有测试，28 行本次新建）
- [x] Every test-plan.md row flipped to 🟢 green（无残留 🔴 red）
- [x] Full suite passes
- [ ] Zero skipped/pending/commented-out tests —— **warn**：仓库级套件有 7 个环境门控 skip（`# zstd unavailable` 等，位于 memex/weekly-insights 相关测试），与本 change 无关且未被本次改动触碰；插件包内套件 390/390 全部执行、0 skip
- [x] No test weakened or deleted without REMOVED requirement（`test/dispose.test.ts` 只把路由清单从 3 条扩到 4 条并新增新端点断言；`test/line-list.test.ts`、`test/line-silent-ui.test.tsx`、`test/line-active-ui.test.tsx` 只新增测试与 THEN 断言，既有断言未删改）

### Evidence

- Final full-suite command（插件包）：`cd packages/dsh-magpie-connector && npx vitest run`
- Result summary：**67 files passed, 390 tests passed**（改动前 61 files / 359 tests；本次 +6 files / +31 tests）
- 类型检查：`npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json` → 0 error
- 仓库级：`npm test` → **706 tests, 699 pass, 0 fail, 7 skipped**（skip 均为环境门控，见上）
- 制品检查：`npm run check:artifacts` → `[artifacts] tracked paths comply with repository policy`
- 物化：`dsh build` 连续运行 → 第 3 次输出 `no changes — deployment already matches manifest`（幂等）
- 构建：`packages/dsh-magpie-connector` `npm run build` → 成功（`lib/client.js` 67.32 kB）
- Non-executable checks run：none（本 change 全部 scenario 都有代码测试）

### 实现与偏差记录

- `src/host/transport.ts`：重定向分支给错误加 `redirect: true` 标记（1 行，行为不变），供检查层识别被传输层阻断的 3xx。
- `src/host/runtime.ts`：新增 `lineCheck()`（准入 → 字段契约 → 解析凭据 → 版本号复核 → 单次 `GET /models` → 分类/脱敏）；`writeVersion` 由 `updateLines` 入口与 `invalidateCredential` 递增；`checking` 全局单飞；`checkTimeoutMs` 可注入（默认 `CHECK_TIMEOUT_MS = 5000`，测试用短预算）。
- `src/host/routes.ts`：注册 `POST /api/dsh-magpie-connector/line-check`（请求体形状非法 400，其余 200 + `kind`）。
- `src/client/`：`line-check` 资源、`parseCheck` / `checkSignature` / `checkDiff` / `cacheIds`、线路卡「检查线路」与只读快照、「未配置」标记、保存结果陈述生效线路（移除 `role="status"`）、按提交意图收窄的用量隔离与失败后重读。
- 与 test-plan 的偏差（已回填到 test-plan 的 Coverage Notes）：「未配置」标记的 DOM 断言放在 `test/line-active-ui.test.tsx`（`test_line_active_ui_03`），host 侧 `complete: false` 断言仍在 `test_line_list_04`；新增 3 个无独立 scenario 的实现级测试 `test/line-save-isolation.test.tsx`（design D9 三条验收句）。
- 未做：宿主进程未重启，`~/.dsh` 已物化但运行中的 Host 仍是旧插件（见交付状态）。

### Review Integrity

- [x] review.md `VERDICT: APPROVE_WITH_CHANGES` + `CHANGES_APPLIED: yes`（Round 4 + 定点复核）
- [x] Verdict not stale：apply 期间未修改 `proposal.md`、`design.md`、`specs/`；只更新了 `tasks.md`（勾选）、`test-plan.md`（翻绿与 Coverage Notes）与 `verify.md`
- [x] All findings fixed or rebutted；Round 4 三项 Required Changes 已被评审者复核为 resolved

### Change Delivery

- Commit range：未提交（未获指示提交）
- Delivery state：实现已提交（`ca1a0735`，0.4.0），随后与已归档的 `2026-10-30-magpie-line-panel-polish`（`632f3f27`）一起合入 main（`e88f1b68`）；`dsh.yaml` 版本 0.4.0 已物化到 `~/.dsh`，Host 已于 15:42 重启并加载新插件（`dsh build` 报 no changes）
- 改动文件：`dsh.yaml`；`packages/dsh-magpie-connector/` 下 `package.json`、`CHANGELOG.md`、`README.md`、`README.zh.md`、`src/host/{runtime,routes,transport}.ts`、`src/client/{SettingsPage,api,styles,view-model}.ts`、`test/{dispose,line-active-ui,line-silent-ui}.test.*`、`test/support/{credentials,host}.ts`；新增 `test/line-check{,-transport,-contract,-admission,-ui,-save-isolation}.test.*`；`openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/`



## 合入后重基与归档（2026-10-30）

0.4.0 的实现分两笔提交合入 main 后，本 change 的 delta 原先基于旧正文，直接 archive 会回退 `magpie-line-panel-polish` 的内容。已执行：

- 按当前主 spec 重基两份 delta：`只读与传输边界`（保留 7 个既有 scenario，含「设置页线路测速」例外）与 `线路展示与展开`（保留 9 个既有 scenario，含默认收起/图标/延迟）逐字保留，只追加线路检查与「未配置」标记；撤销原「线路列表与优先级」MODIFIED，保存结果改为独立的 ADDED requirement。delta 场景数 39 → 44（16 沿用 + 28 新增，均有已实现测试）。
- review Round 5（跨模型对抗评审）= `VERDICT: APPROVE`，确认 16 个既有 scenario 逐字保留、44 行账本与 delta 一一对应、内存归档结果无丢失或重复；唯一建议是说明中的旧计数，已在归档前更正。
- 证据时点：代码级全绿证据仍是当天 11:49 的 `npx vitest run`（67 files / 390 tests）与 `npm test`（706 tests, 699 pass, 7 env skip）；重基只改本 change 的 spec 文档与账本，未改实现，因此该证据仍然有效。归档后主 spec 将同时包含 polish 与本 change 的 requirement。

## Overall Decision

DECISION: PASS_WITH_WARNINGS

✅ 功能与全部 44 个 scenario 的可执行测试通过、`openspec validate --strict` 通过、review Round 5 为 APPROVE、Host 已重启加载 0.4.0 并核验端点；⚠️ 唯一警告：仓库级套件存在 7 个与本 change 无关的环境门控 skip。

## 归档结果

- `openspec archive magpie-line-probe-and-save-clarity -y` 成功：`dsh-magpie-connector` 1 个 requirement 更新、`magpie-line-selection` 1 个更新 + 5 个新增；归档目录 `openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/`。
- 合并后主 spec 同时包含 polish 与本次内容：`magpie-line-selection` 现有 9 条既有 requirement + `保存结果陈述` + 4 条线路检查 requirement；`dsh-magpie-connector`「只读与传输边界」有 9 个 scenario（7 个既有含测速例外 + 2 个检查）。逐字保留核对见 `review.md` 的 Round 5「重基核对」。
