## Review Metadata
- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: fresh-context subagent (no authoring transcript)
- **Tool restrictions**: read-only (no file modified; no network/build/test)
- **Artifacts reviewed**:
  - Change: `openspec/changes/pet-locus-doc-comments/{proposal.md, design.md, specs/pet-locus-doc-comments/spec.md, specs/pet-lark-channel/spec.md, specs/pet-locus-collaboration/spec.md, .openspec.yaml}`
  - Current specs:
    - `openspec/specs/pet-lark-channel/spec.md` (full)
    - `openspec/specs/pet-locus-collaboration/spec.md` (full)
    - `openspec/specs/pet-locus-intent-triage/spec.md` (todo/jump/dispatch requirements)
    - `openspec/specs/pet-locus-media-access/spec.md` (requirement headers and media read path)
  - In-flight deltas:
    - `pet-locus-shell-tier/specs/pet-locus-collaboration/spec.md`
    - `pet-locus-feishu-read-and-delivery-fixes/specs/{pet-lark-channel,pet-locus-collaboration}/spec.md`
    - `pet-locus-independent-agent-inquiries/specs/pet-locus-collaboration/spec.md`
  - `docs/architecture/dsh-plugin-integration-pitfalls.md` §2, §8, §10, §11
  - Source:
    - `channel/{subscription,service,event,bot-lifecycle,media}.ts`
    - `channel/locus-controller.ts` (normalization, addressing, controls, duplicate probe)
    - `channel/lark.ts` (port signatures)
    - `locus/{context,admission,composition,lark-cli-egress-guard}.ts`
    - `locus/aggregate.ts` (endpoint key/normalize)
    - `locus/persistence.ts` (Delivery assertions/correlation)
    - `locus-history-tool.ts` (head)
    - `spec.ts` (domain version)
    - `migrate.ts`
    - `storage/backend.ts` (version gate)
    - `scripts/migrate-state-version.mjs`
    - `index.ts` (ChannelService wiring ~L3537–3560)
  - Reference: `/Users/prgrmrwy/corp/session-links/src/{core,lark}.ts` (comment paths), `docs/scenario.md` (comment lines)
  - lark-drive skill references for `+react-reply`/reactions (local, offline)
- **Verification limits**:
  - Spike E1–E7 could not be re-run.
  - Unverified:
    - whether `+subscribe` re-emits `Connected.` on internal reconnect, and how it behaves on SIGTERM / stdin EOF
    - which `+react-reply` emoji keys are valid for bot identity
    - whether `+batch-query-comments` paginates reply lists
    - whether the v15 `petLocusRecord` schema accepts unknown fields
  - No `tasks.md` exists, so task-level gating was not reviewable.
  - The full 4k-line `persistence.ts` and 2.2k-line `locus-controller.ts` were not read; claims cite only the lines read.

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

## Findings

### 🔴 Critical (blocking)

**C1. The spec requires proof of "no remote connection", which the design concedes it may be unable to produce. Connections that appear after start are never detected.**
- Evidence:
  - The `pet-lark-channel` delta (`specs/pet-lark-channel/spec.md:9`) requires Host to prove there is no other event connection, "包括…远端连接", and otherwise SHALL NOT start.
  - D3 (`design.md:57-63`) says `--dry-run` cannot prove remote count. Its candidate 2 (`online_instance_cnt`) applies only "若其以可调用命令暴露" (Q2, `design.md:125`). The fallback is "至少实现 1；2 不可得时在诊断中如实写'仅检测本机'".
  - So either the channel can never prove the condition and must always be `down` (literal reading), or it ships with the exact silent-loss mode E3 measured (loose reading).
  - Separately, the design covers only the startup moment. E3 shows that a connection opened *after* Pet connects silently splits events on both sides — from another machine, another profile, or a developer running `+subscribe` by hand. Nothing in the spec or design detects that at runtime.
