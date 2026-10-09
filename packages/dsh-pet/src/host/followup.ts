/**
 * In-session follow-up Invocations.
 *
 * A Pet Task owns one ordinary DSH executor session for its whole life, and
 * that session stays open after each Invocation settles. A user who replies
 * THERE — the natural place, since it is where the previous answer and its
 * open question appeared — used to reach a turn with no Invocation at all:
 * `pet_context` can only resolve a `running`/`waiting-user` record, so the
 * model got `NO_CURRENT_INVOCATION` while the round still had ordinary tools.
 *
 * This module is the missing third origin. It does not decide authority from
 * message text: a message qualifies only when the HOST can prove it is a
 * client submission (a user message carrying a client request id) that
 * arrived in a root executor session, and the target is still the Task's own
 * fixed source scope — the model gains no selector. Pet's own dispatches carry
 * no request id, host-injected context uses other source kinds, and locus /
 * qa-child sessions are excluded before anything is considered.
 *
 * Timing: the durable `agent/inbox/spliced` event is appended immediately
 * before `turn/start`, so observing it registers the Invocation before the
 * turn's first model step. When the serial slot is still occupied the
 * registration is deferred to the message's own claim, which reports exactly
 * which message the turn consumes. `pet_context` additionally waits for a
 * registration that is still in flight, so a lost race degrades to a short
 * wait instead of a spurious idle error.
 */

import { isForkChildTaskForm, type PetTaskRecord } from '../wire.js'

/** Minimal structural view of an inbox message this module reads. */
export interface InboxMessageLike {
  readonly id?: unknown
  readonly source?: unknown
  readonly content?: unknown
}

/** Bound on the stored request text of an in-session Invocation. */
export const FOLLOWUP_REQUEST_LIMIT = 4000

/**
 * Whether one message is provably a client-submitted user message.
 *
 * The request id is the discriminator the Host itself uses to recognize its
 * own client submissions (`hasPromptRequest` in the session controller);
 * Pet's dispatcher mints plain `{ kind: 'user' }` messages without one.
 * @param message - Candidate message from a splice, claim or inbox read.
 * @returns whether the message carries a client request identity.
 */
export function isClientUserMessage(message: unknown): message is InboxMessageLike {
  const source = (message as InboxMessageLike | undefined)?.source as
    | { kind?: unknown; rpcId?: unknown }
    | undefined
  if (source === undefined || source === null || typeof source !== 'object') return false
  return source.kind === 'user' && typeof source.rpcId === 'string' && source.rpcId.length > 0
}

/**
 * Durable id of one inbox message.
 * @param message - Candidate message.
 * @returns the id, or `undefined` when it has none.
 */
export function inboxMessageId(message: unknown): string | undefined {
  const id = (message as InboxMessageLike | undefined)?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * Bounded plain-text projection of a user message's content.
 * @param message - Candidate message.
 * @returns the text, or `undefined` when there is nothing to store.
 */
export function clientMessageText(message: unknown): string | undefined {
  const content = (message as InboxMessageLike | undefined)?.content
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const text = (block as { type?: unknown; text?: unknown }).text
    if ((block as { type?: unknown }).type === 'text' && typeof text === 'string') parts.push(text)
  }
  const joined = parts.join('\n').trim()
  if (joined === '') return undefined
  return joined.length > FOLLOWUP_REQUEST_LIMIT
    ? `${joined.slice(0, FOLLOWUP_REQUEST_LIMIT)}…`
    : joined
}

/**
 * Whether a Task may host the in-session origin at all.
 *
 * Archived Tasks are closed for new work, and a fork-child "executor" is a
 * child of a USER session that Pet must not compose — its turns are driven by
 * the subagent runtime and never carry a Pet Invocation by design.
 * @param task - Task resolved from the executing session.
 * @returns whether an in-session follow-up may be registered for it.
 */
export function isFollowupEligibleTask(task: PetTaskRecord | undefined): boolean {
  if (task === undefined) return false
  if (task.archivedAt !== undefined) return false
  return !isForkChildTaskForm(task.sourceKind)
}

/** Why one registration attempt did not produce an Invocation. */
export type FollowupSkipReason =
  | 'duplicate'
  | 'slot-occupied'
  | 'archived'
  | 'source-unavailable'
  | 'not-eligible'

/** Outcome of one registration attempt. */
export type FollowupOutcome =
  | { readonly ok: true; readonly invocationId: string }
  | { readonly ok: false; readonly reason: FollowupSkipReason }

