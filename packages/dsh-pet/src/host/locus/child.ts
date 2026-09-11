/**
 * Generic DSH continuable-child adapter for unified locus execution.
 *
 * This module is deliberately storage- and product-model neutral.  It keeps
 * the small, measured seam used by the old QA path (resolve an exact live
 * parent, start a continuable child, and put a host-authored prompt into the
 * child's inbox) without importing QA, Task, Invocation, repository, or Lark
 * concerns.
 *
 * The DSH operations are ports.  A host composition may adapt its concrete
 * `ctx.agents`, `ctx.subagents`, symbol-keyed inbox, and lifecycle event to
 * these ports; a missing or throwing port is an unavailable operation, never a
 * reason for this adapter to guess, create a replacement identity, or notify a
 * parent.  In particular, a settlement event is an **activation lifecycle**
 * event for the child.  It is not a per-delivery completion signal.  Delivery
 * correlation belongs to the controller/channel layer and must be supplied
 * explicitly there.
 */

/** A live DSH Agent, intentionally opaque apart from its session identity. */
export interface LocusLiveParent {
  readonly session: { readonly id: string }
}

/** The parent registry/resume operations required by the adapter. */
export interface LocusParentPort {
  /** Return the resident Agent for an exact session id, if one is live. */
  get(sessionId: string): LocusLiveParent | undefined
  /** Resume persisted state and return its live Agent when possible. */
  resume(options: { readonly resumeSessionId: string; readonly signal?: AbortSignal }): Promise<
    { readonly agent?: LocusLiveParent } | undefined
  >
}

/** Text block shape accepted by the measured DSH child inbox seam. */
export interface LocusTextBlock {
  readonly type: 'text'
  readonly text: string
}

/**
 * Whether the Host runtime delivers a child's automatic settlement account to
 * its parent session. A locus child answers in its own Feishu entry, so the
 * runtime's account must not enter the main session's conversation; the owner
 * reads a locus child deliberately instead.
 */
export type LocusSettlementNotice = 'notify' | 'silent'

/** The continuable-child creation operation. */
export interface LocusSubagentPort {
  startContinuable(spec: {
    readonly provider: string
    readonly label: string
    readonly childId?: string
    readonly request: {
      readonly prompt: LocusTextBlock[]
      readonly parent: LocusLiveParent
    }
    /**
     * Requested automatic-settlement behavior. A Host runtime that does not
     * support it ignores the field, which is exactly why creation verifies the
     * capability separately rather than assuming suppression took effect.
     */
    readonly settlementNotice?: LocusSettlementNotice
    readonly signal: AbortSignal
  }): Promise<{ readonly childId: string; readonly messageId?: string }>
  /**
   * Create a durable continuable child without submitting an initial prompt.
   * The controller can therefore publish the active locus first, then queue
   * the first real Delivery through the ordinary inbox path.
   */
  createIdleContinuable?(spec: {
    readonly childId: string
    readonly provider: string
    readonly label: string
    readonly parent: LocusLiveParent
    readonly settlementNotice?: LocusSettlementNotice
    readonly signal: AbortSignal
  }): Promise<{ readonly childId: string }>
  /** Literal proof that idle creation is implemented by this runtime. */
  readonly supportsIdleContinuableCreate?: boolean
  /**
   * Whether this Host runtime honors `settlementNotice`. Absent means unknown,
   * and an unknown capability is treated as unsupported: a locus child must
   * not be established when its conclusions would be pushed into the main
   * session automatically.
   */
  readonly supportsSettlementNotice?: boolean
}

/** Source metadata for a host-authored inbox message. */
export interface LocusInboxSource {
  readonly kind: 'user'
}

/** The child inbox operation, already adapted away from symbol-keyed DSH APIs. */
export interface LocusInboxPort {
  queuePrompt(
    parent: LocusLiveParent,
    childId: string,
    prompt: readonly LocusTextBlock[],
    source: LocusInboxSource,
    signal: AbortSignal,
  ): Promise<string>
}

/** Context passed to a compensation operation. */
export interface LocusChildCompensationRequest {
  readonly parent: LocusLiveParent
  readonly childId: string
  readonly signal: AbortSignal
  /** Optional controller diagnostic; never interpreted as a routing value. */
  readonly reason?: string
}

/** Release an unpublished or otherwise abandoned child activation. */
export interface LocusChildCompensationPort {
  release(request: LocusChildCompensationRequest): Promise<void>
}

/**
 * Compatibility shape for a host adapter that exposes the measured DSH name.
 * It is accepted by {@link createLocusChildAdapter} but not required of
 * controller/channel callers.
 */
export interface LocusChildDrainPort {
  drainContinuableChildren(
    parent: LocusLiveParent,
    childIds: readonly string[],
  ): Promise<void>
}

/**
 * Proof port used when restoring a persisted child identity.
 *
 * A durable id alone is not enough: adoption must prove that the child still
 * exists and is a direct child of the exact parent.  Implementations should
 * return the host's observed identity, not merely echo the request.
 */
export interface LocusChildProofPort {
  findChild(
    parentSessionId: string,
    childSessionId: string,
    signal?: AbortSignal,
  ): Promise<LocusChildIdentity | undefined>
}

/** Raw activation-level child settlement emitted by an injected host port. */
export type LocusChildSettlementEvent =
  | { readonly childSessionId: string; readonly stopReason?: string }
  | { readonly id: string; readonly stopReason?: string }

/** Canonical activation-level settlement observed by adapter consumers. */
export interface LocusChildActivationSettlement {
  readonly identity: LocusChildIdentity
  readonly stopReason?: string
}

/**
 * Lifecycle subscription port.  The event names a child activation, not a
 * queued delivery.  A host may use either `onChildSettled` (the measured DSH
 * seam) or `subscribe` when adapting its event bus.
 */
export interface LocusChildSettlementPort {
  readonly onChildSettled?: (
    listener: (event: LocusChildSettlementEvent) => void,
  ) => () => void
  readonly subscribe?: (
    listener: (event: LocusChildSettlementEvent) => void,
  ) => () => void
}