- Why it matters: this is the single most important safety claim of the transport migration ("群消息与评论都不丢；并存连接被检测并 fail closed", `design.md:25`). As written it is either unimplementable or false, and spec and design contradict each other on a security- and correctness-bearing invariant.
- Fix:
  1. Decide Q2 before approval. Either:
     - (a) cite an invocable remote check, or
     - (b) rewrite the spec to name exactly what is proven: other local profiles bound to the same appId that hold a bus or a `+subscribe`, detected via `event status` or a process/lock probe. Remote/cross-machine detection then becomes an explicitly disclosed limitation, with a scenario "无法检测远端连接时诊断写明仅检测本机".
  2. Add a requirement and scenario for runtime detection:
     - re-run the check on every reconnect and periodically;
     - treat `+subscribe` stderr SDK `not found handler` lines, or any lark-cli "another … connected" text, as a conflict signal → channel `down` with a conflict diagnostic.

**C2. The rollback plan is wrong. Rolling back after the v16 bump takes all of Pet down, not just doc entries.**
- Evidence:
  - `design.md:120`: "回退 package 版本即恢复 consume；…旧代码读取含 surface:'doc' 的行会因 schema 校验失败而跳过…不影响 IM 行".
  - The storage backend rejects any version mismatch at unit open (`storage/backend.ts:317-323`: `version-mismatch`, "a mismatch is a migration question rather than something to overwrite").
  - `scripts/migrate-state-version.mjs:2-11,36-39` documents that a stamp mismatch "silently aborts Pet initialization". It only restamps upward (`RESTAMPABLE = [2..14]`), and `migrate.ts:160` likewise refuses unknown versions.
  - So a v15 package against a v16-stamped medium fails `storageDomain.open`, and every Pet capability is lost, including all IM loci.
  - Second hole: D4 stores the doc token in `chatId` (`design.md:67`). If the v15 schema tolerates unknown fields (Q4, still open), doc rows would load as IM loci keyed by a token. Startup recovery and reconcile could then call IM APIs on them — reactions on `messageId = "c/r"`, chat reads.
- Why it matters: the change is labelled BREAKING and states a rollback path. That path is incorrect, and the failure is total. AGENTS.md requires migration and historical-format handling to be conservative and fail closed.
- Fix:
  - Replace Migration step 4 with a specified downgrade procedure:
    - (a) stop the Host;
    - (b) run an offline script — an extension of `migrate-state-version.mjs`, or a new `--downgrade-to 15` mode with backup — that quarantines every locus/delivery row with `surface:'doc'` into a side table (not deleted);
    - (c) restamp 16→15;
    - (d) re-upgrade restores the rows.
  - Add a scenario to the collaboration delta: "回滚后 IM locus 照常服务，文档行被隔离而非被当作 IM 行加载". Alternatively, change D4 per M3 so doc rows can never parse as IM rows.
  - Resolve Q4 now; it gates this decision.

### 🟡 Moderate

**M1. Wrong-direction risk: every IM user's ingress is moved to a hidden command, with no opt-in, and this was verified only on a throwaway app.**
- Evidence:
  - The migration is unconditional: `proposal.md:15` "BREAKING（运行时）入站传输迁移"; `pet-lark-channel` delta `:5` "恰好一个 `event +subscribe`".
  - All spike rows come from the test app `cameo`, not the production dsh-pet app (`design.md:7`).
  - The minimum supported lark-cli is still 1.0.93 (`service.ts:320,370,519`), while `+subscribe` behavior is evidenced only on 1.0.97.
  - Nothing specifies what happens when the app console has not enabled `drive.notice.comment_add_v1` or lacks drive/docx scopes. Does `+subscribe` with that event type fail? Do IM events still flow? The current "Channel onboarding" requirement (`current pet-lark-channel spec:394`) requires subscription/scope errors to surface in settings, and the delta does not extend it to the new event or scopes.
  - D1 does not list or reject a cheaper alternative: keep `event consume` as the default transport and switch to the single `+subscribe` only when the owner explicitly enables "文档评论入口".
- Fix:
  - Add an explicit, default-off `docComments` setting: transport is `consume` when off and the single `+subscribe` when on.
  - Add a requirement that enabling it verifies:
    - lark-cli version ≥ the verified `+subscribe` minimum (state it, e.g. 1.0.97);
    - the `+subscribe --help` probe the design already proposes;
    - doc and drive scopes.
  - Add scenarios for "事件未在后台开通/缺权限" and "版本过低".
  - This also shrinks C2, because users who never enable the feature never get v16 doc rows.

