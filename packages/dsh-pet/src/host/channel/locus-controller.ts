/**
 * Unified Feishu locus channel controller.
 *
 * This file is the narrow channel adapter for the new locus model.  It does
 * not use the retired channel pipeline, PetCoordinator, Tasks, Invocations,
 * `chat_bindings`, or `invocation_channel`.  The host supplies the locus
 * repository, Delivery ledger, child adapter, and a *per-turn* correlation
 * observer.
 *
 * The publish order is deliberately one-way:
 *
 *   admission -> active locus -> exact child -> Delivery.accept
 *     -> current-claim -> queue child (or durable backlog)
 *
 * A turn observer is a hard capability gate.  A child activation observer (or
 * a child id/FIFO heuristic) cannot prove which Delivery ran, so this module
 * refuses before admission and persistence when the per-turn observer is not
 * available.  `deliveryDispatch.claimCurrent` is a REQUIRED production seam
 * (see `LocusControllerDeps`): admission is durable before dispatch, and a
 * busy locus retains the new Delivery in its backlog instead of injecting it
 * into the child inbox.  There is no eager/legacy fallback dispatch path in
 * production; a missing dispatcher refuses the whole admission.
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { sourceOf } from '../locus/doc-endpoint.js'
import { LocusResolutionError } from '../locus/resolution.js'
import type { DeliveryDocComment } from '../locus/delivery.js'
import type { LocusMediaPort } from './media.js'
import {
  historicalUnknownAddressing,
  projectDeliveryAddressing,
  type DeliveryAddressingProjection,
} from '../locus/addressing.js'
import {
  admitLocusEvent,
  type LocusAdmission,
  isAdmittableAuthorization,
  locusEndpointKey,
  type AdmittableLocusAuthorization,
  type LocusAdmissionContext,
  type LocusAdmissionDecision,
  type LocusAdmissionRefusal,
  type LocusAuthorizationState,
  type LocusControlDispatchPort,
  type LocusControlDispatchResult,
  type LocusControlCommand,
  type LocusEndpoint as AdmissionEndpoint,
} from '../locus/admission.js'

/** The minimum prefix accepted by the channel control surface. */
export const MIN_BIND_PREFIX_LENGTH = 6
import {
  LOCUS_SAFE_CHILD_COMPOSITION,
  normalizeLocusEndpoint,
  type LocusChildComposition,
  type LocusContextAnchor,
  type LocusEndpoint,
  type LocusPermission,
} from '../locus/aggregate.js'
import {
  isSafeLocusReplyTarget,
  type LocusReplyTarget,
} from '../locus/context.js'
import type { LarkInboundEvent } from './event.js'
import { verifyLocusLivePolicy, verifyLocusPersistedPolicy, type LocusLiveSandboxPolicy } from '../locus/policy-verification.js'
import type {
  DeliveryAcceptance,
  DeliveryCorrelation,
  DeliveryFeedbackTarget,
  DeliveryInput,
  DeliveryRecord,
  DeliveryTurnCorrelation,
} from '../locus/delivery.js'

/** Promise-like value accepted by all injected ports. */
export type Awaitable<T> = T | PromiseLike<T>

/** A transport-normalized inbound event. */
export interface NormalizedLocusEvent {
  readonly type: 'im.message.receive_v1'
  readonly messageId: string
  readonly chatId: string
  readonly chatType: 'p2p' | 'group'
  readonly messageType: string
  readonly text: string
  readonly createdAt?: number
  readonly senderOpenId: string
  readonly senderType?: string
  readonly rootId?: string
  readonly replyTo?: string
  readonly threadId?: string
  readonly mentions: readonly {
    readonly id?: string
    readonly key?: string
    readonly name?: string
  }[]
}

/** Facts every source carries. */
interface NormalizedLocusMessageCore {
  readonly kind: 'message'
  readonly messageId: string
  readonly endpoint: LocusEndpoint
  readonly senderOpenId: string
  readonly senderName?: string
  readonly text: string
  /** Bounded addressing facts; absent only for legacy/pre-admitted callers. */
  readonly addressing?: DeliveryAddressingProjection
  readonly replyTarget: LocusReplyTarget
  readonly replyToMessageId?: string
  readonly createdAt?: number
}

/**
 * A normalized message with a canonical endpoint and trusted reply target,
 * discriminated by `source` (openspec pet-locus-doc-comments D5). `source` is
 * optional on the IM branch so existing IM callers stay valid; every branch
 * point uses {@link messageSource}.
 */
export type NormalizedLocusMessage =
  | (NormalizedLocusMessageCore & {
      readonly source?: 'im'
      readonly chatType: 'p2p' | 'group'
    })
  | (NormalizedLocusMessageCore & {
      readonly source: 'doc-comment'
      /** Persisted with the Delivery; absent for a whole-doc comment. */
      readonly docComment?: DeliveryDocComment
    })

/** The source of a message: the explicit discriminant, else the endpoint prefix. */
export function messageSource(message: NormalizedLocusMessage): 'im' | 'doc-comment' {
  if (message.source !== undefined) return message.source
  return sourceOf(message.endpoint)
}

/**
 * Rebuild a message from a durable Delivery (backlog promotion, post-restart
 * dispatch). The source comes from the endpoint prefix and doc facts from the
 * persisted record, never from an inbound event, which no longer exists.
 */
export function messageFromDeliveryRecord(record: DeliveryRecord, endpoint: LocusEndpoint): NormalizedLocusMessage {
  const core = {
    kind: 'message' as const,
    messageId: record.messageId,
    endpoint: { ...endpoint },
    senderOpenId: record.senderOpenId ?? '',
    ...(record.senderName === undefined ? {} : { senderName: record.senderName }),
    text: record.text ?? '',
    addressing: record.addressing ?? projectDeliveryAddressing({ mentions: [], orderKnown: false }),
    replyTarget: { ...record.feedbackTarget },
    ...(record.replyToMessageId === undefined ? {} : { replyToMessageId: record.replyToMessageId }),
    ...(record.acceptedAt === undefined ? {} : { createdAt: record.acceptedAt }),
  }
  return sourceOf(endpoint) === 'doc-comment'
    ? { ...core, source: 'doc-comment', ...(record.docComment === undefined ? {} : { docComment: record.docComment }) }
    // Group: the only IM chat type a backlog Delivery comes from today.
    : { ...core, source: 'im', chatType: 'group' }
}

/** A normalized admission result consumed by the controller. */
export type NormalizedLocusAdmission =
  | {
      readonly kind: 'accepted'
      readonly message: NormalizedLocusMessage
      // Reference the single source rather than restating the union: a local
      // copy here is what let `unusable` be admitted and then rejected.
      readonly authorization: AdmittableLocusAuthorization
      readonly needsInitialization: boolean
    }
  | {
      readonly kind: 'control'
      readonly message: NormalizedLocusMessage
      readonly command: LocusControlCommand
      // Reference the single source rather than restating the union: this
      // copy silently went stale when `unusable` was added.
      readonly authorization: LocusAuthorizationState
    }
  | {
      readonly kind: 'rejected'
      readonly reason:
        | LocusAdmissionRefusal
        | 'unsafe-reply-target'
        | 'invalid-event'
        // Doc-comment intake (D13); refused before any locus effect.
        | 'bot-sender'
        | 'comment-scope-unknown'
        | 'comment-reply-missing'
      readonly endpoint?: LocusEndpoint
    }

/** Raw or already normalized channel input. */
export type LocusChannelEvent = LarkInboundEvent | NormalizedLocusEvent

/** A locus row that is safe to publish to the channel. */
export interface ActiveLocus {
  /** Canonical locus id. */
  readonly id?: string
  /** Compatibility spelling used by older locus projections. */
  readonly locusId?: string
  readonly endpoint: LocusEndpoint
  readonly generation: number
  readonly parentSessionId: string
  /**
   * The child's id. A `not-created` generation has no child yet: this is then
   * the id the generation reserved, which its Deliveries already correlate by
   * and under which the first Delivery's queue creates the child.
   */
  readonly childSessionId: string
  /** Missing on legacy callers; child delivery refuses it before adoption. */
  readonly childComposition?: LocusChildComposition
  readonly workspaceId: string
  readonly state: 'active' | 'not-created'
  /** Durable policy projection that every ordinary Delivery must re-verify. */
  readonly permission?: LocusPermission
  readonly toolTier?: { readonly desired: 'safe' | 'shell'; readonly effective: 'safe' | 'shell' } | undefined
  /** Separately Host-authorized root required by effective write. */
  readonly contextAnchor?: NonNullable<LocusContextAnchor>
}

/** Request used when ensuring an endpoint's current locus. */
export interface EnsureLocusForDeliveryInput {
  readonly endpoint: LocusEndpoint
  readonly messageId: string
  readonly signal: AbortSignal
}

/**
 * Narrow locus-resolution port.
 *
 * `ensureForDelivery` is responsible for group/topic hierarchy, parent and
 * workspace validation, child provisioning, and conditional active publish.
 * It must not return an invalid, stopped, retired, legacy, or childless row.
 */
export type LocusResolutionRecord = Omit<ActiveLocus, 'childSessionId'> & {
  readonly childSessionId?: string
  readonly reservedChildSessionId?: string
}

export interface LocusResolutionPort {
  resolveCurrent(endpoint: LocusEndpoint): Awaitable<LocusResolutionRecord | undefined>
  ensureForDelivery(input: EnsureLocusForDeliveryInput): Awaitable<LocusResolutionRecord>
}

/** Exact identity of the parent and locus child used for one delivery. */
export interface LocusChildIdentity {
  readonly parentSessionId: string
  readonly childSessionId: string
}

/** Port for resolving/resuming and queueing one locus child. */
type ChildQueueResult =
  | { readonly accepted: true; readonly executionId: string; readonly inboxMessageId: string }
  | { readonly accepted: false; readonly reason: string }

type CurrentDeliveryInput = {
  locus: ActiveLocus
  child: LocusChildIdentity
  record: DeliveryRecord
  readonly message: NormalizedLocusMessage
  readonly signal: AbortSignal
}

type PreparedCurrentContent = {
  readonly typed: readonly ContentBlock[]
  readonly textFallback: readonly ContentBlock[]
  readonly hasImage: boolean
}

export interface LocusChildDeliveryPort {
  ensureChild(
    locus: ActiveLocus,
    signal: AbortSignal,
  ): Awaitable<LocusChildIdentity>
  queueChild(input: {
    readonly locus: ActiveLocus
    readonly child: LocusChildIdentity
    readonly deliveryId: string
    /** Controller-generated token, armed before the queue operation. */
    readonly executionId: string
    readonly content: readonly ContentBlock[]
    /** Revalidate exact-current immediately at the child queue seam. */
    readonly fenceBeforeQueue: () => Awaitable<boolean>
    readonly replyTarget: LocusReplyTarget
    readonly signal: AbortSignal
  }): Awaitable<
    | { readonly accepted: true; readonly executionId: string; readonly inboxMessageId: string }
    | { readonly accepted: false; readonly reason: string }
  >
}

/** Delivery input with trusted request metadata kept separate from routing. */
export type LocusDeliveryInput = DeliveryInput & {
  readonly senderOpenId: string
  readonly senderName?: string
  readonly text: string
  /** Bounded addressing facts; absent only for legacy/pre-admitted callers. */
  readonly addressing?: DeliveryAddressingProjection
  readonly replyTarget: LocusReplyTarget
  readonly replyToMessageId?: string
}

/** Minimum acceptance projection the channel needs from durable storage. */
type LocusDeliveryAcceptance = Pick<
  DeliveryAcceptance,
  'record' | 'duplicate' | 'conflict'
>

/**
 * Durable current-Delivery serialization seam.
 *
 * `LocusControllerDeps.deliveryDispatch` is REQUIRED in production: one
 * locus/generation/child/endpoint tuple may have at most one Delivery
 * in-flight at a time, and only a durable CAS claim can enforce that across
 * concurrent Feishu events, finish, expiry, and startup recovery. An isolated
 * unit test may still construct a controller with only `hasCurrent` (a
 * read-only probe) for cases that never exercise physical dispatch, but that
 * shape MUST NOT be composed by a production Host.
 */
export interface LocusDeliveryDispatchPort {
  /**
   * Atomically claim the exact accepted Delivery as current. A missing result
   * is not safe: the controller must leave the row in backlog rather than
   * enqueueing a second request. The returned record is the durable claim.
   */
  claimCurrent?(input: {
    readonly correlation: DeliveryCorrelation
    readonly deliveryId?: string
    readonly now: number
  }): Awaitable<DeliveryRecord | undefined>
  /** Read-only, exact-correlation backlog snapshot used to recheck shell-tier allowlisting before claim. */
  pendingForLocus?(correlation: DeliveryCorrelation): Awaitable<readonly DeliveryRecord[]>
  /** Read-only occupancy probe for isolated test adapters; never a claim. */
  hasCurrent?(correlation: DeliveryCorrelation): Awaitable<boolean>
  /** Optional notification after a Delivery reaches a business terminal state. */
  currentFinished?(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
  }): Awaitable<void>
  /** Dispatch the next durable backlog item after a terminal transition. */
  dispatchNext?(correlation: DeliveryCorrelation): Awaitable<void>
  /** Arm the Host deadline scheduler after a current row is durably bound. */
  scheduleCurrent?(record: DeliveryRecord): Awaitable<void>
}

