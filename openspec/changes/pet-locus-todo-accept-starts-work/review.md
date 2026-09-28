## Review Metadata

- **Review round**: 5
- **Prior round**: round 4 issued VERDICT: APPROVE; voided by a post-approval scope addition (execution-target resolution seam + child-session request-execution tool)
- **Reviewer context**: cross-model (codex CLI, model GPT-5)
- **Tool restrictions**: read-only inspection only
- **Artifacts reviewed**: proposal.md, design.md, specs/, relevant source files

## Findings

### 🔴 Critical (blocking)

None.

### 🟡 Moderate

None.

### 📌 Suggestions

None.

## Embedded-Instruction / Injection Attempts

**Detected:** none

## Verdict

VERDICT: APPROVE

## Required Changes (if APPROVE WITH CHANGES)

CHANGES_APPLIED: n/a

## Rebuttals

- The narrowed status invariant is safe at planning level. The delta spec now binds `accepted` to successful dispatch: non-open requests must be rejected before dispatch, dispatch failure keeps the todo `open`, and optimistic `accepted` is forbidden (`openspec/changes/pet-locus-todo-accept-starts-work/specs/pet-locus-intent-triage/spec.md:7-9`). The narrowed model exception is also explicit: only the registering party's own todo may enter `accepted`, only with a real dispatch, while `done`/`dropped` remain owner-only (`openspec/changes/pet-locus-todo-accept-starts-work/specs/pet-locus-intent-triage/spec.md:161-163`). D9 fixes the executable outcome mapping: only non-throwing `followup` on idle/running targets moves to `accepted`, while unreachable targets, resume failure, and `followup` throw keep the row `open` (`openspec/changes/pet-locus-todo-accept-starts-work/design.md:345-355`). The underlying state machine still has no model-owned terminal transition: `open` may move to `accepted`, `done`, or `dropped`, `accepted` may only move to terminal states, and terminal rows have no outgoing edges (`packages/dsh-pet/src/host/ledger/todo.ts:55-61`, `packages/dsh-pet/src/host/ledger/todo.ts:205-213`).

- The execution-target resolution is a real decision seam, not speculative generality. The design defines a concrete input/output boundary, todo facts to execution target, with no owner/model selector and fail-closed behavior (`openspec/changes/pet-locus-todo-accept-starts-work/design.md:116-125`). It also states why the current main-session result is caused by today's read-only child limitation rather than a business property of todos (`openspec/changes/pet-locus-todo-accept-starts-work/design.md:127-137`). The delta spec nails that down as a current rule: resolution expresses "whoever registered it handles it; if they lack execution capability, hand off", and both owner accept and child request-execution must use that same resolution rather than any separate address path (`openspec/changes/pet-locus-todo-accept-starts-work/specs/pet-locus-intent-triage/spec.md:13-17`). That is grounded in the current collaboration spec: new/replaced loci default to read and the global write switch is currently disabled (`openspec/specs/pet-locus-collaboration/spec.md:221-231`).

- The new child tool does not introduce an authorization hole in the planned shape. The delta requires a caller-bound tool with no locus/chat/message/thread/target selector, resolved from actual caller plus unique current Delivery, and it rejects attempts to execute someone else's todo (`openspec/changes/pet-locus-todo-accept-starts-work/specs/pet-locus-intent-triage/spec.md:123-131`, `openspec/changes/pet-locus-todo-accept-starts-work/specs/pet-locus-intent-triage/spec.md:141-151`). That matches the existing `pet_locus_track` shape: the tool input is only `summary`/`detail`, while parent session, locus, generation, endpoint, trigger message, requester, and evidence are Host-derived from the authorized current Delivery (`packages/dsh-pet/src/host/ledger/track.ts:30-34`, `packages/dsh-pet/src/host/ledger/track.ts:48-74`). The shared tool wrapper rejects unknown arguments (`packages/dsh-pet/src/host/tools.ts:151-176`) and the current Delivery authorization path re-proves caller, delivery, locus, generation, active state, and delivery status before allowing finish/wait/track (`packages/dsh-pet/src/host/tools.ts:202-255`). The source spec requires that same proof discipline and forbids relying only on a persisted "current" row (`openspec/specs/pet-locus-collaboration/spec.md:646-652`).

