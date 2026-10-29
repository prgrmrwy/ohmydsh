## Verification Results

### Task Completion
- [x] All tasks marked `[x]` in tasks.md — **256 / 256**（20 requirement 组的 red-green-refactor + 集成组）
- Remaining open tasks: none（真机 smoke / 生产部署 / 截图重录不属于 tasks.md 的自动化任务，见下方 warnings）

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test — **82 / 82** scenario 行均有具名测试；本轮单一版本重设计后重新生成 test-plan（20 requirements），并逐个先红后绿。
- [x] Every test-plan.md row flipped to 🟢 green — **82 / 82**，无 🔴 red 残留。
- [x] Full suite passes — `51 test files / 306 tests` 全绿（含需 `lib/` 构建产物的 `metadata.test.ts`；合入后补 1 个 ESM `require` 源码卫生回归测试）。
- [x] Zero skipped/pending/commented-out tests — 汇总无 skipped；`grep -c '\.skip('` 为 0。
- [x] No test weakened or deleted without a REMOVED requirement —
  - 删除/合并的测试均对应**本 BREAKING change 移除的行为**：旧「设置迁移」4 个场景与 id 复用场景已从 spec 删除；`generation.test.ts`/`connection.test.ts` 与 canonical `line-generation`/`line-connection` 重复，合并到 canonical 文件；`cards-render.test.tsx` 中「清除 key / 平铺 baseUrl 设置」竞态 suite 针对已删除的旧连接表单与 legacy 平铺 API，整段移除（新的行卡片 UI 由 line-active-ui/line-silent-ui/access-ui 覆盖）；`access-auth`/`access-restart` 夹具从 legacy 固定引用迁移到 `lineCredentialRefs(lineId)` 后保留全部断言。
  - 剩余测试无弱化：所有既有不变量（脱敏、传输白名单、无换线重放、pending 隔离、凭据保护）继续由套件覆盖。

### Evidence
- Final full-suite command: `vitest run --root packages/dsh-magpie-connector --fsModuleCachePath /tmp/vitest-cache-magpie`
- Result summary: **Test Files 51 passed (51) · Tests 306 passed (306) · 0 failed · 0 skipped**
- Typecheck: `tsc -p tsconfig.json --noEmit` → OK；`tsc -p tsconfig.test.json --noEmit` → OK
- Build: `tsc -p tsconfig.json && tsdown` → 成功；连续第二次 build 产物 sha256 无差异（幂等）
- Package: `npm pack --dry-run` → `dsh-magpie-connector-0.2.0.tgz`，61 files / 503.2 kB packed（含新 README/CHANGELOG/internal-api/architecture；旧 `docs/settings.gif` 已删除不再发布）
- Repo check: `npm run check:artifacts` → `[artifacts] tracked paths comply with repository policy`
- OpenSpec: `openspec validate magpie-dual-lines --strict` → valid；`openspec status` → all artifacts done（verify 重写后）
- Baseline env notes：worktree `node_modules` 为只读 lean 缓存，vitest 用 `--fsModuleCachePath /tmp/vitest-cache-magpie`；`metadata.test.ts` 需先 build `lib/`，已在最终验证中执行。

### Review Integrity
- [x] review.md `VERDICT: APPROVE_WITH_CHANGES`（round 3，BREAKING 重设计后的 full review）；RC10–RC16 已应用并经评审者四次定点复核，最终 `CHANGES_APPLIED: yes`（见 `review.md` 的 `## RC10–RC16 定点复核（最终，2026-10-29）`）
- [x] Verdict not stale：实现期间除应用 Required Changes / reviewer-accepted rebuttals 外未改动评审制品；最终 sha256 与复核记录一致：
  - proposal `27d2ced0…2777`，design `db56d47f…5c6`，connector spec `715fd096…7c29`，access-auth spec `3abe69d7…2004`，line-selection spec `2aa26f7c…9e94`
- [x] All findings fixed or rebutted：round 1（C1–C3/M1–M10）、round 2（RC1–RC9）、round 3（RC10–RC16 = M20–M26）全部应用并经评审者定点复核（最终轮 `CHANGES_APPLIED: yes`）；S 类建议在 review.md Rebuttals 中逐条 fixed / rebutted / declined。

### Change Delivery
- Commit range: 未提交。worktree 分支 `ws/openspec-explore-magpie-cloudflare`，当前 73 项变更（含本次 BREAKING 重写与新增测试），`openspec/changes/magpie-dual-lines/` 为 untracked。交付状态：等待用户审阅后按仓库流程提交/合入。
- 部署状态：**未部署**。未物化生产 `$DSH_HOME`、未重启 Host、未发布 npm；按仓库规定由用户批准后执行 `dsh build`（连续第二次应无变更）、日常 Host 重启与（可选）npm 0.2.0 发布。
- 升级语义（BREAKING，已在 README/CHANGELOG 记录）：旧 `settings.json`（顶层 `baseUrl`）与旧固定凭据引用不读取、不迁移、不删除；首次打开显示未配置，用户重新添加线路并填写每线路 key/Access；`visibleModels`/`defaultEfforts` 保留；首次保存后 settings 文件重写为单一 `lines[]` 格式（保留旧文件内容仅在保存前）。
- 安全边界：Access 令牌只发往启用它的 HTTPS 线路；明文线路永不携带；探测不带凭据；脱敏覆盖当前/活跃/prepared 凭据；删除线路只清可写引用、环境引用列入 `retainedCredentials`；pending 失败不提交变更且跨重启隔离；生成请求不换线不重放。

## Overall Decision

⚠️ PASS_WITH_WARNINGS — 实现、规范、测试、类型、构建与打包检查全部通过（82/82 scenarios、305/305 tests、typecheck、幂等 build、pack 61 files、artifact policy）；以下 3 项为环境/人工后续，不属于可在本 worktree 自动完成的范围：

1. **真机 smoke**：在家 LAN / 在外公网两网络下的真实切换体验（自动选线、切换不闪断、Docker/VM 中的局域网地址、长会话 524 是否消失）需用户实机验证；两条线路 key 的 `/v1/models` 目录是否一致也未实测。
2. **设置页截图/录屏重录**：旧 `docs/settings.gif` 展示的是已被删除的平铺连接表单，已从包与 README 移除；新版线路卡片 UI 的截图需在真实 GUI 录制后补回 `screenshots.json`/`SCREENSHOTS.md`。
3. **生产部署与发布**：`dsh build` 物化 + 日常 Host 重启 +（可选）npm 发布必须由用户执行；本会话未触碰生产部署。

<!-- Human-readable restatement: ⚠️ PASS WITH WARNINGS -->

DECISION: PASS_WITH_WARNINGS
