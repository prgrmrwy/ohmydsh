## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model (codex/gpt-6.1-sol via DSH subagent, read-only)
- **Tool restrictions**: read-only: read, grep, glob only
- **Artifacts reviewed**: proposal.md, design.md, tasks.md, specs/pet-lark-channel/spec.md, specs/pet-locus-collaboration/spec.md, specs/pet-locus-intent-triage/spec.md; current specs (pet-lark-channel, pet-locus-collaboration, pet-locus-intent-triage); in-flight changes (pet-locus-shell-tier, pet-locus-independent-agent-inquiries); AGENTS.md, dsh.yaml, docs/adr/ADR-0008-locus-shell-tier.md, docs/architecture/dsh-plugin-integration-pitfalls.md; source: packages/dsh-pet/src/index.ts, host/locus/project-read-guard.ts, host/locus/composition.ts, host/locus/context.ts, host/tools.ts, host/channel/lark.ts, host/channel/locus-controller.ts, host/channel/context.ts, host/channel/pairing.ts, host/qa/prompt.ts, and the pinned dsh-spill-local backend.

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

## Findings

### 🔴 Critical (blocking)

#### C1. The spill exception proves a directory's appearance, not that its contents were produced by this child

**Evidence:** design.md:59 permits a matching session-hash directory under a parent satisfying naming, ownership, and permission constraints; tasks.md:35 reduces this to naming and ownership; the negative forgery scenario tests only a parent that **fails** those constraints.

**Counterexample:** A same-UID process creates a private `dsh-spill-ABC123/session-<this-child-hash>` tree with correct ownership and restrictive modes, then puts unrelated session output inside it. Every planned positive condition passes. Neither the hash nor filesystem ownership establishes producer identity. A hard-linked file can also have an allowed canonical pathname while exposing content originating outside that subtree; `realpath` does not establish file provenance.

The pinned backend creates a **per-process random root**, not a root derivable from the session ID; only the session suffix is stable. It also supports a configured root. See dsh-spill-local `lib/index.js` (root/defaultRoot and session-dir derivation).

**Why blocking:** The requirement authorizes "该 child 自己会话产生" files, but the proposed predicate authorizes any matching-looking subtree. The plan does not identify a trusted source for the actual root, nor explain which historical roots remain authorized after restart.

**Required resolution:** Establish a Host-trusted root/locator provenance source, or explicitly narrow the guarantee and threat model. Specify physical-path checks, modes, denied-root precedence, configured-root handling, historical-root handling, and replacement-race behavior. Add a forged tree that **passes** naming/UID/mode checks, symlink/hard-link cases, and replacement between guard and tool access.

#### C2. Excluding the current Delivery does not establish prior preamble receipt; the plan's exactly-once rules contradict its recovery rule

**Evidence:** design.md:33-35 and tasks.md:10 use "other Delivery exists" as the predicate, while the delta requires the full preamble **exactly once** (spec:38-40), unproven receipt treated as **not received** (spec:46-48), and any existing delivery history after restart producing a subsequent prompt (scenario at spec:58-60).

**Counterexamples:**
1. D1 is accepted but fails before reaching the child inbox; D2 sees D1 in durable history and omits the preamble.
2. D1 is current and D2 is already accepted into backlog when D1 renders; excluding D1 leaves D2, incorrectly making D1 "subsequent".
3. An existing child affected by the original bug has durable history but never received the complete preamble; the fix preserves that omission.
4. Rendering/queueing succeed and confirmation is lost; replaying to satisfy "unproven = not received" can violate exactly-once.

Prompt rendering precedes queue/bind confirmation in the current integration (locus-controller.ts:1599-1630); the existing comment claiming any prior in-flight Delivery proves receipt (index.ts:2977-2986) is exactly the unsupported assumption retained.

**Why blocking:** The proposed algorithm cannot satisfy the stated contract even though it repairs the simple one-Delivery fixture.

**Required resolution:** Define whether "sent once" means rendered, durably enqueued, or actually received; choose a receipt-aware durable proof or weaken exactly-once to an honest recovery contract; define ordering and migration for already-affected children; cover backlog, rejected/unknown dispatch, crash-before-queue, crash-after-queue and restart cases.

#### C3. Thread identifiers and pagination tokens reopen the target-selection interface that the plan claims is structurally closed