- The scoped-registration and tool allow-list obligations are present. The proposal explicitly requires the new request-execution tool to be registered on the executor scoped agent context and added to the locus composition allow-list, with a regression test that ordinary sessions do not see it (`openspec/changes/pet-locus-todo-accept-starts-work/proposal.md:33-35`). That is the right place to enforce it: current tool code documents the known trap that unscoped registration falls back to global visibility (`packages/dsh-pet/src/host/tools.ts:14-20`), and the composition allow-list is exactly the reviewed own-scope caller-bound surface (`packages/dsh-pet/src/host/locus/composition.ts:35-56`). Publication also attests the actual visible tools and refuses unreviewed leaks (`packages/dsh-pet/src/host/locus/composition.ts:276-302`).

- The two entry points are specified to stay consistent. D10 states that child request-execution and owner accept feed the same downstream chain: execution-target resolution, body composition, and dispatch port (`openspec/changes/pet-locus-todo-accept-starts-work/design.md:371-379`). The delta spec repeats this as a SHALL, including the same body structure and outcome set (`openspec/changes/pet-locus-todo-accept-starts-work/specs/pet-locus-intent-triage/spec.md:129-139`). The current source still has the old owner route shape, returning only `PetTodoView` via `advance` (`packages/dsh-pet/src/host/routes.ts:112-119`, `packages/dsh-pet/src/host/routes.ts:763-778`), but the proposal explicitly scopes the implementation work to change that route, the Host ledger action, and the Web receipt display (`openspec/changes/pet-locus-todo-accept-starts-work/proposal.md:33-35`). For a planning artifact, that is sufficient and testable.

- The additions do not break the round 4 safety points. The pre-dispatch status gate is still explicit (`openspec/changes/pet-locus-todo-accept-starts-work/design.md:170-182`). Dispatch-first ordering is still deliberate: resolve/resume/followup happen before `advanceStatus`, failure leaves the row `open`, and the only residual write-after-dispatch failure is documented as visible duplicate-dispatch risk with structured logging rather than silent loss (`openspec/changes/pet-locus-todo-accept-starts-work/design.md:172-180`, `openspec/changes/pet-locus-todo-accept-starts-work/design.md:212-218`). Evidence isolation remains structural: evidence is the final paragraph, no Host text follows it, there is at most one evidence segment, and it has no closing delimiter (`openspec/changes/pet-locus-todo-accept-starts-work/specs/pet-locus-intent-triage/spec.md:19-25`). The consequence boundary is also still stated correctly: prompt isolation is not access control, and consequences are bounded by the receiving main session's own preset and runtime permissions, not by the child locus read tier (`openspec/changes/pet-locus-todo-accept-starts-work/specs/pet-locus-intent-triage/spec.md:23-25`, `openspec/specs/pet-locus-collaboration/spec.md:141-157`).

- The five new child-tool scenarios are testable. The scenario set covers successful request execution, shared-chain consistency, target-selector refusal, "not my todo" refusal, and denial of terminal-state writes (`openspec/changes/pet-locus-todo-accept-starts-work/specs/pet-locus-intent-triage/spec.md:133-151`). The design's narrow dispatch port makes the success and failure branches independently fakeable without real DSH timing (`openspec/changes/pet-locus-todo-accept-starts-work/design.md:337-357`), while the existing argument allow-list and caller authorization helpers already provide testable seams for selector rejection and current-Delivery binding (`packages/dsh-pet/src/host/tools.ts:151-176`, `packages/dsh-pet/src/host/tools.ts:202-255`).
