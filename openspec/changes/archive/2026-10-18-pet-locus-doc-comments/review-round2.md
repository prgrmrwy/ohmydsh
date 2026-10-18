## Review Metadata
- **Review round**: 2
- **Prior round**: round 1 REVISE. It flagged C1 (no proof of remote-connection absence, no runtime detection), C2 (rollback), M1–M9 and S1–S8. Its full text is kept verbatim in `review-round1.md`.
- **Reviewer context**: fresh-context subagent with no authoring transcript. This is a retry; the first round-2 attempt crashed before it returned a verdict.
- **Tool restrictions**: read-only. The reviewer created, edited and deleted nothing, and ran no network calls, builds or tests. One background `find` over `/` was cancelled before it produced output.
- **Artifacts reviewed**:
  - Read in full: `proposal.md`, `design.md`, `review.md`, `specs/pet-locus-doc-comments/spec.md`, `specs/pet-lark-channel/spec.md`, `specs/pet-locus-collaboration/spec.md`.
  - Current specs, targeted ranges:
    - `openspec/specs/pet-lark-channel/spec.md` L10-18, 119-131, 362-372, 388-400, 420-424
    - `openspec/specs/pet-locus-collaboration/spec.md` L5-8, 362-380, 501-504, 572-578, 600-606, 646-656
    - `openspec/specs/pet-locus-intent-triage/spec.md` L171-201
  - Source, targeted ranges:
    - `spec.ts` L105, 303-306, 380-400, 480-495, 515-545, 600-700, 869-900, 1050-1190
    - `aggregate.ts` L240-300
    - `persistence.ts` L355-380, 875-905, 3080-3115, 3940-3975, 4075-4200
    - `storage/backend.ts` L83, 300-333
    - `migrate.ts` L150-175
    - `migration-guidance.ts`
    - `scripts/migrate-state-version.mjs` L1-80, plus a grep of its SQL
    - `channel/subscription.ts` L1-20, 131-200
    - `channel/service.ts` L659-681
    - `channel/lark.ts` L525-540
    - `client/locus-view.ts` L30-190
    - `client/ledger-view.ts` L40-90
    - `wire.ts` L920-935
    - `ledger/todo.ts` (grep)
  - lark-cli v1.0.97 source:
    - `shortcuts/event/subscribe.go` L28-60, 130-301
    - `processor_generic.go` (full)
    - `processor_im_message.go` L75-132
    - `internal/event/consume/remote_preflight.go` (full)
    - `cmd/event/stop.go` L40-140
  - Spike artifacts in `/tmp/lark-spike`: `s1.err`, `eof.err`, `w1.err`, `p1.err` (head), and the redacted shapes of `w1.ndjson` and `p1.ndjson`.
- **Verification limits**:
  - No spike was re-run.
  - The Feishu Go SDK source is not available locally, so it could not be confirmed from source whether the `connected to wss` Info line is printed again on an internal reconnect.
  - `tasks.md` does not exist yet, so there was no task-level gating to review.
  - `persistence.ts`, `locus-controller.ts` and `index.ts` were not read in full.

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