**M2. Migration ordering ignores the bus's ~30 s linger. Combined with a terminal `down`, the first restart after upgrade either stalls or splits events.**
- Evidence:
  - `channel/subscription.ts:5-7` already states that the bus daemon "retires about thirty seconds after its last consumer leaves". This largely answers Q1 (`design.md:124`): yes, it holds the WebSocket for about 30 s.
  - On upgrade-restart, the old Host's consumer dies, the bus lingers, and the new Host starts within seconds. One of two things then happens:
    - D3 sees the bus → `down`. `service.ts:589-591` makes `down` terminal until an explicit user reconnect.
    - D3 misses it → `+subscribe` connects next to the bus. E3 shows `+subscribe` does not refuse, so events are silently split for up to about 30 s.
  - `ChannelSubscription.stop()` sends SIGTERM and returns immediately without awaiting exit (`subscription.ts:108-116`), yet the design says "先 SIGTERM 旧 consume 并等待退出" (`design.md:109`).
  - Also unverified:
    - `+subscribe`'s stdin-EOF and SIGTERM cleanup behavior (pitfalls §2);
    - an orphaned `+subscribe` from a crashed Host would keep the connection and the single-instance lock, so every new start would fail with "another instance".
- Fix:
  - Specify a bounded wait-and-retry for a lingering consumer-less bus: poll `event status` until the bus disappears, up to N seconds, before declaring `down`.
  - Make stop await child exit.
  - Specify orphan handling: detect a stale lock owned by a dead parent, and give a diagnostic naming the PID/command.
  - Add scenarios: "升级重启时旧 bus 尚在宽限期" and "孤儿 `+subscribe` 持有单实例锁".

**M3. Reusing `chatId` does not give disjoint key spaces, because every normalizer and key path drops `surface` (pitfalls §11).**
- Evidence:
  - D4 claims hierarchy logic is "零改动" and the key is `doc:docx:<token>` (`design.md:67-70`).
  - Existing code builds keys from `{chatId, threadId}` and discards every other field:
    - `normalizeLocusEndpoint` / `normalizeWithoutKey` return `{chatId}` or `{chatId, threadId}` only (`aggregate.ts:249-250, 312`);
    - `endpointKeyOf` / `endpointFromKey` (`aggregate.ts:268-291`); `persistence.ts:3937`;
    - `admission.ts` `locusEndpointKey(chatId, threadId)` (`:325-327`);
    - `createDurableLocusAuthorizationResolver` looks up `{chatId, threadId}` (`admission.ts:186-189, 206`);
    - `deliveryCorrelates` compares only `chatId`/`threadId` (`persistence.ts:4190-4200`);
    - the controller endpoint rebuilds (`locus-controller.ts:1931-1940, 1973`).
  - Any of these silently turns a doc endpoint into an IM endpoint with `chatId = <token>`, so the delta's own scenario "跨 surface 标识不串键" (`specs/pet-locus-collaboration/spec.md:24-27`) would fail. D9's compile-time guard does not help, because the normalizers return the IM shape, which is legal.
  - The durable duplicate probe is keyed by `messageId` alone (`locus-controller.ts:1332-1350`, `index.ts:2925`). D5's doc `messageId = ${commentId}/${replyId}` omits the token, so it does not match the spec's dedup key `(file_token, comment_id, reply_id)` (`specs/pet-locus-doc-comments/spec.md:52`).
- Fix — choose one and state it:
  - (a) Store the **prefixed** value in the `chatId` field itself (`chatId = "doc:docx:<token>"`, `threadId = <comment_id>`). Every existing chatId-keyed path, index and resolver is then disjoint by construction, and IM calls given such a value fail at the platform instead of resolving a real chat. The raw token is derived by parsing the prefix, only inside the doc egress functions.
  - (b) Keep the raw token, list every normalizer/key/correlation function as a task, and add a cross-layer regression test per pitfalls §11 rule 5.
- In either case:
  - set doc `messageId = doc:<token>/<comment_id>/<reply_id>`;
  - update `assertDeliveryRecord` (`persistence.ts:4089-4098, 4130, 4180-4186`). It currently requires `replyTarget.chatId`, `messageId` and `feedbackTarget.chatId`, and would throw on D5's doc variant.