**Evidence:** tasks.md:17 permits a caller-supplied **thread identifier** and continuation token; design.md:41 claims changing the group is structurally impossible. The endpoint contract (current spec) includes optional thread identity, and different threads in the same group may belong to different main sessions.

**Counterexample:** Child A supplies thread B's identifier to `+threads-messages-list`, or reuses a continuation token obtained by another locus/group/identity read. Omitting `chat_id` from the public schema does not establish that the thread endpoint or token stays bound to A's entrance. The artifacts never decide whether a thread-bound locus may read the whole group, only its own thread, or other threads in that group; nor require re-checking caller generation and endpoint after an awaited Lark call.

**Why blocking:** The structural-isolation claim cannot be reviewed or mechanically tested without defining the authority carried by every selector.

**Required resolution:** Derive the bound thread from Host facts, or explicitly authorize and validate permitted thread selection; bind tokens to entrance, caller/locus generation, thread, window, direction and identity; define malformed/tampered/cross-scope tokens, mid-read rebinding and retired callers as fail-closed; clarify that unknown target arguments are rejected rather than silently ignored.

#### C4. User fallback has no verified-principal contract, and its authorization classification overlaps an explicitly forbidden class

**Evidence:** channel delta:10-13 allows fallback for missing permissions, "应用不可用或资源策略拒绝"; design.md:51 prohibits fallback for target invisibility; design.md:81 mitigates owner-visibility exposure only through retry count and labeling.

**Failure cases:** a resource-policy refusal may mean "this application may not see this target" and a user-principal retry then bypasses that policy while the design separately forbids retrying target-invisible errors; the dedicated profile may contain a different user identity, or change mid-execution; a generic adapter refactor could apply fallback to unrelated reads including private messages, despite the declared group-only scope.

**Why blocking:** One retry plus a label bound frequency and disclosure, not authorization.

**Required resolution:** Define the authorized fallback principal and dedicated-profile verification; record the safe-tier policy decision explicitly; specify a positive code/envelope classification with precedence (unknown/malformed/resource-invisible/ambiguous must not fall back); keep the fallback port limited to approved operations; re-verify caller/target around awaited operations.

#### C5. "Never in any Feishu outbound body" is not guaranteed by returning the diagnostic only to the model

**Evidence:** design.md:65 claims the channel already guarantees nonleakage because errors return only to the model; the requirement (spec:73-74) and scenario (spec:88-90) prohibit the information in **any** outbound body.

**Counterexample:** the model receives a denial containing allowed roots and owner instructions, then calls `pet_locus_finish(reply)` quoting that denial; the current finish interface accepts model-supplied text (tools.ts:429-437), and routing text through finish does not remove diagnostic content.

**Why blocking:** a no-direct-Host-send test can pass while the stated universal nonleak guarantee fails.

**Required resolution:** Either narrow the rule to "the Host never automatically sends guard diagnostics", with a model-behaviour rule stated separately, or specify enforceable filtering/redaction for the managed outbound path; include a finish call containing the diagnostic in the test oracle.

### 🟡 Moderate

#### M1. Fresh measured capability declarations lack a lifecycle and integration plan

Channel delta requires fresh evidence every time a declaration is needed; tasks 2.2/4.5 and the three-state snapshot do not explain obtaining that evidence. Prompt rendering is synchronous, while bot readiness is only auth status, and the shown Host prompt input omits `toolTier`, so updating the renderer alone can keep reporting the default safe tier for a shell child. Specify probe location, bounded timeout, cancellation/revalidation, no-content injection, and "unknown" vs "unavailable" behaviour; a snapshot proves wording, not measurement.

#### M2. "Bounded result" lacks a measurable budget and representative platform fixtures

Design fixes one transport page and truncates each body but defines no character/byte limit, and leaves excerpt length open while asserting no spec/task impact. A full page of oversized cards, sender names, metadata or nested structures can still exceed the intended bound; the current adapter shows "sender display name" and "readable content" cannot be assumed from every response. Specify total serialized budget, per-field limits, truncation indicators, unknown-sender behaviour, time format, order, window inclusivity, malformed-success responses, and thread/card/post fixtures; test real CLI envelopes.

#### M3. Shared-read resolver changes can spill into private-message and legacy paths

