/**
 * Deterministic Pet-side effect fence for one inquiry turn (partial G4).
 *
 * WHAT THIS FENCE ENFORCES
 *
 * Two independent rules, both required, neither sufficient alone:
 *
 *  1. AN INQUIRY GRANTS NO NEW AUTHORITY. The inquiry turn runs with the
 *     target's own normal tool snapshot — its existing permission ceiling —
 *     and nothing else. The snapshot is supplied by the dispatcher; a name
 *     absent from it is refused. The fence never infers that an unlisted or
 *     newly registered tool is safe.
 *  2. AN INQUIRY MAY NOT TRANSFER IDENTITY OR COMMUNICATION AUTHORITY. A hard
 *     floor of names is refused even when the target legitimately holds them,
 *     because using them inside an inquiry turn would let the turn speak or
 *     act AS the target toward third parties, or re-shape who the target is.
 *
 * Rule 1 is the reason this is not an allowlist of "tools proven safe to
 * read". Deciding safety per tool was the earlier design and it was wrong: it
 * silently redefined what the target is allowed to do, and it made every new
 * plugin tool unavailable to ordinary work that had always been permitted.
 * The inquiry path should not widen the ceiling, and it should not narrow it
 * into a different product either.
 *
 * Rule 2 is narrow ON PURPOSE. `pet_collaboration_context_update` is NOT on
 * the floor: updating the shared public record is ordinary collaboration work
 * guarded by its own caller-bound membership check and revision CAS, and those
 * checks do not weaken just because the caller is answering a question.
 *
 * WHY `run()` RE-VALIDATES
 *
 * `test/inquiry-runtime-probe.test.ts` records the observed CURRENT GAP that
 * the reviewed runtime evaluates its scoped monotonic `tools.guard()` at
 * PREPARATION only: when a revocation lands while an async `tools/execute`
 * wrapper is suspended, the runtime does NOT re-check before the tool body
 * runs — the body executes once anyway and only the NEXT call is refused.
 *
 * So this fence never trusts a preparation-time decision. `run()` validates,
 * yields, then validates AGAIN with no suspension point before invoking the
 * body. A decision from `decide()` is an observation, never a bearer token.
 *
 * WHAT THIS MODULE IS NOT (do not overclaim G4)
 *
 * - It is not a sandbox. It constrains calls actually routed THROUGH it.
 *   Anything reaching a tool by another path — a tool the dispatcher forgot to
 *   wrap, an ambient capability inside an already-running body, code the model
 *   causes to run elsewhere — is out of scope by construction.
 * - It cannot cancel a body already running. `close()` refuses later entries;
 *   it does not unwind an effect in flight. That needs a runtime seam (abort
 *   signal propagation).
 * - It does not intersect the target's snapshot with the requester's ceiling,
 *   and it is not supposed to: under the approved semantics the target answers
 *   using its OWN normal permissions, and doing so is not a transfer of those
 *   permissions to the requester. What the spec forbids — an inquiry becoming
 *   an authorization for the target to carry out the requester's work — is
 *   held by rule 2 plus the inquiry protocol itself (purpose, audience and
 *   answer binding), not by shrinking the target's ceiling here.
 * - The floor lists surfaces that EXIST today plus the runtime's messaging and
 *   delegation tools. Pet exposes no model-facing permission/scope/binding
 *   mutation tool at present, so that part of rule 2 is carried by
 *   `alsoForbid`: a dispatcher adding such a surface must add its name there.
 *   A future tool nobody lists is governed only by rule 1.
 * - Content applicability — answering only what suits the stated purpose and
 *   audience — stays a model-behavior constraint. This fence does not inspect
 *   arguments or results and MUST NOT be described as an information-flow
 *   sandbox.
 * - The remaining G4 gap still needs a runtime-side seam: dsh-tools
 *   re-checking the monotonic guard after tool resolution and before
 *   `bodyInvoked`. Until a dispatcher wraps the real tools service with this
 *   fence AND that seam exists, G4 is not satisfied.
 *
 * CONSTRAINTS
 *
 * Pure module: no Cordis/DSH imports, no I/O, no timers, no global state. All
 * variability enters through injected seams so a later dispatcher can bind the
 * real caller/generation/segment validity without this file learning about it.
 */

/** Minimal shape a dispatcher must supply; intentionally not a DSH tool type. */
export interface InquiryEffectFenceTool {
  readonly name: string
}