**M4. The normalizer fidelity plan cannot be achieved as written, and the field mapping is incomplete.**
- Evidence:
  - D2 (`design.md:51`) makes "与 consume 对同一消息的输出逐字段相等" the acceptance criterion and sources paired fixtures from "E3 期间同一消息在两侧的真实输出". But E3 proves each message lands on **exactly one** side (cluster mode, `design.md:13`), so no paired capture of the same message exists.
  - Q3 (`post` rendering) remains open.
  - The mapping lifts `message.*` to the top level, but `LarkInboundEvent` and the controller read `reply_to` (`event.ts:25`; `locus-controller.ts:704, 760`), whereas raw v2 `message` carries `parent_id`. Without an explicit `parent_id → reply_to` mapping, `replyToMessageId` is silently lost: the prompt says "没有明确 reply 关联" (`context.ts:382-384`) and intent-triage clarification behaves differently.
  - The channel delta scenario (`specs/pet-lark-channel/spec.md:25-28`) lists fields but omits `reply_to`, `root_id`, `thread_id`, `create_time`, `message_type` and `sender_type`.
  - Neither `@_all` nor unknown `@_user_N` keys are specified.
- Fix:
  - Write a full field table (raw path → consumer field) covering every field read by `event.ts`, `admission.ts`, `locus-controller.ts:713-763` and `pairing`.
  - Source fixtures by sending distinct messages through each transport separately, or take them from lark-cli's own rendering code at a pinned version.
  - Add scenarios for:
    - a quoted reply (`parent_id`);
    - a topic message (`thread_id` + `root_id`);
    - a `post` with an image and a link;
    - `@_all`;
    - an unknown mention key (keep the raw placeholder; never guess).

**M5. The watermark can move forward on internal reconnects and silently drop redelivered events.**
- Evidence:
  - `subscription.ts:175-181` sets `readyAt = Date.now()` on **every** stderr chunk that contains the marker.
  - D1 (`design.md:39`) switches the marker to `Connected.`. If `+subscribe`'s SDK prints `Connected.` again after an internal WebSocket reconnect (unverified), every event redelivered after that point fails `before-watermark` (`admission.ts:582-585`).
  - Comment events are affected the same way, since the spec applies the "订阅启动水位" to them (`specs/pet-locus-doc-comments/spec.md:50`).
- Fix:
  - Latch `readyAt` once per spawned process and ignore later markers from the same child.
  - Add the scenario "同一订阅进程内部重连后重推的事件不被水位丢弃".

**M6. Isomorphism holes: IM-only consumers are not scoped out for the doc surface, nor given doc analogues.**
- Evidence — each item below runs per Delivery today, keyed on `chatId`/`messageId`:
  - **Media**: `media.ts:389-392` runs `im +messages-mget --message-ids <messageId>` on the current Delivery; for a doc, `messageId` is `c/r`.
  - **Readability probe and prompt** (in-flight `pet-locus-feishu-read-and-delivery-fixes`):
    - the probe measures "当前入口历史消息";
    - the shell-tier prompt says "以 bot 身份读取当前入口的群消息；当前 chat_id：<token>" (`context.ts:337, 408`);
    - the outbound-mention guidance ("群内 @ 人直接写 `@显示名`… Host 会渲染", `context.ts:396, 458`) is wrong for comments.
  - **Sender display name**: `withSenderName` resolves the name through chat members (`locus-controller.ts:1182-1193`). The current requirement (`current pet-lark-channel spec:276-280`) makes the display name a correctness requirement. A doc analogue is needed, such as a contact lookup or the comment's own user name.
  - **Outbound @ rendering**: the requirement (`current pet-locus-collaboration spec:600-644`) is chat-member based. The delta neither exempts docs nor defines a comment `person` element.
  - **`pet_locus_chat_history`**: it remains in `LOCUS_CALLER_BOUND_TOOLS` (`composition.ts:74`). The doc spec forbids the *doc* tool on IM children (`specs/pet-locus-doc-comments/spec.md:140, 157-160`), but never forbids the *chat* tool on doc children, which would call IM reads with a token. That violates the in-flight rule "未装配的 caller-bound 能力不得以可见但必然失败的形式暴露".
  - **Intent-triage todos**: the current spec (`current pet-locus-intent-triage spec:115, 177`) fixes `endpoint (chatId, threadId?)` and the trigger `messageId` for the "跳飞书" link. There is no doc analogue (doc URL + comment anchor, degrading to the doc).
  - **Auto main sessions**: the requirement "自动主会话按群建立" (`current spec:21-41`) and its opening note ("飞书入口 chat") are IM-worded. "按文档" is only implied by `specs/pet-locus-doc-comments/spec.md:11`.