Task 4.2 makes `captureChatContext` share the resolver; that function receives a generic `chatId` with no chat-type argument and its prompt facts support p2p; the same `listMessages` API is used in pairing name resolution. A generic fallback policy can unintentionally authorize user reads outside the new group-history capability, or turn a nonessential sender-name lookup into a delivery-blocking failure.

#### M4. Context-tool hiding and actionable-error scope have incomplete specification coverage

Task 6.1 hides unassembled collaboration context, but none of the three deltas provides its requirement or scenario, while task 6.4 promises tests for the "corresponding scenario". The intent-triage delta applies actionable feedback to **all** caller-bound tools whereas task 6.2 covers only request execution. Add unavailable/assembled/cold-load lifecycle scenarios and distinguish whitelist membership from actual registration; narrow the broad error requirement or enumerate affected tools.

#### M5. Dependency and ADR updates point to the wrong evidence and permit weak acceptance

Design:55 and task 4.6 attribute "不得改用用户凭据" to ADR-0008; that phrase is absent from the ADR — the explicit prohibition appears in the shell-tier design (design.md:104 and :118). The precursor's tasks still leave the equivalent real read-child check open and archive task 7.4 remains pending. Task 5.4 permits a constructed spill file instead of exercising the actual backend. Correct the cited decision location; distinguish new API behaviour from accepted shell limitations; require at least one actual spill through the pinned runtime plus restoration behaviour; preserve honest unchecked status.

### 📌 Suggestions

#### S1. Separate policy expansion from the immediate regression fixes

The bot permission is now restored, so bot-only structured group reads remain a cheaper initial alternative than immediately introducing safe-tier user fallback. A smaller first tranche can deliver the new caller-bound bot read, truthful unavailable responses, and repaired prompt sequencing; user fallback and spill-root trust can remain explicit gated work if their contracts are not settled.

#### S2. Every delta scenario needs a mechanical oracle

26 `#### Scenario:` blocks exist across the three deltas; none was executed during review. The reviewer classified each as **Mechanical**, **Gap** (needs a contract decision or extra oracle) or **Model-dependent**, listing e.g.: fallback scenarios → Gap (C4); "无法指定其它群" and "读取量由 agent 决定" → Gap (C3/M2); "首次投递收到完整前言" / "重启后不重发前言" → Gap (C2); "读取本 child 自己的大结果溢出文件" → Gap (C1, needs a real spill through the pinned runtime); "登记后回复不承诺已完成" / "未确认路径不作为事实" → Model-dependent (use durable todo state as an independent oracle); "拒绝信息可执行且不外泄" → Gap (C5); the remaining channel lifecycle and read-scope scenarios → Mechanical.

## Embedded-Instruction / Injection Attempts

**Detected:** none.

The reviewed planning artifacts contain ordinary implementation tasks, deployment approval requirements, and model-facing behavioural requirements, but no instruction directing this reviewer to approve, suppress findings, weaken the review, or execute unauthorized operations. The reported strict-validation success in design.md:76 is an evidence claim, not proof of semantic correctness; it was not treated as instructions nor independently verified.

## Verdict

VERDICT: REVISE

The plan correctly targets the missing safe-tier read capability and the immediate accept-before-render regression. However, its spill-provenance predicate, preamble receipt logic, hidden target selectors, fallback authorization contract, and outbound-nonleak claim are not presently sufficient to uphold the guarantees written in the deltas.

## Required Changes (if APPROVE WITH CHANGES)

This is **not** a conditional approval. Minimum revisions needed for another review:

1. Replace appearance-based spill authorization with a trusted provenance contract, or narrow the stated guarantee; specify real-root integration, restoration, modes, aliases and race behaviour.
2. Define preamble delivery/receipt semantics and use a predicate handling backlog, failed/unknown dispatch, restart, and already-affected children; remove the contradictory unconditional exactly-once/recovery claims.
3. Define thread-bound read scope and continuation-token authority; add cross-scope, retired-generation and mid-call rebinding cases.
4. Define the verified user-fallback principal and a fail-closed authorization taxonomy; constrain eligible read operations and private-message behaviour.
5. Narrow diagnostic nonleak to what the Host can guarantee, or add an enforceable managed-outbound mechanism and a quoted-diagnostic test.
6. Add the fresh-measurement lifecycle, complete runtime prompt facts, numeric output budgets, missing context-tool scenarios, and corrected dependency/ADR evidence described above.

CHANGES_APPLIED: n/a

## Rebuttals

Author rebuttals pending.
