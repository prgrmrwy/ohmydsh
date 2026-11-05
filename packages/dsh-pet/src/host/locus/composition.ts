/**
 * Composition of one unified locus child inside the Host runtime.
 *
 * A locus child is published only when its caller-bound surface and its file
 * policy are both established, so the first turn cannot run with the wrong
 * tools or a wider sandbox than the locus was granted. Both must therefore be
 * decided SYNCHRONOUSLY while the runtime is still creating the agent: at that
 * point a throw vetoes publication and rolls the agent back, whereas anything
 * installed later races the child's first turn.
 *
 * The runtime seams are injected as ports for the same reason as elsewhere in
 * this package: this module carries no Cordis, DSH, or Lark import, and a
 * missing port is an unavailable capability rather than a reason to publish a
 * half-composed child.
 */

import { LOCUS_WRITE_ENABLED } from './policy-verification.js'
import { LOCUS_BASE_PRESET, LOCUS_CHILD_PRESET } from './preset.js'

/** The composition marker a child must carry to be served (Host-attested). */
export const LOCUS_TIER3_COMPOSITION = 'tier3' as const

/** The permission a locus grants its child; `write` requires Host proof. */
export type LocusChildPermission = 'read' | 'write'

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

/** Tools added by the explicitly owner-granted shell tier. */
export const LOCUS_SHELL_TIER_TOOL_NAMES: readonly string[] = Object.freeze([
  'bash',
  'skill',
])

/** Delegation/agent-control routes forbidden in every Locus tool tier. */
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

export type LocusToolTier = 'safe' | 'shell'

/**
 * Tools Pet registers into a Locus child's OWN scope.
 *
 * These are caller-bound: each resolves its caller from the live child session
 * rather than from its arguments, so they are the only own-plane registrations a
 * safe child may expose. The list is the reviewed surface; adding a Pet tool to
 * a child scope means adding it here in the same change, and an omission
 * surfaces as a refused publication rather than a silent widening.
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
 * Attest the tool surface a child actually exposes.
 *
 * `LOCUS_SAFE_TOOL_FILTER` restricts the INHERITED plane only: a tool a scope
 * registers in its OWN layer stays visible and callable whatever the filter
 * allows, and `deny` cannot name it because the restriction is validated against
 * inherited names alone. Production met that limit once — the shipped standard
 * preset registers its `subagent` row per agent, so `subagent` survived the
 * filter and let the child delegate to a descendant that kept `bash` and
 * `lark-cli`.
 *
 * A filter cannot express this property, so publication reads what the child
 * really exposes and refuses to publish a `safe` tier child when the read disagrees. That
 * keeps the guarantee independent of which preset or registration style produced
 * the child, and it fails closed when the surface cannot be read.
 *
 * @param visible - Tool names read from the live child scope, or undefined when
 *   the runtime could not answer.
 * @returns whether the surface is exactly the reviewed one, and what escapes it.
 */
