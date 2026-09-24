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
  'pet_collaboration_context',
  'pet_collaboration_context_update',
  'pet_collaborators',
  'pet_context',
  'pet_inquire',
  'pet_inquiry_answer',
  'pet_locus_finish',
  'pet_locus_ledger_read',
  'pet_locus_parent_lookup',
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
 * really exposes and refuses to publish `safe-v1` when the read disagrees. That
 * keeps the guarantee independent of which preset or registration style produced
 * the child, and it fails closed when the surface cannot be read.
 *
 * @param visible - Tool names read from the live child scope, or undefined when
 *   the runtime could not answer.
 * @returns whether the surface is exactly the reviewed one, and what escapes it.
 */
export function attestLocusComposition(
  visible: readonly string[] | undefined,
): LocusCompositionAttestation {
  if (visible === undefined) return { ok: false, reason: 'unreadable', leaks: [] }
  const allowed = new Set<string>([...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS])
  const leaks = [...new Set(visible)].filter(name => !allowed.has(name)).sort()
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
  /** Host-verified permission of the locus generation. */
  readonly permission: LocusChildPermission
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

/** Outcome of examining one candidate agent. */
export type LocusCompositionResult =
  /** Not a locus child; the caller leaves it alone. */
  | { readonly composed: false }
  /** Composed: the surface is installed and the policy is verified. */
  | {
    readonly composed: true
    readonly composition: LocusChildComposition
    readonly effectivePermission: LocusChildPermission
  }

/** Ports one composer instance uses. */
export interface LocusCompositionPorts {
  readonly lookup: LocusCompositionLookup
  readonly surface?: LocusScopedSurfacePort
  readonly policy?: LocusPolicyPort
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

  // Policy first: the child must never observe a scope that outlives a failed
  // permission application, and the surface reports the permission it reads.
  const effectivePermission = applyPolicy(agent, composition, ports.policy)

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

  // The installed surface is a request; what the child can actually call is the
  // effect. `safe-v1` claims the child cannot reach an execution or delegation
  // route, and only this read can support that claim: the tool filter cannot
  // remove an own-plane registration, and a preset change can add one without
  // touching this package. Refuse publication rather than publish the claim.
  let visible: readonly string[] | undefined
  try {
    visible = surface.visibleTools?.(agent)
  } catch (error) {
    throw new LocusCompositionError(
      'surface-not-attested',
      `Could not read the tool surface of locus child ${agent.id}`,
      { cause: error },
    )
  }
  const attestation = attestLocusComposition(visible)
  if (!attestation.ok) {
    throw new LocusCompositionError(
      'surface-not-attested',
      attestation.reason === 'unreadable'
        ? `Locus child ${agent.id} exposes no readable tool surface`
        : `Locus child ${agent.id} exposes tools outside its safe composition: `
          + attestation.leaks.join(', '),
    )
  }

  return { composed: true, composition, effectivePermission }
}

/**
 * Apply and verify the locus permission for one child.
 *
 * The applied value is a request; the resolved value is the effect. A locus
 * granted `read` must not run on a scope the Host resolved as `write`, and a
 * locus granted `write` must not silently degrade to `read` either: both are
 * a mismatch between the durable grant and the actual sandbox.
 */
function applyPolicy(
  agent: LocusCandidateAgent,
  composition: LocusChildComposition,
  policy: LocusPolicyPort | undefined,
): LocusChildPermission {
  if (policy === undefined) {
    throw new LocusCompositionError(
      'policy-unavailable',
      `Host exposes no file policy seam for locus child ${agent.id}`,
    )
  }
  try {
    policy.apply(agent.id, composition.permission)
  } catch (error) {
    throw new LocusCompositionError(
      'policy-failed',
      `Could not apply ${composition.permission} policy to locus child ${agent.id}`,
      { cause: error },
    )
  }

  let resolved: LocusChildPermission | undefined
  try {
    resolved = policy.resolve(agent.id)
  } catch (error) {
    throw new LocusCompositionError(
      'policy-failed',
      `Could not read back the resolved policy for locus child ${agent.id}`,
      { cause: error },
    )
  }
  if (resolved !== composition.permission) {
    throw new LocusCompositionError(
      'policy-not-verified',
      `Locus child ${agent.id} requires ${composition.permission} but the Host resolved `
      + `${resolved ?? 'no policy'}`,
    )
  }
  return resolved
}
