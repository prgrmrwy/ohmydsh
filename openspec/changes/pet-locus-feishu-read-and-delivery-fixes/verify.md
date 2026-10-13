## Verification Results

（本文件由实施者填写；`7.5` 真机验收仍需所有者批准重启 Host，故本节在通过前保持未勾选。）

### Task Completion
- [x] 全部实施型任务标记 `[x]`（本 change 共 33 条：1.1–1.5、2.1–2.7、3.1–3.10、4.1–4.5、5.1–5.4、6.1–6.4）
- [ ] **7.5 真机验收未完成**：需要所有者批准重启 Host 才能加载本次部署（见 W1）
- Remaining open tasks: `7.5`（真机）、`7.7`（spec 合并与归档，按 tasks 规定先等 `pet-locus-shell-tier` 7.4）

### TDD Integrity
- [x] `test-plan.md` 中每条 `#### Scenario:` 都有具名测试：42/42 scenario（pet-lark-channel 13、pet-locus-collaboration 24、pet-locus-intent-triage 5）
- [x] 台账全绿：`grep -c "🔴 red" test-plan.md` 只命中图例行，46 行映射全部 🟢 green
- [x] 全量测试通过（pet 与 repo 两处，见 Evidence）
- [x] 本 change 新增测试中没有 `.skip`/`.only`/`.todo`；pet 套件 43 个 skipped 全部来自既有的 `describe.skipIf` 运行时探针（本 change 未新增）
- [x] 未删除或弱化任何既有断言；对既有断言的修改全部记录在下方"既有断言的修改"

**既有断言的修改（均非弱化）**：
1. `test/channel-context.test.ts`：fixture 增加 `entranceRead: 'readable'`。改前两条既有测试断言的是**无条件**的读取邀请（`刻意**不**附带聊天记录摘要`、`按需读取`），而本 change 的 spec 正是要废除"未实测就声称可读"，因此这两条断言只能在旧行为下成立。已保留原断言（在新 fixture 下继续守护"可读时仍然不注入历史"），并新增 5 条三态/默认 unconfirmed 的断言，强度提高。
2. `test/client.test.ts`：源码切片锚点由 `renderPrompt: ({ locus, message })` 改为 `renderPrompt: async ({ locus, message, signal })`（渲染器现在可以 await 有界探测），并新增一条断言钉住"渲染前实测 + await 后复核记录"。
3. `test/executor-scope.test.ts`：可见工具数 7→8（新增 `pet_locus_chat_history`），附带理由注释；该计数本来就是"新增注册必须在此列明理由"的守门断言。
4. `test/channel-lark.test.ts`：把新的探测用例放进既有的 `describe('caller-bound entrance read')`，以复用同一套真实 CLI 信封夹具（无断言改动）。

### Evidence

- `cd packages/dsh-pet && npm run typecheck`（`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit`）：零错误
- `cd packages/dsh-pet && npx vitest run`：**3023 passed, 0 failed, 43 skipped**（171 文件：168 passed, 3 skipped）
- `cd packages/dsh-pet && npm run build`：host `tsc` + client `tsdown` 成功（`lib/client.js` 340.26 kB）
- 仓库 `npm test`：**424 passed, 0 failed, 2 skipped**（426 tests，~57s）
- `npm run check:artifacts`：`[artifacts] tracked paths comply with repository policy`
- `node scripts/sync.mjs` 连续两次：第一次 `3 change(s) applied`（本机第一轮已把新构建部署到 `~/.dsh/profiles/web/node_modules/dsh-pet`），第二次 `no changes — deployment already matches manifest`（幂等）
- `npx openspec validate pet-locus-feishu-read-and-delivery-fixes --strict`：`Change '...' is valid`
- 部署物核对：`~/.dsh/profiles/web/node_modules/dsh-pet/lib/host/channel/entrance-capability.js` 存在且 `lib/host/channel/lark.js` 含 `probeEntranceRead` —— 代码已就位，只差 Host 重启（W1）
- 本 change 的实现提交：`2310a87`（anvil 工件）→ `6d98a7e`（B/C：首投前言判据 + caller-bound 入口读取）→ `1d3ddd9`（D：能力声明实测与探测生命周期）→ `6cfb387`（E：守卫拒绝可诊断）→ `6579880`（F：待办工具反馈与登记回复）。注意同一分支上还有两个**其它 change** 的提交（`22b50e6`、`aad37c9`，sidebar/guard），不属于本 change
- 本 change 的改动规模（限 `packages/dsh-pet` + 本 change 目录 + `BACKLOG.md`）：41 files, +3407/−144
- Non-executable checks run：none

### 真机验收（首次执行，2026-10-13 01:10，部分通过并暴露一处缺陷）