/** All external operations used by one adapter instance. */
export interface LocusChildPorts {
  readonly parent: LocusParentPort
  readonly subagent: LocusSubagentPort
  /** Omit when this Host does not expose a child inbox; queue then fails closed. */
  readonly inbox?: LocusInboxPort
  readonly compensation?: LocusChildCompensationPort | LocusChildDrainPort
  /** Required for safe adoption; create/queue may still operate without it. */
  readonly proof?: LocusChildProofPort
  readonly settlement?: LocusChildSettlementPort
}

/** Optional host context shape used by {@link probeLocusChildPorts}. */
export interface LocusHostContextLike {
  get?(name: string): unknown
  on?(event: string, listener: (...args: unknown[]) => void): () => void
}

/** Why a host child seam could not be acquired. */
export type LocusChildProbeDiagnostic =
  | 'parent-service-unavailable'
  | 'subagent-service-unavailable'
  | 'inbox-unavailable'
  | 'settlement-events-unavailable'

/** Result of probing an optional host for the generic locus child seam. */
export type LocusChildPortsProbe =
  | { readonly available: true; readonly ports: LocusChildPorts }
  | { readonly available: false; readonly diagnostic: LocusChildProbeDiagnostic }

/** Stable child identity used to fence queue and compensation operations. */
export interface LocusChildIdentity {
  readonly parentSessionId: string
  readonly childSessionId: string
}

/** Active identity plus the exact live parent object required by DSH. */
export interface LocusActiveChild extends LocusChildIdentity {
  /** The latest exact live parent used for a DSH operation. */
  readonly parent: LocusLiveParent
}

export type LocusChildFailureReason =
  | 'invalid-parent-id'
  | 'parent-unavailable'
  | 'parent-operation-failed'
  | 'invalid-child-request'
  | 'active-child-conflict'
  | 'child-create-failed'
  | 'settlement-notice-unsupported'
  | 'idle-child-create-unsupported'
  | 'child-identity-invalid'
  | 'adapter-disposed'
  | 'aborted'
  | 'no-active-child'
  | 'child-identity-mismatch'
  | 'inbox-unavailable'
  | 'inbox-failed'
  | 'inbox-message-id-invalid'
  | 'compensation-unavailable'
  | 'compensation-failed'
  | 'child-not-found'
  | 'child-parent-mismatch'
  | 'child-proof-unavailable'
  | 'child-proof-failed'

/** A fail-closed diagnostic returned by an adapter operation. */
export interface LocusChildFailure {
  readonly ok: false
  readonly reason: LocusChildFailureReason
}

/** Result of resolving a parent without exposing host exceptions. */
export type LocusParentResolution =
  | { readonly ok: true; readonly parent: LocusLiveParent }
  | LocusChildFailure

/** Result of creating or reusing one child activation. */
export type LocusChildCreateResult =
  | {
      readonly ok: true
      readonly created: boolean
      readonly identity: LocusChildIdentity
    }
  | LocusChildFailure

/** Result of accepting one host-authored prompt into an active child inbox. */
export type LocusChildQueueResult =
  | { readonly ok: true; readonly messageId: string; readonly identity: LocusChildIdentity }
  | LocusChildFailure

/** Result of compensating one active child. */
export type LocusChildCompensationResult =
  | { readonly ok: true; readonly identity: LocusChildIdentity }
  | LocusChildFailure

/** Input used when adopting a durable child after a process/Agent restart. */
export interface LocusChildAdoptionInput {
  readonly parentSessionId: string
  readonly childSessionId: string
  readonly signal?: AbortSignal
}

/** Result of adopting a persisted child without creating a new child. */
export type LocusChildAdoptionResult =
  | { readonly ok: true; readonly adopted: boolean; readonly identity: LocusChildIdentity }
  | LocusChildFailure

const DEFAULT_CHILD_PROVIDER = 'fork'
const EMPTY_SIGNAL = new AbortController().signal

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false
}

/** Default provider used for the in-process continuable child backend. */
export const LOCUS_CHILD_PROVIDER = DEFAULT_CHILD_PROVIDER

/** Return whether an object has a usable non-empty identifier. */
function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function childRequestFingerprint(input: {
  readonly parentSessionId: string
  readonly label: string
  readonly prompt: string
  readonly provider?: string
  readonly childId?: string
}): string {
  return JSON.stringify([
    input.parentSessionId,
    input.label,
    input.prompt,
    input.provider ?? DEFAULT_CHILD_PROVIDER,
    input.childId ?? null,
  ])
}

/** Return whether a value can be used as a live Agent. */
function isLiveParent(value: unknown): value is LocusLiveParent {
  if (value === null || typeof value !== 'object') return false
  const session = (value as { session?: unknown }).session
  if (session === null || typeof session !== 'object') return false
  return isIdentifier((session as { id?: unknown }).id)
}

/** Compare identities exactly; no prefix matching is safe at this seam. */
export function sameLocusChildIdentity(
  left: LocusChildIdentity,
  right: LocusChildIdentity,
): boolean {
  return (
    left.parentSessionId === right.parentSessionId &&
    left.childSessionId === right.childSessionId
  )
}

/**
 * Resolve an exact live parent, resuming it only when it is not resident.
 *
 * The returned object is the exact object passed to `startContinuable` and
 * `queuePrompt`; an id alone is not a substitute because DSH checks lineage
 * against the live Agent object.  Host failures are intentionally collapsed to
 * a diagnostic result so callers can stop publishing a locus.
 */
