/**
 * Composition of one unified locus child inside the Host runtime.
 *
 * A locus child is published only when its caller-bound surface and its
 * access mode are both established, so the first turn cannot run with the
 * wrong tools or a wider sandbox than its entry row says. Both must therefore
 * be decided SYNCHRONOUSLY while the runtime is still creating the agent: at
 * that point a throw vetoes publication and rolls the agent back, whereas
 * anything installed later races the child's first turn.
 *
 * v20 (design D8, D7, D11): the row carries ONE `accessMode`. This module
 * applies exactly that value and reads it back; there is no pending value, no
 * fallback to an older one and no persisted composition marker. The publish
 * itself is the only proof. A mismatch refuses publication (class B) and the
 * row is not rewritten; the caller stamps `verifiedAt` only after a composed
 * result (`recordAccessVerified`).
 *
 * The runtime seams are injected as ports for the same reason as elsewhere in
 * this package: this module carries no Cordis, DSH, or Lark import, and a
 * missing port is an unavailable capability rather than a reason to publish a
 * half-composed child.
 */

import type { LocusAccessModeV20 } from './contract-v20.js'
import { LOCUS_WRITE_DISABLED_DIAGNOSTIC, LOCUS_WRITE_ENABLED } from './policy-verification.js'
import { LOCUS_BASE_PRESET, LOCUS_CHILD_PRESET } from './preset.js'

/**
 * The inherited tools a Locus child may keep.
 *
 * Reviewed read-only set. `LOCUS_SAFE_TOOL_FILTER` is built from it, and
 * {@link attestLocusComposition} treats it as the inherited half of the
 * permitted surface.
 */
export const LOCUS_SAFE_TOOL_NAMES: readonly string[] = Object.freeze([
  'read',
  'read_image',
  'glob',
  'grep',
  'web_search',
])

/** Tools `danger-full-access` adds on top of `read-only` (D8). */
export const LOCUS_FULL_ACCESS_TOOL_NAMES: readonly string[] = Object.freeze([
  'bash',
  'skill',
])


/** Delegation/agent-control routes forbidden under every access mode. */
export const LOCUS_DELEGATION_DENYLIST: readonly string[] = Object.freeze([
  'subagent',
  'subagent_fork',
  'subagent_codex',
  'subagent_claude_code',
  'workflow',
  'ralph',
  'send_message',
  'list_agents',
  'job_output',
  'job_list',
  'job_kill',
])

/**
 * Tools Pet registers into a Locus child's OWN scope.
 *
 * These are caller-bound: each resolves its caller from the live child session
 * rather than from its arguments, so they are the only own-plane registrations a
 * child may expose. The list is the reviewed surface; adding a Pet tool to a
 * child scope means adding it here in the same change, and an omission surfaces
 * as a refused publication rather than a silent widening.
 */
export const LOCUS_CALLER_BOUND_TOOLS: readonly string[] = Object.freeze([
  'locus_ask_parent',
  'locus_context',
  'pet_context',
  'pet_locus_chat_history',
  'pet_locus_doc_context',
  'pet_locus_finish',
  'pet_locus_track',
  'pet_locus_wait',
])

/** Outcome of one composition attestation. */
export interface LocusCompositionAttestation {
  /** True when every visible tool is explained by the allowlist or by Pet. */
  readonly ok: boolean
  /** Why the surface was refused; absent when it passed. */
  readonly reason?: 'unreadable' | 'leaked'
  /** Visible tools that neither the allowlist nor Pet explains, sorted. */
  readonly leaks: readonly string[]
}

/**
 * Attest the tool surface a child actually exposes, for one access mode.
 *
 * `LOCUS_SAFE_TOOL_FILTER` restricts the INHERITED plane only: a tool a scope
 * registers in its OWN layer stays visible and callable whatever the filter
 * allows. Production met that limit once — the shipped standard preset
 * registers its `subagent` row per agent — so publication reads what the child
 * really exposes and refuses when the read disagrees, failing closed when the
 * surface cannot be read.
 *
 * @param visible - Tool names read from the live child scope, or undefined when unreadable.
 * @param mode - The access mode the surface must match.
 */
export function attestLocusComposition(
  visible: readonly string[] | undefined,
  mode: LocusAccessModeV20 = 'read-only',
): LocusCompositionAttestation {
  if (visible === undefined) return { ok: false, reason: 'unreadable', leaks: [] }
  const modeTools = mode === 'danger-full-access' ? LOCUS_FULL_ACCESS_TOOL_NAMES : []
  const allowed = new Set<string>([...LOCUS_SAFE_TOOL_NAMES, ...modeTools, ...LOCUS_CALLER_BOUND_TOOLS])
  const leaks = [...new Set([...visible].filter(name => !allowed.has(name)))]
  if (mode === 'danger-full-access' && !visible.includes('bash')) leaks.push('bash (required for danger-full-access)')
  for (const name of LOCUS_DELEGATION_DENYLIST) {
    if (visible.includes(name) && !leaks.includes(name)) leaks.push(name)
  }
  leaks.sort()
  return leaks.length === 0 ? { ok: true, leaks: [] } : { ok: false, reason: 'leaked', leaks }
}

