## Verification Results

验证时间：2026-11-06（Asia/Shanghai）。路径都相对于 worktree 根。

### Task Completion
- [ ] All tasks marked `[x]` in tasks.md
- Remaining open tasks:
  - **8.2** `npm test`（仓库根）：754 条中 732 通过、20 失败、2 跳过。除下面写明已修复的 3 条外，其余 18 条都是 Lean Worktree 的依赖缓存不完整导致的：临时副本里 `tsc: not found`（缓存里没有 typescript，worktree 内能用只是因为向上解析到了主 checkout 的 `node_modules`）、"根依赖不完整，请执行 bootstrap/npm ci"、缓存只读导致的 `EACCES unlink`。要修复，需要先 `ws promote` 再安装依赖，本会话不允许。这 18 条没有在主 checkout 上复跑，所以"本次改动之前它们就失败"只是推断，没有实测。`npm run check:artifacts` 通过。
  - **8.3** 隔离 `DSH_HOME` 连续两次 sync：两次都在 npm scope 预检阶段停止，原因是私有 overlay 的 `ai-code-report-bridge` 需要 `@dp`、`@logsdk` 的 registry，而这些配置只在真实 profile 的 `.npmrc` 里，没有写入任何定制。我没有把真实 `.npmrc` 复制到临时目录（可能含私有地址或凭据），也没有对日常 `~/.dsh` 运行 sync（不能从临时 worktree 部署）。需要在合入后，于主 checkout 执行 `dsh build` 两次来补验。

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test：47 行都能在所列文件中按测试名找到。29 行为新写或修改，18 行为原有回归测试。
- [x] Every test-plan.md row flipped to 🟢 green：原 29 行 🔴 全部翻为 🟢，18 行 🟢 existing 仍然通过。
- [ ] Full suite passes：包内测试在 Node v24.21.0 下全部通过；在本机默认的 Node v24.12.0 下，`test/usage-report.test.ts` 有 2 条 zstd 尾帧用例失败（实施前基线就是这样，与本 change 无关），仓库根测试见上。
- [x] Zero skipped/pending/commented-out tests：包内 312 条，0 跳过。
- [x] No test weakened or deleted without REMOVED requirement：没有删除测试。原有测试只做了这些改动：rubric 改为新路径或从注册表取值；`judgePolicy` 增加显式 preset 参数；出站白名单加入预设来源的主机（spec 已写明）；非法期限样例按修订后的 spec 补充 8001、1500.5、未知 preset，并新增 1000、6000、8000 必须可保存的断言；`package-output` 增加 `lib/rubric.json` 不得出现在包内、`lib/presets/reasoning-depth/rubric.json` 必须存在两条断言。

**TDD 过程说明**：
- 下列测试在实现之前写好，并确认失败原因正确：
  - 1.1、1.4、1.7、1.10、2.1、2.4；
  - 3.2「启用 execution 的预设加入固定行」（失败原因：state 中没有 Execution 行）；
  - 4.1、4.4「活跃决策跨越大量其它判断仍保留归属」：先用"只在全局 FIFO 里加 preset"的朴素实现复现失败，失败点是快照丢失，再换成按会话存储的 `mainDecided`；
  - 5.4、6.1、6.4。
- 3.5–3.24 这些采样场景，在 3.3"每个调用点只捕获一次预设并显式传入"完成后，首次运行就通过。为证明它们确实能抓到错误，做了两次临时变异：预览路径写死为缺省预设，导致 2 条失败；子任务在创建时捕获预设，导致 3 条失败。两次变异都已恢复，恢复后全部通过。
- 4.7、5.1 的断言针对已经实现的行为，首次运行即通过；红灯阶段属于 3.3 和 5.2 的提前实现。
- 3.26（出站白名单）提前到第 2 组完成，因为新增的来源主机让全量测试变红。5.2 的设置字段提前到 3.3 实现，因为采样必须读取设置里的 `preset`。这两项都只是调整了顺序，没有超出 design。

### Evidence
- Final full-suite command（包内，Node v24.21.0）：`npm run typecheck && npx vitest run --no-fsModuleCache`（在 `packages/dsh-auto-model-routing/` 下；`--no-fsModuleCache` 用于避开 Lean Worktree 只读的 `node_modules`）
- Result summary：typecheck exit 0；Test Files 35 passed (35)；Tests 312 passed (312)，0 failed，0 skipped。
- 同一命令在 Node v24.12.0 下：310 passed，2 failed（`usage-report.test.ts` 的 zstd 尾帧用例，与基线一致）。
- 仓库根 `npm test`：732 passed，20 failed，2 skipped。原因见上文 8.2。本 change 自身引入的 3 条失败都已修复，修复后 `node --test tests/repo-docs-governance.test.mjs` 33/33 通过：
  - `dsh.yaml` 中的 note 超过 600 码位，已重写为 524 码位，并保留回滚指向 CHANGELOG；
  - 新文档尚未纳入跟踪，已 `git add`；评审文件改用相对于文件自身的链接，原先指向已迁移或已删除文件的链接改为纯文本说明；
  - `docs/presets/README.md` 改为英文，中文内容移到 `README.zh.md`，两者互相链接；规则原文 `只能追加新 id` 以行内代码保留，满足 spec 断言。
- `OPENSPEC_TELEMETRY=0 openspec validate auto-routing-judgement-presets --strict`：`is valid`，exit 0。
- `npm run check:artifacts`：通过。
- 付费调用：没有。eval 测试用 `node --import` 预加载 fetch 桩；第一次跑红灯时，旧脚本在包目录留下一个名为 `--preset` 的桩结果文件（`actualUsd: 0`，没有真实请求），已删除，测试子进程也已固定 `cwd`。

### Review Integrity
- [x] review.md `VERDICT: APPROVE_WITH_CHANGES` with `CHANGES_APPLIED: yes`（round 2，复核子会话已核对）。
- [x] Verdict not stale：实施期间没有修改 proposal.md、design.md、specs/。review.md 与 review-round1.md 只改了链接格式（为满足仓库的链接治理测试），评审正文、结论和发现都没有变。
- [x] All findings fixed or rebutted：round 1 与 round 2 全部采纳，没有反驳。

### Change Delivery
- OR delivery state (if not committed)：未提交。新文件已 `git add` 进入索引，已有文件的改动在工作区，等待用户审阅。提交、`ws-merge` 合入、主 checkout `dsh build` 与重启 Host，都要另外经用户批准后再执行。

## Overall Decision

DECISION: PASS_WITH_WARNINGS

⚠️ 本 change 的规格、实现与包内测试已经闭环（Node 24.21 下 312/312）。警告项：仓库根测试受 Lean Worktree 依赖缓存影响有 18 条环境性失败（未在主 checkout 复跑确认）；隔离 sync 被私有 npm scope 拦下，两次 sync 的幂等需要合入后在主 checkout 补验；本机 Node 24.12 存在 2 条已知的基线失败。