export async function resolveLocusParent(
  port: LocusParentPort,
  parentSessionId: string,
  signal?: AbortSignal,
): Promise<LocusParentResolution> {
  if (!isIdentifier(parentSessionId)) return { ok: false, reason: 'invalid-parent-id' }
  if (isAborted(signal)) return { ok: false, reason: 'aborted' }

  let resident: LocusLiveParent | undefined
  try {
    resident = port.get(parentSessionId)
  } catch {
    return { ok: false, reason: 'parent-operation-failed' }
  }
  if (isLiveParent(resident) && resident.session.id === parentSessionId) {
    return { ok: true, parent: resident }
  }

  let resumed: { readonly agent?: LocusLiveParent } | undefined
  try {
    resumed = await port.resume({ resumeSessionId: parentSessionId, ...(signal !== undefined ? { signal } : {}) })
  } catch {
    return { ok: false, reason: 'parent-unavailable' }
  }

  if (isAborted(signal)) return { ok: false, reason: 'aborted' }
  if (isLiveParent(resumed?.agent) && resumed.agent.session.id === parentSessionId) {
    return { ok: true, parent: resumed.agent }
  }

  // Some host versions report resume success without returning the Agent.  A
  // second exact lookup is safe; a different session id is not accepted.
  try {
    if (isAborted(signal)) return { ok: false, reason: 'aborted' }
    const afterResume = port.get(parentSessionId)
    if (isLiveParent(afterResume) && afterResume.session.id === parentSessionId) {
      return { ok: true, parent: afterResume }
    }
  } catch {
    return { ok: false, reason: 'parent-operation-failed' }
  }

  return { ok: false, reason: 'parent-unavailable' }
}

/**
 * Generic continuable-child adapter.
 *
 * One instance represents one controller-owned active child at a time.  It
 * never creates a Task/Invocation, never sends a message to the parent, and
 * never infers delivery settlement from a child lifecycle event.
 */
type PendingLocusCreate = {
  readonly fingerprint: string
  readonly promise: Promise<LocusChildCreateResult>
  readonly resolve: (result: LocusChildCreateResult) => void
  readonly reject: (reason?: unknown) => void
}

type LocusCreateReservation =
  | { readonly kind: 'active'; readonly result: LocusChildCreateResult }
  | { readonly kind: 'pending'; readonly promise: Promise<LocusChildCreateResult> }
  | { readonly kind: 'start'; readonly pending: PendingLocusCreate }

export class LocusChildAdapter {
  private active: LocusActiveChild | undefined
  private createInFlight: PendingLocusCreate | undefined
  /** Active-changing operations reserve this fence before entering the queue. */
  private activeTransitionInFlight = 0
  /** Undefined means no lifecycle mutation is currently queued. */
  private lifecycleChain: Promise<void> | undefined
  private disposed = false
  private readonly settlementListeners = new Set<
    (event: LocusChildActivationSettlement) => void
  >()
  private readonly unsubscribeSettlement: (() => void) | undefined

  constructor(private readonly ports: LocusChildPorts) {
    this.unsubscribeSettlement = this.bindSettlementPort(ports.settlement)
  }

  /** The currently published child identity, or undefined before/after activation. */
  get activeChild(): LocusChildIdentity | undefined {
    if (this.active === undefined) return undefined
    return Object.freeze({
      parentSessionId: this.active.parentSessionId,
      childSessionId: this.active.childSessionId,
    })
  }

  /** Read the current active identity without exposing the live Agent object. */
  getActiveChild(): LocusChildIdentity | undefined {
    return this.activeChild
  }

  private enqueueLifecycleMutation<T>(operation: () => Promise<T>): Promise<T> {
    // Start the operation in the same turn as the caller.  Besides reducing
    // queue latency, this preserves the adapter contract that a create request
    // has synchronously reserved its in-flight identity before another request
    // or disposal can race it.  The continuation itself remains serialized by
    // lifecycleChain.
    let resolveNext!: (value: T | PromiseLike<T>) => void
    let rejectNext!: (reason?: unknown) => void
    const result = new Promise<T>((resolve, reject) => {
      resolveNext = resolve
      rejectNext = reject
    })
    const run = async (): Promise<void> => {
      try {
        resolveNext(await operation())
      } catch (error) {
        rejectNext(error)
      }
    }
    const prior = this.lifecycleChain
    if (prior === undefined) {
      this.lifecycleChain = result.then(() => undefined, () => undefined)
      void run()
    } else {
      const scheduled = prior.then(run, run)
      this.lifecycleChain = scheduled.then(() => undefined, () => undefined)
    }
    return result
  }

  /**
   * Reserve an operation that may publish or clear `active` before queueing it.
   *
   * The reservation is synchronous: a later create request must not observe the
   * old active child while compensation/adoption is already waiting in the
   * lifecycle queue.  The returned promise owns the release so callers only
   * observe completion after the fence has been removed.
   */
  private enqueueActiveTransition<T>(operation: () => Promise<T>): Promise<T> {
    this.activeTransitionInFlight += 1
    const result = this.enqueueLifecycleMutation(operation)
    return result.finally(() => {
      this.activeTransitionInFlight -= 1
    })
  }

  /** Resolve a parent through the injected parent port. */
  resolveParent(parentSessionId: string, signal?: AbortSignal): Promise<LocusParentResolution> {
    if (this.disposed) return Promise.resolve({ ok: false, reason: 'adapter-disposed' })
    return resolveLocusParent(this.ports.parent, parentSessionId, signal)
  }

  /**
   * Adopt an already-created durable child after a Host restart or Agent
   * unload.  Adoption validates/resumes the exact parent but never calls
   * `startContinuable`; passing a persisted child id to that creation API would
   * risk duplicate-child rejection or an accidental replacement identity.
   */
  async adoptChild(input: LocusChildAdoptionInput): Promise<LocusChildAdoptionResult> {
    if (!isIdentifier(input.parentSessionId) || !isIdentifier(input.childSessionId)) {
      return { ok: false, reason: 'invalid-child-request' }
    }
    if (isAborted(input.signal)) return { ok: false, reason: 'aborted' }
    return this.enqueueActiveTransition(() => this.adoptChildLocked(input))
  }