/** Stable, machine-readable refusal codes. Never include caller data. */
export type InquiryEffectRefusalReason =
  /**
   * Rule 2: the name transfers identity or communication authority (outbound
   * Feishu delivery, cross-agent messaging, delegation, permission/binding
   * change). Refused even when the target itself holds the tool.
   */
  | 'authority-transfer-not-permitted-in-inquiry-turn'
  /**
   * Rule 1: the name is not part of the target's inherited tool snapshot, so
   * running it would grant authority the inquiry never had. Unknown and newly
   * registered tools land here — the fence never assumes they are safe.
   */
  | 'tool-outside-inherited-authority'
  /** The inquiry turn's authority was revoked or could not be proven while the call was in flight. */
  | 'inquiry-turn-revoked'
  /** The inquiry turn has ended; no further preparation or effect is permitted. */
  | 'inquiry-turn-closed'
  /** The tool reference itself was not a usable, exactly-normalized identifier. */
  | 'tool-reference-unusable'

export type InquiryEffectDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: InquiryEffectRefusalReason }

/**
 * The hard floor: names refused in an inquiry turn even when the target's own
 * snapshot contains them, because an inquiry must not become a way to speak or
 * act AS the target toward anyone else.
 *
 * This is deliberately NOT a list of effectful tools. File writes, shell and
 * network reach are governed by rule 1 (the inherited snapshot), because they
 * are ordinary work the target may already be permitted to do and an inquiry
 * neither widens nor narrows that.
 *
 * Absent on purpose: `pet_collaboration_context_update`. The shared public
 * record has its own caller-bound membership derivation and revision CAS; an
 * inquiry turn updating it is ordinary collaboration, not authority transfer.
 */
export const INQUIRY_FORBIDDEN_TOOLS: readonly string[] = Object.freeze([
  // Outbound delivery under the target's identity: an inquiry must never
  // consume the target's own Feishu Delivery to answer someone else.
  'pet_locus_finish',
  'pet_locus_wait',
  // Ordinary cross-agent messaging. The inquiry protocol is the only
  // sanctioned channel; native messaging would bypass its ledger, budget and
  // cycle checks, and produces no answer binding.
  'interrupt_agent',
  'send_message',
  // Delegation. Laundering work through another agent is still the work, and
  // it escapes this turn's fence entirely.
  'agent',
  'ralph',
  'subagent',
  'subagent_fork',
  'task',
  'workflow',
])

const STATIC_FLOOR: ReadonlySet<string> = new Set(INQUIRY_FORBIDDEN_TOOLS)

/**
 * Exactly the identifier shape we accept: lowercase letters/digits with single
 * underscores between segments. Anything else (whitespace, case variation,
 * dashes, empty) is refused rather than normalized, because normalizing is how
 * `Bash ` quietly becomes `bash`, and how a lookalike slips past the floor.
 */
const TOOL_NAME_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/

export interface InquiryEffectFenceOptions {
  /**
   * The target's NORMAL tool snapshot — its existing permission ceiling for
   * this turn. Copied at construction; later mutation of the caller's iterable
   * has no effect. A name absent from it is refused, so the fence never grants
   * authority the target did not already have, and never guesses about a tool
   * it has not been told exists.
   *
   * This is the target's own snapshot, NOT an intersection with the
   * requester's ceiling: the target answers with its normal permissions.
   */
  readonly inherited: Iterable<string>
  /**
   * Extra names to refuse alongside `INQUIRY_FORBIDDEN_TOOLS`. Pet currently
   * exposes no model-facing permission/scope/Locus binding or generation
   * mutation tool; when one is added, its name belongs here so the floor keeps
   * covering rule 2 without this module having to predict the name.
   */
  readonly alsoForbid?: Iterable<string>
  /**
   * Liveness of the inquiry turn's authority, consulted on EVERY decide and
   * TWICE per run (before and after the wrapper window). A dispatcher binds
   * the real check here: caller still the same child, locus generation
   * unchanged, segment still the active one. Throwing fails closed.
   * Defaults to always-active so the fence is usable without a Host.
   */
  readonly isActive?: () => boolean
  /**
   * Optional extra window the fence awaits before its final check, modelling
   * the runtime's suspendable async `tools/execute` wrapper. It is only a test
   * and composition seam: `run()` always yields once on its own, so the
   * re-validation guarantee does not depend on this being supplied.
   */
  readonly settle?: () => void | PromiseLike<void>
}

export interface InquiryEffectFence {
  /**
   * Preparation boundary. Reports whether the tool could run right now.
   * The answer is an observation with no lifetime: it does NOT authorize a
   * later `run()`, which re-validates from scratch.
   */
  decide(tool: InquiryEffectFenceTool): InquiryEffectDecision
  /**
   * Effect boundary. Validates, awaits the wrapper window, validates AGAIN
   * with no suspension point before the call, and only then invokes `body`.
   * Rejects with `InquiryEffectError` when refused; a body's own failure
   * propagates unchanged so a dispatcher can tell refusal from breakage.
   */
  run<T>(tool: InquiryEffectFenceTool, body: () => T | PromiseLike<T>): Promise<T>
  /**
   * End the inquiry turn. Idempotent and irreversible. Every later decide/run
   * refuses, including calls already suspended in their wrapper window — they
   * are stopped before their body. It does NOT unwind a body already running.
   */
  close(): void
}

