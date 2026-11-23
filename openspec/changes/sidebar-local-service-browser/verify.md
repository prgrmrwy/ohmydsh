## Verification Results

日期：2026-11-24。由 lead 撰写，依据见下文的证据和各链接文件。

### Task Completion
- [ ] All tasks marked `[x]` in tasks.md（211 项中 208 项已勾选）
- Remaining open tasks：
  - **15.5 预览验收**：本机直连部分 8 项全部通过（见 [acceptance.md](acceptance.md)）。**经 Cockpit 跨机**的部分须由用户在另一台电脑上操作，目前尚未进行。因此整项保持未勾选。
  - **15.6**：即本文件。等 15.5 完成后重新出具，届时再勾选。
  - **15.7 合入、生产部署、重启、归档**：每一步都须用户另行批准，不属于本次实施的范围。

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test：用脚本逐字核对 67 行 `spec Scenario "<名>"`，67 行都找到对应测试，缺失 0 行。其中第 67 行《超长未结束的开头注释触发有界回退》是实施阶段 spec 修订时新增的。
- [x] Every test-plan.md row flipped to 🟢 green：67/67 为绿色，红色 0 行。
- [x] Full suite passes：结果见下方 Evidence。
- [ ] Zero skipped/pending/commented-out tests：**本包**的 Node 套件与浏览器套件 skip 均为 0，测试代码中搜不到 `.only`、`.skip`、`skipIf`、`todo`。**仓库根**套件有 3 个 skip，是本 change 之前就存在的（与归档 change 中记载的 MCP bridge 探针 skip 是同一类），本 change 没有新增；但 Anvil 要求全仓 skip 为 0，这一项按字面仍不满足。
- [x] No test weakened or deleted without REMOVED requirement：实施中有两处调整，都没有削弱 THEN，均由 lead 裁定并记入 test-plan 的 Coverage Notes：
  1. 《unsafe-inline 与已有 nonce 共存时仍追加》的执行语义只能在浏览器中断言，所以把它从 Node 文件移到了浏览器文件。Host 侧对 CSP 头的断言保留为额外测试。
  2. 《长流不被总时长截断》按 spec 原始数值执行（5 秒 × 6，共 30 秒）。缩放后的版本只作为额外测试保留。

**TDD 过程偏差（如实记录，不改写历史）**：
- browser-dev 在写浏览器测试之前，先写了地址栏、注入脚本和 SW 的源码。补救办法是把 `src/inject` 和 `src/sw` 临时移走后重跑：11 个文件失败，只有 smoke 通过，失败原因都是“缺少行为”。
- 《残留注册被清理》《Service Worker 注册失败》两个场景第一次运行时，对应行为已经存在，没有单独的红灯记录。
- 实施阶段新增的第 67 个场景，以及实现评审后补的修复测试中，凡是实现已先存在的，都用变异验证代替红灯。做法是：破坏实现，确认测试变红，再恢复。具体记录见 tasks 6.A1 和本文件末尾的实施记录。

### Evidence
- 最终全量运行（lead 亲自执行，2026-11-24 00:1x，Asia/Shanghai）：
  - `cd packages/sidebar-local-service-browser && npm run typecheck` → exit 0（三份 tsconfig）
  - `npm test` → **14 个文件、132 个测试通过**，0 失败，0 skip
  - `npm run test:browser`（先严格构建，headless Chrome 157）→ **14 个文件、47 个测试通过**，0 失败，0 skip
  - `grep -c -i placeholder lib/index.js` → 0；`tsdown.config.ts` 中 `ALLOW_PLACEHOLDER_ASSETS_BY_DEFAULT = false`
  - 仓库根 `npm test`（运行期间临时对新包执行 `git add -N`，跑完已复原，暂存区为 0）→ **814 个：811 通过、0 失败、3 skip**（均为原有）
  - 仓库根 `npm run check:artifacts` → tracked paths comply
  - `openspec validate sidebar-local-service-browser --strict` → valid