/** One agent the runtime is about to publish. */
export interface LocusCandidateAgent {
  /** Target Agent exposes its durable identity as `id`, not `sessionId`. */
  readonly id: string
  /**
   * The agent's own scope. Services must be resolved from THIS object: a
   * registration made against the Host scope publishes globally instead of
   * being bound to the child.
   */
  readonly scope: LocusAgentScope
}

/** The agent-scoped service lookup used to register the caller-bound surface. */
export interface LocusAgentScope {
  /** Resolve one runtime service on this exact scope, or `undefined`. */
  get(service: string): unknown
}

/** Registration of the child's surface on its own scope. All synchronous by contract. */
export interface LocusScopedSurfacePort {
  /** Install the locus-bound caller-bound tools on the child's own scope. */
  install(agent: LocusCandidateAgent, composition: LocusChildComposition): void
  /**
   * Install the restriction layer of this access mode (`read-only` denies
   * {@link LOCUS_FULL_ACCESS_TOOL_NAMES}; `danger-full-access` installs none).
   * Requires the runtime's `tools.restrict`; throw when it is absent.
   */
  applyAccessMode?(agent: LocusCandidateAgent, mode: LocusAccessModeV20): void
  /** Install the per-agent Lark CLI write mistake-prevention guard. */
  installOutboundGuard?(agent: LocusCandidateAgent): void
  /**
   * Read the tool names this exact child can see and call, from the child's
   * own scope (an inherited read would hide own-plane registrations). Absent or
   * `undefined` means unread, and an unread surface is refused.
   */
  visibleTools?(agent: LocusCandidateAgent): readonly string[] | undefined
}

/** Host sandbox operations for one child session (`dsh-sandbox-policy`). */
export interface LocusPolicyPort {
  /** Apply the sandbox mode to this exact child session. */
  apply(sessionId: string, mode: LocusAccessModeV20): void
  /** Read back the mode the runtime actually resolved; only the effect counts. */
  resolve(sessionId: string): LocusAccessModeV20 | undefined
}

/** The durable row facts a candidate child must match to be composed (D15 lookup hit). */
export interface LocusChildComposition {
  /** The group row's M (a topic row has none of its own). */
  readonly locusMainSessionId: string
  /** The row's `sessionId`; must equal the candidate's id. */
  readonly sessionId: string
  readonly locusId: string
  /** The row revision read by the lookup; the fence for `recordAccessVerified`. */
  readonly revision: number
  /** The ONLY access value: applied and read back, never substituted. */
  readonly accessMode: LocusAccessModeV20
  /**
   * The entry this child serves. Fresh children are composed before their row
   * goes active, so anything that depends on the entry kind (a document child
   * gets the doc read tool, an IM child the group history) reads it here.
   */
  readonly endpoint: { readonly chatId: string; readonly threadId?: string }
}

/** Reverse lookup from a candidate session to its row (wired from the D15 lookup). */
export interface LocusCompositionLookup {
  /**
   * `undefined` means "not a locus child": ordinary sessions are untouched.
   * Throwing means the lookup is unusable; a candidate that might be a locus
   * child is then refused rather than published without its surface.
   */
  find(sessionId: string): LocusChildComposition | undefined
}

/** Why a candidate child could not be composed. */
export type LocusCompositionFailure =
  /** The lookup returned a different child identity (class A). */
  | 'identity-unproven'
  /** The locus main's preset is unreadable or not `locus-base`: M unavailable, not a composition failure. */
  | 'main-unavailable'
  /** The child's own preset cannot be read (class B). */
  | 'preset-unverified'
  /** The child does not run `locus-child` (class B). */
  | 'preset-mismatch'
  | 'surface-unavailable'
  | 'surface-failed'
  | 'surface-not-attested'
  | 'policy-unavailable'
  | 'policy-failed'
  | 'policy-not-verified'
  /** `danger-full-access` while `LOCUS_WRITE_ENABLED` is off (class B, row kept). */
  | 'write-disabled'
  | 'lookup-failed'

/** Composition error carrying the reason a child was not published. */
export class LocusCompositionError extends Error {
  override readonly name = 'LocusCompositionError'