入口：群 `oc_6847047be0e4310c404a8a41ed068365`（「Pet Locus shell-tier test」，新入口无 locus）；触发消息 `om_x100b63e5094a74a0c072c7f7ef0ba0c`「@aaa金雷竹批发韩总 看下历史消息我们在讨论什么」；结果：`delivery-51` / locus `locus-runtime-1791825019304-1e6afb3085e438`（gen 1, safe, read）/ child `session-1e2caf37-54a4-4d49-8128-ceb8df47f583`。

| 验收项 | 结果 | 证据 |
|---|---|---|
| 首投带完整前言 | ✅ PASS | child 首条 user/message 含 `### Endpoint`/`### Locus`/`### Tool tier` 等完整路由事实 |
| 档位声明 | ✅ PASS | prompt `### Tool tier` → `effective：safe`；locus 记录 `toolTier.effective=safe` |
| 能力声明与实测一致 | ✅ PASS | prompt `### 按需读取` → `- 本入口读取能力（本次实测）：本入口的历史消息已实测可读（bot 身份）。` |
| safe 档 child 拥有入口读取工具 | ✅ PASS | child 第 1 步即调用 `pet_locus_chat_history({"direction":"older"})` |
| 工具成功返回内容 | ❌ FAIL（已修） | 工具返回被运行时判为 `INVALID_TOOL_OUTPUT`：`"value.identity" is not a declared property (additionalProperties: false)` → 见 W6 |
| 失败不伪装成"没有消息" | ✅ PASS | child 如实回复"历史读取工具返回了错误，没拿到聊天内容"，未编造讨论内容 |
| 投递结算 | ✅ PASS | delivery-51 `status=replied`、`outboundResult=success`、`finishOutcome=reply`（01:10:35） |
| 守卫拒绝文案（`read /etc/hosts`） | ✅ PASS | `delivery-54` 的 turn 4：`Error: locus-project-read-outside-confirmed-workspace` + 拒绝原因 + `- 允许根：/Users/bytedance/mydir/dev/nexus` + 申请方式（E 组改动真机生效） |
| 未知参数拒绝 | 🟡 半验 | child 依据工具契约**拒绝**构造带 `chat_id` 的调用（"工具定义没有 chat_id 参数，并明确禁止提供聊天目标参数"），因此没有产生真机拒绝样本；工具级拒绝由 `test/locus-chat-history-tool.test.ts` 的 `rejects unknown arguments without reading anything` 覆盖 |
| 游标篡改/伪造 | 🟡 半验 | 同上：child 依约拒绝自行编造 cursor；伪造/跨入口/过期由 `test/locus-history-cursor.test.ts`（8 例）与工具级用例覆盖 |
| 话题入口读取 | ⏳ 未验 | 需要在群里新建话题后 @ 一次（独立 locus，不受群级队列影响） |

**2026-10-13 第二轮真机（01:21 与 01:32/01:34 两次投递，修复后运行）**：
- `delivery-52`（"再试一下历史消息"）：`pet_locus_chat_history` **成功返回 9 条**（`读取身份：bot`、ISO 时间+发送者、不可信输入标注、预算脚注），child 据此总结并 `pet_locus_finish(reply)`；续投提示词同时带到 `工具档位：safe` 与 `本入口读取能力（本次实测）：…已实测可读` —— W6 修复真机生效，D 组两处声明（首投/续投）均真机生效。
- `delivery-53`/`delivery-54`：处理中发生 Host 重启 → 见下方"重启打断"一段与 `pet-locus-interrupted-delivery-recovery` change（U009）。`delivery-54` 于 02:33:03 正常回复；turn 4 里 `read /etc/hosts` 返回了守卫拒绝文案（上表）。

附带观察（与本 change 无关）：finish 之后多个 turn 的下一步命中 provider `EMPTY_RESPONSE`（codex pool `gpt-6.1-sol` exhausted，DSH 已按策略安排重试），不影响已发出的回复与已结算的 Delivery。

**W6 缺陷（真机发现，已修复）**：`PET_LOCUS_CHAT_HISTORY_TOOL` 的 `output.schema` 声明了 `ok/reason/text/cursor/hasMore/count`，但成功路径返回的对象还带 `identity: 'bot'`；该 schema 是 `additionalProperties: false`，于是**每一次成功读取都会变成 `INVALID_TOOL_OUTPUT`**。单测没抓到，是因为它们直接调用 `executeLocusChatHistory`，从未经过 `ToolRuntime` 的返回值校验。

修复：`1baf443a`（schema 增补 `identity`，并说明该值为何必须声明）；回归测试 `d8258f4e`（在 `test/ledger-tool-scope.test.ts` 里用**真实 ToolRuntime** 执行该工具的成功与失败两条路径；把 `identity` 声明去掉后该测试立即转红，已实测）。同时把 `pet_locus_track` 也纳入真运行时执行断言，避免同类缺陷。重新构建并部署后：`diff -rq packages/dsh-pet/lib ~/.dsh/profiles/web/node_modules/dsh-pet/lib` 无差异，部署物 `lib/host/tools.js` 已含新声明。
- 真机证据（历史，非本次变更后）：`session-82bccfbf-d4aa-4239-8801-98a51b145aaa`（事故 child，cwd `/Users/bytedance/mydir/dev/nexus`，delivery-42, 16:48:44, locus `locus-runtime-1791794320256-3c9ae68ac77f68`，safe 档）与父会话 `session-a1f7a6e8-7032-4495-8207-1a4e142ca663`