- README 补充非 HTML 文档的限制后，又重跑了 `tests/repo-docs-governance.test.mjs` 与 `tests/repo-facade.test.mjs` → 47 通过、0 失败。
- Non-executable checks run：
  - **隔离 `dsh build`**（15.4）：第 1 次应用 81 处变更；第 2 次应用 1 处变更（dsh-memex 资源补物化，与本 change 无关，本包为 up-to-date）；第 3 次 `no changes`。按“第二次无变化”的字面要求，**这一项未满足**，已如实记录。
  - **本机预览验收**（15.5 的本机部分）：8/8 通过，见 [acceptance.md](acceptance.md)。

### Review Integrity
- [x] 规划评审：第 4 轮 `VERDICT: APPROVE_WITH_CHANGES`，`CHANGES_APPLIED: yes`。Required Changes 经过三次复核，最终 `RE-CHECK: PASS`（见 [review.md](review.md)）。前 3 轮 REVISE 的记录保存在 review-round1～3.md，人类裁决见 [human-decisions.md](human-decisions.md)。
- [x] 判决未过期：Required Changes 落实之后，spec 和 design 只做过一处修订，即“注入位置与有界缓冲”。起因是实施阶段独立实现评审发现的 M1。按 Anvil 的 spec drift 规则，这处修订经过 5 次定向复核（review.md 末尾的各个 `Targeted …` 小节），最终 `AMENDMENT-REVIEW: APPROVE`。另外，test-plan 新增第 67 行，tasks 新增 6.A1–6.A3。除此之外，proposal、design、specs 没有其它改动。
- [x] 所有发现均已修复或得到裁决：
  - [implementation-review.md](implementation-review.md) 结论为 `PASS_WITH_FIXES`，0 个 Critical，2 个 Moderate：M1（注入扫描器的注释识别）由 task-6 修复，M2（SW 注册与激活共用 5 秒预算）由 task-7 修复。两项都有先红后绿的证据，并经 lead 复跑全量测试确认。
  - 规划阶段各轮发现的处理情况见 review.md 与 human-decisions.md。

### Change Delivery
- Delivery state：**尚未提交**。改动都在 worktree `.worktrees/cockpit-dsh-ssh-sidebar-tab-127-0-0-1`（分支 `ws/cockpit-dsh-ssh-sidebar-tab-127-0-0-1`）中：
  - 新增：`packages/sidebar-local-service-browser/`、`openspec/changes/sidebar-local-service-browser/`
  - 修改：`dsh.yaml`、`package-lock.json`（相对 HEAD 只有新增，既有包没有升级或降级）、根 `README.md` 和 `README.zh.md`（插件索引）、`tests/local-package-peers.test.mjs` 和 `tests/repo-docs-governance.test.mjs`（新包登记）
- 提交、合入、生产部署、重启 Host、归档 change，都由用户批准后通过受控命令执行。
- 依赖模式：worktree 已经 `ws promote` 为 mutable。安装时使用了 `--ignore-scripts`，原因是根目录执行带脚本的安装会触发其它 workspace 的 prepare 构建，导致 tsc 内存溢出（OOM）。这个问题在本 change 之前就存在，与本 change 无关。

## Overall Decision

DECISION: FAIL

❌ 目前不能宣布 Anvil 严格验收通过，阻断项如下：
1. 15.5 中经 Cockpit 跨机的验收尚未完成，须由用户操作；
2. 全仓 skip 不为 0（3 个原有 skip，不是本 change 新增）；
3. 隔离 build 第二次运行不是严格的“无变化”（1 处无关的 dsh-memex 补物化）；
4. 部分场景存在上文所述的 TDD 过程偏差。

这个结论不代表实现有缺陷：本包的全部测试、本机预览验收和独立实现评审都已通过。用户完成跨机验收，并决定第 2、3 条是否作为既有限制接受之后，再重新出具 verify。