/** Atomic Delivery persistence and exact per-turn settlement port. */
export interface LocusDeliveryLedgerPort {
  /** Optional early idempotency probe; it must return the immutable original row. */
  findByMessageId?(messageId: string): Awaitable<DeliveryRecord | undefined>
  /**
   * Exact durable lookup used to recover an already-queued Delivery after Host
   * restart. It never selects by child/FIFO and may return terminal history.
   */
  getById?(deliveryId: string): Awaitable<DeliveryRecord | undefined>
  /** Idempotent by message id; duplicate rows are returned unchanged. */
  accept(input: LocusDeliveryInput): Awaitable<LocusDeliveryAcceptance>
  /** Bind the child queue acceptance to the exact execution token. */
  bindQueued(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
    readonly executionId: string
    readonly inboxMessageId: string
    readonly queuedAt?: number
  }): Awaitable<DeliveryRecord | undefined>
  /** Bind the trusted per-turn identity once the inbox claim is observed. */
  bindTurn(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
    readonly executionId: string
    readonly turnId: string
    readonly startedAt?: number
  }): Awaitable<DeliveryRecord | undefined>
  /**
   * Settle only with a host-proven delivery id, execution id and turn
   * correlation.  Implementations MUST NOT fall back to child-id/FIFO lookup.
   */
  settleByTurn(input: {
    readonly deliveryId: string
    readonly executionId: string
    readonly correlation: DeliveryTurnCorrelation
    readonly outcome: 'settled' | 'failed'
    readonly settledAt: number
    readonly failureReason?: string
    readonly inboxMessageId?: string
    readonly expectedRevision?: number
  }): Awaitable<{ readonly changed: boolean; readonly record: DeliveryRecord | undefined; readonly reason?: string }>
  /** Host-side terminal disposition for a backlog/current item never injected into a child. */
  failBeforeDispatch(input: { readonly deliveryId: string; readonly correlation: DeliveryCorrelation; readonly reason: string; readonly executionId?: string; readonly failedAt?: number }): Awaitable<boolean>
  /** Atomically promote one accepted/backlog Delivery to current. */
  claimCurrent?(input: {
    readonly correlation: DeliveryCorrelation
    readonly deliveryId: string
    readonly now: number
  }): Awaitable<DeliveryRecord | undefined>
  /** Optional queue-refusal probe; it must not claim terminal turn failure. */
  fail?(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
    readonly executionId?: string
    readonly reason: string
  }): Awaitable<boolean | void>
}

/** Required observer contract; activation-only observers are not accepted. */
export interface LocusTurnCorrelationObserver {
  readonly perTurnCorrelation: true
  subscribe(listener: (event: LocusTurnCorrelationEvent) => void): (() => void)
  /** Wake an exact claim after its durable inbox-message binding commits. */
  deliveryAvailable?(input: {
    readonly childSessionId: string
    readonly messageId: string
  }): void
}

/** Per-turn execution identity emitted by a trusted host adapter. */
export interface LocusTurnCorrelationEvent {
  readonly phase: 'started' | 'completed' | 'failed'
  readonly deliveryId: string
  readonly executionId: string
  readonly turnId: string
  readonly correlation: DeliveryCorrelation
  readonly reason?: string
  readonly cancelReason?: 'user' | 'parent' | 'disposed'
}

/** Mechanical receipt/reaction port.  Failures are always fail-soft. */
export interface LocusMechanicalReceiptPort {
  markAccepted(target: DeliveryFeedbackTarget): Awaitable<void>
  markSettled(target: DeliveryFeedbackTarget, outcome: 'settled' | 'failed'): Awaitable<void>
  /** Only for control/diagnostic messages, never business transcript text. */
  /** `senderOpenId` lets a doc answer mention the asker (whole-doc comments cannot be replied to). */
  sendControl?(target: LocusReplyTarget, text: string, senderOpenId?: string): Awaitable<void>
}

/**
 * Physically separate business-reply port.  The controller intentionally never
 * calls this: business text belongs to the child session's Feishu capability.
 */
export interface LocusBusinessReplyPort {
  send(input: { readonly target: LocusReplyTarget; readonly text: string }): Awaitable<void>
}

const DEFAULT_CAPACITY_RETRY_MS = 5_000

/** Controller dependencies. */
export interface LocusControllerDeps {
  readonly locus: LocusResolutionPort
  /**
   * Whether this document has ever had ANY entry (root or comment, any state).
   * Asked once, before a doc entry is provisioned; `false` means this is the
   * document's first entry and the ask-scope disclosure is owed (D7). Derived
   * from durable loci, so no extra "disclosed" flag is stored. Absent: never
   * disclose (fail-soft, nothing is sent).
   */
  readonly docHasEntries?: (chatId: string) => Awaitable<boolean>
  /** Disclosure text for a document's first entry (D7). */
  readonly docDisclosureText?: string
  readonly deliveries: LocusDeliveryLedgerPort
  /** Required current/backlog dispatcher seam for serialized locus intake. */
  readonly deliveryDispatch: LocusDeliveryDispatchPort
  readonly child: LocusChildDeliveryPort
  /** Inspect only an already-resident agent; never resume a child for policy reads. */
  readonly inspectResidentPolicy?: (childSessionId: string) =>
    | { readonly resident: false }
    | { readonly resident: true; readonly policy?: LocusLiveSandboxPolicy }
  /** Optional Host-owned current-message image admission. */
  readonly media?: LocusMediaPort
  /**
   * Async Host enrichment seam. Admission stays synchronous/pure; this lookup
   * runs before durable acceptance and never classifies from flattened text.
   */
  readonly addressing?: {
    listChatBots(chatId: string): Awaitable<
      | readonly { readonly openId: string }[]
      | { readonly kind: 'ok'; readonly bots: readonly { readonly openId: string }[] }
      | { readonly kind: 'permission-denied' | 'error' }
    >
    /**
     * Resolve one chat member's display name.
     *
     * The delivery prompt asks the agent to address people by display name, so a
     * prompt reporting only an `ou_…` invites it to write that identifier —
     * which renders as plain text and publishes the id. Optional: without it the
     * prompt keeps the open id alone.
     */
    resolveMemberName?(chatId: string, openId: string): Awaitable<string | undefined>
  }
  /** Delay before retrying a first-child creation the runtime refused for lack of a free slot. */
  readonly capacityRetryMs?: number
  /** Persistently pause/invalid the current generation when policy proof drifts. */
  readonly invalidatePolicyDrift?: (input: {
    readonly locus: ActiveLocus
    readonly reason: string
  }) => Awaitable<void>
  /**
   * Render the Host-bound per-delivery taskbook. Production supplies this so
   * the child sees the exact immutable reply target and locus facts instead of
   * receiving untrusted message text as its whole prompt.
   */
  /**
   * Render one delivery prompt.
   *
   * Allowed to be asynchronous: the renderer measures this entrance's read
   * capability before it can truthfully declare it, and that measurement is
   * bounded but not instantaneous. The controller re-proves the exact current
   * after this resolves, so a locus rebuilt or disabled during the measurement
   * cannot have its stale prompt delivered. The caller's signal is passed so
   * an aborted delivery cancels the measurement instead of adopting its result.
   */
  readonly renderPrompt?: (input: {
    readonly locus: ActiveLocus
    readonly message: NormalizedLocusMessage
    readonly signal: AbortSignal
  }) => string | Promise<string>
  /** Required for publishing; missing/invalid means fail closed. */
  readonly turns?: LocusTurnCorrelationObserver
  readonly receipts?: LocusMechanicalReceiptPort
  /** Kept separate for integration typing; never called by this controller. */
  readonly businessReply?: LocusBusinessReplyPort
  /**
   * Optional Host-owned control plane. Admission has already verified the bot
   * mention and allowlist before this port is called. Control commands never
   * enter Delivery or child queueing; the port only receives the exact
   * endpoint and sender facts needed to resolve the current locus safely.
   */
  readonly controlDispatch?: LocusControlDispatchPort
  readonly admissionContext?: LocusAdmissionContext | (() => LocusAdmissionContext)
  /** Authoritative allowlist snapshot used again at the durable claim boundary. */
  readonly allowOpenIds?: () => readonly string[]
  readonly currentToolTier?: (endpoint: LocusEndpoint) => 'safe' | 'shell' | undefined
  /** Receives the same admission allowlist snapshot used for owner-only checks. */
  readonly readAllowOpenIds?: () => readonly string[]
  readonly now?: () => number
  readonly signal?: AbortSignal
  readonly log?: (code: LocusControllerDiagnostic) => void
}

/** Stable diagnostics with no message body or external identifier. */
export type LocusControllerDiagnostic =
  | 'turn-correlation-unavailable'
  | 'invalid-event'
  | 'admission-rejected'
  /**
   * Admission refusals, reported with their exact reason.
   *
   * `admission-rejected` alone cannot be acted on: every refusal looks the
   * same in the log, so an operator cannot tell a genuine non-mention from a
   * watermark/dedup/authorization problem without attaching a debugger. Each
   * reason below is already a closed, stable code carrying no message body
   * and no external identifier, so surfacing it keeps the same privacy
   * boundary as the rest of this union.
   */
  | `admission-rejected:${Extract<NormalizedLocusAdmission, { kind: 'rejected' }>['reason']}`
  | 'control-command'
  | 'locus-unavailable'
  // Distinguish WHY a locus could not be resolved. Without these, a reader
  // failure and a refused bootstrap both surface as the single
  // `locus-unavailable` code, which is undiagnosable from logs alone.
  | 'locus-read-failed'
  | 'locus-bootstrap-failed'
  | 'locus-bootstrap-skipped'
  | 'child-unavailable'
  | 'child-identity-mismatch'
  | 'policy-drift'
  /**
   * Live policy could not be READ (not a mismatch). The generation is retired
   * and rebuilt once so the delivery is still served; this code is logged only
   * when that repair also failed and the message was refused.
   */
  | 'policy-unreadable'
  /** The unreadable generation was retired and a fresh one served this delivery. */
  | 'policy-generation-rebuilt'
  | 'delivery-persistence-failed'
  | 'delivery-conflict'
  | 'duplicate-delivery'
  | 'queue-failed'
  | 'child-capacity-exhausted'
  | 'dispatch-state-unknown'
  | 'settlement-ignored'
  | 'shutdown-frozen'

/** Result of one event. */
export type LocusControllerResult =
  | {
      readonly kind: 'accepted'
      readonly deliveryId: string
      readonly executionId: string
      readonly locusId: string
      readonly generation: number
    }
  | {
      readonly kind: 'duplicate'
      readonly deliveryId: string
      readonly locusId: string
      readonly generation: number
    }
  | {
      readonly kind: 'control'
      readonly command: LocusControlCommand
      readonly ok?: boolean
      readonly reason?: string
      readonly text?: string
    }
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'refused'; readonly reason: LocusControllerRefusal }

export type LocusControllerRefusal =
  | 'turn-correlation-unavailable'
  | 'invalid-event'
  | 'admission-unavailable'
  | 'locus-unavailable'
  | 'child-unavailable'
  | 'child-identity-mismatch'
  | 'policy-drift'
  /**
   * Live policy could not be READ (not a mismatch). The generation is retired
   * and rebuilt once so the delivery is still served; this refusal is reported
   * only when that repair also failed.
   */
  | 'policy-unreadable'
  | 'delivery-persistence-failed'
  | 'delivery-conflict'
  | 'queue-failed'
  | 'dispatch-state-unknown'
  | 'aborted'
  | 'shutdown-frozen'

interface PendingTurn {
  readonly deliveryId: string
  executionId: string
  correlation: DeliveryCorrelation
  readonly target: DeliveryFeedbackTarget
  /** True while queue acceptance has not yet been durably bound. */
  dispatching: boolean
  /** The first exact turn identity observed for this execution. */
  startedTurnId?: string
  /** Exact official cancellation buffered until its queue/turn binding is durable. */
  interruptedTurnId?: string
  /** Conflicting observer evidence permanently blocks turn binding. */
  conflicted?: boolean
  /** Serialize observer callbacks for this delivery. */
  operation?: Promise<void>
}

const EMPTY_SIGNAL = new AbortController().signal

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isControlDispatchResult(value: unknown): value is LocusControlDispatchResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok === true) return nonEmpty(value.text) && (value.reason === undefined || nonEmpty(value.reason))
  if (!nonEmpty(value.reason)) return false
  return value.silent === true ? value.text === undefined : nonEmpty(value.text)
}

