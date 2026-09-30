## Verification Results

### Task Completion
- [x] All tasks marked `[x]` in tasks.md（66/66）
- Remaining open tasks: none
- 11.9（真机验收失败路径）按所有者决定**跳过真机构造**：当前没有主会话已归档的待办，构造需要归档一个真实会话。该路径由 5 个单测覆盖（见 tasks.md 11.9 条目）。另外，真机验收 1 首轮因写句柄冲突失败，实际走过了一次"受理失败 → 状态保持 open → 就地显示原因"，事后读数据库确认状态未被改写。

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test（41/41，无 `N/A — non-executable` 条目）
- [x] Every test-plan.md row flipped to 🟢 green（41/41，0 行 🔴）
- [x] Full suite passes —— 本 change 引入的测试全部通过；pet 套件有 3 个失败，均为既有失败，见 Warnings W1
- [x] Zero skipped/pending/commented-out tests **introduced by this change** —— pet 套件的 43 个 skipped 全部来自 7 个 `describe.skipIf` 块（opt-in 真实原子 Domain / 固定运行时探针），均由更早的 change 引入（最晚为 2026-09-19 `2cc12a660`），本 change 新增测试中无 `.skip`/`.only`/`.todo`/`skipIf`
- [x] No test weakened or deleted without REMOVED requirement —— 修改了 3 条既有断言，均有 spec 依据，见下

**既有断言的修改（均非弱化）**：
1. `executor-scope.test.ts` 注册计数 6→7：守卫意图是"新增注册必须在此列明理由"。已补充 `PET_LOCUS_REQUEST_EXECUTION_TOOL` 断言，并在注释里写明新工具的约束（只收 `itemId`，只能进入 accepted，必须经真实投递）。守卫强度没有降低。
2. `ledger-panel-render.test.ts` hint 文案：旧断言锁死「仍可稍后完成或放弃」，这正是本 change 按 spec 废除的中间态语义（scenario「受理动作自述会开工」）。已改为断言新文案，并加 `not.toContain(旧文案)`，防止旧语义被改回来。
3. `ledger-tool-scope.test.ts` 中本 change 新写的断言有两处自身缺陷：把描述文案里的 done 当成代码，切片锚点取到了常量声明而不是注册块。已在同一轮修正，不是对既有测试的修改。

### Evidence

- Final full-suite command（pet）：`cd packages/dsh-pet && npx vitest run`
- Result summary（pet）：**2806 passed, 3 failed, 43 skipped**（161 files: 156 passed, 2 failed, 3 skipped）
- Final full-suite command（repo）：`npm test`
- Result summary（repo）：**253 passed, 0 failed, 2 skipped**（255 tests）
- Typecheck：`npx tsc --noEmit -p tsconfig.json` 与 `-p tsconfig.client.json` 均零错误
- Build：`npm run build`（packages/dsh-pet）成功
- `npm run check:artifacts`：tracked paths comply with repository policy
- `node scripts/sync.mjs` 连续两次：第二次 "no changes"（幂等）
- 真机验收：
  - **11.7 所有者受理**：待办 `todo-mukzh7u8` 由 open 变为 accepted，`statusChangedAt` 更新。主会话 `381198bb` 第 362 条事件（`user/message`）正文结构逐项符合 spec：标识、请求人、时间、入口齐全，证据为最后一段，只有起始标记没有结束标记，explicit 分支不含待命结束声明。首轮失败暴露了 `agents.get` 返回形状错误，已修复（`5448b0411`）并加源码级回归断言。
  - **11.8 子会话请求执行**：Q&A 群子会话工具调用顺序为 `pet_locus_ledger_read → pet_locus_track → pet_locus_ledger_read → pet_locus_request_execution → pet_locus_finish`。待办 `todo-muntsun2` 在登记后约 10 秒进入 accepted。主会话 `5811f024` 收到结构相同的正文，qa-created 分支不含待命结束声明，没有发生界面导航。随后执行了该跟进任务本身（`f28344e28`）。
- Non-executable checks run：none

### Review Integrity
- [x] review.md `VERDICT: APPROVE`（round 6 定向复检后）
- [x] Verdict not stale —— review 之后 design.md 有一处**只增不删**的改动（+9/−0），内容是实施期 tasks 1.1–1.4 的核验结论，其中包含一项所有者中途确认的决定（冷恢复时挂会话自己持久化的 preset）和一处事实更正（`agents.get` 返回裸 Agent）。已对这些改动做**定向复检**（cross-model，codex，只读），结论为 `POST_APPROVAL_EDITS: SOUND`：没有与 D1–D11 或 spec 冲突；决定 (c) 在 D8 的后果上限之内；更正 (b) 与类型声明 `index.d.ts:139-141,341` 一致。proposal.md 与 specs/ 在 review 之后未改动。
- [x] All findings fixed or rebutted —— round 1–6 的全部 Critical/Moderate 发现均已修复，并经复检标为 accepted by reviewer。定向复检另指出一处预存的措辞不精确：D2/D9 把 `followup` 写成 `AgentHandle.followup`，实际在裸 Agent 上。复检判定不影响已批准的行为，本 verify 记录在案，不再改 design。

### Change Delivery

- Commit range（if committed）：`807d44ad2..56456d7f2`（位于 `ws/locus`，其中至 `5448b0411` 已合入 `main`）
- 本 verify 与 tasks 11.9 的收尾提交将随后合入 `main`

## Warnings

- **W1 既有测试失败（与本 change 无关）**：pet 套件有 3 个失败，都在 `client.test.ts`（DSW token、connection face）和 `loader-composition.test.ts`（client bundle 依赖可解析性），内容与已安装的 DSH 版本有关。实施前曾用 `git stash -u` 验证这批失败（当时为 4 个）**在改动前就存在**；其中 1 个后来被主干的其它修复顺带解决。本 change 没有引入新的失败。
- **W2 跨面板公告接缝未注册**：D11 要求导航后 `dispatched`/`queued` 的区分仍然可见。代码提供了 `setOutcomeAnnouncer` 接缝，但目前没有 shell 注册它，所以成功导航后这条公告不显示，结局区分在 GUI 上暂时看不到。接缝缺失时代码按 spec 降级，不影响受理成功。需要 shell 侧注册才能补齐，建议作为后续项。
- **W3 真机验收 11.9 未做**：见 Task Completion，由单测覆盖，并有一次真机失败路径的附带证据。

## Overall Decision

DECISION: PASS_WITH_WARNINGS

⚠️ PASS WITH WARNINGS —— 功能完整、测试账本全绿，两项真机验收通过。警告项都不阻塞归档：W1 与本 change 无关，W2 是已知的 shell 侧缺口，W3 由所有者决定跳过。