  constructor(
    readonly reason: LocusCompositionFailure,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/**
 * How a refused publication is handled (D7 "组合失败两类").
 *
 * - `A` — child lost or identity unprovable: the caller marks the row `invalid`
 *   and the next authorized @ rebuilds it in place.
 * - `B` — any other compose / policy / readback / capability failure: refuse
 *   publication, settle the Delivery with the diagnostic, do NOT rewrite the
 *   row (a first creation rotates its reservation per D16 instead).
 * - `main-unavailable` — the locus main is not usable: whole-W migration, never
 *   a composition outcome.
 *
 * A "child lost" fact is observed before composition (the runtime has no such
 * agent); callers classify it as `A` themselves. Anything that is not a
 * {@link LocusCompositionError} is `B`.
 */
export type LocusCompositionFailureClass = 'A' | 'B' | 'main-unavailable'

export function classifyLocusCompositionFailure(error: unknown): LocusCompositionFailureClass {
  if (!(error instanceof LocusCompositionError)) return 'B'
  if (error.reason === 'identity-unproven') return 'A'
  if (error.reason === 'main-unavailable') return 'main-unavailable'
  return 'B'
}

/** Outcome of examining one candidate agent. */
export type LocusCompositionResult =
  /** Not a locus child; the caller leaves it alone. */
  | { readonly composed: false }
  /**
   * Composed with `accessMode` applied AND read back. The caller must still
   * `recordAccessVerified({locusId, revision}, accessMode, now)` before it
   * publishes; that write failing refuses publication too (class B).
   */
  | {
    readonly composed: true
    readonly composition: LocusChildComposition
    readonly accessMode: LocusAccessModeV20
  }

/** Ports one composer instance uses. */
export interface LocusCompositionPorts {
  readonly lookup: LocusCompositionLookup
  /**
   * The persisted preset of the locus main, read synchronously. Absent, unread
   * or not `locus-base` is "M unavailable" (D7), never served.
   */
  readonly parentPreset?: (locusMainSessionId: string) => string | undefined
  /**
   * The persisted preset of the child itself: its tool ceiling, remounted on
   * every cold resume. Required; absent means "cannot prove" (class B).
   */
  readonly childPreset?: (sessionId: string) => string | undefined
  readonly surface?: LocusScopedSurfacePort
  readonly policy?: LocusPolicyPort
  /** Defaults to {@link LOCUS_WRITE_ENABLED}; injectable only for tests. */
  readonly writeEnabled?: boolean
}

/**
 * Compose one candidate agent as a locus child, or leave it untouched.
 *
 * Call this from the runtime's synchronous agent-created boundary. It throws
 * {@link LocusCompositionError} when a session that IS a locus child cannot be
 * composed, so the runtime vetoes publication; see
 * {@link classifyLocusCompositionFailure} for what the caller does next.
 */
export function composeLocusChild(
  agent: LocusCandidateAgent,
  ports: LocusCompositionPorts,
): LocusCompositionResult {
  if (typeof agent.id !== 'string' || agent.id.trim() === '') {
    return { composed: false }
  }

  let composition: LocusChildComposition | undefined
  try {
    composition = ports.lookup.find(agent.id)
  } catch (error) {
    throw new LocusCompositionError(
      'lookup-failed',
      `Unable to resolve locus composition for ${agent.id}`,
      { cause: error },
    )
  }
  if (composition === undefined) return { composed: false }
  if (composition.sessionId !== agent.id) {
    throw new LocusCompositionError(
      'identity-unproven',
      `Locus lookup for ${agent.id} returned a different child identity`,
    )
  }

  // Proofs with no side effect first, so a failed proof leaves nothing to undo.
  verifyParentPreset(agent, composition, ports.parentPreset)
  verifyChildPreset(agent, ports.childPreset)
  const mode = composition.accessMode
  if (mode === 'danger-full-access' && !(ports.writeEnabled ?? LOCUS_WRITE_ENABLED)) {
    // Never demoted to read-only: the row keeps the owner's choice and the
    // child is simply not published (D8).
    throw new LocusCompositionError('write-disabled', LOCUS_WRITE_DISABLED_DIAGNOSTIC)
  }

  // Sandbox first: the child must never observe tools that outlive a failed
  // policy application.
  applyPolicy(agent, mode, ports.policy)

  const surface = ports.surface
  if (surface === undefined) {
    throw new LocusCompositionError('surface-unavailable', `Host exposes no scoped surface for locus child ${agent.id}`)
  }
  try {
    surface.install(agent, composition)
  } catch (error) {
    throw new LocusCompositionError(
      'surface-failed',
      `Could not install the caller-bound surface for locus child ${agent.id}`,
      { cause: error },
    )
  }
  // The persistent filter is a wide, delegation-free base; the access mode
  // narrows it by a restriction layer installed on every publication including
  // cold resume. A child without that layer would be wider than its row.
  if (surface.applyAccessMode === undefined) {
    throw new LocusCompositionError(
      'surface-not-attested',
      `Host cannot apply the ${mode} restriction layer to locus child ${agent.id}`,
    )
  }
  if (surface.installOutboundGuard === undefined) {
    throw new LocusCompositionError(
      'surface-not-attested',
      `Host cannot install the Lark CLI mistake-prevention guard for locus child ${agent.id}`,
    )
  }
  try {
    surface.installOutboundGuard(agent)
  } catch (error) {
    throw new LocusCompositionError(
      'surface-not-attested',
      `Host cannot install the Lark CLI mistake-prevention guard for locus child ${agent.id}`,
      { cause: error },
    )
  }
  try {
    surface.applyAccessMode(agent, mode)
  } catch (error) {
    throw new LocusCompositionError(
      'surface-not-attested',
      `Host could not apply the ${mode} restriction layer to locus child ${agent.id}`,
      { cause: error },
    )
  }
  // The installed layer is a request; what the child can call is the effect.
  let visible: readonly string[] | undefined
  try {
    visible = surface.visibleTools?.(agent)
  } catch (error) {
    throw new LocusCompositionError(
      'surface-not-attested',
      `Host could not read the tool surface of locus child ${agent.id}`,
      { cause: error },
    )
  }
  const attestation = attestLocusComposition(visible, mode)
  if (!attestation.ok) {
    throw new LocusCompositionError(
      'surface-not-attested',
      attestation.reason === 'unreadable'
        ? `Host could not attest the ${mode} surface of locus child ${agent.id}: no readable tool surface`
        : `Host could not attest the ${mode} surface of locus child ${agent.id}: tools outside it: ${attestation.leaks.join(', ')}`,
    )
  }
  return { composed: true, composition, accessMode: mode }
}

/** The locus main must run `locus-base`; anything else is "M unavailable" (D7). */
function verifyParentPreset(
  agent: LocusCandidateAgent,
  composition: LocusChildComposition,
  read: LocusCompositionPorts['parentPreset'],
): void {
  const main = composition.locusMainSessionId
  let preset: string | undefined
  try {
    preset = read?.(main)
  } catch (error) {
    throw new LocusCompositionError(
      'main-unavailable',
      `Could not read the preset of locus main ${main} for child ${agent.id}`,
      { cause: error },
    )
  }
  if (preset !== LOCUS_BASE_PRESET) {
    throw new LocusCompositionError(
      'main-unavailable',
      preset === undefined
        ? `Locus main ${main} reports no readable preset for child ${agent.id}`
        : `Locus main ${main} runs preset ${preset}, not ${LOCUS_BASE_PRESET}`,
    )
  }
}

/** The child must run its own pinned preset (its tool ceiling), or refuse (class B). */
function verifyChildPreset(
  agent: LocusCandidateAgent,
  read: LocusCompositionPorts['childPreset'],
): void {
  if (read === undefined) {
    throw new LocusCompositionError('preset-unverified', `Host cannot read the preset of locus child ${agent.id}`)
  }
  let preset: string | undefined
  try {
    preset = read(agent.id)
  } catch (error) {
    throw new LocusCompositionError(
      'preset-unverified',
      `Could not read the preset of locus child ${agent.id}`,
      { cause: error },
    )
  }
  if (preset === undefined) {
    throw new LocusCompositionError('preset-unverified', `Locus child ${agent.id} reports no preset`)
  }
  if (preset !== LOCUS_CHILD_PRESET) {
    throw new LocusCompositionError(
      'preset-mismatch',
      `Locus child ${agent.id} runs preset ${preset}, not ${LOCUS_CHILD_PRESET}`,
    )
  }
}

/**
 * Apply the row's access mode to the sandbox and read it back. Exactly that
 * value or nothing: no other mode is tried (D8 "不回退到旧值").
 */
function applyPolicy(
  agent: LocusCandidateAgent,
  mode: LocusAccessModeV20,
  policy: LocusPolicyPort | undefined,
): void {
  if (policy === undefined) {
    throw new LocusCompositionError('policy-unavailable', `Host exposes no sandbox policy seam for locus child ${agent.id}`)
  }
  try {
    policy.apply(agent.id, mode)
  } catch (error) {
    throw new LocusCompositionError(
      'policy-failed',
      `Could not apply the ${mode} sandbox to locus child ${agent.id}`,
      { cause: error },
    )
  }
  let resolved: LocusAccessModeV20 | undefined
  try {
    resolved = policy.resolve(agent.id)
  } catch (error) {
    throw new LocusCompositionError(
      'policy-failed',
      `Could not read back the sandbox of locus child ${agent.id}`,
      { cause: error },
    )
  }
  if (resolved !== mode) {
    throw new LocusCompositionError(
      'policy-not-verified',
      `宿主策略拒绝：入口要求 ${mode}，宿主回读为 ${resolved ?? '无策略'}；该子会话未发布，prompt 不能解除这一限制。`,
    )
  }
}