function controlValidationText(command: LocusControlCommand): string {
  switch (command.kind) {
    case 'bind-missing-prefix':
      return '请提供至少 6 位的主会话 id 前缀。'
    case 'bind':
      return '会话 id 前缀太短，请至少提供 6 位。'
    case 'bind-invalid':
      return '绑定命令只接受一个会话 id 前缀。'
    case 'scope-missing-mode':
      return '请指定共享权限：read 或 write。'
    case 'scope-invalid':
      return '共享权限只能是 read 或 write。'
    case 'tools-missing-tier':
      return '请指定工具档位：safe 或 shell。'
    case 'tools-invalid':
      return '工具档位只能是 safe 或 shell。'
    case 'unbind-invalid':
      return '解绑命令不接受参数。'
    default:
      return '控制命令格式无效。'
  }
}

function endpointKey(endpoint: LocusEndpoint): string {
  return normalizeLocusEndpoint(endpoint).key
}

function sameEndpoint(left: LocusEndpoint, right: LocusEndpoint): boolean {
  try {
    return endpointKey(left) === endpointKey(right)
  } catch {
    return false
  }
}

function locusIdOf(locus: ActiveLocus): string | undefined {
  return nonEmpty(locus.locusId) ? locus.locusId.trim() : nonEmpty(locus.id) ? locus.id.trim() : undefined
}

function normalizeActiveLocus(raw: unknown, expected: LocusEndpoint): ActiveLocus | undefined {
  if (!isRecord(raw)) return undefined
  const endpoint = raw.endpoint
  if (!isRecord(endpoint) || !nonEmpty(endpoint.chatId)) return undefined
  const locusEndpoint: LocusEndpoint = {
    chatId: endpoint.chatId.trim(),
    ...(nonEmpty(endpoint.threadId) ? { threadId: endpoint.threadId.trim() } : {}),
  }
  if (!sameEndpoint(locusEndpoint, expected)) return undefined
  if (raw.state !== 'active' && raw.state !== 'not-created') return undefined
  const state: 'active' | 'not-created' = raw.state
  const generation = raw.generation
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1) return undefined
  const id = nonEmpty(raw.id) ? raw.id.trim() : undefined
  const locusId = nonEmpty(raw.locusId) ? raw.locusId.trim() : undefined
  if (id === undefined && locusId === undefined) return undefined
  const childIdentity = state === 'active' ? raw.childSessionId : raw.reservedChildSessionId
  if (!nonEmpty(raw.parentSessionId) || !nonEmpty(childIdentity) || !nonEmpty(raw.workspaceId)) {
    return undefined
  }
  const permission = raw.permission
  if (
    !isRecord(permission) ||
    (permission.desired !== 'read' && permission.desired !== 'write') ||
    (permission.effective !== 'read' && permission.effective !== 'write')
  ) return undefined
  const contextAnchor = isRecord(raw.contextAnchor)
    ? raw.contextAnchor as unknown as NonNullable<LocusContextAnchor>
    : undefined
  // Carry the durable safe-composition proof through this normalizer. Child
  // delivery refuses any locus that does not present it, so dropping the field
  // here (while the record has it) rejects every delivery with a generic
  // `child-unavailable`. Only the proven value is copied: an unrecognized
  // composition stays absent and the downstream guard keeps failing closed.
  const childComposition = state === 'active' && raw.childComposition === LOCUS_SAFE_CHILD_COMPOSITION
    ? LOCUS_SAFE_CHILD_COMPOSITION
    : undefined
  const toolTier = isRecord(raw.toolTier)
    && (raw.toolTier.effective === 'safe' || raw.toolTier.effective === 'shell')
    && (raw.toolTier.desired === 'safe' || raw.toolTier.desired === 'shell')
    ? raw.toolTier as unknown as { readonly desired: 'safe' | 'shell'; readonly effective: 'safe' | 'shell' }
    : undefined
  return {
    ...(id !== undefined ? { id } : {}),
    ...(locusId !== undefined ? { locusId } : {}),
    endpoint: locusEndpoint,
    generation,
    parentSessionId: raw.parentSessionId.trim(),
    childSessionId: childIdentity.trim(),
    workspaceId: raw.workspaceId.trim(),
    state,
    permission: permission as unknown as LocusPermission,
    ...(childComposition === undefined ? {} : { childComposition }),
    ...(toolTier === undefined ? {} : { toolTier }),
    ...(contextAnchor === undefined ? {} : { contextAnchor }),
  }
}

function toWireEvent(input: LocusChannelEvent): LarkInboundEvent {
  if ((input as NormalizedLocusEvent).messageId !== undefined) {
    const normalized = input as NormalizedLocusEvent
    return {
      type: normalized.type,
      message_id: normalized.messageId,
      chat_id: normalized.chatId,
      chat_type: normalized.chatType,
      message_type: normalized.messageType,
      content: normalized.text,
      ...(normalized.createdAt !== undefined ? { create_time: String(normalized.createdAt) } : {}),
      sender_id: normalized.senderOpenId,
      ...(normalized.senderType !== undefined ? { sender_type: normalized.senderType } : {}),
      ...(normalized.rootId !== undefined ? { root_id: normalized.rootId } : {}),
      ...(normalized.replyTo !== undefined ? { reply_to: normalized.replyTo } : {}),
      ...(normalized.threadId !== undefined ? { thread_id: normalized.threadId } : {}),
      mentions: normalized.mentions,
    }
  }
  return input as LarkInboundEvent
}

/** Normalize transport fields without widening a thread to its chat. */
export function normalizeLocusEvent(input: LocusChannelEvent): NormalizedLocusEvent {
  const candidate = input as Partial<NormalizedLocusEvent> & Partial<LarkInboundEvent>
  const messageId = candidate.messageId ?? candidate.message_id
  const chatId = candidate.chatId ?? candidate.chat_id
  const chatType = candidate.chatType ?? candidate.chat_type
  const messageType = candidate.messageType ?? candidate.message_type
  const text = candidate.text ?? candidate.content
  const senderOpenId = candidate.senderOpenId ?? candidate.sender_id
  const createdAtRaw = candidate.createdAt ?? candidate.create_time
  const createdAt =
    typeof createdAtRaw === 'number'
      ? createdAtRaw
      : typeof createdAtRaw === 'string' && createdAtRaw.trim() !== ''
        ? Number(createdAtRaw)
        : undefined
  if (
    candidate.type !== 'im.message.receive_v1' ||
    !nonEmpty(messageId) ||
    !nonEmpty(chatId) ||
    (chatType !== 'p2p' && chatType !== 'group') ||
    !nonEmpty(messageType) ||
    typeof text !== 'string' ||
    !nonEmpty(senderOpenId)
  ) {
    throw new TypeError('invalid locus event')
  }
  const mentions = Array.isArray(candidate.mentions)
    ? candidate.mentions.map(item => {
        if (!isRecord(item)) return {}
        return {
          ...(nonEmpty(item.id) ? { id: item.id.trim() } : {}),
          ...(nonEmpty(item.key) ? { key: item.key.trim() } : {}),
          ...(nonEmpty(item.name) ? { name: item.name.trim() } : {}),
        }
      })
    : []
  return Object.freeze({
    type: 'im.message.receive_v1',
    messageId: messageId.trim(),
    chatId: chatId.trim(),
    chatType,
    messageType: messageType.trim(),
    text,
    ...(createdAt !== undefined && Number.isFinite(createdAt) ? { createdAt } : {}),
    senderOpenId: senderOpenId.trim(),
    ...(nonEmpty(candidate.senderType) ? { senderType: candidate.senderType.trim() } : {}),
    ...(nonEmpty(candidate.rootId) ? { rootId: candidate.rootId.trim() } : nonEmpty(candidate.root_id) ? { rootId: candidate.root_id.trim() } : {}),
    ...(nonEmpty(candidate.replyTo) ? { replyTo: candidate.replyTo.trim() } : nonEmpty(candidate.reply_to) ? { replyTo: candidate.reply_to.trim() } : {}),
    ...(nonEmpty(candidate.threadId) ? { threadId: candidate.threadId.trim() } : nonEmpty(candidate.thread_id) ? { threadId: candidate.thread_id.trim() } : {}),
    mentions,
  })
}

function messageFromAdmission(
  event: NormalizedLocusEvent,
  decision: LocusAdmission,
  selfOpenId?: string,
): NormalizedLocusMessage | undefined {
  const endpoint: LocusEndpoint = {
    chatId: decision.endpoint.chatId,
    ...(decision.endpoint.threadId !== undefined ? { threadId: decision.endpoint.threadId } : {}),
  }
  // `root_id` is a THREAD fact only where a thread exists: inside a topic it is
  // that topic's root message.  On the chat timeline a quoted message also sets
  // `root_id`, but there it is the root of a reply chain — not a thread root —
  // so recording it would both mislabel the Delivery and make the child prompt
  // claim a thread that does not exist.  The quoted message itself still travels
  // as `replyToMessageId`.
  const replyTarget: LocusReplyTarget = {
    chatId: endpoint.chatId,
    messageId: event.messageId,
    ...(endpoint.threadId !== undefined ? { threadId: endpoint.threadId } : {}),
    ...(endpoint.threadId !== undefined && event.rootId !== undefined
      ? { rootMessageId: event.rootId }
      : {}),
  }
  if (!isSafeLocusReplyTarget(endpoint, replyTarget)) return undefined
  return {
    kind: 'message',
    messageId: event.messageId,
    endpoint,
    chatType: event.chatType,
    senderOpenId: decision.senderId,
    text: decision.text,
    addressing: projectDeliveryAddressing({
      mentions: event.mentions,
      ...(selfOpenId === undefined ? {} : { selfOpenId }),
      // Event arrays preserve occurrence order; membership enrichment happens
      // asynchronously inside the controller before durable acceptance.
      orderKnown: true,
    }),
    replyTarget,
    ...(event.replyTo !== undefined ? { replyToMessageId: event.replyTo } : {}),
    ...(event.createdAt !== undefined ? { createdAt: event.createdAt } : {}),
  }
}

/** Run the existing pure admission gauntlet and normalize its trusted output. */
export function admitNormalizedLocusEvent(
  input: LocusChannelEvent,
  context: LocusAdmissionContext,
): NormalizedLocusAdmission {
  let event: NormalizedLocusEvent
  try {
    event = normalizeLocusEvent(input)
  } catch {
    return { kind: 'rejected', reason: 'invalid-event' }
  }
  let decision: LocusAdmissionDecision
  try {
    decision = admitLocusEvent(toWireEvent(event), context)
  } catch {
    return { kind: 'rejected', reason: 'invalid-event' }
  }
  if (!decision.admit) {
    const endpoint = decision.endpoint === undefined
      ? undefined
      : {
          chatId: decision.endpoint.chatId,
          ...(decision.endpoint.threadId !== undefined ? { threadId: decision.endpoint.threadId } : {}),
        }
    return { kind: 'rejected', reason: decision.reason, ...(endpoint !== undefined ? { endpoint } : {}) }
  }
  const message = messageFromAdmission(event, decision, context.botOpenId)
  if (message === undefined) return { kind: 'rejected', reason: 'unsafe-reply-target' }
  if (decision.command !== undefined) {
    return { kind: 'control', message, command: decision.command, authorization: decision.authorization }
  }
  if (!isAdmittableAuthorization(decision.authorization)) {
    return { kind: 'rejected', reason: 'authorization-unresolved' }
  }
  return {
    kind: 'accepted',
    message,
    authorization: decision.authorization,
    needsInitialization: decision.needsInitialization,
  }
}

function validObserver(value: unknown): value is LocusTurnCorrelationObserver {
  return (
    isRecord(value) &&
    value.perTurnCorrelation === true &&
    typeof value.subscribe === 'function'
  )
}

function isDeliveryCorrelation(value: unknown): value is DeliveryCorrelation {
  if (!isRecord(value)) return false
  const endpoint = value.endpoint
  if (!isRecord(endpoint) || !nonEmpty(endpoint.chatId)) return false
  if (endpoint.threadId !== undefined && !nonEmpty(endpoint.threadId)) return false
  return (
    nonEmpty(value.locusId) &&
    nonEmpty(value.childSessionId) &&
    typeof value.generation === 'number' &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 1
  )
}

function exactCorrelation(left: DeliveryCorrelation, right: DeliveryCorrelation): boolean {
  return (
    isDeliveryCorrelation(left) &&
    isDeliveryCorrelation(right) &&
    left.locusId === right.locusId &&
    left.generation === right.generation &&
    left.childSessionId === right.childSessionId &&
    sameEndpoint(left.endpoint, right.endpoint)
  )
}

function deliveryIdOf(locus: ActiveLocus): string {
  const id = locusIdOf(locus)
  if (id === undefined) throw new TypeError('active locus has no id')
  return id
}

/** Stable local lane key; the durable locus/generation/child tuple remains authoritative. */
function dispatchLaneKey(correlation: DeliveryCorrelation): string {
  return [
    correlation.locusId,
    String(correlation.generation),
    correlation.childSessionId,
    endpointKey(correlation.endpoint),
  ].join('\u0000')
}