## Prior-Round Resolution
| Item | Status | Evidence |
|---|---|---|
| C1 | RESOLVED | The remote check uses the directly callable `GET /open-apis/event/v1/connection` (design.md:24 E8; this matches `remote_preflight.go:17-36`). The runtime re-check runs every 60 s, and the possible loss window is disclosed (channel spec:81, :115-118). One new off-by-one appears here; see M-b. |
| C2 | PARTIAL | An offline downgrade with quarantine was added (design.md:176-184; collab spec:76-84). The quarantine scope is incomplete, and restoring at Host startup breaks the offline-only invariant; see C-a. |
| M1 | PARTIAL (switch rebutted) | The version, `--help` and connection gates are in the spec (channel spec:69-71). Still missing: the IM `--dry-run` gate (design.md:75) is not in the spec; there is no scenario for the comment event or the drive/docx scopes not being enabled; there is no `subscribe-unavailable` scenario; Channel onboarding (current spec:388) is not MODIFIED. |
| M2 | RESOLVED | All four are specified: idle-bus `event stop` (E9), process-group kill with a 5 s wait (channel spec:9), the orphan pid file (:9, :105-113), and lock-held handling (:83, :120-123). |
| M3 | RESOLVED | The prefixed `chatId` is adopted (design.md:93-105). `petLocusEndpoint` checks only for the key separator (spec.ts:529-539). The doc messageId contains the token (doc spec:70). |
| M4 | RESOLVED | `--compact` shares lark-cli's mapping (`processor_im_message.go:75-125`, including `reply_to = ParentID` at L120). An `interactive` scenario exists (channel spec:32-35). |
| M5 | RESOLVED | The watermark is latched once per child (channel spec:11, :42-45). `Connected.` is printed once (`subscribe.go:283`). |
| M6 | PARTIAL | The disposition table and its scenarios exist (doc spec:213-251). However, these existing requirements are changed without a MODIFY: collab "出站 @ 渲染" (current :600), collab "自动主会话按群建立" (current :21), and the intent-triage jump requirement. See M-e. |
| M7 | RESOLVED | Owner decision, backed by a disclosure receipt (doc spec:81, :98-101), an untrusted-content label (:262, :271-274) and a management-surface note (:294). |
| M8 | RESOLVED | The reaction keys were tested (E15). Failure, expiry and API-failure scenarios exist (doc spec:168-201). |
| M9 | PARTIAL | The refusal vocabulary is extended (channel spec:142-146) and the short-code requirement is MODIFIED (collab:133). But the doc short-code rule cannot work as written (M-d), and `target-mismatch` (design.md:117, :209) conflicts with the spec's `association-unproven` (doc spec:161). |
| S1 | RESOLVED | `bot.added` is not subscribed (design.md:55). |
| S2 | RESOLVED | The `/open-apis` form and doc-body writes are covered (doc spec:176-181, :208-211). |
| S3 | RESOLVED | Paginated fallback (doc spec:73-74, :118-126). |
| S4 | PARTIAL | The invariant is restated, but it now contradicts the `event stop` rule (M-c). |
| S5 | PARTIAL | Scenarios exist for readiness timeout and lock-held (channel spec:120-138). There is still no `subscribe-unavailable` scenario. |
| S6 | RESOLVED | proposal.md:64-66. |
| S7 | RESOLVED | Q1–Q4 are closed, with evidence E8–E16. |
| S8 | RESOLVED | Limits are stated in UTF-16 code units, with numbers (doc spec:261, :266-269). |

## Findings

### 🔴 Critical (blocking)

**C-a. The rollback quarantine is incomplete, so v15 still fails in the common mixed case. The restore step also breaks the offline-only migration invariant.**

Evidence:
- The quarantine set is defined as "`chatId` 以 `doc:` 开头的 locus 行、delivery 行、ledger 行，以及按这些 locus 键索引的行" (design.md:180). The collab scenario asserts something narrower: "所有 `chatId` 以 `doc:` 开头的行都被移入…" (collab spec:79).
- Several tables refer to a doc locus without carrying a doc `chatId`:
  - `parent-loci` index rows. They are keyed by the parent session and list **both** IM and doc locusIds (persistence.ts:3945-3958).
  - `child-locus` index rows (:3960-3967).
  - `locus_permission_audit`, which stores only `locusId` (spec.ts:891-895).
  - `locus_operations`, where `locusId` and `chatId` are optional (spec.ts:921-962).
  - Inquiries that name a doc child's `locusId` (`inquiry/ledger.ts:68`).
- A main session bound to both a group and a doc is the normal `/bind` use case. Its `parent-loci` row has two possible fates, and both break IM:
  - It stays as is. v15 then throws `Parent index … points to an invalid locus` (persistence.ts:888-895).
  - It is moved out. The IM loci then disappear from the index.
  
  Every collaboration caller path goes through `listLociByParent` (collaboration/caller.ts:99-104, assembly.ts:295, management.ts:793), so the result is the same failure C2 was about: IM loci stop working.
