## Context

See `proposal.md` for motivation. Today `ChannelService` owns one supervised `ChannelSubscription`; it starts only after `config.enabled` and all formal Channel prerequisites are true. `InboundPipeline` rejects disabled channels and non-allowlisted senders before routing, while Settings can only write a caller-supplied `ou_...` list. The repository already serializes `updateChannelConfig()` calls within the Host process, and the event stream supplies the app-scoped sender `open_id` needed for authorization.

The design must preserve four existing boundaries: lark-cli exclusively owns credentials; `open_id` remains the admission authority; unauthorized ordinary messages stay silent; and only one unbounded `im.message.receive_v1` consumer is owned and supervised by Pet.

## Goals / Non-Goals

**Goals:**

- Let a Settings user mint a short-lived capability that authorizes exactly one single-chat sender.
- Support pairing before allowlist, default workspace, and formal Channel enablement are complete.
- Reuse the existing supervised consumer without weakening the ordinary intake pipeline.
- Make claim, persistence, UI state, and consumer teardown deterministic under concurrent events and page reloads.
- Keep the pairing secret ephemeral and absent from durable state and diagnostics.

**Non-Goals:**

- Prove that the paired sender is the browser operator; the code is a bearer capability and may deliberately be shared with another intended member.
- Search the organization directory, enumerate groups, or import/synchronize group membership.
- Persist or resume an in-flight pairing across Host restart.
- Route pairing through an Agent, Task, Invocation, workspace, or QA child.
- Replace manual `open_id` entry.

## Decisions

### D1: Model pairing as a Host-memory bearer-capability state machine

Add a dedicated pairing controller owned by `ChannelService`, with one state at a time:

```text
idle
  └─ start → starting
                 └─ consumer ready → waiting
                                         └─ exact match → claiming
                                                              ├─ stored → succeeded
                                                              └─ error  → failed
starting/waiting ─ cancel/replace/timeout/stop → idle|expired
```

The private state contains a generation/id, the eight-character code rendered as `xxxx-xxxx`, activation/expiry timestamps and an unreferenced expiry timer. Terminal public state may retain safe result fields long enough for Settings to render them, but it never exposes an old code after success, cancellation, expiry or failure. A new start generation-fences all callbacks and invalidates the previous state synchronously.

Use `randomBytes()` with a lowercase unambiguous 32-character alphabet, giving 40 bits for eight symbols. The code lives only in Host memory and the authenticated same-origin Settings response. It is never placed in SQLite, logs, errors, session events or task prompts.

**Alternatives considered:** Persisting a hashed code would survive restart but adds recovery and expiry semantics without user value; persisting plaintext would expand the secret surface. A user-directory lookup needs broader identity and permissions and does not solve external users. Host-memory state is the smallest fail-closed design.

### D2: One consumer, reconciled from two independent run reasons

Replace direct `subscription.start()` / `stop()` decisions with a reconciliation function:

```text
formalReason = config.enabled and formal prerequisites remain valid
pairingReason = pairing is starting, waiting or claiming
shouldRun = formalReason or pairingReason
```

There is still exactly one `ChannelSubscription`. Starting a pairing first verifies the bound app through the existing supported-version and `botIdentity(expectedAppId)` probes, but deliberately does not require an allowlist, default workspace or `config.enabled`. It then sets `starting`, reconciles the consumer on, and only changes to `waiting` after the ready marker. The five-minute validity window begins at that transition, so the UI never tells the user to send a code before intake is attached.

If the consumer is already connected for the formal Channel, pairing activates immediately and uses the pairing activation timestamp as its replay watermark. If pairing was the only run reason, completion/cancel/expiry/failure reconciles the consumer off via the subscription's existing SIGTERM path. Disabling the formal Channel no longer unconditionally stops the subscription when pairing still owns a run reason. `ChannelService.stop()` cancels pairing and stops the subscription unconditionally.

**Alternatives considered:** A second bounded or unbounded `event consume` process creates competing consumers and two cleanup/retry state machines. Temporarily setting `config.enabled=true` lies about onboarding and risks routing ordinary messages. Run-reason reconciliation keeps one process and leaves durable config truthful.

### D3: Dispatch pairing before, but outside, the ordinary pipeline

Change the subscription line callback into a small intake dispatcher:

```text
parse event once
  ├─ pairing controller consumes exact candidate → stop
  └─ otherwise existing InboundPipeline handles event unchanged
```

The pairing branch accepts only:

- `im.message.receive_v1` from `sender_type=user`;
- `chat_type=p2p` and `message_type=text`;
- a syntactically valid sender `ou_...`;
- an event at or after the active pairing watermark;
- text whose trimmed value exactly equals `/pair <current-code>`.

Everything else falls through to the existing pipeline. When the formal Channel is disabled, that pipeline reports the existing low-cardinality `disabled` reason and sends nothing. A group containing the correct code therefore cannot pair; an incorrect p2p code neither changes pairing state nor produces a reply. Pairing-specific diagnostics contain only low-cardinality state/reason labels.