/** Refusal raised at the effect boundary. Carries only the stable reason. */
export class InquiryEffectError extends Error {
  readonly reason: InquiryEffectRefusalReason
  /** The requested tool name, already validated as a bare identifier, or '' when unusable. */
  readonly toolName: string

  constructor(reason: InquiryEffectRefusalReason, toolName: string) {
    // The message is the code itself: no arguments, ids, paths or state.
    super(reason)
    this.reason = reason
    this.toolName = toolName
  }
}

// Set on the prototype so the only OWN enumerable properties are the two
// fields above: serializing this error can never widen what it discloses.
InquiryEffectError.prototype.name = 'InquiryEffectError'

/**
 * A single already-settled promise, awaited once per `run()` to guarantee the
 * body never starts in the caller's synchronous tick. Allocating nothing per
 * call keeps the hot path free of observable state.
 */
const NEXT_MICROTASK: Promise<void> = Promise.resolve()

const ALLOWED: InquiryEffectDecision = Object.freeze({ allowed: true })

const refuse = (reason: InquiryEffectRefusalReason): InquiryEffectDecision =>
  Object.freeze({ allowed: false, reason })

/** Accept only a bare, exactly-normalized identifier; never repair the input. */
function readToolName(tool: InquiryEffectFenceTool): string | undefined {
  if (typeof tool !== 'object' || tool === null) return undefined
  const { name } = tool as { name?: unknown }
  if (typeof name !== 'string') return undefined
  if (!TOOL_NAME_PATTERN.test(name)) return undefined
  return name
}

/** Snapshot a caller iterable, keeping only exactly-normalized identifiers. */
function snapshotNames(values: Iterable<string> | undefined): Set<string> {
  const names = new Set<string>()
  if (values === undefined) return names
  for (const value of values) {
    if (typeof value !== 'string') continue
    if (!TOOL_NAME_PATTERN.test(value)) continue
    names.add(value)
  }
  return names
}

export function createInquiryEffectFence(options: InquiryEffectFenceOptions): InquiryEffectFence {
  // Snapshot both inputs so a later mutation of the caller's arrays cannot
  // change what this turn is permitted to do.
  const inherited = snapshotNames(options.inherited)
  const extraFloor = snapshotNames(options.alsoForbid)

  const isActive = options.isActive
  const settle = options.settle
  let closed = false

  const forbidden = (name: string): boolean => STATIC_FLOOR.has(name) || extraFloor.has(name)

  /** The single source of truth for both boundaries; called fresh every time. */
  function validate(tool: InquiryEffectFenceTool): InquiryEffectDecision {
    if (closed) return refuse('inquiry-turn-closed')
    const name = readToolName(tool)
    if (name === undefined) return refuse('tool-reference-unusable')
    // Liveness is checked before the name rules so that a revoked turn refuses
    // identically for every tool: the refusal cannot be used to probe anything.
    if (isActive !== undefined) {
      let active: boolean
      try {
        active = isActive() === true
      } catch {
        // An identity/generation lookup that cannot answer is not permission.
        return refuse('inquiry-turn-revoked')
      }
      if (!active) return refuse('inquiry-turn-revoked')
    }
    // Rule 2 first: the floor holds even for a name the target legitimately
    // has, so a snapshot that includes it must not be able to override this.
    if (forbidden(name)) return refuse('authority-transfer-not-permitted-in-inquiry-turn')
    // Rule 1: no new authority. Unknown and newly registered tools land here.
    if (!inherited.has(name)) return refuse('tool-outside-inherited-authority')
    return ALLOWED
  }

  return {
    decide(tool) {
      return validate(tool)
    },

    async run<T>(tool: InquiryEffectFenceTool, body: () => T | PromiseLike<T>): Promise<T> {
      const name = readToolName(tool) ?? ''
      // 1. Preparation-equivalent check: refuse early, cheaply.
      const prepared = validate(tool)
      if (!prepared.allowed) throw new InquiryEffectError(prepared.reason, name)

      // 2. The suspendable window. A revocation or close() may land here; this
      //    is exactly the runtime window where the probe shows the body still
      //    runs today.
      //
      //    The unconditional yield is deliberate, not incidental: it means the
      //    body is never entered in the caller's own synchronous tick, so a
      //    revocation or close() issued anywhere in that tick — the realistic
      //    shape of "a decision was made while calls were in flight" — is
      //    always observed by the final check below. The optional `settle`
      //    seam models a longer wrapper window on top of it.
      await NEXT_MICROTASK
      if (settle !== undefined) await settle()

      // 3. Final check. Nothing between this line and the call may suspend —
      //    no await, no thenable, no scheduling. That is the whole guarantee.
      const final = validate(tool)
      if (!final.allowed) throw new InquiryEffectError(final.reason, name)
      return await body()
    },

    close() {
      closed = true
    },
  }
}