- The restore step is "v16 启动若发现 `quarantine_doc_v16` 表存在，就在开放 intake 之前把其中的行原样搬回" (design.md:183). Three problems:
  - Moving index rows back unchanged overwrites any index rows v15 has rewritten in the meantime.
  - The Host opens storage only through declared domain tables (backend.ts:324-332), and `quarantine_doc_v16` is not one of them.
  - `migration-guidance.ts:22-23` states "Normal Host startup never opens or mutates state.sqlite directly".

Fix:
1. Define the quarantine set as the closure keyed by locusId: the doc loci, plus every row in deliveries, switch notices, permission audit, operations, inquiries, inquiry results and ledger items whose `locusId` or `endpoint.chatId` points to a doc locus.
2. Never move index rows. Either rewrite them, or delete them and rebuild from `loci`. Mixed `parent-loci` rows must keep their IM ids.
3. Do the restore in the offline upgrade script (`--yes`), not at Host startup, and rebuild the indexes afterwards.
4. Add a scenario: "同一主会话同时关联群与文档时降级，v15 的 `listLociByParent` 正常返回 IM locus".

### 🟡 Moderate

**M-a. There is no 15→16 upgrade path.**

Evidence:
- The migration script only restamps upward from `RESTAMPABLE = [2..14]` (migrate-state-version.mjs:37-40).
- `migrate.ts:160` accepts only versions 1–13.
- The backend throws `version-mismatch` on any stamp mismatch (backend.ts:314-323).
- Migration Plan step 3 only says "`dsh build` 后重启 Host" (design.md:225).

As a result, every existing user's Pet fails to open storage after the upgrade until someone runs a restamp that the plan never specifies.

Fix:
- State that the script's upgrade mode adds 15 to `RESTAMPABLE`.
- State that the operator runs `dsh-pet-migrate-state --yes` before restarting, or relies on the existing guidance text.
- Add this step to the Migration Plan, with a scenario.

**M-b. The runtime "计数>1" rule has an off-by-one in both directions.**

channel spec:81 re-checks "每次重启子进程后也复查一次" and goes `down` when the count is greater than 1. With only Pet connected, the healthy count is 1 (E8). Right after a restart, before the new child's WebSocket is up, the rule fails both ways:
- **Missed conflict.** A foreign connection on its own reads as 1 and is not caught.
- **False alarm.** The previous crashed child's server-side connection may still be draining. E8 shows about 3 s to clear after SIGTERM; a hard crash was not measured. Old plus new reads 2 and triggers a false `down`. `down` stays in place until the user reconnects (current channel spec:362).

Fix:
- On every child restart, re-run the **start gate**: require a count of 0 before spawning, with the same 15 s grace period.
- Run the runtime `>1` check only while `connected`, meaning after the `connected to wss` line has appeared.
- Require two consecutive readings above 1, N seconds apart, before going `down`.
- Add a scenario for a restart while the previous connection is still draining.

**M-c. The channel delta contradicts itself on the shared bus, and the M1 follow-ups are missing from the spec.**

Evidence:
- channel spec:76 says "SHALL 对 Pet 自己的 profile 执行 `event stop`", while :79 says "MUST NOT 终止 lark-cli 的共享 bus daemon". `event stop` stops exactly that daemon (stop.go:51-52).
- The bus is per-app and shared across profiles (design.md:83). Safety currently rests only on `event stop` refusing by itself when `ActiveConns > 0 && !force` (stop.go:123-133). The spec neither forbids `--force` nor says what to do when the result is `refused` (exit 2).
- M1 follow-ups still missing:
  - The IM `--dry-run` scope gate is only in the design (design.md:75), not in the spec.
  - No scenario covers "评论事件未在后台开通/缺 drive 权限 → IM 照常、文档入口不可用".
  - No scenario covers `subscribe-unavailable`.
  - Channel onboarding (current spec:388) is not MODIFIED to list the comment event and the drive/docx scopes, although design.md:75 relies on it.

