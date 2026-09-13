/**
 * Deterministic Pet-side effect fence for one inquiry turn (partial G4).
 *
 * WHY THIS EXISTS
 *
 * `openspec/changes/pet-locus-independent-agent-inquiries` design D6 requires
 * that an inquiry MUST NOT become an authorization to modify files, perform
 * external writes, change permissions/bindings, or have the target execute
 * work on the requester's behalf — and that the Host enforce that limit with
 * an EXECUTABLE restriction, not a prompt reminder.
 *
 * The reviewed runtime already offers a scoped monotonic `tools.guard()`, but
 * `test/inquiry-runtime-probe.test.ts` records two observed gaps. The one this
 * module answers directly:
 *
 *   CURRENT GAP: the guard is evaluated at PREPARATION. If a revocation lands
 *   while an async `tools/execute` wrapper is suspended, the runtime does NOT
 *   re-check the guard before `dispatchToolBody` runs — the body executes once
 *   anyway, and only the NEXT call is refused.
 *
 * So this fence deliberately does not trust a preparation-time decision. Its
 * whole point is `run()`: it re-validates immediately before invoking the body,
 * with NO `await` between the final check and the call. A decision returned by
 * `decide()` is an observation, never a bearer token.
 *
 * WHAT THIS MODULE IS NOT (do not overclaim G4)
 *
 * - It is not a sandbox. It constrains calls that are actually routed THROUGH
 *   it. Anything that reaches a tool by another path — a tool the dispatcher
 *   forgot to wrap, an ambient capability inside an already-running body, code
 *   the model causes to run elsewhere — is out of scope by construction.
 * - It cannot cancel work already inside a body. `close()` refuses later
 *   entries; it does not unwind an effect in flight. Cancellation needs a real
 *   runtime seam (abort signal propagation).
 * - It does not see the runtime's own tool registry, so "unknown tool" here
 *   means "not in the allowlist handed to this fence", which is exactly why it
 *   fails closed instead of inferring safety.
 * - The remaining G4 gap therefore still needs a runtime-side seam: dsh-tools
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
  /** The tool is not proven safe for an inquiry turn (unknown, effectful, delegating, or outbound). */
  | 'effect-not-permitted-in-inquiry-turn'
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
 * Tools that can never run in an inquiry turn, even if a caller lists them.
 *
 * This is a hard floor UNDER the allowlist, not a replacement for it: the
 * allowlist is still closed-by-default, so a tool absent from both is refused.
 * The floor exists so that a future dispatcher bug — a widened allowlist, a
 * config typo, an allowlist merged from somewhere less trusted — cannot turn an
 * inquiry into an execution channel.
 *
 * `pet_locus_reply` and `pet_collaboration_context_update` are listed because
 * they carry the TARGET's own authority: a reply would consume the target's
 * Feishu Delivery for someone else's question, and a public-record update would
 * let an inquiry mutate shared project facts.
 */
export const INQUIRY_FORBIDDEN_TOOLS: readonly string[] = Object.freeze([
  // Local filesystem / process effects.
  'apply_patch',
  'bash',
  'edit',
  'multi_edit',
  'notebook_edit',
  'shell',
  'write',
  // Outbound / network reach.
  'browser',
  'fetch',
  'image_generate',
  'video_generate',
  'web_fetch',
  'web_search',
  'x_search',
  // Delegation and cross-agent control: laundering an effect through another
  // agent is still the effect.
  'agent',
  'interrupt_agent',
  'ralph',
  'send_message',
  'subagent',
  'subagent_fork',
  'task',
  'workflow',
  // Target-authority Pet surfaces.
  'pet_collaboration_context_update',
  'pet_locus_reply',
])

const FORBIDDEN = new Set(INQUIRY_FORBIDDEN_TOOLS)

/**
 * Exactly the identifier shape we accept: lowercase letters/digits with single
 * underscores between segments. Anything else (whitespace, case variation,
 * dashes, empty) is refused rather than normalized, because normalizing is how
 * `Bash ` quietly becomes `bash`, and how a lookalike slips past the floor.
 */
const TOOL_NAME_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/

export interface InquiryEffectFenceOptions {
  /**
   * Tool names proven safe for an inquiry turn. Copied at construction; later
   * mutation of the caller's array has no effect. Everything absent from it is
   * refused, so an empty allowlist means "no tools at all".
   */
  readonly allow: Iterable<string>
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

export function createInquiryEffectFence(options: InquiryEffectFenceOptions): InquiryEffectFence {
  // Snapshot the allowlist, dropping names that could never be honoured anyway
  // so a misconfigured entry cannot look allowed at any later point.
  const allow = new Set<string>()
  for (const entry of options.allow) {
    if (typeof entry !== 'string') continue
    if (!TOOL_NAME_PATTERN.test(entry)) continue
    if (FORBIDDEN.has(entry)) continue
    allow.add(entry)
  }

  const isActive = options.isActive
  const settle = options.settle
  let closed = false

  /** The single source of truth for both boundaries; called fresh every time. */
  function validate(tool: InquiryEffectFenceTool): InquiryEffectDecision {
    if (closed) return refuse('inquiry-turn-closed')
    const name = readToolName(tool)
    if (name === undefined) return refuse('tool-reference-unusable')
    // Liveness is checked BEFORE the allowlist on purpose: once the turn is
    // revoked, every tool refuses identically, so the refusal cannot be used
    // to probe which tools the turn had been granted.
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
    if (FORBIDDEN.has(name)) return refuse('effect-not-permitted-in-inquiry-turn')
    // Closed by default: unknown and new tools land here.
    if (!allow.has(name)) return refuse('effect-not-permitted-in-inquiry-turn')
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