The current pipeline's message dedup is not reused as the authorization lock. Pairing performs its own synchronous `waiting → claiming` compare-and-set before its first `await`; JavaScript run-to-completion makes only one concurrently delivered line the winner. Generation checks after every await fence cancellation, replacement and Host stop. Redelivery after `claiming` cannot authorize another sender.

**Alternatives considered:** Adding a special allowlist exemption to `admitInboundEvent()` would mix authorization bootstrap with business admission and could accidentally reach routing. A separate pre-dispatch branch makes the non-routing invariant structural.

### D4: Persist authorization before any success signal

The claim path calls the existing serialized `repository.updateChannelConfig()` and writes:

```text
allowOpenIds = unique(current.allowOpenIds + senderOpenId)
knownNames   = current cache plus a best-effort resolved sender name
```

The event `sender_id` is validated with the existing `PET_OPEN_ID_PATTERN`. Display-name lookup may use the trigger message through the existing bounded history helper; lookup failure does not fail authorization and never substitutes a name for the ID. The code is single-use even when the sender was already present; the update remains idempotent and produces a success result for that member.

Only after the durable update succeeds does the Host publish `succeeded` and send a fixed reply to the trigger message. A storage failure publishes `failed`, sends no success reply and requires an explicit new pairing attempt. This avoids ambiguous reuse after a partially observed failure.

**Alternatives considered:** Replying before storage lowers latency but can claim authorization that did not commit. Reopening the same code after failure complicates concurrent ownership and makes an observed secret reusable.

### D5: Expose pairing through the existing authenticated Channel management surface

Extend `PetChannelView` with a pairing projection such as:

```ts
pairing?:
  | { phase: 'starting' }
  | { phase: 'waiting'; command: string; expiresAt: number }
  | { phase: 'claiming'; expiresAt: number }
  | { phase: 'succeeded'; openId: string; name?: string }
  | { phase: 'expired' }
  | { phase: 'failed'; diagnostic: string }
```

Add strict `channelMutate` actions `pair-start` and `pair-cancel`; starting while another attempt exists replaces it atomically. No route accepts a caller-provided code, sender ID, expiry or terminal state. Existing same-origin authentication and exact route/body-key validation continue to protect the management plane.

Settings renders this state inside the allowlist group. It polls only while `starting`, `waiting` or `claiming`, using the same bounded/cancellable refresh pattern as binding/connection state. Countdown is derived locally from Host `expiresAt`, while every remount refetches Host truth. Clipboard failure is local UI feedback and does not alter pairing. Manual ID entry remains available under a secondary disclosure.

**Alternatives considered:** A new route family is unnecessary surface area; putting the code in React state would lose the only authority on reload and could not coordinate event claims.

### D6: Keep control-plane receipts as a narrow exception to Agent-owned replies

Pairing is not a business request. The Host sends one fixed success reply after commit. It may send a fixed expiry reply only when an event exactly matches the code that was current but expired during processing; implementations need not retain expired codes merely to support this optional receipt. Wrong codes, group attempts and ordinary messages remain silent. No model participates in any receipt.

This exception is encoded in the modified specification so it cannot later be generalized into system-side business replies.

## Risks / Trade-offs

- **[Bearer code can be forwarded]** → State plainly in Settings that whoever sends the code first becomes allowed; keep one active code, 40-bit entropy, five-minute validity and single-use atomic claim.
- **[Brute-force attempts hit the event stream]** → Wrong attempts are silent and state-preserving; the short window and 40-bit space make online guessing impractical without adding identity scopes or mutable lockout behavior.
- **[Page polling misses a fast transition]** → Host owns terminal state; every response returns the current projection, and bounded polling begins for all nonterminal phases.
- **[Consumer reconnect crosses pairing lifetime]** → Pairing keeps its own absolute expiry and generation; reconnect does not extend it, and a message older than the activation watermark cannot claim.
- **[Formal disable races with an active pairing]** → Subscription reconciliation computes both reasons after each mutation rather than issuing imperative stop calls from individual features.
- **[Success reply fails after authorization commits]** → Authorization remains committed and Settings shows success; reply failure is fail-soft and logged only as a safe category, never rolled back.
- **[Host-memory terminal state disappears on restart]** → Allowlist commit is durable; only presentation of the completed attempt is lost. In-flight attempts intentionally fail closed.

## Migration Plan

1. Add wire types and Host-only pairing controller without changing persisted schema.
2. Integrate run-reason reconciliation and pre-pipeline dispatch behind tests.
3. Add strict management actions and Settings UI.
4. Build/test the package, run repository checks, then `dsh build` twice for deployment idempotency.
5. Restart DSH and perform a real p2p acceptance test from generation through allowlist admission; verify no Task/Invocation/binding rows were created.

Rollback by disabling/removing the new UI/actions and restoring subscription reconciliation to formal enablement only. No data migration is needed: successfully paired members are ordinary allowlist entries and remain valid after rollback.