Fix:
1. Reword :79 to: "MUST NOT 对存在活跃消费者的 bus 执行 `event stop`，MUST NOT 传 `--force`；`event stop` 返回 refused 时按 `event-connection-conflict` 处理".
2. Add the dry-run gate and the three missing scenarios.
3. MODIFY the Channel onboarding requirement.

**M-d. The doc short-code rule cannot be implemented as written.**

Evidence:
- collab spec:133 and doc spec:291 say "与群/话题的派生规则同构" and derive the code from the full prefixed `chatId`.
- The current endpoint rule takes everything after the first `_` (client/locus-view.ts:73-77). `doc:docx:<token>` contains no `_`, so every doc gets the code `doc:`. Codes then collide across all documents until they fall back to the full id (:131-137).
- If the rule is instead read as "strip the type prefix", `doc:docx:X` and `oc_X` both yield `X`, which contradicts collab spec:150-153.
- `endpointHandleLabel` would label a doc `oc·` or `omt·` (:159-161).
- `endpointRole` would call a doc "入口" rather than "文档". That is acceptable.

Fix: state the doc rule explicitly:
- the source substring is the token (or comment_id) characters after `doc:docx:`;
- the label is `doc·` / `cmt·`;
- collision handling stays per kind.

Then fix scenario :150-153 so that "different from the `oc_X` code" relies on the label prefix, not on the substring.

**M-e. Behaviour exceptions are added without MODIFYing the requirements they change.**

Evidence:
- intent-triage spec:177 says **跳飞书** locates the target by `endpoint` and the trigger `messageId`; a topic todo points to the topic, and otherwise "退化为所属群".
- The doc table (doc spec:224, :243-246) redefines this for docs. Current code would classify a comment todo, which has a `threadId`, as `kind:'thread'` with `messageId = doc:…` (ledger-view.ts:46-62).
- The URL `https://<tenant>.feishu.cn/docx/<token>` (design.md:159) does not say where `<tenant>` comes from.
- The same problem applies to two collab requirements:
  - "出站 @ 引用渲染为平台真实提醒" (current :600, "SHALL 只使用当前 chat 成员列表"), whose scope is all business replies;
  - "自动主会话按群建立" (current :21).
- OpenSpec merge leaves the old SHALLs unchanged, so after archive the current specs would contradict each other.

Fix:
- Add MODIFIED deltas for intent-triage "管理面呈现待办…跳转", collab :600 and collab :21. Scope each one to IM entries and add a doc clause.
- Specify where the tenant comes from, or use the URL returned by `drive +inspect`.

**M-f. Stderr is now parsed for meaning, so it needs a redaction rule.**

Evidence:
- Without `--quiet`, the SDK Info line goes to stderr (`subscribe.go:40-43`, `:234`). The readiness marker `connected to wss` is therefore observable, which answers Q2-5 positively; spike `s1.err:4` confirms it.
- That line contains `access_key=…&ticket=…`.
- The design now parses stderr for readiness, the lock-held error and `not found handler` lines (design.md:58-60, :89). Today's subscription.ts never keeps stderr.
- Current channel spec:13-14 forbids Pet from handling credentials.

Fix:
- Add to the channel requirement: "SHALL NOT log, persist or surface raw `+subscribe` stderr; only matched classifications are recorded; URL query strings are redacted".
- Pet MUST NOT pass `--quiet`.