  private async adoptChildLocked(input: LocusChildAdoptionInput): Promise<LocusChildAdoptionResult> {
    if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
    if (isAborted(input.signal)) return { ok: false, reason: 'aborted' }
    if (this.createInFlight !== undefined) return { ok: false, reason: 'active-child-conflict' }
    const current = this.active
    if (current !== undefined) {
      const identity = {
        parentSessionId: current.parentSessionId,
        childSessionId: current.childSessionId,
      }
      return sameLocusChildIdentity(identity, input)
        ? { ok: true, adopted: false, identity }
        : { ok: false, reason: 'active-child-conflict' }
    }

    const parentResult = await this.resolveParent(input.parentSessionId, input.signal)
    if (!parentResult.ok) return parentResult
    if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
    if (isAborted(input.signal)) return { ok: false, reason: 'aborted' }

    const proof = this.ports.proof
    if (proof === undefined || typeof proof.findChild !== 'function') {
      return { ok: false, reason: 'child-proof-unavailable' }
    }
    let observed: LocusChildIdentity | undefined
    try {
      observed = await proof.findChild(input.parentSessionId, input.childSessionId, input.signal)
    } catch {
      return { ok: false, reason: 'child-proof-failed' }
    }
    if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
    if (isAborted(input.signal)) return { ok: false, reason: 'aborted' }
    if (observed === undefined) return { ok: false, reason: 'child-not-found' }
    if (!isIdentifier(observed.parentSessionId) || !isIdentifier(observed.childSessionId)) {
      return { ok: false, reason: 'child-proof-failed' }
    }
    if (observed.parentSessionId !== input.parentSessionId) {
      return { ok: false, reason: 'child-parent-mismatch' }
    }
    if (observed.childSessionId !== input.childSessionId) {
      return { ok: false, reason: 'child-not-found' }
    }
    const identity: LocusChildIdentity = {
      parentSessionId: observed.parentSessionId,
      childSessionId: observed.childSessionId,
    }
    this.active = Object.freeze({ ...identity, parent: parentResult.parent })
    return { ok: true, adopted: true, identity }
  }

  /** Alias for integrations that name durable-child restoration explicitly. */
  resumeChild = this.adoptChild.bind(this)

  /**
   * Create or idempotently reuse a child activation.
   *
   * A second request for the same parent returns the current identity without
   * starting another child.  A request for another parent is refused until the
   * controller explicitly compensates/retires the current activation.
   */
  async createChild(input: {
    readonly parentSessionId: string
    readonly label: string
    readonly prompt: string
    readonly provider?: string
    readonly childId?: string
    readonly signal?: AbortSignal
  }): Promise<LocusChildCreateResult> {
    if (!isIdentifier(input.parentSessionId) || !isIdentifier(input.label) || !isIdentifier(input.prompt)) {
      return { ok: false, reason: 'invalid-child-request' }
    }

    const signal = input.signal ?? EMPTY_SIGNAL
    if (signal.aborted) return { ok: false, reason: 'aborted' }
    const fingerprint = childRequestFingerprint(input)
    const reservation = this.reserveCreate(input, fingerprint, signal)
    return reservation.kind === 'active' ? reservation.result : reservation.kind === 'pending'
      ? reservation.promise
      : this.runReservedCreate(input, signal, reservation.pending)
  }

  /**
   * Create a durable, idle child for two-phase locus provisioning.
   *
   * No artificial initialization prompt is allowed: the first prompt will be
   * the first real Delivery, after the active locus and its indexes commit.
   */
  async createIdleChild(input: {
    readonly parentSessionId: string
    readonly label: string
    readonly childId: string
    readonly provider?: string
    readonly signal?: AbortSignal
  }): Promise<LocusChildCreateResult> {
    if (
      !isIdentifier(input.parentSessionId)
      || !isIdentifier(input.label)
      || !isIdentifier(input.childId)
    ) return { ok: false, reason: 'invalid-child-request' }
    const signal = input.signal ?? EMPTY_SIGNAL
    if (signal.aborted) return { ok: false, reason: 'aborted' }
    const reservedInput = { ...input, prompt: '<idle-continuable>' }
    const reservation = this.reserveCreate(
      reservedInput,
      childRequestFingerprint(reservedInput),
      signal,
    )
    return reservation.kind === 'active' ? reservation.result : reservation.kind === 'pending'
      ? reservation.promise
      : this.runReservedIdleCreate(input, signal, reservation.pending)
  }

  /**
   * Reserve create synchronously before entering the async lifecycle queue.
   * The checks are still performed by the queue operation for queued callers;
   * this reservation closes the gap in which a second create/adopt/dispose can
   * run before the first async callback reaches its first statement.
   */
  private reserveCreate(
    input: {
      readonly parentSessionId: string
      readonly label: string
      readonly prompt: string
      readonly provider?: string
      readonly childId?: string
    },
    fingerprint: string,
    signal: AbortSignal,
  ): LocusCreateReservation {
    if (this.disposed) return { kind: 'active', result: { ok: false, reason: 'adapter-disposed' } }
    if (signal.aborted) return { kind: 'active', result: { ok: false, reason: 'aborted' } }
    if (this.activeTransitionInFlight > 0) {
      return { kind: 'active', result: { ok: false, reason: 'active-child-conflict' } }
    }
    const current = this.active
    if (current !== undefined) {
      if (current.parentSessionId !== input.parentSessionId) {
        return { kind: 'active', result: { ok: false, reason: 'active-child-conflict' } }
      }
      if (input.childId !== undefined && input.childId !== current.childSessionId) {
        return { kind: 'active', result: { ok: false, reason: 'active-child-conflict' } }
      }
      return {
        kind: 'active',
        result: {
          ok: true,
          created: false,
          identity: { parentSessionId: current.parentSessionId, childSessionId: current.childSessionId },
        },
      }
    }
    const pending = this.createInFlight
    if (pending !== undefined) {
      return pending.fingerprint === fingerprint
        ? { kind: 'pending', promise: pending.promise }
        : { kind: 'active', result: { ok: false, reason: 'active-child-conflict' } }
    }
    let resolve!: (result: LocusChildCreateResult) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<LocusChildCreateResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const next = { fingerprint, promise, resolve, reject }
    this.createInFlight = next
    return { kind: 'start', pending: next }
  }