/**
 * Controller for ordinary Feishu deliveries into a unified locus child.
 */
export class LocusChannelController {
  private readonly now: () => number
  private readonly signal: AbortSignal
  private readonly pending = new Map<string, PendingTurn>()
  /** Serialize acceptance and physical dispatch for one exact locus locally. */
  private readonly dispatchTails = new Map<string, Promise<void>>()
  /** Retry timers for Deliveries waiting on a free child slot, by Delivery id. */
  private readonly capacityRetries = new Map<string, ReturnType<typeof setTimeout>>()
  /** Deliveries whose owner was already told the request is being kept. */
  private readonly capacityNotified = new Set<string>()
  private readonly unsubscribe: (() => void) | undefined
  private observerReady: boolean
  private lifecycle: 'active' | 'frozen' | 'disposed' = 'active'
  /** Admission, management and observation work; never the native model turn. */
  private readonly operations = new Set<Promise<unknown>>()
  private readonly suppressedDispatches = new Map<string, { correlation: DeliveryCorrelation; deliveryId?: string }>()

  constructor(private readonly deps: LocusControllerDeps) {
    this.now = deps.now ?? Date.now
    this.signal = deps.signal ?? EMPTY_SIGNAL
    this.observerReady = validObserver(deps.turns)
    this.unsubscribe = this.observerReady ? this.subscribeObserver(deps.turns!) : undefined
    if (this.unsubscribe === undefined) this.observerReady = false
  }

  /** True only when strict per-turn observation was subscribed successfully. */
  get available(): boolean {
    return this.observerReady
  }

  /** Close admission synchronously, then await entered mutations and queue bindings. */
  async freezeForShutdown(): Promise<void> {
    if (this.lifecycle === 'disposed') return
    this.lifecycle = 'frozen'
    while (this.operations.size > 0) await Promise.allSettled([...this.operations])
  }

  /** The owner calls this only after its native drain has actually ended. */
  async resumeAfterShutdown(): Promise<void> {
    if (this.lifecycle !== 'frozen') return
    await this.freezeForShutdown()
    if (this.lifecycle !== 'frozen') return
    this.lifecycle = 'active'
    const suppressed = [...this.suppressedDispatches.values()]
    this.suppressedDispatches.clear()
    await Promise.all(suppressed.map(async ({ correlation, deliveryId }) => {
      if (deliveryId !== undefined) await this.retryFirstChild(deliveryId, correlation)
      await this.dispatchNext(correlation)
    }))
  }