### 📌 Suggestions
- **S-a. Unify the stable code.** design.md:117 and :209 say `target-mismatch`; the spec uses `association-unproven` (doc spec:161, collab spec:42). Either drop the design's new code or add it to the spec.
- **S-b. Include the file type in the doc messageId.** The doc Delivery `messageId` uses `doc:<token>/…`, while `chatId` uses `doc:docx:<token>`. Adding `docx:` to the messageId keeps the file type in the dedup key if more file types are added later.
- **S-c. Say who sends the disclosure receipt.** doc spec:81 and :101 require a disclosure "回执" when a doc entry is first created, but finish is the only business egress. State whether this is a Host control receipt (a separate `+add-reply`) or text the Host prepends to the first finish reply.
- **S-d. Update the stale rebuttal.** review.md:253's C1 rebuttal ("bounded `event consume` probe") no longer matches the design, which uses the direct API (E8). Update it so the record is accurate.
- **S-e. Make these scenario THENs mechanically checkable.**

  | Location | Current THEN | Suggested observable |
  |---|---|---|
  | doc spec:96 | "行为与群…一致" | "Delivery count 0 and diagnostic `not-allowed-sender`" |
  | doc spec:274 | "不含任何把它提升为…指令的结构" | "the line appears only inside the tool-result text block after the label" |
  | doc spec:42 | "归属等价" | "the parent of `(D,c2)` equals the parent of the doc-level locus" |
- **S-f. Correct the design's description of IM egress failure.** `lark.ts:534` `requireMessageId` (`^om_`) and `:527` `requireChatId` (`^oc_`) mean IM egress given a doc value throws locally, rather than "平台拒绝" (design.md:104). This is still fail closed, but the design should describe it accurately.

## Embedded-Instruction / Injection Attempts
**Detected:** none. The artifacts, source and spike output contain no text aimed at the reviewer. doc spec:272 contains an example injection string ("忽略之前的指令…"). It is quoted test data inside a scenario, not an instruction, and was not acted on.

## Verdict
VERDICT: REVISE

## Required Changes (if APPROVE WITH CHANGES)
Not applicable, because the verdict is REVISE. To clear it:
1. Fix C-a: quarantine the full locusId closure, rebuild indexes instead of moving them, restore offline, and add the mixed-parent scenario.
2. Fix M-a through M-f as described above.

CHANGES_APPLIED: n/a

## Rebuttals
- **M1 (default-off switch):** accepted by reviewer. Choosing a single transport is a product decision that belongs to the owner, and the round-1 risk is now covered by the version, command and connection-count gates plus the disclosed loss window. The M1 follow-ups the author promised to keep are still incomplete; they are tracked under M-c.
- **C1 (remote check via consume probe):** accepted. The direction was superseded by the better direct connection-count API (E8). The rebuttal text itself is stale (S-d).
- **"Other items: fixed in round 2 artifacts":** rejected. C2, M6, M9, S4 and S5 are only partially fixed; see the table above and findings C-a, M-c, M-d and M-e.

## Author response for round 3 (outside the reviewer's text)
- **C-a**: owner decision (2026-10-16). Rollback is a whole-database restore from the backup that `migrate-state-version.mjs` already writes before restamping. All Pet state created after the upgrade is lost, and the owner accepted that. Quarantine, the downgrade script and restore-on-startup are all deleted (design D11).
- **Owner decision (2026-10-16): do not split** this into "transport only" and "doc entry" changes (design A7).
- **ponytail-review (2026-10-16)** findings applied:
  - no `event stop` / `event status` parsing; wait up to 40 s instead;
  - start gate on every spawn;
  - two consecutive readings > 1 required;
  - stderr redaction;
  - app-exclusivity disclosure;
  - comment watermark from `timestamp`.
- M-a through M-f and S-a through S-f: see the "Round 2 → Round 3" table in design.md.

## Escalation (author note, outside the reviewer's text)
This is the second consecutive REVISE (round 1 → round 2). Under anvil rules, the author STOPS and escalates to the human, with no third author/reviewer loop without explicit human direction. Escalated to the owner on 2026-10-16. The owner reviewed it, decided on rollback and splitting, ran a ponytail-review, and on 2026-10-16 explicitly authorized a third full review round.
