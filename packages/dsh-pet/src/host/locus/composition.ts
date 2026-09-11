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

/** One agent the runtime is about to publish. */
export interface LocusCandidateAgent {
  readonly sessionId: string
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
  install(agent: LocusCandidateAgent): void
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
  if (typeof agent.sessionId !== 'string' || agent.sessionId.trim() === '') {
    return { composed: false }
  }

  let composition: LocusChildComposition | undefined
  try {
    composition = ports.lookup.find(agent.sessionId)
  } catch (error) {
    // An unusable lookup cannot prove this is an ordinary session, and
    // publishing a locus child without its surface is the failure this
    // boundary exists to prevent.
    throw new LocusCompositionError(
      'lookup-failed',
      `Unable to resolve locus composition for ${agent.sessionId}`,
      { cause: error },
    )
  }
  if (composition === undefined) return { composed: false }
  if (composition.childSessionId !== agent.sessionId) {
    throw new LocusCompositionError(
      'lookup-failed',
      `Locus lookup for ${agent.sessionId} returned a different child identity`,
    )
  }

  // Policy first: the child must never observe a scope that outlives a failed
  // permission application, and the surface reports the permission it reads.
  const effectivePermission = applyPolicy(agent, composition, ports.policy)

  const surface = ports.surface
  if (surface === undefined) {
    throw new LocusCompositionError(
      'surface-unavailable',
      `Host exposes no scoped surface for locus child ${agent.sessionId}`,
    )
  }
  try {
    surface.install(agent)
  } catch (error) {
    throw new LocusCompositionError(
      'surface-failed',
      `Could not install the caller-bound surface for locus child ${agent.sessionId}`,
      { cause: error },
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
      `Host exposes no file policy seam for locus child ${agent.sessionId}`,
    )
  }
  try {
    policy.apply(agent.sessionId, composition.permission)
  } catch (error) {
    throw new LocusCompositionError(
      'policy-failed',
      `Could not apply ${composition.permission} policy to locus child ${agent.sessionId}`,
      { cause: error },
    )
  }

  let resolved: LocusChildPermission | undefined
  try {
    resolved = policy.resolve(agent.sessionId)
  } catch (error) {
    throw new LocusCompositionError(
      'policy-failed',
      `Could not read back the resolved policy for locus child ${agent.sessionId}`,
      { cause: error },
    )
  }
  if (resolved !== composition.permission) {
    throw new LocusCompositionError(
      'policy-not-verified',
      `Locus child ${agent.sessionId} requires ${composition.permission} but the Host resolved `
      + `${resolved ?? 'no policy'}`,
    )
  }
  return resolved
}
