## Verification Results

### Task Completion
- [x] All tasks marked `[x]` in tasks.md
- Remaining open tasks: none（7.3 / 7.5 已用隔离预览 + agent-browser 完成，见 Evidence）

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test (41/41 rows；无 `N/A — non-executable` 行)
- [x] Every test-plan.md row flipped to 🟢 green (0 行残留 🔴)
- [x] Full suite passes
- [x] Zero skipped/pending/commented-out tests in the changed package (384 passed, 0 skipped). Repository suite has 7 pre-existing environment-gated skips (Python 3.9+, managed-profile-only MCP client, zstd unavailable) — none touched or weakened by this change.
- [x] No test weakened or deleted without REMOVED requirement — only scenario-aligned rewrites (`line-active-ui` collapse, info-icon anchor, transport probe extension) plus new tests; `active 展示` scenarios were removed by the approved `REMOVED Requirements` block.

### Evidence

- Final package suite: `npm test --workspace=packages/dsh-magpie-connector` (vitest) → **63 files / 384 tests passed, 0 failed, 0 skipped**
- Repository suite: `npm test` → **706 tests, 699 pass, 0 fail, 7 pre-existing env skips**; `npm run test:tap` confirms all 7 skips are `Python 3.9+ required` / `managed DSH profile only` / `zstd unavailable`
- Typecheck: `npx tsc -p tsconfig.json --noEmit` 与 `npx tsc -p tsconfig.test.json --noEmit` → clean
- Build: `npm run build`（tsc + tsdown）→ lib/client.js 64.66 kB；`node -e "import('./lib/host/latency.js')"` 确认 host 产物 ESM 可加载；`lib/client.js` 中 primitives 仍为 `require(...)` 外部引用
- Artifacts: `npm run check:artifacts` → `tracked paths comply with repository policy`
- Sync idempotency: `node scripts/sync.mjs` 连续三次 → 三次均 `no changes — deployment already matches manifest`（首次 29 项、README 更新后 1 项、之后 0 项）
- OpenSpec: `openspec validate magpie-line-panel-polish --type change` → valid（仅两条已接受的 >500 字符提示）
- **隔离预览验收（2026-10-30）**：worktree `dsh build` → `ws prepare-preview` → `dsh`（isolated home，port 3202，日常 3080 未动）；本地 loopback mock Magpie 网关提供演示模型与用量卡片；agent-browser + headless Chrome 156（本地安装 Noto Sans SC 字体后）驱动真实 UI：
  - 首装空态 →「添加线路」→ 新行展开；填写 mock 地址 + 演示 key → 保存成功；首次保存后该行仍展开并换成 host 分配的 id（`fbe7a083`）
  - 关闭并重新打开设置：两行都 `data-expanded="false"`（默认收起）；`data-latency-state=done`，快线路 4 格 + `5 ms`、备用线路 0 格 + 「超时」
  - 点击行头部 toggle 收起/展开成功；聚焦切换控件后 Enter 与 Space 均能切换；`aria-expanded` 同步
  - 上移后行顺序改变且展开状态保持；禁用按钮 `aria-label` 含「已是第一条」；可用操作按钮 hover 出现 DSH Tooltip「上移线路 2」
  - 用量卡片：46% / 28% 蓝色填充右端为圆弧（贴合轨道圆角），Chat 显示「无限」；模型显示 `display_name`（Claude Opus 5.5 等）
  - 截图已发布为 `packages/dsh-magpie-connector/docs/settings.png`（1600×1600，mock 数据），`docs/SCREENSHOTS.md` 台账行更新为 2026-10-30
- 复跑：`npm run check:artifacts` → 通过；预览停止后 daily 3080 未受影响

### Review Integrity
- [x] review.md `VERDICT: APPROVE`（round 7，单条 Required Change 复检后 APPROVE；round 1–6 记录在 `review-roundN.md`）
- [x] Verdict not stale：apply 期间未修改 proposal.md / design.md / specs/；只更新了 test-plan/tasks 状态与代码
- [x] All findings fixed or rebutted：round 1–7 的 Critical/Moderate 全部修复并在后续轮次复检通过；未决项均为 📌 Suggestions

### Change Delivery

- Delivery state: 已提交到任务分支 `ws/openspec-explore-magpie-1-2-3-icon-cursor-4-fps`（47 files，含归档后的 change 与 canonical spec 更新），随后用 `scripts/ws-merge.mjs` 合入主分支。未 push；push 会触发 `mirror-release` 工作流（npm 发布 + GitHub Release），留待用户批准。

## Warnings

1. **日常部署已被本 change 物化**：在 worktree 内执行 `node scripts/sync.mjs`（tasks 7.4 的幂等检查）与 `dsh build` 后，`~/.dsh` 的 web profile 已同步为 `dsh-magpie-connector@0.4.0`（含 README/CHANGELOG/lib 硬链接）。当前运行中的 Host 仍是启动时的 0.3.1 host 代码；刷新 GUI 会加载 0.4.0 client，但 `/latency` 在旧 host 上返回 404 → 按设计降级为「—」，其余功能不受影响。是否重启日常 Host 完成部署、或从主 checkout 回退到 0.3.1，需要用户决定；本 change 未执行日常 Host 重启。

## Overall Decision

DECISION: PASS_WITH_WARNINGS