  /** Management mutations share the controller's admission and drain boundary. */
  async runWhileActive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.lifecycle !== 'active') {
      throw Object.assign(new Error('Locus controller is frozen for shutdown.'), { code: 'LOCUS_SHUTDOWN_FROZEN' })
    }
    return this.trackOperation(operation)
  }

  private trackOperation<T>(operation: () => Promise<T>): Promise<T> {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason: unknown) => void
    const current = new Promise<T>((done, fail) => { resolve = done; reject = fail })
    this.operations.add(current)
    const release = () => { this.operations.delete(current) }
    void current.then(release, release)
    try { void operation().then(resolve, reject) } catch (error) { reject(error) }
    return current
  }

  private suppressDispatch(correlation: DeliveryCorrelation, deliveryId?: string): void {
    if (this.lifecycle === 'disposed') return
    const key = dispatchLaneKey(correlation)
    const retryId = deliveryId ?? this.suppressedDispatches.get(key)?.deliveryId
    this.suppressedDispatches.set(key, { correlation, ...(retryId === undefined ? {} : { deliveryId: retryId }) })
  }

  /**
   * Remove the in-memory execution binding after a business terminal CAS.
   * `turn/end` is intentionally not used here: only the durable lifecycle owns
   * this transition.  The mechanical receipt is best-effort and never changes
   * the durable result.
   */
  currentFinished(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
    readonly outcome?: 'settled' | 'failed'
  }): void {
    const pending = this.pending.get(input.deliveryId)
    if (pending === undefined || !exactCorrelation(pending.correlation, input.correlation)) return
    this.pending.delete(input.deliveryId)
    void this.trackOperation(() => this.receiptSettled(pending.target, input.outcome ?? 'settled'))
  }

  /**
   * Claim and queue the oldest durable backlog Delivery after a terminal or
   * expiry transition.  This is the same queue/bind/observer fence used by
   * intake; calling `handle()` with the stored message would hit idempotency
   * and never physically dispatch the backlog row.
   */
  async dispatchNext(correlation: DeliveryCorrelation): Promise<void> {
    if (!this.available || this.signal.aborted) return
    if (this.lifecycle !== 'active') {
      this.suppressDispatch(correlation)
      return
    }
    await this.trackOperation(() => this.dispatchNextActive(correlation))
  }

  private async dispatchNextActive(correlation: DeliveryCorrelation): Promise<void> {
    await this.enqueueDispatchLane(correlation, async () => {
      if (this.lifecycle !== 'active') { this.suppressDispatch(correlation); return }
      let claimed: DeliveryRecord | undefined
      try {
        let refreshedLocus: unknown
        try {
          refreshedLocus = await this.deps.locus.resolveCurrent(correlation.endpoint)
        } catch {
          this.log('dispatch-state-unknown')
          return
        }
        const currentLocus = normalizeActiveLocus(refreshedLocus, correlation.endpoint)
        if (currentLocus !== undefined && currentLocus.state === 'not-created' && locusIdOf(currentLocus) === correlation.locusId &&
            currentLocus.generation === correlation.generation && currentLocus.childSessionId !== correlation.childSessionId) {
          // A failed creation consumed its reserved Session id. Its unissued
          // backlog was atomically retargeted within the SAME generation.
          queueMicrotask(() => { void this.dispatchNext({ ...correlation, childSessionId: currentLocus.childSessionId }).catch(() => this.log('dispatch-state-unknown')) })
          return
        }
        if (currentLocus === undefined || locusIdOf(currentLocus) !== correlation.locusId
          || currentLocus.generation !== correlation.generation || currentLocus.childSessionId !== correlation.childSessionId) {
          this.log('dispatch-state-unknown')
          return
        }
        const shellTier = currentLocus.toolTier?.effective === 'shell'
        let allowOpenIds: readonly string[] | undefined
        try {
          allowOpenIds = this.deps.readAllowOpenIds?.() ?? this.deps.allowOpenIds?.()
        } catch {
          allowOpenIds = undefined
        }
        if (shellTier && allowOpenIds === undefined) {
          this.log('dispatch-state-unknown')
          return
        }
        const backlog = await this.deps.deliveryDispatch.pendingForLocus?.(correlation)
        if (shellTier && backlog === undefined) {
          this.log('dispatch-state-unknown')
          return
        }
        let dispatchDeliveryId: string | undefined
        if (shellTier) {
          for (const delivery of backlog ?? []) {
            if (delivery.status !== 'accepted' && delivery.status !== 'queued') continue
            if (delivery.senderOpenId !== undefined && allowOpenIds!.includes(delivery.senderOpenId)) {
              dispatchDeliveryId = delivery.deliveryId
              break
            }
            let settled = false
            try {
              settled = await this.deps.deliveries.failBeforeDispatch({
                deliveryId: delivery.deliveryId,
                correlation,
                reason: 'owner-only-tier',
                ...(delivery.executionId === undefined ? {} : { executionId: delivery.executionId }),
                failedAt: this.now(),
              })
            } catch {
              this.log('delivery-persistence-failed')
              return
            }
            if (settled) {
              await this.receiptSettled(delivery.feedbackTarget, 'failed')
              await this.sendControlReceipt(delivery.feedbackTarget, '当前入口为所有者专用，该排队请求未投递；所有者可将工具档位切回 safe。', delivery.senderOpenId)
            } else {
              // The row moved after our snapshot (for example, a durable lease
              // transition). Do not guess at its new sender/status; another
              // dispatcher pass will reread the lane.
              return
            }
          }
        }
        if (this.lifecycle !== 'active') { this.suppressDispatch(correlation); return }
        if (!shellTier || dispatchDeliveryId !== undefined) {
          claimed = await this.deps.deliveryDispatch.claimCurrent?.({
            correlation,
            ...(dispatchDeliveryId === undefined ? {} : { deliveryId: dispatchDeliveryId }),
            now: this.now(),
          })
        }
      } catch {
        this.log('delivery-persistence-failed')
        return
      }
      if (
        claimed === undefined ||
        claimed.status !== 'current' ||
        claimed.queueState !== 'current' ||
        !exactCorrelation(claimed, correlation)
      ) return
      await this.dispatchClaimed(claimed, correlation)
    })
  }

  /**
   * Resolve the generation for one durably claimed current Delivery and put it
   * in front of its child: an existing child gets a queued prompt; a generation
   * with no child yet creates it with this Delivery as the first prompt.
   */
  private async dispatchClaimed(claimed: DeliveryRecord, correlation: DeliveryCorrelation): Promise<void> {
    if (this.lifecycle !== 'active') { this.suppressDispatch(correlation, claimed.deliveryId); return }
    // Arm the durable lease before runtime lookup or child/policy checks. If
    // dispatch cannot bind the inbox, expiry still revokes this current claim
    // and a later dispatcher pass can make progress.
    try {
      await this.deps.deliveryDispatch.scheduleCurrent?.(claimed)
    } catch {
      this.log('delivery-persistence-failed')
    }
    const locus = await this.resolveLocus(
      correlation.endpoint,
      messageFromDeliveryRecord(claimed, correlation.endpoint),
      false,
      this.signal,
    )
    if (this.lifecycle !== 'active') { this.suppressDispatch(correlation, claimed.deliveryId); return }
    if (
      locus === undefined ||
      locus.childSessionId !== claimed.childSessionId ||
      locus.generation !== claimed.generation ||
      locusIdOf(locus) !== claimed.locusId ||
      !nonEmpty(claimed.senderOpenId) ||
      !nonEmpty(claimed.text)
    ) {
      this.log('dispatch-state-unknown')
      return
    }
    let child: LocusChildIdentity
    try {
      child = await this.deps.child.ensureChild(locus, this.signal)
    } catch {
      this.log('child-unavailable')
      return
    }
    if (
      child.parentSessionId !== locus.parentSessionId ||
      child.childSessionId !== claimed.childSessionId
    ) {
      this.log('child-identity-mismatch')
      return
    }
    const policy = this.verifyPersistedPolicy(locus)
    if (!policy.ok) {
      this.log('policy-drift')
      return
    }
    await this.queueClaimedDelivery({
      locus,
      child,
      record: claimed,
      message: messageFromDeliveryRecord(claimed, correlation.endpoint),
      signal: this.signal,
    })
  }

  /**
   * Retry creating a generation's first child for a Delivery that is still the
   * durable current and was never handed to a child — the runtime's active-child
   * limit was full when it was tried. The Delivery is neither settled nor
   * replaced, and retrying stops with the Delivery's own lease: expiry settles
   * it exactly as it settles any current that never ran.
   */
  private async retryFirstChild(deliveryId: string, correlation: DeliveryCorrelation): Promise<void> {
    if (!this.available || this.signal.aborted) return
    if (this.lifecycle !== 'active') { this.suppressDispatch(correlation, deliveryId); return }
    await this.trackOperation(() => this.retryFirstChildActive(deliveryId, correlation))
  }

  private async retryFirstChildActive(deliveryId: string, correlation: DeliveryCorrelation): Promise<void> {
    await this.enqueueDispatchLane(correlation, async () => {
      let record: DeliveryRecord | undefined
      try { record = await this.deps.deliveries.getById?.(deliveryId) } catch { record = undefined }
      if (
        record === undefined ||
        record.status !== 'current' ||
        record.queueState !== 'current' ||
        record.executionId !== undefined ||
        !exactCorrelation(record, correlation) ||
        this.now() >= (record.deadlineAt ?? 0)
      ) return
      await this.dispatchClaimed(record, correlation)
    })
  }

  /** Keep a Delivery that could not get a child slot, and try again shortly. */
  private waitForChildCapacity(record: DeliveryRecord, correlation: DeliveryCorrelation): void {
    this.log('child-capacity-exhausted')
    if (this.capacityRetries.has(record.deliveryId)) clearTimeout(this.capacityRetries.get(record.deliveryId))
    const timer = setTimeout(() => {
      this.capacityRetries.delete(record.deliveryId)
      void this.retryFirstChild(record.deliveryId, correlation).catch(() => {
        this.log('delivery-persistence-failed')
      })
    }, this.deps.capacityRetryMs ?? DEFAULT_CAPACITY_RETRY_MS)
    // A pending retry never keeps the process alive on its own.
    timer.unref?.()
    this.capacityRetries.set(record.deliveryId, timer)
  }

  dispose(): void {
    this.lifecycle = 'disposed'
    this.suppressedDispatches.clear()
    try {
      this.unsubscribe?.()
    } catch {
      // Host teardown is fail-soft and never sends a parent/business message.
    }
    for (const timer of this.capacityRetries.values()) clearTimeout(timer)
    this.capacityRetries.clear()
    this.capacityNotified.clear()
    this.pending.clear()
    this.dispatchTails.clear()
    this.observerReady = false
  }

  /** Handle a raw or normalized event after the observer capability gate. */
  async handle(
    input: LocusChannelEvent,
    suppliedContext?: LocusAdmissionContext,
  ): Promise<LocusControllerResult> {
    if (!this.available) return this.refuse('turn-correlation-unavailable')
    if (this.signal.aborted) return this.refuse('aborted')
    if (this.lifecycle !== 'active') return this.refuse('shutdown-frozen')
    return this.trackOperation(async () => {
      // The watermark belongs to the currently running subscription generation.
      const context = suppliedContext ?? this.readAdmissionContext()
      if (context === undefined) return this.refuse('admission-unavailable')
      const admission = admitNormalizedLocusEvent(input, context)
      return this.consumeAdmission(admission, context, input)
    })
  }

  private async enrichAddressing(message: NormalizedLocusMessage): Promise<NormalizedLocusMessage> {
    const named = await this.withSenderName(message)
    const original = named.addressing ?? historicalUnknownAddressing()
    const normalized = named.addressing === undefined ? { ...named, addressing: original } : named
    const port = this.deps.addressing
    // Chat bot membership only exists for IM groups.
    if (port === undefined || named.source === 'doc-comment' || named.chatType !== 'group') return normalized
    try {
      const result = await port.listChatBots(named.endpoint.chatId)
      let bots: readonly { readonly openId: string }[] | undefined
      if (Array.isArray(result)) {
        bots = result as readonly { readonly openId: string }[]
      } else {
        const structured = result as {
          readonly kind: 'ok' | 'permission-denied' | 'error'
          readonly bots?: readonly { readonly openId: string }[]
        }
        if (structured.kind === 'ok') bots = structured.bots
      }
      if (bots === undefined) return normalized
      const self = original.occurrences.find(occurrence => occurrence.kind === 'self-bot')?.stableId
      return {
        ...named,
        addressing: projectDeliveryAddressing({
          mentions: original.occurrences.map(occurrence => ({
            ...(occurrence.stableId === undefined ? {} : { id: occurrence.stableId }),
            ...(occurrence.mentionKey === undefined ? {} : { key: occurrence.mentionKey }),
            name: occurrence.displayName,
          })),
          ...(self === undefined ? {} : { selfOpenId: self }),
          chatBots: bots,
          orderKnown: original.orderKnown,
        }),
      }
    } catch {
      return normalized
    }
  }

  /**
   * Fill in the sender's display name when the record does not carry one.
   *
   * The delivery prompt reports the sender and tells the agent to address people
   * by display name. Given only an `ou_…`, an agent writes that identifier: the
   * platform renders it as plain text, so nobody is notified and the id is
   * published in the chat. Fail-soft — an unresolvable name leaves the open id,
   * which is the previous behaviour.
   *
   * @param message - Message about to be projected into a delivery.
   * @returns the message, with `senderName` set when it could be resolved.
   */
  private async withSenderName(message: NormalizedLocusMessage): Promise<NormalizedLocusMessage> {
    if (message.senderName !== undefined && message.senderName.trim() !== '') return message
    const resolve = this.deps.addressing?.resolveMemberName
    if (resolve === undefined || message.senderOpenId.trim() === '') return message
    try {
      const name = await resolve.call(this.deps.addressing, message.endpoint.chatId, message.senderOpenId)
      if (name === undefined || name.trim() === '') return message
      return { ...message, senderName: name.trim() }
    } catch {
      return message
    }
  }

  /** Consume a pre-admitted normalized result without re-running deduplication. */
  async handleAdmission(
    admission: NormalizedLocusAdmission,
    suppliedContext?: LocusAdmissionContext,
    originalEvent?: LocusChannelEvent,
  ): Promise<LocusControllerResult> {
    if (!this.available) return this.refuse('turn-correlation-unavailable')
    if (this.signal.aborted) return this.refuse('aborted')
    if (this.lifecycle !== 'active') return this.refuse('shutdown-frozen')
    return this.trackOperation(() => this.consumeAdmission(admission, suppliedContext, originalEvent))
  }

  private async consumeAdmission(
    admission: NormalizedLocusAdmission,
    suppliedContext?: LocusAdmissionContext,
    originalEvent?: LocusChannelEvent,
  ): Promise<LocusControllerResult> {
    if (this.lifecycle !== 'active') return this.refuse('shutdown-frozen')
    if (admission.kind === 'rejected') {
      if (admission.reason === 'owner-only-tier' && admission.endpoint !== undefined) {
        if (originalEvent !== undefined) {
          await this.refuseOwnerOnlyAdmission(admission.endpoint, originalEvent, suppliedContext)
        }
      }
      // Report the exact reason: a bare `admission-rejected` makes a genuine
      // non-mention indistinguishable from a watermark, dedup or authorization
      // problem, which is precisely the ambiguity that made a live refusal
      // impossible to diagnose from the log alone.
      this.log(`admission-rejected:${admission.reason}`)
      return { kind: 'ignored', reason: admission.reason }
    }
    if (admission.kind === 'control') {
      this.log('control-command')
      return this.dispatchControl(admission)
    }

    const message = await this.enrichAddressing(admission.message)
    if (this.lifecycle !== 'active') return this.refuse('shutdown-frozen')
    const endpoint = normalizeLocusEndpoint(message.endpoint).endpoint
    const signal = this.signal
    // Decide BEFORE provisioning whether this is the document's first entry:
    // afterwards the new entry itself would answer "yes, it has one".
    const owesDisclosure = admission.needsInitialization && messageSource(message) === 'doc-comment'
      ? await this.firstDocEntry(endpoint.chatId)
      : false
    let locus = await this.resolveLocus(endpoint, message, admission.needsInitialization, signal)
    if (locus === undefined) return this.refuse('locus-unavailable')
    if (owesDisclosure && this.deps.docDisclosureText !== undefined) {
      // A Host control receipt, routed like the business answer; never business
      // text and never blocking. Sent once the entry exists.
      await this.sendControlReceipt(message.replyTarget, this.deps.docDisclosureText, message.senderOpenId)
    }

    // Adoption proves the exact durable child, but not that its current policy
    // still matches the database. Resolve through the continuation owner at
    // this operation boundary, before creating ANY Delivery/reaction/queue.
    //
    // A generation whose live policy cannot be READ is repaired here rather
    // than merely refused. Refusing alone left the locus `active` with no
    // self-healing exit: every later delivery failed the same way forever, so
    // one unreadable child silently muted the group until an operator
    // intervened. Retiring the generation and letting the establishing path
    // build a fresh one serves THIS message instead of starving it. Bounded to
    // one rebuild per delivery so a persistently unverifiable composition
    // cannot churn generations inside a single request.
    let child: LocusChildIdentity | undefined
    let policyVerification: ReturnType<LocusChannelController['verifyPersistedPolicy']> | undefined
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (this.lifecycle !== 'active') return this.refuse('shutdown-frozen')
      let adopted: LocusChildIdentity
      try {
        adopted = await this.deps.child.ensureChild(locus, signal)
      } catch {
        return this.refuse('child-unavailable')
      }
      if (
        !nonEmpty(adopted.parentSessionId) ||
        !nonEmpty(adopted.childSessionId) ||
        adopted.parentSessionId.trim() !== locus.parentSessionId ||
        adopted.childSessionId.trim() !== locus.childSessionId
      ) {
        return this.refuse('child-identity-mismatch')
      }
      const identity: LocusChildIdentity = {
        parentSessionId: adopted.parentSessionId.trim(),
        childSessionId: adopted.childSessionId.trim(),
      }
      policyVerification = this.verifyPersistedPolicy(locus)
      if (policyVerification.ok) {
        child = identity
        break
      }
      // A durable disagreement is real drift: retire it and refuse, before any
      // Delivery side effect (ADR-0005). A generation-scoped read failure is
      // repairable, so rebuild it once and serve on the fresh generation. An
      // absent capability belongs to the composition, not to this child, so
      // rebuilding cannot help it.
      if (policyVerification.fatal) {
        try {
          await this.deps.invalidatePolicyDrift?.({ locus, reason: policyVerification.diagnostic })
        } catch {
          // Failure to persist the pause is still fail closed for this request.
        }
        break
      }
      if (!policyVerification.repairable || attempt > 0) break
      try {
        await this.deps.invalidatePolicyDrift?.({
          locus,
          reason: `live policy unreadable; rebuilding this generation (${policyVerification.diagnostic})`,
        })
      } catch {
        // Failure to persist the retirement is still fail closed for this
        // request, so do not fall through to the rebuild.
        break
      }
      const rebuilt = await this.resolveLocus(endpoint, message, true, signal)
      if (rebuilt === undefined) break
      this.log('policy-generation-rebuilt')
      locus = rebuilt
    }
    if (child === undefined || policyVerification === undefined || !policyVerification.ok) {
      const failed = policyVerification !== undefined && !policyVerification.ok ? policyVerification : undefined
      this.logReason('policy-unreadable', failed?.diagnostic ?? 'no verification result')
      return this.refuse(failed?.fatal === true ? 'policy-drift' : 'policy-unreadable')
    }

    const locusId = locusIdOf(locus)
    if (locusId === undefined) return this.refuse('locus-unavailable')
    const correlation: DeliveryCorrelation = {
      endpoint,
      locusId,
      generation: locus.generation,
      childSessionId: child.childSessionId,
    }
    const input: LocusDeliveryInput = {
      ...correlation,
      messageId: message.messageId,
      acceptedAt: this.now(),
      senderOpenId: message.senderOpenId,
      ...(message.senderName !== undefined ? { senderName: message.senderName } : {}),
      text: message.text,
      ...(message.addressing === undefined ? {} : { addressing: message.addressing }),
      ...(message.source === 'doc-comment' && message.docComment !== undefined ? { docComment: message.docComment } : {}),
      ...(message.replyTarget.rootMessageId !== undefined
        ? { rootMessageId: message.replyTarget.rootMessageId }
        : {}),
      replyTarget: message.replyTarget,
      ...(message.replyToMessageId !== undefined ? { replyToMessageId: message.replyToMessageId } : {}),
    }

    // Serialize the durable acceptance and any physical dispatch per exact lane.
    // The acceptance and queue side effect below must not overlap for one locus
    // in this Host. The checks above are read-only EXCEPT for the one repair
    // that retires an unreadable generation; that retirement is guarded by the
    // stored locus's own state, so a concurrent delivery can at worst observe
    // the already-rebuilt generation instead of building a second one.
    return this.enqueueDispatchLane(correlation, async () => {
      if (this.lifecycle !== 'active') return this.refuse('shutdown-frozen')
      // Probe the durable message index before resolving/queueing a duplicate.
      // The atomic accept below remains authoritative for concurrent deliveries;
      // this early check only prevents avoidable child side effects on replay.
      if (this.deps.deliveries.findByMessageId !== undefined) {
        let existing: DeliveryRecord | undefined
        try {
          existing = await this.deps.deliveries.findByMessageId.call(
            this.deps.deliveries,
            message.messageId,
          )
        } catch {
          return this.refuse('delivery-persistence-failed')
        }
        if (existing !== undefined) {
          if (!exactCorrelation(existing, correlation)) return this.refuse('delivery-conflict')
          this.log('duplicate-delivery')
          return {
            kind: 'duplicate',
            deliveryId: existing.deliveryId,
            locusId: existing.locusId,
            generation: existing.generation,
          }
        }
      }

    let accepted: LocusDeliveryAcceptance
    try {
      accepted = await this.deps.deliveries.accept(input)
    } catch {
      return this.refuse('delivery-persistence-failed')
    }
    if (accepted.conflict) {
      this.log('delivery-conflict')
      return this.refuse('delivery-conflict')
    }
    if (accepted.duplicate) {
      this.log('duplicate-delivery')
      return {
        kind: 'duplicate',
        deliveryId: accepted.record.deliveryId,
        locusId: accepted.record.locusId,
        generation: accepted.record.generation,
      }
    }

    // Acceptance is the durable admission boundary. Only the composed dispatcher
    // may authorize an inbox injection; a busy locus leaves this row in backlog.
    // There is intentionally no eager compatibility path in the production
    // controller: one-current FIFO is a safety invariant, not an optimization.
    if (this.lifecycle !== 'active') return this.deferDelivery(accepted.record, correlation)
    const dispatch = this.deps.deliveryDispatch
    if (dispatch === undefined) return this.refuse('dispatch-state-unknown')
    if (dispatch.claimCurrent !== undefined) {
      let claimed: DeliveryRecord | undefined
      try {
        if (locus.toolTier?.effective === 'shell') {
          const allowOpenIds = this.readAdmissionContext()?.allowOpenIds ?? this.deps.readAllowOpenIds?.() ?? this.deps.allowOpenIds?.()
          if (allowOpenIds === undefined) return this.refuse('admission-unavailable')
          if (!allowOpenIds.includes(message.senderOpenId)) {
            const failed = await this.deps.deliveries.failBeforeDispatch({
              deliveryId: accepted.record.deliveryId,
              correlation,
              reason: 'owner-only-tier',
              failedAt: this.now(),
            })
            if (failed) {
              await this.receiptSettled(accepted.record.feedbackTarget, 'failed')
              await this.sendControlReceipt(message.replyTarget, '当前入口为所有者专用，只有 allowlist 成员可以驱动。', message.senderOpenId)
            }
            return { kind: 'ignored', reason: 'owner-only-tier' }
          }
        }
        const refreshedRaw = await this.deps.locus.resolveCurrent(endpoint)
        const refreshed = normalizeActiveLocus(refreshedRaw, endpoint)
        if (refreshed === undefined || locusIdOf(refreshed) !== correlation.locusId
          || refreshed.generation !== correlation.generation || refreshed.childSessionId !== correlation.childSessionId) {
          return this.refuse('dispatch-state-unknown')
        }
        if (refreshed.toolTier?.effective === 'shell') {
          const currentAllowOpenIds = this.readAdmissionContext()?.allowOpenIds
            ?? this.deps.readAllowOpenIds?.()
            ?? this.deps.allowOpenIds?.()
          if (currentAllowOpenIds === undefined) return this.refuse('admission-unavailable')
          if (!currentAllowOpenIds.includes(message.senderOpenId)) {
            const failed = await this.deps.deliveries.failBeforeDispatch({
              deliveryId: accepted.record.deliveryId,
              correlation,
              reason: 'owner-only-tier',
              failedAt: this.now(),
            })
            if (failed) {
              await this.receiptSettled(accepted.record.feedbackTarget, 'failed')
              await this.sendControlReceipt(message.replyTarget, '当前入口为所有者专用，只有 allowlist 成员可以驱动。工具档位可由所有者切回 safe。', message.senderOpenId)
            }
            return { kind: 'ignored', reason: 'owner-only-tier' }
          }
        }
        if (this.lifecycle !== 'active') return this.deferDelivery(accepted.record, correlation)
        claimed = await dispatch.claimCurrent({
          correlation,
          deliveryId: accepted.record.deliveryId,
          now: this.now(),
        })
      } catch {
        return this.refuse('delivery-persistence-failed')
      }
      if (claimed === undefined) {
        await this.receiptAccepted(accepted.record.feedbackTarget)
        return {
          kind: 'accepted',
          deliveryId: accepted.record.deliveryId,
          executionId: '',
          locusId: accepted.record.locusId,
          generation: accepted.record.generation,
        }
      }
      // A dispatcher result is a physical-dispatch authorization only when it
      // is the exact accepted row and a durable current claim. Never queue the
      // accepted row after a custom adapter returns another row.
      if (
        claimed.deliveryId !== accepted.record.deliveryId ||
        !exactCorrelation(claimed, correlation) ||
        claimed.status !== 'current' ||
        claimed.queueState !== 'current'
      ) return this.refuse('dispatch-state-unknown')
      return this.queueClaimedDelivery({ locus, child, record: claimed, message, signal })
    } else if (dispatch.hasCurrent !== undefined) {
      // A read-only probe cannot establish a durable one-current invariant.
      // Keep compatibility adapters backlog-only rather than risking a second
      // inbox injection; production composes claimCurrent below.
      let occupied: boolean
      try {
        occupied = await dispatch.hasCurrent(correlation)
      } catch {
        return this.refuse('delivery-persistence-failed')
      }
      if (occupied) {
        await this.receiptAccepted(accepted.record.feedbackTarget)
        return {
          kind: 'accepted',
          deliveryId: accepted.record.deliveryId,
          executionId: '',
          locusId: accepted.record.locusId,
          generation: accepted.record.generation,
        }
      }
      return this.refuse('dispatch-state-unknown')
    }

    // The token is generated before queueing and registered before queueing, so
    // a synchronous host turn event cannot race an unarmed correlation map.
    // Do not emit an in-progress reaction yet: acceptance is durable admission,
    // not proof that the child inbox accepted the work. Emitting it before the
    // queue/bind fence leaves stale feedback when queueing or binding refuses.
    const executionId = randomUUID()
    const pending: PendingTurn = {
      deliveryId: accepted.record.deliveryId,
      executionId,
      correlation,
      target: accepted.record.feedbackTarget,
      dispatching: true,
    }
    this.pending.set(pending.deliveryId, pending)

    let queued:
      | { readonly accepted: true; readonly executionId: string; readonly inboxMessageId: string }
      | { readonly accepted: false; readonly reason: string }
    try {
      const content = await this.prepareCurrentContent({
        locus,
        child,
        record: accepted.record,
        message,
        signal,
      })
      if (content === undefined) {
        this.pending.delete(pending.deliveryId)
        return this.dispatchUnknown(pending)
      }
      queued = await this.queuePreparedCurrent({
        input: { locus, child, record: accepted.record, message, signal },
        pending,
        content,
      })
    } catch {
      this.pending.delete(pending.deliveryId)
      return this.dispatchUnknown(pending)
    }
    if (!isRecord(queued) || queued.accepted !== true) {
      this.pending.delete(pending.deliveryId)
      const reason = isRecord(queued) && typeof queued.reason === 'string' ? queued.reason : 'queue-refused'
      return this.definitiveQueueFailure(pending, reason)
    }
    if (
      !nonEmpty(queued.executionId) ||
      queued.executionId.trim() !== pending.executionId ||
      !nonEmpty(queued.inboxMessageId)
    ) {
      this.pending.delete(pending.deliveryId)
      return this.dispatchUnknown(pending)
    }

    let bound: DeliveryRecord | undefined
    try {
      bound = await this.deps.deliveries.bindQueued({
        deliveryId: pending.deliveryId,
        correlation,
        executionId: pending.executionId,
        inboxMessageId: queued.inboxMessageId.trim(),
        queuedAt: this.now(),
      })
    } catch {
      this.pending.delete(pending.deliveryId)
      return this.dispatchUnknown(pending)
    }
    if (bound === undefined) {
      this.pending.delete(pending.deliveryId)
      return this.dispatchUnknown(pending)
    }
    // Only now is the child inbox acceptance durably bound to the host token.
    // Wake exactly this message: its claim/end may have arrived before the
    // durable bind and remained unresolved without a polling deadline.
    try {
      this.deps.turns?.deliveryAvailable?.({
        childSessionId: bound.childSessionId,
        messageId: queued.inboxMessageId.trim(),
      })
    } catch {
      // The observer keeps fail-closed state; a wake failure cannot authorize a
      // guessed turn or make queue acceptance itself terminal.
      this.log('settlement-ignored')
    }
    // A queue refusal or bind failure must not leave an in-progress reaction.
    await this.receiptAccepted(bound.feedbackTarget ?? pending.target)
    pending.dispatching = false
    // Queue acceptance is now durably established. Drain any exact started-turn
    // evidence recorded synchronously during queueing. Normal turn completion
    // stays diagnostic; an exact official cancellation can attempt its failed CAS.
    await pending.operation
    if (pending.conflicted) this.log('settlement-ignored')
    if (pending.startedTurnId !== undefined) {
      await this.bindObservedTurn(pending, pending.startedTurnId)
    }
    return {
      kind: 'accepted',
      deliveryId: bound.deliveryId,
      executionId: pending.executionId,
      locusId: bound.locusId,
      generation: bound.generation,
    }
    })
  }

  /**
   * Queue one acceptance/dispatch operation behind the prior operation for the
   * exact locus generation. This is intentionally process-local: durable
   * current claiming still belongs to the repository/dispatcher seam.
   */
  private deferDelivery(record: DeliveryRecord, correlation: DeliveryCorrelation): LocusControllerResult {
    this.suppressDispatch(correlation, record.deliveryId)
    return {
      kind: 'accepted', deliveryId: record.deliveryId, executionId: '',
      locusId: record.locusId, generation: record.generation,
    }
  }

  private async queueClaimedDelivery(input: {
    readonly locus: ActiveLocus
    readonly child: LocusChildIdentity
    readonly record: DeliveryRecord
    readonly message: NormalizedLocusMessage
    readonly signal: AbortSignal
  }): Promise<LocusControllerResult> {
    if (this.lifecycle !== 'active') return this.deferDelivery(input.record, input.record)
    let executionId: string = randomUUID()
    let correlation: DeliveryCorrelation = {
      endpoint: input.record.endpoint,
      locusId: input.record.locusId,
      generation: input.record.generation,
      childSessionId: input.record.childSessionId,
    }
    const pending: PendingTurn = {
      deliveryId: input.record.deliveryId,
      executionId,
      correlation,
      target: input.record.feedbackTarget,
      dispatching: true,
    }
    this.pending.set(pending.deliveryId, pending)
    let queued:
      | { readonly accepted: true; readonly executionId: string; readonly inboxMessageId: string }
      | { readonly accepted: false; readonly reason: string }
    try {
      const content = await this.prepareCurrentContent(input)
      if (this.lifecycle !== 'active') {
        this.pending.delete(pending.deliveryId)
        return this.deferDelivery(input.record, correlation)
      }
      if (content === undefined) {
        this.pending.delete(pending.deliveryId)
        return this.dispatchUnknown(pending)
      }
      queued = await this.queuePreparedCurrent({ input, pending, content })
    } catch {
      this.pending.delete(pending.deliveryId)
      return this.dispatchUnknown(pending)
    }
    // Only the pre-prompt image disposition can rotate this same Delivery's attempt.
    correlation = pending.correlation
    executionId = pending.executionId
    if (!isRecord(queued) || queued.accepted !== true) {
      this.pending.delete(pending.deliveryId)
      const reason = isRecord(queued) && typeof queued.reason === 'string' ? queued.reason : 'queue-refused'
      if (this.lifecycle !== 'active') return this.deferDelivery(input.record, correlation)
      if (reason === 'child-capacity-exhausted') {
        // No prompt was accepted, so the Delivery is whole: keep it
        // current, tell the asker once that it is being kept, and retry.
        this.waitForChildCapacity(input.record, correlation)
        if (!this.capacityNotified.has(input.record.deliveryId)) {
          this.capacityNotified.add(input.record.deliveryId)
          await this.sendControlReceipt(
            input.message.replyTarget,
            '当前同时运行的子会话已达上限，你的请求已保留，有空位后会自动处理，无需重发。',
            input.message.senderOpenId,
          )
        }
        return {
          kind: 'accepted',
          deliveryId: input.record.deliveryId,
          executionId: '',
          locusId: input.record.locusId,
          generation: input.record.generation,
        }
      }
      return this.definitiveQueueFailure(pending, reason)
    }
    this.capacityNotified.delete(input.record.deliveryId)
    if (!nonEmpty(queued.executionId) || queued.executionId.trim() !== executionId || !nonEmpty(queued.inboxMessageId)) {
      this.pending.delete(pending.deliveryId)
      return this.dispatchUnknown(pending)
    }
    let bound: DeliveryRecord | undefined
    try {
      bound = await this.deps.deliveries.bindQueued({
        deliveryId: pending.deliveryId,
        correlation,
        executionId,
        inboxMessageId: queued.inboxMessageId.trim(),
        queuedAt: this.now(),
      })
    } catch {
      this.pending.delete(pending.deliveryId)
      return this.dispatchUnknown(pending)
    }
    if (bound !== undefined && bound.deliveryId === pending.deliveryId && exactCorrelation(bound, correlation) &&
        bound.executionId === executionId && bound.inboxMessageId === queued.inboxMessageId.trim() &&
        ['replied', 'no-reply', 'failed', 'expired', 'unknown-terminal'].includes(bound.status)) {
      // The first turn can finish before startContinuable returns. Never revive
      // its queue slot or emit an in-progress receipt after terminal feedback.
      this.pending.delete(pending.deliveryId)
      return { kind: 'accepted', deliveryId: bound.deliveryId, executionId, locusId: bound.locusId, generation: bound.generation }
    }
    if (
      bound === undefined ||
      bound.deliveryId !== pending.deliveryId ||
      !exactCorrelation(bound, correlation) ||
      (bound.status !== 'current' && bound.status !== 'finishing') ||
      bound.queueState !== 'current'
    ) {
      this.pending.delete(pending.deliveryId)
      return this.dispatchUnknown(pending)
    }
    try {
      this.deps.turns?.deliveryAvailable?.({
        childSessionId: bound.childSessionId,
        messageId: queued.inboxMessageId.trim(),
      })
    } catch {
      this.log('settlement-ignored')
    }
    await this.receiptAccepted(bound.feedbackTarget)
    try {
      await this.deps.deliveryDispatch.scheduleCurrent?.(bound)
    } catch {
      this.log('delivery-persistence-failed')
    }
    pending.dispatching = false
    await pending.operation
    if (pending.conflicted) this.log('settlement-ignored')
    if (pending.startedTurnId !== undefined) await this.bindObservedTurn(pending, pending.startedTurnId)
    return {
      kind: 'accepted',
      deliveryId: bound.deliveryId,
      executionId,
      locusId: bound.locusId,
      generation: bound.generation,
    }
  }

  /** Build one typed inbox message while repeatedly fencing the exact durable current. */
  private async prepareCurrentContent(input: CurrentDeliveryInput): Promise<PreparedCurrentContent | undefined> {
    const isExactCurrent = () => this.isExactCurrent(input)
    const rendered = this.deps.renderPrompt?.({
      locus: input.locus,
      message: input.message,
      signal: input.signal,
    })
    const text = rendered === undefined ? input.message.text : await rendered
    // Re-proven AFTER the renderer's awaited work: the renderer measures this
    // entrance's read capability, and a locus rebuilt/disabled (or an entrance
    // rebound) while that was in flight must not receive the stale prompt.
    if (!await isExactCurrent()) return undefined
    const base: ContentBlock[] = [{ type: 'text', text }]
    if (input.record.imageRouteRejected === true) {
      const fallback = this.imageTextFallback(base)
      return { typed: fallback, textFallback: fallback, hasImage: false }
    }
    // Exact fence immediately before platform enumeration/download starts.
    if (!await isExactCurrent()) return undefined
    // Media lives on IM messages only; a doc trigger id never reaches IM (D9).
    if (messageSource(input.message) === 'doc-comment') {
      return { typed: base, textFallback: base, hasImage: false }
    }
    const media = this.deps.media
    if (media === undefined || !media.available) {
      // No selector or fallback is exposed. A Host without reliable media
      // confinement remains text-only and says so deterministically.
      const typed = [...base, { type: 'text' as const, text: '[当前 Host 的图片读取能力不可用。]' }]
      return { typed, textFallback: typed, hasImage: false }
    }
    const admitted = await media.admitCurrentImage({
      messageId: input.record.messageId,
      signal: input.signal,
      // Exact fence immediately before AttachmentStore.saveImage.
      fenceBeforeSave: isExactCurrent,
    })
    // Exact fence immediately before typed ContentBlock[] enters the child inbox.
    if (!await isExactCurrent()) return undefined
    const typed = admitted.kind === 'unavailable'
      ? [...base, ...admitted.content, { type: 'text' as const, text: '[当前消息图片未能安全读取。]' }]
      : [...base, ...admitted.content]
    const hasImage = typed.some(block => block.type === 'image')
    return {
      typed,
      hasImage,
      textFallback: hasImage
        ? this.imageTextFallback(base)
        : typed,
    }
  }

  private imageTextFallback(base: readonly ContentBlock[]): ContentBlock[] {
    return [...base, { type: 'text', text: '[当前模型无法查看图片；请仅依据以上文字回复，不要声称已看见或理解图片内容。]' }]
  }

  private async isExactCurrent(input: CurrentDeliveryInput): Promise<boolean> {
    if (this.lifecycle !== 'active' || input.signal.aborted || this.deps.deliveries.getById === undefined) return false
    let current: DeliveryRecord | undefined
    try { current = await this.deps.deliveries.getById(input.record.deliveryId) } catch { return false }
    return this.lifecycle === 'active' && current !== undefined
      && current.deliveryId === input.record.deliveryId
      && current.messageId === input.record.messageId
      && current.status === 'current'
      && current.queueState === 'current'
      && exactCorrelation(current, {
        endpoint: input.record.endpoint,
        locusId: input.record.locusId,
        generation: input.record.generation,
        childSessionId: input.record.childSessionId,
      })
      && input.locus.generation === current.generation
      && input.locus.childSessionId === input.child.childSessionId
      && input.locus.parentSessionId === input.child.parentSessionId
  }

  /** Retry only a typed-image route refusal, once, against the same exact current. */
  private async queuePreparedCurrent(input: {
    readonly input: CurrentDeliveryInput
    readonly pending: PendingTurn
    readonly content: PreparedCurrentContent
  }): Promise<ChildQueueResult> {
    const queue = (content: readonly ContentBlock[]): Awaitable<ChildQueueResult> => this.lifecycle !== 'active'
      ? { accepted: false, reason: 'shutdown-frozen' }
      : this.deps.child.queueChild({
      locus: input.input.locus,
      child: input.input.child,
      deliveryId: input.pending.deliveryId,
      executionId: input.pending.executionId,
      content,
      fenceBeforeQueue: () => this.isExactCurrent(input.input),
      replyTarget: input.input.message.replyTarget,
      signal: input.input.signal,
    })
    const typed = await queue(input.content.typed)
    if (
      typed.accepted === true ||
      typed.reason !== 'image-route-unsupported' ||
      !input.content.hasImage
    ) return typed
    // queueChild rejected before inbox acceptance. Revalidate after that await so
    // A can never use its fallback to enter a newly promoted B. Media admission
    // is deliberately not rerun: the fallback contains only the original prompt
    // and an explicit statement that this route cannot see the image.
    if (input.input.locus.state === 'not-created') {
      // The official pre-prompt veto leaves a persisted Session id. Only the
      // atomic text-retry disposition may move A to a fresh reservation.
      const original = input.input.record
      const current = await this.deps.deliveries.getById?.(original.deliveryId)
      const locus = normalizeActiveLocus(await this.deps.locus.resolveCurrent(original.endpoint), original.endpoint)
      if (current === undefined || locus === undefined || current.imageRouteRejected !== true ||
          current.deliveryId !== original.deliveryId || current.messageId !== original.messageId ||
          current.status !== 'current' || current.queueState !== 'current' ||
          current.executionId !== undefined || current.inboxMessageId !== undefined || current.turnId !== undefined ||
          current.locusId !== original.locusId || current.generation !== original.generation ||
          locus.state !== 'not-created' || locusIdOf(locus) !== original.locusId ||
          locus.generation !== original.generation || locus.childSessionId !== current.childSessionId ||
          locus.parentSessionId !== input.input.locus.parentSessionId ||
          (current.deadlineAt !== undefined && this.now() >= current.deadlineAt)) {
        return { accepted: false, reason: 'stale-delivery' }
      }
      input.input.locus = locus
      input.input.child = { parentSessionId: locus.parentSessionId, childSessionId: locus.childSessionId }
      input.input.record = current
      input.pending.executionId = randomUUID()
      input.pending.correlation = { endpoint: current.endpoint, locusId: current.locusId, generation: current.generation, childSessionId: current.childSessionId }
      try { await this.deps.deliveryDispatch.scheduleCurrent?.(current) } catch { this.log('delivery-persistence-failed') }
    }
    if (!await this.isExactCurrent(input.input)) return { accepted: false, reason: 'stale-delivery' }
    return queue(input.content.textFallback)
  }

  private enqueueDispatchLane<T>(
    correlation: DeliveryCorrelation,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = dispatchLaneKey(correlation)
    const previous = this.dispatchTails.get(key) ?? Promise.resolve()
    const current = previous.then(operation, operation)
    const tail = current.then(
      () => undefined,
      () => undefined,
    )
    this.dispatchTails.set(key, tail)
    void tail.then(() => {
      if (this.dispatchTails.get(key) === tail) this.dispatchTails.delete(key)
    })
    return current
  }

  /**
   * Verify the generation's policy from what Pet itself recorded, never by
   * reading a live Session.
   *
   * The sandbox is applied and read back at the only moments the runtime lets
   * Pet touch it — child creation and every `agent/created` (see
   * `composeLocusChild`) — and the child is published only if that read back
   * matched the durable grant. So the durable record plus the composition
   * marker IS the proof; a per-delivery live read would need a borrowed Session
   * the runtime does not offer. What can still disagree with the build is a
   * stored `write` grant while write grants are switched off.
   *
   * `fatal` marks a durable disagreement that justifies refusing outright
   * (ADR-0005); `repairable` marks a failure a fresh generation could fix.
   */
  private verifyPersistedPolicy(locus: ActiveLocus):
    | { readonly ok: true }
    | {
        readonly ok: false
        readonly diagnostic: string
        readonly fatal: boolean
        readonly repairable: boolean
      } {
    if (locus.permission === undefined) {
      return {
        ok: false,
        diagnostic: 'the generation carries no recorded permission',
        fatal: false,
        repairable: false,
      }
    }
    if (locus.state === 'active' && locus.childComposition !== LOCUS_SAFE_CHILD_COMPOSITION) {
      return {
        ok: false,
        diagnostic: 'the generation is not a Host-attested current composition',
        fatal: false,
        repairable: false,
      }
    }
    const facts = {
      permission: locus.permission,
      ...(locus.contextAnchor === undefined ? {} : { contextAnchor: locus.contextAnchor }),
    }
    let resident: ReturnType<NonNullable<LocusControllerDeps['inspectResidentPolicy']>> | undefined
    try { resident = this.deps.inspectResidentPolicy?.(locus.childSessionId) } catch {
      return { ok: false, diagnostic: 'Resident child policy is unreadable', fatal: false, repairable: false }
    }
    const verified = resident?.resident === true
      ? verifyLocusLivePolicy(facts, resident.policy)
      : verifyLocusPersistedPolicy(facts)
    return verified.ok
      ? { ok: true }
      : { ok: false, diagnostic: verified.diagnostic, fatal: true, repairable: false }
  }

  private async dispatchControl(
    admission: Extract<NormalizedLocusAdmission, { kind: 'control' }>,
  ): Promise<Extract<LocusControllerResult, { kind: 'control' }>> {
    const command = admission.command
    // Malformed recognized commands are retained on the control surface by
    // admission, but cannot be dispatched as mutations. A mechanical receipt
    // is optional; absent dispatch capability remains fail-closed and does not
    // become business work.
    if (
      command.kind === 'bind-missing-prefix' ||
      command.kind === 'bind-invalid' ||
      (command.kind === 'bind' && command.prefix.trim().length < MIN_BIND_PREFIX_LENGTH) ||
      command.kind === 'scope-missing-mode' ||
      command.kind === 'scope-invalid' ||
      command.kind === 'tools-missing-tier' ||
      command.kind === 'tools-invalid' ||
      command.kind === 'unbind-invalid'
    ) {
      const text = controlValidationText(command)
      await this.sendControlReceipt(admission.message.replyTarget, text, admission.message.senderOpenId)
      return {
        kind: 'control',
        command,
        ok: false,
        reason: 'invalid-command',
        text,
      }
    }
    const dispatch = this.deps.controlDispatch
    if (dispatch === undefined) {
      // Preserve the existing capability boundary: a Host that has not
      // composed control mutations must not guess at legacy bindings or
      // create a Delivery merely because a command was recognized.
      const text = '当前入口暂不支持该控制命令。'
      await this.sendControlReceipt(admission.message.replyTarget, text, admission.message.senderOpenId)
      return { kind: 'control', command, ok: false, reason: 'control-unavailable', text }
    }
    let result: LocusControlDispatchResult
    try {
      result = await dispatch.dispatch({
        command,
        endpoint: {
          chatId: admission.message.endpoint.chatId,
          ...(admission.message.endpoint.threadId === undefined
            ? {}
            : { threadId: admission.message.endpoint.threadId }),
          key: locusEndpointKey(
            admission.message.endpoint.chatId,
            admission.message.endpoint.threadId,
          ),
        },
        senderId: admission.message.senderOpenId,
        authorization: admission.authorization,
      })
    } catch {
      const text = '控制命令执行失败，请稍后重试。'
      await this.sendControlReceipt(admission.message.replyTarget, text, admission.message.senderOpenId)
      return { kind: 'control', command, ok: false, reason: 'control-dispatch-failed', text }
    }
    if (!isControlDispatchResult(result)) {
      const text = '控制命令返回无效结果，未执行工作。'
      await this.sendControlReceipt(admission.message.replyTarget, text, admission.message.senderOpenId)
      return { kind: 'control', command, ok: false, reason: 'control-dispatch-failed', text }
    }
    if ('text' in result && result.text !== undefined) {
      await this.sendControlReceipt(admission.message.replyTarget, result.text, admission.message.senderOpenId)
    }
    return {
      kind: 'control',
      command,
      ok: result.ok,
      ...('reason' in result && result.reason !== undefined ? { reason: result.reason } : {}),
      ...('text' in result && result.text !== undefined ? { text: result.text } : {}),
    }
  }

  private async refuseOwnerOnlyAdmission(
    endpoint: LocusEndpoint,
    event: LocusChannelEvent,
    suppliedContext?: LocusAdmissionContext,
  ): Promise<void> {
    const normalized = normalizeLocusEvent(event)
    const message = messageFromAdmission(normalized, {
      admit: true,
      endpoint: { chatId: endpoint.chatId, ...(endpoint.threadId === undefined ? {} : { threadId: endpoint.threadId }), key: locusEndpointKey(endpoint.chatId, endpoint.threadId) },
      text: normalized.text,
      senderId: normalized.senderOpenId,
      authorization: 'authorized',
      needsInitialization: false,
    }, suppliedContext?.botOpenId ?? this.readAdmissionContext()?.botOpenId)
    if (message === undefined) return
    const allow = suppliedContext?.allowOpenIds ?? this.readAdmissionContext()?.allowOpenIds ?? this.deps.allowOpenIds?.() ?? []
    if (allow.includes(message.senderOpenId)) return
    await this.sendControlReceipt(message.replyTarget, '当前入口为所有者专用，只有 allowlist 成员可以驱动。工具档位可由所有者切回 safe。', message.senderOpenId)
  }

  private async firstDocEntry(chatId: string): Promise<boolean> {
    if (this.deps.docHasEntries === undefined) return false
    try {
      return !(await this.deps.docHasEntries(chatId))
    } catch {
      // Unknown history: stay silent rather than risk a duplicate disclosure.
      return false
    }
  }

  private async sendControlReceipt(target: LocusReplyTarget, text: string, senderOpenId?: string): Promise<void> {
    if (!nonEmpty(text)) return
    try {
      await this.deps.receipts?.sendControl?.(target, text, senderOpenId)
    } catch {
      // Mechanical control feedback is fail-soft. The control mutation itself
      // remains the dispatch port's durable responsibility.
    }
  }

  private readAdmissionContext(): LocusAdmissionContext | undefined {
    if (this.deps.admissionContext === undefined) return undefined
    try {
      return typeof this.deps.admissionContext === 'function'
        ? this.deps.admissionContext()
        : this.deps.admissionContext
    } catch {
      return undefined
    }
  }

  private async resolveLocus(
    endpoint: LocusEndpoint,
    message: NormalizedLocusMessage,
    needsInitialization: boolean,
    signal: AbortSignal,
  ): Promise<ActiveLocus | undefined> {
    let raw: unknown
    let mayEnsure = needsInitialization
    try {
      raw = await this.deps.locus.resolveCurrent(endpoint)
      // Existing entries also need the delivery-time main check. A readable
      // active row alone does not prove its coordinator can still serve.
      mayEnsure ||= normalizeActiveLocus(raw, endpoint) !== undefined
    } catch (error: unknown) {
      // A known unavailable generation can be replaced on the SAME work
      // session. Source archival, owner exit and unknown read failures cannot
      // turn into permission to create a new source or default entry.
      const replaceable = error instanceof LocusResolutionError && error.reason === 'locus-unusable'
      if (!needsInitialization && !replaceable) {
        this.logReason('locus-read-failed', error)
        return undefined
      }
      mayEnsure = true
    }
    if (!mayEnsure) {
      this.log('locus-bootstrap-skipped')
      return undefined
    }
    if (this.lifecycle !== 'active') return undefined
    try {
      raw = await this.deps.locus.ensureForDelivery({
        endpoint,
        messageId: message.messageId,
        signal,
      })
    } catch (error: unknown) {
      this.logReason('locus-bootstrap-failed', error)
      // A failed readiness check or replacement must not disappear silently.
      // The provisioning controller supplies the mechanical refusal text.
      const reason = error instanceof Error && error.message.trim() !== '' ? error.message : '原因未知'
      await this.sendControlReceipt(message.replyTarget, `入口建立失败：${reason}`, message.senderOpenId)
      return undefined
    }
    return normalizeActiveLocus(raw, endpoint)
  }

  private subscribeObserver(observer: LocusTurnCorrelationObserver): (() => void) | undefined {
    try {
      const disposer = observer.subscribe.call(observer, (event: LocusTurnCorrelationEvent) => {
        if (this.lifecycle !== 'disposed') void this.trackOperation(() => this.observe(event))
      })
      return typeof disposer === 'function' ? disposer : undefined
    } catch {
      return undefined
    }
  }

  private async observe(event: LocusTurnCorrelationEvent): Promise<void> {
    if (!isRecord(event)) {
      this.log('settlement-ignored')
      return
    }
    if (
      (event.phase !== 'started' && event.phase !== 'completed' && event.phase !== 'failed') ||
      !nonEmpty(event.deliveryId) ||
      !nonEmpty(event.executionId) ||
      !nonEmpty(event.turnId) ||
      !isRecord(event.correlation)
    ) {
      this.log('settlement-ignored')
      return
    }
    let pending = this.pending.get(event.deliveryId)
    if (pending === undefined && this.deps.deliveries.getById !== undefined) {
      let durable: DeliveryRecord | undefined
      try {
        durable = await this.deps.deliveries.getById.call(
          this.deps.deliveries,
          event.deliveryId,
        )
      } catch {
        this.log('settlement-ignored')
        return
      }
      if (
        durable !== undefined &&
        (durable.status === 'queued' || durable.status === 'running' || durable.status === 'current') &&
        durable.executionId === event.executionId &&
        exactCorrelation(durable, event.correlation)
      ) {
        pending = {
          deliveryId: durable.deliveryId,
          executionId: event.executionId,
          correlation: event.correlation,
          target: durable.feedbackTarget,
          dispatching: false,
          ...(durable.turnId === undefined ? {} : { startedTurnId: durable.turnId }),
        }
        this.pending.set(pending.deliveryId, pending)
      }
    }
    if (pending === undefined || pending.executionId !== event.executionId) {
      this.log('settlement-ignored')
      return
    }
    if (!exactCorrelation(pending.correlation, event.correlation)) {
      this.log('settlement-ignored')
      return
    }
    const operation = async (): Promise<void> => {
      const turnId = event.turnId.trim()
      if (event.phase !== 'started') {
        if (event.phase !== 'failed' || event.reason !== 'turn-interrupted' ||
            (event.cancelReason !== 'user' && event.cancelReason !== 'parent' && event.cancelReason !== 'disposed') ||
            pending.startedTurnId !== turnId) {
          this.log('settlement-ignored')
          return
        }
        pending.interruptedTurnId = turnId
        if (!pending.dispatching) await this.bindObservedTurn(pending, turnId)
        return
      }
      if (pending.startedTurnId !== undefined && pending.startedTurnId !== turnId) {
        pending.conflicted = true
        this.log('settlement-ignored')
        return
      }
      // While dispatching, observer facts are only buffered. Persisting a turn
      // before bindQueued would make the later queue bind ambiguous.
      pending.startedTurnId = turnId
      if (!pending.dispatching) await this.bindObservedTurn(pending, turnId)
    }
    const previous = pending.operation ?? Promise.resolve()
    pending.operation = previous.then(operation, operation)
    await pending.operation
  }

  private async bindObservedTurn(pending: PendingTurn, turnId: string): Promise<void> {
    if (pending.conflicted) return
    if (pending.startedTurnId !== undefined && pending.startedTurnId !== turnId) {
      this.log('settlement-ignored')
      return
    }
    pending.startedTurnId = turnId
    try {
      const bound = await this.deps.deliveries.bindTurn({
        deliveryId: pending.deliveryId,
        correlation: pending.correlation,
        executionId: pending.executionId,
        turnId,
        startedAt: this.now(),
      })
      if (bound === undefined) { this.log('settlement-ignored'); return }
      if (pending.interruptedTurnId === turnId) await this.settleInterruptedTurn(pending, turnId)
    } catch {
      this.log('settlement-ignored')
    }
  }

  private async settleInterruptedTurn(pending: PendingTurn, turnId: string): Promise<void> {
    const current = await this.deps.deliveries.getById?.(pending.deliveryId)
    if (pending.conflicted || current === undefined || !exactCorrelation(current, pending.correlation) ||
        current.executionId !== pending.executionId || current.turnId !== turnId || !nonEmpty(current.inboxMessageId) ||
        (current.status !== 'current' && current.status !== 'running')) {
      this.log('settlement-ignored')
      return
    }
    const result = await this.deps.deliveries.settleByTurn({
      deliveryId: pending.deliveryId, executionId: pending.executionId,
      correlation: { ...pending.correlation, turnId }, outcome: 'failed',
      settledAt: this.now(), failureReason: 'turn-interrupted',
      inboxMessageId: current.inboxMessageId,
      ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
    })
    if (!result.changed || result.record?.deliveryId !== pending.deliveryId || result.record.status !== 'failed' ||
        result.record.executionId !== pending.executionId || result.record.turnId !== turnId ||
        !exactCorrelation(result.record, pending.correlation)) {
      this.log('settlement-ignored')
      return
    }
    this.currentFinished({ deliveryId: pending.deliveryId, correlation: pending.correlation, outcome: 'failed' })
    // This can run inside the dispatch lane, so a successor must never be awaited.
    void this.dispatchNext(pending.correlation).catch(() => this.log('delivery-persistence-failed'))
  }

  private async definitiveQueueFailure(pending: PendingTurn, reason: string): Promise<LocusControllerResult> {
    if (this.deps.deliveries.fail === undefined) {
      return this.dispatchUnknown(pending)
    }
    try {
      const refusal = await this.deps.deliveries.fail({
        deliveryId: pending.deliveryId,
        correlation: pending.correlation,
        executionId: pending.executionId,
        reason,
      })
      // A pre-turn queue refusal is not a terminal child outcome. Only an
      // explicit true from a future Host seam may claim a durable refusal;
      // absent/false keeps the Delivery non-terminal and suppresses the failed
      // reaction.
      if (refusal !== true) {
        // Creation may have committed inside agent/created and then been
        // durably compensated. That exact terminal row is already the refusal.
        const compensated = await this.deps.deliveries.getById?.(pending.deliveryId)
        if (compensated?.status !== 'failed' || (compensated.executionId !== undefined && compensated.executionId !== pending.executionId) ||
            compensated.failureReason !== 'child-create-failed' || !exactCorrelation(compensated, pending.correlation)) {
          return this.dispatchUnknown(pending)
        }
      }
    } catch {
      return this.dispatchUnknown(pending)
    }
    await this.receiptSettled(pending.target, 'failed')
    if (reason.startsWith('child-') && reason !== 'child-capacity-exhausted') {
      await this.sendControlReceipt(pending.target, `当前入口子会话创建或投递失败（${reason}）；请求已失败，下一条消息会重试。`)
    }
    // A definitive pre-dispatch refusal on a durably claimed current must
    // still advance the locus: without this, a queue/bind refusal on the
    // physical-dispatch fence would strand every later backlog Delivery until
    // the (unreachable, since the row is now terminal) deadline timer fires.
    //
    // This method always runs INSIDE `enqueueDispatchLane` for this exact
    // correlation (both callers hold it), and `dispatchNext` re-enters the
    // very same per-locus lane. Awaiting it here would deadlock: the lane's
    // queued continuation could only run after this operation returns, and
    // this operation is awaiting that continuation. Detach it instead so it
    // is scheduled behind the current lane operation without blocking on it.
    try {
      this.deps.deliveryDispatch.currentFinished?.({
        deliveryId: pending.deliveryId,
        correlation: pending.correlation,
      })
      if (this.lifecycle !== 'active') this.suppressDispatch(pending.correlation)
      else void Promise.resolve(this.deps.deliveryDispatch.dispatchNext?.(pending.correlation)).catch(() => {
        this.log('delivery-persistence-failed')
      })
    } catch {
      this.log('delivery-persistence-failed')
    }
    this.log('queue-failed')
    return { kind: 'refused', reason: 'queue-failed' }
  }

  private dispatchUnknown(pending: PendingTurn): LocusControllerResult {
    this.log('dispatch-state-unknown')
    return { kind: 'refused', reason: 'dispatch-state-unknown' }
  }

  private async receiptAccepted(target: DeliveryFeedbackTarget): Promise<void> {
    try {
      await this.deps.receipts?.markAccepted(target)
    } catch {
      // Mechanical feedback never changes Delivery truth.
    }
  }

  private async receiptSettled(target: DeliveryFeedbackTarget, outcome: 'settled' | 'failed'): Promise<void> {
    try {
      await this.deps.receipts?.markSettled(target, outcome)
    } catch {
      // Mechanical feedback is fail-soft.
    }
  }

  private refuse(reason: LocusControllerRefusal): LocusControllerResult {
    if (reason !== 'aborted' && reason !== 'admission-unavailable') this.log(reason as LocusControllerDiagnostic)
    return { kind: 'refused', reason }
  }

  /**
   * Log a diagnostic together with the cause that produced it.
   *
   * The code stays a member of the stable union so existing consumers keep
   * working; the cause is appended because a silent `catch` here previously
   * made an operational failure indistinguishable from a design refusal.
   */
  private logReason(code: LocusControllerDiagnostic, error: unknown): void {
    const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    this.log(`${code} (${cause})` as LocusControllerDiagnostic)
  }

  private log(code: LocusControllerDiagnostic): void {
    try {
      this.deps.log?.(code)
    } catch {
      // Diagnostics are not part of the admission or Delivery transaction.
    }
  }
}

/** Factory form for callers that prefer a function. */
export function createLocusChannelController(deps: LocusControllerDeps): LocusChannelController {
  return new LocusChannelController(deps)
}

/** Compatibility alias for integrations using the shorter name. */
export const LocusController = LocusChannelController