  private runReservedIdleCreate(
    input: {
      readonly parentSessionId: string
      readonly label: string
      readonly childId: string
      readonly provider?: string
    },
    signal: AbortSignal,
    pending: PendingLocusCreate,
  ): Promise<LocusChildCreateResult> {
    const operation: Promise<LocusChildCreateResult> = this.enqueueLifecycleMutation(async () => {
      if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
      if (signal.aborted) return { ok: false, reason: 'aborted' }
      if (this.active !== undefined) return { ok: false, reason: 'active-child-conflict' }
      const create = this.ports.subagent.createIdleContinuable
      if (this.ports.subagent.supportsSettlementNotice !== true) {
        return { ok: false, reason: 'settlement-notice-unsupported' }
      }
      if (
        this.ports.subagent.supportsIdleContinuableCreate !== true
        || create === undefined
      ) return { ok: false, reason: 'idle-child-create-unsupported' }
      const parentResult = await this.resolveParent(input.parentSessionId, signal)
      if (!parentResult.ok) return parentResult
      let result: { readonly childId: string }
      try {
        result = await create.call(this.ports.subagent, {
          childId: input.childId,
          provider: input.provider ?? DEFAULT_CHILD_PROVIDER,
          label: input.label,
          parent: parentResult.parent,
          settlementNotice: 'silent',
          signal,
        })
      } catch {
        if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
        if (signal.aborted) return { ok: false, reason: 'aborted' }
        return { ok: false, reason: 'child-create-failed' }
      }
      if (result.childId !== input.childId) {
        return { ok: false, reason: 'child-identity-invalid' }
      }
      const identity = {
        parentSessionId: input.parentSessionId,
        childSessionId: input.childId,
      }
      this.active = Object.freeze({ ...identity, parent: parentResult.parent })
      return { ok: true, created: true, identity }
    })
    void operation.then(
      result => {
        if (this.createInFlight === pending) this.createInFlight = undefined
        pending.resolve(result)
      },
      error => {
        if (this.createInFlight === pending) this.createInFlight = undefined
        pending.reject(error)
      },
    )
    return pending.promise
  }

  private runReservedCreate(
    input: {
      readonly parentSessionId: string
      readonly label: string
      readonly prompt: string
      readonly provider?: string
      readonly childId?: string
    },
    signal: AbortSignal,
    pending: PendingLocusCreate,
  ): Promise<LocusChildCreateResult> {
    const operation: Promise<LocusChildCreateResult> = this.enqueueLifecycleMutation(async () => {
      if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
      if (signal.aborted) return { ok: false, reason: 'aborted' }
      if (this.active !== undefined) return { ok: false, reason: 'active-child-conflict' }
      return this.startChild(input, signal)
    })
    void operation.then(
      result => {
        if (this.createInFlight === pending) this.createInFlight = undefined
        pending.resolve(result)
      },
      error => {
        if (this.createInFlight === pending) this.createInFlight = undefined
        pending.reject(error)
      },
    )
    return pending.promise
  }

  /**
   * Restore a persisted child only after the host has proven direct lineage.
   * This is intentionally separate from createChild so a stored id can never
   * be passed to startContinuable as a duplicate-creation hint.
   */
  private async startChild(
    input: {
      readonly parentSessionId: string
      readonly label: string
      readonly prompt: string
      readonly provider?: string
      readonly childId?: string
    },
    signal: AbortSignal,
  ): Promise<LocusChildCreateResult> {
    if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
    if (signal.aborted) return { ok: false, reason: 'aborted' }

    const parentResult = await this.resolveParent(input.parentSessionId, signal)
    if (!parentResult.ok) return parentResult
    if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
    if (signal.aborted) return { ok: false, reason: 'aborted' }

    // Fail closed before creating anything: a child established on a runtime
    // that pushes its settlement account into the main session would violate
    // the "no automatic report to the parent" boundary, and no later cleanup
    // can retract conclusions already written to the parent's log.
    if (this.ports.subagent.supportsSettlementNotice !== true) {
      return { ok: false, reason: 'settlement-notice-unsupported' }
    }

    let result: { readonly childId: string }
    try {
      result = await this.ports.subagent.startContinuable({
        provider: input.provider ?? DEFAULT_CHILD_PROVIDER,
        label: input.label,
        ...(input.childId !== undefined ? { childId: input.childId } : {}),
        request: {
          prompt: [{ type: 'text', text: input.prompt }],
          parent: parentResult.parent,
        },
        settlementNotice: 'silent',
        signal,
      })
    } catch {
      if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
      if (signal.aborted) return { ok: false, reason: 'aborted' }
      return { ok: false, reason: 'child-create-failed' }
    }

    if (!isIdentifier(result?.childId)) {
      // Do not call compensation for an unknown child identity.  Releasing a
      // guessed id could destroy an unrelated child; fail closed instead.
      return { ok: false, reason: 'child-identity-invalid' }
    }

    const identity: LocusChildIdentity = {
      parentSessionId: input.parentSessionId,
      childSessionId: result.childId,
    }

    // Never publish an activation after cancellation or disposal.  If the
    // host completed creation before either fence was observed, release the
    // now-known child best-effort instead of exposing a stale active identity.
    if (this.disposed || signal.aborted) {
      await this.releaseUnpublishedChild(parentResult.parent, identity.childSessionId)
      return { ok: false, reason: this.disposed ? 'adapter-disposed' : 'aborted' }
    }

    this.active = Object.freeze({ ...identity, parent: parentResult.parent })
    return { ok: true, created: true, identity }
  }

  /** Release a child that was created but failed the publication fence. */
  private async releaseUnpublishedChild(
    parent: LocusLiveParent,
    childSessionId: string,
  ): Promise<void> {
    const compensation = this.ports.compensation
    if (compensation === undefined) return
    try {
      if ('release' in compensation && typeof compensation.release === 'function') {
        await compensation.release({
          parent,
          childId: childSessionId,
          signal: EMPTY_SIGNAL,
          reason: 'child activation publication fenced',
        })
      } else if (
        'drainContinuableChildren' in compensation &&
        typeof compensation.drainContinuableChildren === 'function'
      ) {
        await compensation.drainContinuableChildren(parent, [childSessionId])
      }
    } catch {
      // The activation was never published.  There is no safe active identity
      // to expose or guess; a durable provisioning reconciler can diagnose any
      // cleanup failure from the host's own resource records.
    }
  }