/** Host ports the follow-up coordinator depends on. */
export interface FollowupDeps {
  /** Resolve the Task whose executor session this is, or `undefined`. */
  readonly resolveTask: (executorSessionId: string) => PetTaskRecord | undefined
  /** Durable idempotency probe: the Invocation already raised by a message. */
  readonly findByMessage: (messageId: string) => { readonly id: string } | undefined
  /** Register the Invocation, capturing a FRESH snapshot of the Task source. */
  readonly register: (input: {
    readonly taskId: string
    readonly messageId: string
    readonly request?: string
  }) => Promise<FollowupOutcome>
  /** Whether the session is a unified-locus child rather than a root executor. */
  readonly isLocusChild?: (executorSessionId: string) => boolean
  /** Diagnostics sink; never used for control flow. */
  readonly onOutcome?: (input: {
    readonly executorSessionId: string
    readonly messageId: string
    readonly taskId: string
    readonly outcome: FollowupOutcome
  }) => void
  /** Failure sink; a registration error must never break the session loop. */
  readonly onError?: (error: unknown) => void
}

/** Options bounding the registration wait. */
export interface FollowupOptions {
  /**
   * Longest `pet_context` waits for an in-flight registration.
   *
   * A registration is a handful of local durable writes; the wait exists only
   * so a lost race between the splice observer and the model's first step
   * cannot surface as a spurious idle error.
   */
  readonly waitMs?: number
}

/** Default registration wait, in milliseconds. */
export const FOLLOWUP_WAIT_MS = 3000

/**
 * Registers and tracks in-session follow-up Invocations for executor sessions.
 *
 * One instance lives on the Host. Observations are fire-and-forget: a
 * failure is reported through `deps.onError` and never propagates into the
 * DSH event bus, because a thrown listener would veto the very turn it is
 * trying to account for.
 */
export class FollowupCoordinator {
  private readonly chains = new Map<string, Promise<unknown>>()
  private readonly inFlight = new Set<string>()
  private readonly waitMs: number

  /**
   * @param deps - Host ports.
   * @param options - Bounded wait configuration.
   */
  constructor(
    private readonly deps: FollowupDeps,
    options: FollowupOptions = {},
  ) {
    this.waitMs = options.waitMs ?? FOLLOWUP_WAIT_MS
  }

  /**
   * Observe one message from a durable splice or a claim.
   *
   * Both call sites may see the same message; the durable probe plus the
   * in-flight set collapse them to at most one Invocation.
   * @param executorSessionId - Session the message entered.
   * @param message - Candidate inbox message.
   */
  observe(executorSessionId: string, message: unknown): void {
    void this.attempt(executorSessionId, message).catch(error => {
      this.deps.onError?.(error)
    })
  }

  /**
   * Await any registration currently in flight for one session.
   *
   * Resolves immediately when nothing is being registered, and never longer
   * than the configured bound.
   * @param executorSessionId - Executing session.
   */
  async waitForRegistration(executorSessionId: string): Promise<void> {
    const pending = this.observationTail(executorSessionId)
    if (pending === undefined) return
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        pending.then(
          () => undefined,
          () => undefined,
        ),
        new Promise<void>(resolve => {
          timer = setTimeout(resolve, this.waitMs)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /** The tail of this session's registration chain, if any is unfinished. */
  private observationTail(executorSessionId: string): Promise<unknown> | undefined {
    return this.chains.get(executorSessionId)
  }

  /** One registration attempt, serialized per session. */
  private async attempt(executorSessionId: string, message: unknown): Promise<void> {
    if (!isClientUserMessage(message)) return
    const messageId = inboxMessageId(message)
    if (messageId === undefined) return
    if (this.inFlight.has(messageId)) return
    if (this.deps.isLocusChild?.(executorSessionId) === true) return

    const task = this.deps.resolveTask(executorSessionId)
    if (!isFollowupEligibleTask(task)) return
    if (this.deps.findByMessage(messageId) !== undefined) return

    const request = clientMessageText(message)
    this.inFlight.add(messageId)
    const chained = this.chain(executorSessionId, async () => {
      const outcome = await this.deps.register({
        taskId: task!.id,
        messageId,
        ...(request !== undefined ? { request } : {}),
      })
      this.deps.onOutcome?.({
        executorSessionId,
        messageId,
        taskId: task!.id,
        outcome,
      })
      return outcome
    }).finally(() => {
      this.inFlight.delete(messageId)
    })
    this.chains.set(executorSessionId, chained)
    await chained
  }

  /** Serialize one registration behind this session's previous one. */
  private chain(executorSessionId: string, run: () => Promise<unknown>): Promise<unknown> {
    const previous = this.chains.get(executorSessionId) ?? Promise.resolve()
    return previous.then(run, run)
  }
}