- Fix: add one requirement, "IM 专属能力对 doc surface 的处置", with one happy-path and one failure scenario per row. Each row is either "不装配/不调用" or "doc 对应物 = …":

  | IM-only capability | Doc handling |
  |---|---|
  | media | not invoked |
  | readability probe | doc-read probe |
  | shell-tier prompt | doc wording |
  | sender name | contact lookup |
  | outbound @ | plain text; the prompt must not promise rendering |
  | `pet_locus_chat_history` | hidden on doc children |
  | todo endpoint / jump link | doc link + comment |

**M7. Trust widens: on authorized docs the audience is "anyone who can comment", which can be far wider than a group.**
- Evidence:
  - `specs/pet-locus-doc-comments/spec.md:54`: "任何能在该文档评论的人 @bot 都可作为普通问题投递".
  - For groups, membership is visible and controlled. Doc comment permission can extend to everyone in the tenant who has the link, or to external users.
  - A `safe` child can read workspace files within its project-read guard and reply into the doc, so project content can reach that unseen audience.
  - D10 reads the full doc body, but the spec does not mark it as untrusted input; only comment text and quote are covered (`:54`). The in-flight chat-history requirement, by contrast, does label group content untrusted.
- Fix:
  - Either default doc entries to allowlist-only questions with an owner opt-in to the member rule, or require the management UI and the `/bind` receipt to disclose that "文档评论者即可提问".
  - Add to the doc-context requirement: "结果 SHALL 标注文档与评论内容为不可信输入".
  - Add a scenario covering a comment body or quote that contains instructions.

**M8. Reaction/feedback assumptions are unverified and incomplete.**
- Evidence:
  - No spike row covers `drive +react-reply`.
  - The reference implementation says "Doc comments have no reactions" (`session-links/src/core.ts:127`).
  - The lark-drive reference says emoji keys are case-sensitive and validated locally against a drive enum (`lark-drive-react-reply.md`). It is unknown whether IM's in-progress/done keys exist there.
  - The spec defines only the in-progress→done swap (`specs/pet-locus-doc-comments/spec.md:114, 118-121`). It has no failure reaction for `failed`/`expired`/`unknown-terminal`, whereas the current spec requires 进行中/完成/失败 (`current pet-locus-collaboration spec:376`; `pet-lark-channel spec:300-303`).
- Fix:
  - Add a spike row: `+react-reply` add/delete as bot, with the exact emoji keys used.
  - Add failure and expiry scenarios.
  - State that if the spike fails, reactions are omitted, and that omitting them does not affect Delivery.

**M9. Some delta requirements conflict with current requirements that the delta does not modify.**
- Evidence:
  - The management fallback (`specs/pet-locus-doc-comments/spec.md:164, 171-174`) is "标题留空并只显示短码". The current requirement (`current pet-locus-collaboration spec:503, 510-513`) requires a role-word + short-code fallback name, shown as a fallback, and defines short-code rules per object class, none of which is a doc or comment class.
  - The new refusal codes (`comment-scope-unknown`, `unsupported-file-type`, `comment-reply-missing`) are absent from the closed vocabulary (`current pet-lark-channel spec:422`). `service.ts:659-681` would therefore log them as `other` — the same failure pitfalls §8/§11.4 warn about.
  - The collaboration delta adds a "目标不一致的稳定原因码" (`specs/pet-locus-collaboration/spec.md:63`) without adding it to the closed refusal list (`current spec:650`).