### Review Integrity
- [x] `review.md`：round 3 `VERDICT: APPROVE_WITH_CHANGES`，5 项 Required Changes 已全部应用，`CHANGES_APPLIED: yes`（round 1/2 记录保留在 `review-round1.md`/`review-round2.md`）
- [x] 评审后的改动未改变已批准的行为断言：实施中新增的 `entrance-capability.ts`、`probeEntranceRead`、三处 prompt 表述与守卫指引文案，都落在 design D3/D4 已批准的形状内；`proposal.md`、`design.md`、`specs/` 在 review 之后未改动（仅 `tasks.md`/`test-plan.md` 台账随实施推进）
- [x] 全部发现已修复或已归入 `BACKLOG.md`：U006（user 身份回落契约）、U007（可信 spill root）按 round 1 的 C4/C1 拆出，未在本 change 中放宽任何读取边界

### Change Delivery
- Commit range: `2310a87..6579880`（本 change 自身 5 个提交，见上）
- 未 push（所有者只要求提交，未要求推送）
- 未归档：`7.7` 规定 spec 合并与归档须等 `pet-locus-shell-tier` 7.4 先行

## Warnings

- **W7 重启打断导致 1 小时阻塞（已由后续 change 修复，真机端到端待补验）**：2026-10-13 01:32:44 受理的 `delivery-53` 在 01:33:35 重启时被打断（child 日志 `turn/end {kind:'interrupted'}`），但它已绑定 turnId，旧代码按"序列化 current 存活重启"只等自己的 1h 租约 → 02:32:44 过期、02:32:45 才提升后续消息。已立项并实现 `pet-locus-interrupted-delivery-recovery`（启动恢复结算 + 最小执行租约 ≥10min）；该判定已用**真实记录 + 真实会话日志**回放验证（返回 `state: 'interrupted'`），但"启动即结算"的真机端到端仍待一次真实的重启打断（见该 change 的 `verify.md` W1）。
- **W1 真机验收未完成（阻塞 7.5）**：第一次真机执行（见上）已验证首投前言/档位/实测声明/工具可见性/如实报告失败，并暴露并修复了 W6；修复后的**再次真机验收仍需重启 Host**（当前运行进程加载的是修复前的构建），因此未知参数拒绝、游标篡改、守卫拒绝文案、话题入口、以及**工具成功返回内容**这几项仍待验。重启前本 change 不得归档。
- **W2 `pet-locus-shell-tier` task 1.2 的真机读取门仍未关闭**：design 已声明本 change 不声称关闭它；本次 `safe` 档读取能力只在单测与适配器层验证，真机沙箱内验收仍归该 change。
- **W3 探测为每次投递一次额外 CLI 读取**：`probeEntranceRead` 每个投递/每次 QA 提问各多一次 `--page-size 1` 读取（默认 5s 上限）。这是"声明必须实测"的直接代价；若真机观察到投递延迟可感，可下调 `ENTRANCE_PROBE_DEADLINE_MS` 或改为投递内复用（两者都不改变"未确认不声明可读"的语义）。
- **W4 群历史读取仍只用 bot 身份**：本次未实现 user 身份回落（按所有者决定拆到 U006）。因此当 bot 再次失去群读取权限时，child 会如实声明不可读，而不是自行回落——这是有意的选择，不是遗漏。
- **W6 工具输出 schema 未声明 `identity`（真机发现，已修）**：见上文；教训是「工具返回值与声明 schema 必须经真实 `ToolRuntime` 执行来校验」，单测直接调纯函数会漏掉这一类缺陷。已在 `test/ledger-tool-scope.test.ts` 补真运行时执行断言（`pet_locus_chat_history` 成功+失败两路、`pet_locus_track` 一路）。
- **W5 Jev MCP 不可用**：`@jkudish/jev-mcp` 在本机对 `classify`/`decide` 返回 HTTP 451，已按 router 规则记录两条 `needs-review`（`~/.dsh/state/jev-workflow-router/records.v1.jsonl`）并停止重试；本 change 改按所有者指定路线（anvil schema + cross-model review `codex/gpt-6.1-sol`）执行，不受影响。

## Overall Decision

DECISION: PENDING_LIVE_ACCEPTANCE

⚠️ 实现与验证账本已完成（33 条实施任务全绿、42/42 scenario 有具名测试、pet 与 repo 全量测试零失败、sync 幂等、`openspec validate --strict` 通过）；唯一未完成的是需要所有者批准重启 Host 的真机验收（W1）与依赖 `pet-locus-shell-tier` 归档顺序的 7.7。因此本 change **尚不可归档**。