  /**
   * Queue one host-authored turn for the exact active child.
   *
   * `identity` is optional for convenience when a controller already serializes
   * one adapter instance; when supplied it is checked exactly to prevent a late
   * request from targeting a replacement child.
   */
  async queuePrompt(input: {
    readonly text: string
    readonly identity?: LocusChildIdentity
    readonly signal?: AbortSignal
  }): Promise<LocusChildQueueResult> {
    if (!isIdentifier(input.text)) return { ok: false, reason: 'invalid-child-request' }
    const signal = input.signal ?? EMPTY_SIGNAL
    if (signal.aborted) return { ok: false, reason: 'aborted' }
    return this.enqueueLifecycleMutation(() => this.queuePromptLocked(input, signal))
  }

  private async queuePromptLocked(
    input: { readonly text: string; readonly identity?: LocusChildIdentity },
    signal: AbortSignal,
  ): Promise<LocusChildQueueResult> {
    if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
    const active = this.active
    if (active === undefined) return { ok: false, reason: 'no-active-child' }
    const identity = { parentSessionId: active.parentSessionId, childSessionId: active.childSessionId }
    if (input.identity !== undefined && !sameLocusChildIdentity(input.identity, identity)) {
      return { ok: false, reason: 'child-identity-mismatch' }
    }

    // A continuable child can be unloaded after an activation-level end event.
    // Resolve the parent for every inbox operation so DSH receives the current
    // exact live Agent object and can cold-resume it when needed.
    const parentResult = await this.resolveParent(active.parentSessionId, signal)
    if (!parentResult.ok) return parentResult
    if (
      this.disposed ||
      this.active === undefined ||
      !sameLocusChildIdentity(this.active, active)
    ) {
      return { ok: false, reason: this.disposed ? 'adapter-disposed' : 'child-identity-mismatch' }
    }
    this.active = Object.freeze({ ...active, parent: parentResult.parent })

    const inbox = this.ports.inbox
    const queue = inbox?.queuePrompt
    if (typeof queue !== 'function' || inbox === undefined) {
      return { ok: false, reason: 'inbox-unavailable' }
    }
    if (signal.aborted) return { ok: false, reason: 'aborted' }

    let messageId: string
    try {
      messageId = await queue.call(
        inbox,
        parentResult.parent,
        active.childSessionId,
        [{ type: 'text', text: input.text }],
        { kind: 'user' },
        signal,
      )
    } catch {
      return { ok: false, reason: 'inbox-failed' }
    }
    // Queue acceptance is not reversible at this seam.  Still fence the
    // result so a turn completed after shutdown/cancellation cannot be reported
    // as an active delivery to a caller that is no longer allowed to publish.
    if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
    if (signal.aborted) return { ok: false, reason: 'aborted' }
    if (!isIdentifier(messageId)) return { ok: false, reason: 'inbox-message-id-invalid' }
    return { ok: true, messageId, identity }
  }

  /** Alias used by channel adapters that call the operation a delivery. */
  queueChildPrompt = this.queuePrompt.bind(this)

  /**
   * Compensate the currently active child, if its identity still matches.
   *
   * Compensation is explicit because a queue refusal is not proof that a child
   * should be destroyed.  The operation is fail-soft but not fail-open: a
   * failed or missing compensation port leaves `activeChild` intact so the
   * controller cannot publish a false rollback result.
   */
  async compensateChild(options: {
    readonly identity?: LocusChildIdentity
    readonly reason?: string
    readonly signal?: AbortSignal
  } = {}): Promise<LocusChildCompensationResult> {
    const signal = options.signal ?? EMPTY_SIGNAL
    if (signal.aborted) return { ok: false, reason: 'aborted' }
    return this.enqueueActiveTransition(() => this.compensateChildLocked(options, signal))
  }

  private async compensateChildLocked(
    options: { readonly identity?: LocusChildIdentity; readonly reason?: string },
    signal: AbortSignal,
  ): Promise<LocusChildCompensationResult> {
    if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
    const active = this.active
    if (active === undefined) return { ok: false, reason: 'no-active-child' }
    const identity = { parentSessionId: active.parentSessionId, childSessionId: active.childSessionId }
    if (options.identity !== undefined && !sameLocusChildIdentity(options.identity, identity)) {
      return { ok: false, reason: 'child-identity-mismatch' }
    }

    const compensation = this.ports.compensation
    if (compensation === undefined) return { ok: false, reason: 'compensation-unavailable' }
    const parentResult = await this.resolveParent(active.parentSessionId, signal)
    if (!parentResult.ok) return parentResult
    if (
      this.disposed ||
      this.active === undefined ||
      !sameLocusChildIdentity(this.active, active)
    ) {
      return { ok: false, reason: this.disposed ? 'adapter-disposed' : 'child-identity-mismatch' }
    }
    this.active = Object.freeze({ ...active, parent: parentResult.parent })
    try {
      if ('release' in compensation && typeof compensation.release === 'function') {
        await compensation.release({
          parent: parentResult.parent,
          childId: active.childSessionId,
          signal,
          ...(options.reason !== undefined ? { reason: options.reason } : {}),
        })
      } else if (
        'drainContinuableChildren' in compensation &&
        typeof compensation.drainContinuableChildren === 'function'
      ) {
        await compensation.drainContinuableChildren(parentResult.parent, [active.childSessionId])
      } else {
        return { ok: false, reason: 'compensation-unavailable' }
      }
    } catch {
      return { ok: false, reason: 'compensation-failed' }
    }

    // The child is released regardless of whether the caller's fence closed
    // while the external operation was in flight.  Clear the local identity
    // first; retaining it after a successful release would permit a later
    // queue to target a child that no longer exists.
    if (this.active === undefined || !sameLocusChildIdentity(this.active, active)) {
      return { ok: false, reason: 'child-identity-mismatch' }
    }
    this.active = undefined
    if (this.disposed) return { ok: false, reason: 'adapter-disposed' }
    if (signal.aborted) return { ok: false, reason: 'aborted' }
    return { ok: true, identity }
  }

  /** Short alias for controllers that call compensation a release. */
  releaseActiveChild = this.compensateChild.bind(this)