export function attestLocusComposition(
  visible: readonly string[] | undefined,
  tier: LocusToolTier = 'safe',
): LocusCompositionAttestation {
  if (visible === undefined) return { ok: false, reason: 'unreadable', leaks: [] }
  const tierTools = tier === 'shell' ? LOCUS_SHELL_TIER_TOOL_NAMES : []
  const allowed = new Set<string>([
    ...LOCUS_SAFE_TOOL_NAMES,
    ...tierTools,
    ...LOCUS_CALLER_BOUND_TOOLS,
  ])
  const leaks = [...new Set([...visible].filter(name => !allowed.has(name)))].sort()
  if (tier === 'shell' && !visible.includes('bash')) leaks.push('bash (required for shell tier)')
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

/** Registration of the caller-bound context tool on one child scope. */
export interface LocusScopedSurfacePort {
  /**
   * Install the locus-bound surface on the child's own scope.
   *
   * Synchronous by contract: the runtime is mid-creation, so a rejected
   * promise would arrive after publication and could not veto it.
   */
  install(agent: LocusCandidateAgent, composition: LocusChildComposition): void
  /** Apply or remove the per-agent shell-tier restriction layer on a live child. */
  setToolTier?(agent: LocusCandidateAgent, tier: LocusToolTier): void
  /** Install the per-agent Lark CLI write mistake-prevention guard. */
  installOutboundGuard?(agent: LocusCandidateAgent): void
  /**
   * Read the tool names this exact child can actually see and call.
   *
   * The tool filter restricts the INHERITED plane only, so a scope's own
   * registrations escape it — see {@link attestLocusComposition}. Callers must
   * read the child's own view, not an inherited one: reading without the child's
   * scope key reports the inherited surface and would hide exactly the
   * registrations this check exists to find.
   *
   * Optional so existing fakes keep compiling; absent means unread, and an
   * unread surface is refused rather than published.
   */
  visibleTools?(agent: LocusCandidateAgent): readonly string[] | undefined
}

/** Host file-policy operations for one child session. */
export interface LocusPolicyPort {
  /** Apply the locus permission to this exact child session. */
  apply(sessionId: string, permission: LocusChildPermission): void
  /**
   * Read back the policy the runtime actually resolved. The applied value is
   * a request; this is the effect, and only the effect may be reported as the
   * child's permission.
   */
  resolve(sessionId: string): LocusChildPermission | undefined
}

/** The durable locus facts a candidate child must match to be composed. */
export interface LocusChildComposition {
  readonly parentSessionId: string
  readonly childSessionId: string
  readonly locusId: string
  readonly generation: number
  /** Durable version read before applying a pending grant. */
  readonly revision?: number
  /** Host-verified permission of the locus generation (the EFFECTIVE value). */
  readonly permission: LocusChildPermission
  /**
   * A permission change recorded while the child was released and not yet
   * applied. Present only when it differs from {@link permission}; it is
   * applied and read back on this publication, and never served before then.
   */
  readonly pendingPermission?: LocusChildPermission
  /**
   * Host-attested composition marker. Only `tier3` exists; a missing marker
   * (no child was ever created) is never served.
   */
  readonly childComposition?: 'tier3'
  /** The tier the row was published with; missing is read as `safe`. */
  readonly toolTier?: { readonly desired: LocusToolTier; readonly effective: LocusToolTier }
  /**
   * The entry this child serves. Fresh children are composed synchronously
   * BEFORE their locus row is published, so a durable lookup by locusId finds
   * nothing yet; anything that depends on the entry kind (a document child
   * gets the doc read tool, an IM child the group history) must read it here.
   */
  readonly endpoint?: { readonly chatId: string; readonly threadId?: string }
}

/** Reverse lookup from a candidate session to its durable locus. */
export interface LocusCompositionLookup {
  /**
   * Resolve the composition for one candidate child session.
   *
   * Returning `undefined` means "not a locus child", which leaves ordinary
   * sessions untouched. Throwing means the lookup itself is unusable, and a
   * candidate that might be a locus child must then be refused rather than
   * published without its surface.
   */
  find(sessionId: string): LocusChildComposition | undefined
}

/** Why a candidate child could not be composed. */
export type LocusCompositionFailure =
  /** The row is not a `tier3` child: it belongs to the retired model and must not serve. */
  | 'legacy-composition'
  /** The locus main's preset cannot be read, so the child's composition is not proven. */
  | 'preset-unverified'
  /** The locus main, or the child itself, does not run its pinned preset. */
  | 'preset-mismatch'
  | 'surface-unavailable'
  | 'surface-failed'
  | 'surface-not-attested'
  | 'policy-unavailable'
  | 'policy-failed'
  | 'policy-not-verified'
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
 * How a change recorded while the child was released turned out when its
 * wake-up publication tried to apply it.
 */
export interface LocusPendingOutcome<T> {
  readonly requested: T
  /** What the child is actually composed with, after the attempt. */
  readonly effective: T
  /** True when `requested` verified and is now in force; false when it fell back. */
  readonly applied: boolean
  /** Why the request fell back; absent when applied. */
  readonly reason?: string
}

/** Pending changes this publication resolved; the caller persists and reports them. */
export interface LocusPendingResolution {
  readonly permission?: LocusPendingOutcome<LocusChildPermission>
  readonly toolTier?: LocusPendingOutcome<LocusToolTier>
}

/** Outcome of examining one candidate agent. */
export type LocusCompositionResult =
  /** Not a locus child; the caller leaves it alone. */
  | { readonly composed: false }
  /** Composed: the surface is installed and the policy is verified. */
  | {
    readonly composed: true
    readonly composition: LocusChildComposition
    readonly effectivePermission: LocusChildPermission
    /** Present only when a recorded pending change was resolved by this publication. */
    readonly pending?: LocusPendingResolution
  }

/** Ports one composer instance uses. */
export interface LocusCompositionPorts {
  readonly lookup: LocusCompositionLookup
  /**
   * The preset the child's parent (the locus main) is persisted with, read
   * synchronously from the live parent. A child composes from its parent's
   * preset on creation and on every cold resume, so a parent that is not on
   * the pinned preset makes the child's surface unreviewed.
   *
   * Required for a child to be served: absent means "cannot prove", and an
   * unproven composition is refused rather than published.
   */
  readonly parentPreset?: (parentSessionId: string) => string | undefined
  /**
   * The preset the child ITSELF is persisted with, read synchronously from the
   * live child.
   *
   * The child's tool ceiling is that preset (DSH 0.2.1 has no per-request tool
   * filter), and the runtime mounts it again from the persisted selection on
   * every cold resume. Reading it back on every publication is what proves a
   * resumed child kept the reviewed ceiling instead of joining its parent's.
   *
   * Required for a child to be served: absent means "cannot prove", and an
   * unproven composition is refused rather than published.
   */
  readonly childPreset?: (childSessionId: string) => string | undefined
  readonly surface?: LocusScopedSurfacePort
  readonly policy?: LocusPolicyPort
  /**
   * Whether a `write` grant is honoured at all (the global switch). Defaults to
   * {@link LOCUS_WRITE_ENABLED}; a pending write request is declined, not
   * attempted, while it is off.
   */
  readonly writeEnabled?: boolean
}

/**
 * Compose one candidate agent as a locus child, or leave it untouched.
 *
 * Call this from the runtime's synchronous agent-created boundary. It throws
 * {@link LocusCompositionError} when a session that IS a locus child cannot be
 * composed, so the runtime vetoes publication instead of starting a child
 * whose tools or file policy do not match its locus.
 * @param agent - the candidate the runtime is publishing.
 * @param ports - lookup plus the optional Host surface/policy seams.
 * @returns whether the agent was composed, and its verified permission.
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
    // An unusable lookup cannot prove this is an ordinary session, and
    // publishing a locus child without its surface is the failure this
    // boundary exists to prevent.
    throw new LocusCompositionError(
      'lookup-failed',
      `Unable to resolve locus composition for ${agent.id}`,
      { cause: error },
    )
  }
  if (composition === undefined) return { composed: false }
  if (composition.childSessionId !== agent.id) {
    throw new LocusCompositionError(
      'lookup-failed',
      `Locus lookup for ${agent.id} returned a different child identity`,
    )
  }

  // Only the current composition serves. A row with an older marker (or none)
  // belongs to the retired model: it must not be composed, adopted or resumed,
  // whatever surface it would have exposed.
  if (composition.childComposition !== LOCUS_TIER3_COMPOSITION) {
    throw new LocusCompositionError(
      'legacy-composition',
      `Locus child ${agent.id} is not a ${LOCUS_TIER3_COMPOSITION} composition and cannot be served`,
    )
  }

  // The child composes from its parent's preset, on creation and on every cold
  // resume. Prove that parent is the pinned one BEFORE any side effect, so a
  // failed proof leaves nothing to undo.
  verifyParentPreset(agent, composition, ports.parentPreset)
  verifyChildPreset(agent, ports.childPreset)

  // Policy first: the child must never observe a scope that outlives a failed
  // permission application, and the surface reports the permission it reads.
  const permissionOutcome = applyPolicy(agent, composition, ports.policy, ports.writeEnabled ?? LOCUS_WRITE_ENABLED)
  const effectivePermission = permissionOutcome.effective

  const surface = ports.surface
  if (surface === undefined) {
    throw new LocusCompositionError(
      'surface-unavailable',
      `Host exposes no scoped surface for locus child ${agent.id}`,
    )
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
  // The persistent filter is a wide, delegation-free base; the tier narrows it
  // by a restriction layer installed here, on every publication including cold
  // resume. A child without that layer would be wider than its tier, so the
  // layer and the outbound guard are both mandatory.
  if (surface.setToolTier === undefined) {
    throw new LocusCompositionError(
      'surface-not-attested',
      `Host cannot apply the ${composition.toolTier?.effective ?? 'safe'} tool tier to locus child ${agent.id}`,
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

  // The installed surface is a request; what the child can actually call is the
  // effect. The tool filter cannot remove an own-plane registration, and a
  // preset change can add one without touching this package, so each tier is
  // applied and then READ BACK, and a tier is served only if the readback
  // matches it. Refuse publication rather than publish an unproven claim.
  const effectiveTier = composition.toolTier?.effective ?? 'safe'
  const requestedTier = composition.toolTier?.desired ?? effectiveTier
  const attemptTier = (tier: LocusToolTier): string | undefined => {
    try {
      surface.setToolTier!(agent, tier)
    } catch (error) {
      return `could not apply the ${tier} tool tier (${error instanceof Error ? error.message : String(error)})`
    }
    let visible: readonly string[] | undefined
    try {
      visible = surface.visibleTools?.(agent)
    } catch (error) {
      return `could not read the tool surface (${error instanceof Error ? error.message : String(error)})`
    }
    const attestation = attestLocusComposition(visible, tier)
    if (attestation.ok) return undefined
    return attestation.reason === 'unreadable'
      ? 'no readable tool surface'
      : `tools outside the ${tier} composition: ${attestation.leaks.join(', ')}`
  }
  const refuseTier = (tier: LocusToolTier, problem: string, cause?: unknown): never => {
    throw new LocusCompositionError(
      'surface-not-attested',
      `Host could not attest the ${tier} tool tier for locus child ${agent.id}: ${problem}`,
      cause === undefined ? undefined : { cause },
    )
  }

  let tierOutcome: LocusPendingOutcome<LocusToolTier> | undefined
  if (requestedTier !== effectiveTier) {
    // A change recorded while the child was released: try it first, and on any
    // mismatch return to the tier it was already serving under — which must
    // verify in turn, or nothing is published.
    const problem = attemptTier(requestedTier)
    if (problem === undefined) {
      tierOutcome = { requested: requestedTier, effective: requestedTier, applied: true }
    } else {
      const fallback = attemptTier(effectiveTier)
      if (fallback !== undefined) refuseTier(effectiveTier, fallback)
      tierOutcome = { requested: requestedTier, effective: effectiveTier, applied: false, reason: problem }
    }
  } else {
    const problem = attemptTier(effectiveTier)
    if (problem !== undefined) refuseTier(effectiveTier, problem)
  }
  const pending: LocusPendingResolution = {
    ...(permissionOutcome.outcome === undefined ? {} : { permission: permissionOutcome.outcome }),
    ...(tierOutcome === undefined ? {} : { toolTier: tierOutcome }),
  }
  if (pending.permission !== undefined || pending.toolTier !== undefined) {
    return { composed: true, composition, effectivePermission, pending }
  }
  return { composed: true, composition, effectivePermission }
}

/** Prove the child's parent runs the pinned preset, or refuse. */
function verifyParentPreset(
  agent: LocusCandidateAgent,
  composition: LocusChildComposition,
  read: LocusCompositionPorts['parentPreset'],
): void {
  if (read === undefined) {
    throw new LocusCompositionError(
      'preset-unverified',
      `Host cannot read the preset of locus main ${composition.parentSessionId} for child ${agent.id}`,
    )
  }
  let preset: string | undefined
  try {
    preset = read(composition.parentSessionId)
  } catch (error) {
    throw new LocusCompositionError(
      'preset-unverified',
      `Could not read the preset of locus main ${composition.parentSessionId} for child ${agent.id}`,
      { cause: error },
    )
  }
  if (preset === undefined) {
    throw new LocusCompositionError(
      'preset-unverified',
      `Locus main ${composition.parentSessionId} reports no preset for child ${agent.id}`,
    )
  }
  if (preset !== LOCUS_BASE_PRESET) {
    throw new LocusCompositionError(
      'preset-mismatch',
      `Locus main ${composition.parentSessionId} runs preset ${preset}, not ${LOCUS_BASE_PRESET}`,
    )
  }
}

/** Prove the child runs its own pinned preset (its tool ceiling), or refuse. */
function verifyChildPreset(
  agent: LocusCandidateAgent,
  read: LocusCompositionPorts['childPreset'],
): void {
  if (read === undefined) {
    throw new LocusCompositionError(
      'preset-unverified',
      `Host cannot read the preset of locus child ${agent.id}`,
    )
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
    throw new LocusCompositionError(
      'preset-unverified',
      `Locus child ${agent.id} reports no preset`,
    )
  }
  if (preset !== LOCUS_CHILD_PRESET) {
    throw new LocusCompositionError(
      'preset-mismatch',
      `Locus child ${agent.id} runs preset ${preset}, not ${LOCUS_CHILD_PRESET}`,
    )
  }
}

/**
 * Apply and verify the locus permission for one child.
 *
 * The applied value is a request; the resolved value is the effect. A locus
 * granted `read` must not run on a scope the Host resolved as `write`, and a
 * locus granted `write` must not silently degrade to `read` either: both are
 * a mismatch between the durable grant and the actual sandbox.
 *
 * A change recorded while the child was released is tried first; when it does
 * not verify, the permission the child was already serving under is re-applied
 * and must verify instead, or the child is not published.
 */
function applyPolicy(
  agent: LocusCandidateAgent,
  composition: LocusChildComposition,
  policy: LocusPolicyPort | undefined,
  writeEnabled: boolean,
): { readonly effective: LocusChildPermission; readonly outcome?: LocusPendingOutcome<LocusChildPermission> } {
  if (policy === undefined) {
    throw new LocusCompositionError(
      'policy-unavailable',
      `Host exposes no file policy seam for locus child ${agent.id}`,
    )
  }
  const attempt = (permission: LocusChildPermission): LocusCompositionError | undefined => {
    try {
      policy.apply(agent.id, permission)
    } catch (error) {
      return new LocusCompositionError(
        'policy-failed',
        `Could not apply ${permission} policy to locus child ${agent.id}`,
        { cause: error },
      )
    }
    let resolved: LocusChildPermission | undefined
    try {
      resolved = policy.resolve(agent.id)
    } catch (error) {
      return new LocusCompositionError(
        'policy-failed',
        `Could not read back the resolved policy for locus child ${agent.id}`,
        { cause: error },
      )
    }
    if (resolved !== permission) {
      return new LocusCompositionError(
        'policy-not-verified',
        `Locus child ${agent.id} requires ${permission} but the Host resolved `
        + `${resolved ?? 'no policy'}`,
      )
    }
    return undefined
  }

  const priorEffective = !writeEnabled && composition.permission === 'write' ? 'read' : composition.permission
  const requested = composition.pendingPermission
  if (requested !== undefined && requested !== composition.permission) {
    // A write request is declined, not attempted, while the global switch is off.
    const problem = requested === 'write' && !writeEnabled
      ? new LocusCompositionError('policy-not-verified', 'write grants are disabled')
      : attempt(requested)
    if (problem === undefined) {
      return { effective: requested, outcome: { requested, effective: requested, applied: true } }
    }
    const fallback = attempt(priorEffective)
    if (fallback !== undefined) throw fallback
    return {
      effective: priorEffective,
      outcome: { requested, effective: priorEffective, applied: false, reason: problem.message },
    }
  }
  const problem = attempt(priorEffective)
  if (problem !== undefined) throw problem
  return { effective: priorEffective }
}
