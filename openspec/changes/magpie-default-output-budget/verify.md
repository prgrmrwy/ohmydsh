## Verification Results

### Task Completion
- [x] 除 6.6 外全部任务标记 `[x]`（20/21）
- Remaining open tasks: **6.6** —— 需要在用户重启 DSH Host 后，对运行中的 0.1.2 再查一次 `/models` 并确认三个受影响模型的 `defaultMaxTokens`。重启是用户决定的操作，本轮未执行；其代码层面的等价校验已在「Non-executable checks run」中完成，见下文。

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test（13 行全部有具名 vitest 用例）
- [x] Every test-plan.md row flipped to 🟢 green（0 行仍为 🔴）
- [x] Full suite passes（包内 265/265；仓库级见 Evidence 的环境性失败说明）
- [x] Zero skipped/pending/commented-out tests（`vitest run` 无 skip）
- [x] No test weakened or deleted without REMOVED requirement

红绿过程记录：
- 2.1 三组预算测试先红（`expected 393216 to be 184464` 等），实现公式后转绿。
- 2.3「SDK 模型上限为最大输出能力」在预算落地后按预期转红（`maxTokens` 被误设为 184464），3.1 能力分离后恢复，符合 test-plan 注 3。
- 4.1 的两组压缩检查测试在当前公式下直接通过；按要求临时把 `defaultMaxTokens: defaultOutputBudget(...)` 回退成 `outputLimit` 复验，测试转红（`104026/416104: expected -377614 to be greater than 0` 等），随后恢复源码并确认 8/8 通过。

### Evidence

- Final full-suite command（包内）：`cd packages/dsh-magpie-connector && npm test`
- Result summary：**36 files / 265 tests passed，0 failed，0 skipped**
- Typecheck / build：`npm run typecheck` 通过；`npm run build` 通过
- 仓库级：`cd <repo> && npm test` → **628 pass / 1 fail**。失败的是 `tests/jev-readiness.test.mjs` 的「readiness prefers v4 session file and falls back to v3」，原因是该 fixture 直接 `spawnSync('zstd', ...)`，而本机未安装 `zstd`（`zstd: command not found`），断言 `null !== 0`。与本 change 无关，属环境缺依赖，未改动该测试。
- Non-executable checks run：
  - `npm run check:artifacts` → `[artifacts] tracked paths comply with repository policy`
  - `openspec validate magpie-default-output-budget --strict` → `Change 'magpie-default-output-budget' is valid`
  - `./bin/dsh build`（首次）→ `[sync] done — 3 change(s) applied`；第二次 → `[sync] no changes — deployment already matches manifest`（幂等）
  - 只读在线校验（用源码 `mapCatalog` 对新代码映射真实 `GET /models`，未改任何状态）：`codex/gpt-6-astra`、`codex/gpt-6-luna` → `defaultMaxTokens 70464`、阈值 136000；`opencode-go/minimax-m3.1-flash` → `434464`、阈值 500000；其余 10 个模型不变，与 design/CHANGELOG 的预期一致。
- 宿主 llm 补齐路径（test-plan 注 4 最后一项）：未搭建 `dsh-llm` + 真实 Context 的集成测试，成本过高。替代依据：`node_modules/@deepseek-ai/dsh-llm/lib/index.js:2169–2173` 的 `resolveCallWithInfo` 在 `config.maxTokens` 缺失时取 `info.defaultMaxTokens`，`2291–2308` 在派发前物化；本 change 不改该路径，默认值改为目录提供后宿主行为不变。

### Review Integrity
- [x] review.md `VERDICT: APPROVE_WITH_CHANGES` 且 `CHANGES_APPLIED: yes`（第 2 轮；第 1 轮 REVISE 的 C1/C2 与 M1–M5 已逐项关闭）
- [x] Verdict not stale：第 2 轮判决后仅按 Required Changes 修改了 `proposal.md` 与 `design.md`（N1/N2/N3），`specs/` 未再改动；评审方已复核并接受
- [x] All findings fixed or rebutted；N1–N3 的复核结论为「accepted by reviewer」

### Change Delivery

- Commit range：无（未提交）
- Delivery state：**工作区就绪，等待人工复核与提交**。改动文件：
  - `packages/dsh-magpie-connector/src/host/catalog.ts`（预算公式与 `outputLimit`）、`src/host/adapter.ts`（SDK 上限改用能力值）
  - `packages/dsh-magpie-connector/test/output-budget.test.ts`、`test/output-budget-wire.test.ts`、`test/catalog-mapping.test.ts`
  - `packages/dsh-magpie-connector/{package.json,CHANGELOG.md,README.md,README.zh.md}`
  - `dsh.yaml`（版本 0.1.2 与 note）
  - 另：`BACKLOG.md` 与 `packages/dsh-magpie-connector/docs/cloudflare-524-long-requests.md`（D014 的排查记录，已 `git add`，与本次 change 同批提交即可）
  - `openspec/changes/magpie-default-output-budget/` 尚未纳入版本控制（等提交时一并加入）
- 提交由用户在复核后执行；本轮未擅自 commit。

## Overall Decision

DECISION: PASS_WITH_WARNINGS

- ✅ 实现、测试、文档、manifest、build 幂等与在线只读校验均符合规范。
- ⚠️ 两项待办：① 6.6 需用户重启 Host 后用运行中的 0.1.2 复验（当前 Host 仍是 0.1.1）；② 仓库级 `npm test` 有 1 个与本次无关的环境性失败（本机缺 `zstd` 二进制），建议装 `zstd` 或跳过该用例的机器级依赖。