  /** Subscribe to activation-level settlement observations from this adapter. */
  onActivationSettled(
    listener: (event: LocusChildActivationSettlement) => void,
  ): () => void {
    this.settlementListeners.add(listener)
    return () => this.settlementListeners.delete(listener)
  }

  /** Explicitly named alias that avoids implying per-delivery settlement. */
  onChildActivationSettled = this.onActivationSettled.bind(this)

  /** Dispose only the lifecycle subscription; it never sends a parent message. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    try {
      this.unsubscribeSettlement?.()
    } catch {
      // A broken event disposer cannot be allowed to turn plugin shutdown into
      // a host failure.  No child is implicitly released here.
    }
    this.settlementListeners.clear()
  }

  private bindSettlementPort(
    port: LocusChildSettlementPort | undefined,
  ): (() => void) | undefined {
    if (port === undefined) return undefined
    const subscribe =
      typeof port.onChildSettled === 'function'
        ? port.onChildSettled
        : typeof port.subscribe === 'function'
          ? port.subscribe
          : undefined
    if (subscribe === undefined) return undefined

    try {
      const unsubscribe = subscribe.call(port, event => this.handleSettlement(event))
      return typeof unsubscribe === 'function' ? unsubscribe : undefined
    } catch {
      // The adapter remains usable for create/queue, but no activation
      // settlement is considered observed.  It therefore never clears an
      // active identity on an unproven event source.
      return undefined
    }
  }

  private handleSettlement(event: LocusChildSettlementEvent): void {
    const active = this.active
    if (active === undefined || event === undefined || event === null) return
    const raw = event as { childSessionId?: unknown; id?: unknown; stopReason?: unknown }
    const childSessionId =
      typeof raw.childSessionId === 'string'
        ? raw.childSessionId
        : typeof raw.id === 'string'
          ? raw.id
          : undefined
    if (childSessionId !== active.childSessionId) return

    const identity: LocusChildIdentity = {
      parentSessionId: active.parentSessionId,
      childSessionId: active.childSessionId,
    }
    const settled: LocusChildActivationSettlement = {
      identity,
      ...(typeof raw.stopReason === 'string' ? { stopReason: raw.stopReason } : {}),
    }
    // Keep the durable continuable-child identity.  This event closes one
    // activation epoch only; a later queue operation resolves/resumes the same
    // parent and asks DSH to cold-resume the same child session.  Clearing it
    // here would force an unsafe replacement child and lose locus history.
    for (const listener of [...this.settlementListeners]) {
      try {
        listener(settled)
      } catch {
        // Observer failures belong to the controller and must not corrupt the
        // adapter's lifecycle fence or bubble into DSH's event emitter.
      }
    }
  }
}

/** Factory form for controller/channel dependency injection. */
export function createLocusChildAdapter(ports: LocusChildPorts): LocusChildAdapter {
  return new LocusChildAdapter(ports)
}

/**
 * Extract the measured symbol-keyed DSH queue into the generic inbox port.
 *
 * This helper is optional: callers may inject their own queue operation.  It
 * accepts an unknown host service and returns `undefined` when the seam is not
 * present, so a plugin can remain loaded while the locus capability is
 * unavailable.
 */
export const LOCUS_QUEUE_PROMPT_SYMBOL = Symbol.for('dsh.subagent.queuePrompt')

/**
 * Adapt the Host child inbox.
 *
 * The runtime publishes this operation under a well-known symbol on its
 * subagent service, and its own package exposes the same entry as a named
 * helper. Reading the symbol keeps this module free of a hard dependency on
 * that package while still using the runtime's real seam rather than a
 * reimplementation; an absent symbol is an unavailable inbox.
 */
export function adaptLocusInboxPort(
  subagents: unknown,
  /**
   * Optional exact helper from the runtime's own package. When supplied it is
   * preferred over the symbol lookup, because the package owns the argument
   * contract and a version change surfaces as a type error rather than as a
   * silently mismatched call.
   */
  queueHostPrompt?: (
    runtime: unknown,
    parent: LocusLiveParent,
    childId: string,
    prompt: readonly LocusTextBlock[],
    source: LocusInboxSource,
    signal: AbortSignal,
  ) => Promise<string>,
): LocusInboxPort | undefined {
  if (subagents === null || typeof subagents !== 'object') return undefined
  if (queueHostPrompt !== undefined) {
    return {
      queuePrompt: async (parent, childId, prompt, source, signal) => {
        if (source.kind !== 'user') throw new Error('unsupported inbox source')
        return queueHostPrompt(subagents, parent, childId, prompt, source, signal)
      },
    }
  }
  const service = subagents as Record<symbol, unknown>
  const queue = service[LOCUS_QUEUE_PROMPT_SYMBOL]
  if (typeof queue !== 'function') return undefined

  return {
    queuePrompt: async (parent, childId, prompt, source, signal) => {
      if (source.kind !== 'user') throw new Error('unsupported inbox source')
      return (await (queue as (...args: unknown[]) => Promise<unknown>).call(
        subagents,
        parent,
        childId,
        prompt,
        source,
        signal,
      )) as string
    },
  }
}

/**
 * Probe the optional DSH child seams without making them hard dependencies of
 * Pet.  The probe only publishes a capability when parent resolution,
 * continuable creation, and the symbol-keyed inbox are all present.  A proof
 * port is exposed when the host can enumerate direct children; otherwise
 * adoption remains deliberately unavailable rather than trusting a durable id.
 */
export function probeLocusChildPorts(
  ctx: LocusHostContextLike,
  options: {
    /**
     * Whether the composed Host runtime honors a silent settlement notice.
     * The caller proves this from the runtime it actually loaded; this module
     * never infers it, and an unproven capability keeps creation unavailable.
     */
    readonly settlementNoticeSupported?: boolean
  } = {},
): LocusChildPortsProbe {
  const parentService = ctx.get?.('agents')
  if (parentService === null || typeof parentService !== 'object') {
    return { available: false, diagnostic: 'parent-service-unavailable' }
  }
  const parentRecord = parentService as {
    get?: unknown
    resume?: unknown
  }
  if (typeof parentRecord.get !== 'function' || typeof parentRecord.resume !== 'function') {
    return { available: false, diagnostic: 'parent-service-unavailable' }
  }

  const subagentService = ctx.get?.('subagents')
  if (subagentService === null || typeof subagentService !== 'object') {
    return { available: false, diagnostic: 'subagent-service-unavailable' }
  }
  const subagentRecord = subagentService as {
    startContinuable?: unknown
    createIdleContinuable?: unknown
    drainContinuableChildren?: unknown
    listChildren?: unknown
    /** Literal markers published only by a runtime that owns the behavior. */
    supportsSettlementNotice?: unknown
    supportsIdleContinuableCreate?: unknown
  }
  if (typeof subagentRecord.startContinuable !== 'function') {
    return { available: false, diagnostic: 'subagent-service-unavailable' }
  }
  const inbox = adaptLocusInboxPort(subagentService)
  if (inbox === undefined) return { available: false, diagnostic: 'inbox-unavailable' }
  if (typeof ctx.on !== 'function') {
    return { available: false, diagnostic: 'settlement-events-unavailable' }
  }

  // Resume the main session through the Host's session controller when it is
  // composed. That path reconstructs the session's persisted preset before
  // publishing it; a bare `agents.resume()` does not, and would hand back a
  // parent whose tool composition is empty — the same "looks resumed, is not
  // composed" failure recorded in the integration-pitfalls note. Without the
  // controller, parent resume stays unavailable rather than silently degraded.
  const controller = ctx.get?.('sessionController') as
    | { resolveAgent?: (sessionId: string) => unknown }
    | undefined
  const resolveAgent = typeof controller?.resolveAgent === 'function'
    ? controller.resolveAgent.bind(controller)
    : undefined

  const parent: LocusParentPort = {
    get: sessionId =>
      (parentRecord.get as (id: string) => LocusLiveParent | undefined).call(parentService, sessionId),
    resume: async (resumeOptions) => {
      if (resolveAgent === undefined) return undefined
      const resolved = await Promise.resolve(resolveAgent(resumeOptions.resumeSessionId)) as
        | { readonly agent?: LocusLiveParent; readonly error?: unknown }
        | undefined
      // The controller reports a refusal as data. Returning no agent keeps the
      // adapter's fail-closed path instead of surfacing a partial parent.
      if (resolved?.error !== undefined) return undefined
      return resolved?.agent === undefined ? undefined : { agent: resolved.agent }
    },
  }
  const subagent: LocusSubagentPort = {
    startContinuable: spec =>
      Promise.resolve(
        (subagentRecord.startContinuable as (input: unknown) => unknown).call(subagentService, spec),
      ) as Promise<{ readonly childId: string; readonly messageId?: string }>,
    ...(typeof subagentRecord.createIdleContinuable === 'function'
      ? {
        createIdleContinuable: (spec: unknown) => Promise.resolve(
          (subagentRecord.createIdleContinuable as (input: unknown) => unknown)
            .call(subagentService, spec),
        ) as Promise<{ readonly childId: string }>,
      }
      : {}),
    ...(subagentRecord.supportsIdleContinuableCreate === true
      ? { supportsIdleContinuableCreate: true }
      : {}),
    // Accept either an explicit composition proof (tests/older adapters) or
    // the literal marker on the runtime actually loaded by the Host. Never
    // infer from accepting an unknown field: older JS silently ignores it.
    ...(options.settlementNoticeSupported === true || subagentRecord.supportsSettlementNotice === true
      ? { supportsSettlementNotice: true }
      : {}),
  }
  const compensation: LocusChildDrainPort | undefined =
    typeof subagentRecord.drainContinuableChildren === 'function'
      ? {
          drainContinuableChildren: (liveParent, childIds) =>
            Promise.resolve(
              (subagentRecord.drainContinuableChildren as (parent: LocusLiveParent, ids: readonly string[]) => unknown).call(
                subagentService,
                liveParent,
                childIds,
              ),
            ).then(() => undefined),
        }
      : undefined
  const proof: LocusChildProofPort | undefined =
    typeof subagentRecord.listChildren === 'function'
      ? {
          findChild: async (parentSessionId, childSessionId, signal) => {
            const result = await (subagentRecord.listChildren as (id: string, signal?: AbortSignal) => Promise<unknown>).call(
              subagentService,
              parentSessionId,
              signal,
            )
            if (!Array.isArray(result)) return undefined
            const match = result.find(item => {
              if (item === null || typeof item !== 'object') return false
              const row = item as {
                id?: unknown
                parentSessionId?: unknown
                kind?: unknown
                mode?: unknown
              }
              if (row.id !== childSessionId) return false
              if (row.parentSessionId !== undefined && row.parentSessionId !== parentSessionId) return false
              // A matching id alone is not proof of a resumable child: the same
              // listing also carries diagnostics and one-shot runs, and
              // adopting one of those would bind a locus to a child that can
              // never take another turn. When the runtime reports the kind and
              // mode, both must say this is a continuable child.
              if (row.kind !== undefined && row.kind !== 'child') return false
              if (row.mode !== undefined && row.mode !== 'continuable') return false
              return true
            }) as { id?: unknown } | undefined
            return match !== undefined && typeof match.id === 'string'
              ? { parentSessionId, childSessionId: match.id }
              : undefined
          },
        }
      : undefined

  const on = ctx.on.bind(ctx)
  const settlement: LocusChildSettlementPort = {
    onChildSettled: listener =>
      on('subagent/end', (...args: unknown[]) => {
        const value = args[0]
        if (value === null || typeof value !== 'object') return
        const raw = value as { id?: unknown; childSessionId?: unknown; stopReason?: unknown }
        const id = typeof raw.childSessionId === 'string' ? raw.childSessionId : raw.id
        if (typeof id !== 'string') return
        listener({
          id,
          ...(typeof raw.stopReason === 'string' ? { stopReason: raw.stopReason } : {}),
        })
      }),
  }

  return {
    available: true,
    ports: {
      parent,
      subagent,
      inbox,
      ...(compensation !== undefined ? { compensation } : {}),
      ...(proof !== undefined ? { proof } : {}),
      settlement,
    },
  }
}