- Fix:
  - MODIFY the short-code requirement to add doc and comment classes, with the fallback name "文档 · <短码>".
  - MODIFY "未通过准入…可诊断" to add the doc codes, and update `SAFE_IGNORED` in tasks.
  - Name the target-mismatch code and add it to the capability refusal list.

### 📌 Suggestions

- **S1. Gold-plating: `im.chat.member.bot.added_v1` is folded in on a false premise.**
  - Production deliberately never starts that subscription (`index.ts:3546-3553`: "`botLifecycleInitializer` stays deliberately unset… the bot-added subscription itself is never started").
  - The current spec says bot-added creates nothing (`current spec:87`).
  - D1's "否则仍是两条连接" (`design.md:37`) is therefore false. Drop the event from `--event-types`, or keep it only with a stated consumer.
- **S2. The egress guard misses common forms.**
  - `LARK_API_WRITE` matches `api <verb> /im/v1/messages` but not `/open-apis/im/v1/messages` — the form the reference implementation actually uses (`lark-cli-egress-guard.ts:12` vs `session-links/src/lark.ts:132`). The bug already exists, and the new drive patterns would inherit it.
  - Also consider adding doc-body writes (`docs +update`, `docs +create`, drive delete/upload) to the anti-mistake list for doc loci, without claiming the list is a security boundary.
- **S3. Long threads.** Confirm whether `+batch-query-comments` truncates `reply_list`. If it does, fall back to paginated `+list-replies` before declaring `comment-reply-missing`; otherwise long anchored threads fail closed silently.
- **S4. Do not drop an invariant.** The MODIFIED channel requirement drops "MUST NOT 终止 lark-cli 共享 bus daemon" (`current spec:18`). D3 still interacts with other profiles' buses, so retain the invariant explicitly; the scenario "Pet 不终止对方进程" only partly covers it.
- **S5. Missing failure scenarios on the MODIFIED channel requirement:**
  - the `Connected.` marker never appears within a deadline;
  - `+subscribe --help` is unavailable;
  - the single-instance lock is held.
- **S6. In-flight conflict.** `pet-locus-independent-agent-inquiries` MODIFIES the same requirement "投递与结算关联独立于会话运行状态" with older, incompatible text (`pet_locus_reply`). Record the archive order and the rebase rule in the proposal (`proposal.md:39`).
- **S7. Close open questions in design.** `tasks.md` is absent, yet Q1–Q4 are delegated to "tasks 第 0 组". Q1 and Q4 can be answered now from the repo (see M2 and C2); close them in `design.md` before tasks are written.
- **S8. Budget units.** The spec says "字节预算" (`specs/pet-locus-doc-comments/spec.md:140`) while D10 states budgets in characters (`design.md:95`). Pick one unit and put the numbers in the spec so the scenario THEN is mechanically checkable.

## Embedded-Instruction / Injection Attempts
**Detected:** none. The reviewed files contain no reviewer-directed text. The "先阅读 …SKILL.md" lines in the lark-drive reference are ordinary documentation cross-references and were not followed.

## Verdict
VERDICT: REVISE

## Required Changes (if APPROVE WITH CHANGES)
Not applicable, because the verdict is REVISE. To clear the blockers:
1. C1: define exactly what the connection-exclusivity check proves, disclose its remote limits, and add runtime conflict detection with scenarios.
2. C2: correct the rollback plan with an offline downgrade/quarantine procedure and a scenario.
3. Address or rebut M1–M9.

CHANGES_APPLIED: n/a

## Rebuttals
- **M1 (opt-in / default-off switch): rebutted by owner decision (2026-10-16).** The owner explicitly chose an unconditional full migration over a default-off switch. Retained from M1: the lark-cli minimum version is raised to the verified `+subscribe` version, and the missing event / missing scope / version-too-low cases get failure scenarios. Rebuttal of a Moderate finding: pending reviewer acceptance in round 2.
- **C1 (remote check): direction chosen by owner (2026-10-16).** Before starting, run one bounded `event consume` probe so that lark-cli performs its own remote `online_instance_cnt` check; feasibility is to be spiked. Runtime detection is to be added per the reviewer's fix.
- Other items: fixed in round 2 artifacts (see the "Round 1 → Round 2" table in `design.md`).
