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
 *   admission -> active locus -> exact child -> Delivery.accept -> queue child
 *
 * A turn observer is a hard capability gate.  A child activation observer (or
 * a child id/FIFO heuristic) cannot prove which Delivery ran, so this module
 * refuses before admission and persistence when the per-turn observer is not
 * available.
 */

import { randomUUID } from 'node:crypto'
import {
  admitLocusEvent,
  type LocusAdmission,
  locusEndpointKey,
  type LocusAdmissionContext,
  type LocusAdmissionDecision,
  type LocusAdmissionRefusal,
  type LocusControlDispatchPort,
  type LocusControlDispatchResult,
  type LocusControlCommand,
  type LocusEndpoint as AdmissionEndpoint,
} from '../locus/admission.js'

/** The minimum prefix accepted by the channel control surface. */
export const MIN_BIND_PREFIX_LENGTH = 6
import {
  normalizeLocusEndpoint,
  type LocusContextAnchor,
  type LocusEndpoint,
  type LocusPermission,
} from '../locus/aggregate.js'
import {
  isSafeLocusReplyTarget,
  type LocusReplyTarget,
} from '../locus/context.js'
import type { LarkInboundEvent } from './event.js'
import { verifyLocusLivePolicy } from '../locus/policy-verification.js'
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

/** A normalized message with a canonical endpoint and trusted reply target. */
export interface NormalizedLocusMessage {
  readonly kind: 'message'
  readonly messageId: string
  readonly endpoint: LocusEndpoint
  readonly chatType: 'p2p' | 'group'
  readonly senderOpenId: string
  readonly senderName?: string
  readonly text: string
  readonly replyTarget: LocusReplyTarget
  readonly replyToMessageId?: string
  readonly createdAt?: number
}

/** A normalized admission result consumed by the controller. */
export type NormalizedLocusAdmission =
  | {
      readonly kind: 'accepted'
      readonly message: NormalizedLocusMessage
      readonly authorization: 'authorized' | 'uninitialized'
      readonly needsInitialization: boolean
    }
  | {
      readonly kind: 'control'
      readonly message: NormalizedLocusMessage
      readonly command: LocusControlCommand
      readonly authorization: 'authorized' | 'uninitialized' | 'retired' | 'legacy'
    }
  | {
      readonly kind: 'rejected'
      readonly reason: LocusAdmissionRefusal | 'unsafe-reply-target' | 'invalid-event'
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
  readonly childSessionId: string
  readonly workspaceId: string
  readonly state: 'active'
  /** Durable policy projection that every ordinary Delivery must re-verify. */
  readonly permission?: LocusPermission
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
export interface LocusResolutionPort {
  resolveCurrent(endpoint: LocusEndpoint): Awaitable<ActiveLocus | undefined>
  ensureForDelivery(input: EnsureLocusForDeliveryInput): Awaitable<ActiveLocus>
}

/** Exact identity of the parent and locus child used for one delivery. */
export interface LocusChildIdentity {
  readonly parentSessionId: string
  readonly childSessionId: string
}

/** Port for resolving/resuming and queueing one locus child. */
export interface LocusChildDeliveryPort {
  ensureChild(
    locus: ActiveLocus,
    signal: AbortSignal,
  ): Awaitable<LocusChildIdentity>
  /**
   * Read the exact live Session through its continuation owner after adoption.
   * Generic session routing is not authoritative for continuable children.
   */
  withChildSession?<T>(input: {
    readonly identity: LocusChildIdentity
    readonly operation: (session: unknown) => T | Promise<T>
    readonly signal?: AbortSignal
  }): Awaitable<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }>
  queueChild(input: {
    readonly locus: ActiveLocus
    readonly child: LocusChildIdentity
    readonly deliveryId: string
    /** Controller-generated token, armed before the queue operation. */
    readonly executionId: string
    readonly prompt: string
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
  readonly replyTarget: LocusReplyTarget
  readonly replyToMessageId?: string
}

/** Minimum acceptance projection the channel needs from durable storage. */
type LocusDeliveryAcceptance = Pick<
  DeliveryAcceptance,
  'record' | 'duplicate' | 'conflict'
>

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
  }): Awaitable<{ readonly changed: boolean; readonly record: DeliveryRecord | undefined; readonly reason?: string }>
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
}

/** Mechanical receipt/reaction port.  Failures are always fail-soft. */
export interface LocusMechanicalReceiptPort {
  markAccepted(target: DeliveryFeedbackTarget): Awaitable<void>
  markSettled(target: DeliveryFeedbackTarget, outcome: 'settled' | 'failed'): Awaitable<void>
  /** Only for control/diagnostic messages, never business transcript text. */
  sendControl?(target: LocusReplyTarget, text: string): Awaitable<void>
}

/**
 * Physically separate business-reply port.  The controller intentionally never
 * calls this: business text belongs to the child session's Feishu capability.
 */
export interface LocusBusinessReplyPort {
  send(input: { readonly target: LocusReplyTarget; readonly text: string }): Awaitable<void>
}

/** Controller dependencies. */
export interface LocusControllerDeps {
  readonly locus: LocusResolutionPort
  readonly deliveries: LocusDeliveryLedgerPort
  readonly child: LocusChildDeliveryPort
  /**
   * Resolve the complete live sandbox policy for the exact Session handle.
   * Called only inside child.withChildSession, immediately before acceptance.
   */
  readonly resolveLivePolicy?: (session: unknown) => Awaitable<{
    readonly mode?: string
    readonly workspaceRoot?: string
  } | undefined>
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
  readonly renderPrompt?: (input: {
    readonly locus: ActiveLocus
    readonly message: NormalizedLocusMessage
  }) => string
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
  readonly now?: () => number
  readonly signal?: AbortSignal
  readonly log?: (code: LocusControllerDiagnostic) => void
}

/** Stable diagnostics with no message body or external identifier. */
export type LocusControllerDiagnostic =
  | 'turn-correlation-unavailable'
  | 'invalid-event'
  | 'admission-rejected'
  | 'control-command'
  | 'locus-unavailable'
  | 'child-unavailable'
  | 'child-identity-mismatch'
  | 'policy-drift'
  | 'delivery-persistence-failed'
  | 'delivery-conflict'
  | 'duplicate-delivery'
  | 'queue-failed'
  | 'dispatch-state-unknown'
  | 'settlement-ignored'

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
  | 'delivery-persistence-failed'
  | 'delivery-conflict'
  | 'queue-failed'
  | 'dispatch-state-unknown'
  | 'aborted'

interface PendingTerminal {
  readonly phase: 'completed' | 'failed'
  readonly turnId: string
  readonly reason?: string
}

interface PendingTurn {
  readonly deliveryId: string
  readonly executionId: string
  readonly correlation: DeliveryCorrelation
  readonly target: DeliveryFeedbackTarget
  /** True while queue acceptance has not yet been durably bound. */
  dispatching: boolean
  /** The first exact turn identity observed for this execution. */
  startedTurnId?: string
  /** Terminal observation retained across a queue/bind race. */
  terminal?: PendingTerminal
  /** Conflicting observer evidence permanently blocks settlement. */
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
  if (raw.state !== 'active') return undefined
  const generation = raw.generation
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1) return undefined
  const id = nonEmpty(raw.id) ? raw.id.trim() : undefined
  const locusId = nonEmpty(raw.locusId) ? raw.locusId.trim() : undefined
  if (id === undefined && locusId === undefined) return undefined
  if (!nonEmpty(raw.parentSessionId) || !nonEmpty(raw.childSessionId) || !nonEmpty(raw.workspaceId)) {
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
  return {
    ...(id !== undefined ? { id } : {}),
    ...(locusId !== undefined ? { locusId } : {}),
    endpoint: locusEndpoint,
    generation,
    parentSessionId: raw.parentSessionId.trim(),
    childSessionId: raw.childSessionId.trim(),
    workspaceId: raw.workspaceId.trim(),
    state: 'active',
    permission: permission as unknown as LocusPermission,
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
): NormalizedLocusMessage | undefined {
  const endpoint: LocusEndpoint = {
    chatId: decision.endpoint.chatId,
    ...(decision.endpoint.threadId !== undefined ? { threadId: decision.endpoint.threadId } : {}),
  }
  const replyTarget: LocusReplyTarget = {
    chatId: endpoint.chatId,
    messageId: event.messageId,
    ...(endpoint.threadId !== undefined ? { threadId: endpoint.threadId } : {}),
    ...(event.rootId !== undefined ? { rootMessageId: event.rootId } : {}),
  }
  if (!isSafeLocusReplyTarget(endpoint, replyTarget)) return undefined
  return {
    kind: 'message',
    messageId: event.messageId,
    endpoint,
    chatType: event.chatType,
    senderOpenId: decision.senderId,
    text: decision.text,
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
  const message = messageFromAdmission(event, decision)
  if (message === undefined) return { kind: 'rejected', reason: 'unsafe-reply-target' }
  if (decision.command !== undefined) {
    return { kind: 'control', message, command: decision.command, authorization: decision.authorization }
  }
  if (decision.authorization !== 'authorized' && decision.authorization !== 'uninitialized') {
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

/**
 * Controller for ordinary Feishu deliveries into a unified locus child.
 */
export class LocusChannelController {
  private readonly now: () => number
  private readonly signal: AbortSignal
  private readonly pending = new Map<string, PendingTurn>()
  private readonly unsubscribe: (() => void) | undefined
  private observerReady: boolean

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

  dispose(): void {
    try {
      this.unsubscribe?.()
    } catch {
      // Host teardown is fail-soft and never sends a parent/business message.
    }
    this.pending.clear()
    this.observerReady = false
  }

  /** Handle a raw or normalized event after the observer capability gate. */
  async handle(
    input: LocusChannelEvent,
    suppliedContext?: LocusAdmissionContext,
  ): Promise<LocusControllerResult> {
    if (!this.available) return this.refuse('turn-correlation-unavailable')
    if (this.signal.aborted) return this.refuse('aborted')
    // Production supplies this per event so the watermark is the ready time of
    // the currently running subscription generation. The dependency-level form
    // remains available for isolated controller tests only.
    const context = suppliedContext ?? this.readAdmissionContext()
    if (context === undefined) return this.refuse('admission-unavailable')
    const admission = admitNormalizedLocusEvent(input, context)
    return this.handleAdmission(admission)
  }

  /** Consume a pre-admitted normalized result without re-running deduplication. */
  async handleAdmission(admission: NormalizedLocusAdmission): Promise<LocusControllerResult> {
    if (!this.available) return this.refuse('turn-correlation-unavailable')
    if (this.signal.aborted) return this.refuse('aborted')
    if (admission.kind === 'rejected') {
      this.log('admission-rejected')
      return { kind: 'ignored', reason: admission.reason }
    }
    if (admission.kind === 'control') {
      this.log('control-command')
      return this.dispatchControl(admission)
    }

    const message = admission.message
    const endpoint = normalizeLocusEndpoint(message.endpoint).endpoint
    const signal = this.signal
    let locus = await this.resolveLocus(endpoint, message, admission.needsInitialization, signal)
    if (locus === undefined) return this.refuse('locus-unavailable')

    let child: LocusChildIdentity
    try {
      child = await this.deps.child.ensureChild(locus, signal)
    } catch {
      return this.refuse('child-unavailable')
    }
    if (
      !nonEmpty(child.parentSessionId) ||
      !nonEmpty(child.childSessionId) ||
      child.parentSessionId.trim() !== locus.parentSessionId ||
      child.childSessionId.trim() !== locus.childSessionId
    ) {
      return this.refuse('child-identity-mismatch')
    }
    child = {
      parentSessionId: child.parentSessionId.trim(),
      childSessionId: child.childSessionId.trim(),
    }

    // Adoption proves the exact durable child, but not that its current policy
    // still matches the database. Resolve through the continuation owner at
    // this operation boundary, before creating ANY Delivery/reaction/queue.
    const policyVerification = await this.verifyLivePolicy(locus, child, signal)
    if (!policyVerification.ok) {
      try {
        await this.deps.invalidatePolicyDrift?.({ locus, reason: policyVerification.diagnostic })
      } catch {
        // Failure to persist the pause is still fail closed for this request.
      }
      return this.refuse('policy-drift')
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
      ...(message.replyTarget.rootMessageId !== undefined
        ? { rootMessageId: message.replyTarget.rootMessageId }
        : {}),
      replyTarget: message.replyTarget,
      ...(message.replyToMessageId !== undefined ? { replyToMessageId: message.replyToMessageId } : {}),
    }

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
      queued = await this.deps.child.queueChild({
        locus,
        child,
        deliveryId: pending.deliveryId,
        executionId,
        prompt: this.deps.renderPrompt?.({ locus, message }) ?? message.text,
        replyTarget: message.replyTarget,
        signal,
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
    // Queue acceptance is now durably established. Drain all facts recorded by
    // synchronous observer callbacks in their serialized order before returning.
    await pending.operation
    if (pending.conflicted) {
      this.log('settlement-ignored')
      return {
        kind: 'accepted',
        deliveryId: bound.deliveryId,
        executionId: pending.executionId,
        locusId: bound.locusId,
        generation: bound.generation,
      }
    }
    const observedTurnId = pending.startedTurnId ?? pending.terminal?.turnId
    if (observedTurnId !== undefined) await this.bindObservedTurn(pending, observedTurnId)
    if (pending.terminal !== undefined && pending.terminal.turnId === observedTurnId) {
      await this.settleObservedTerminal(pending, pending.terminal)
    }
    return {
      kind: 'accepted',
      deliveryId: bound.deliveryId,
      executionId: pending.executionId,
      locusId: bound.locusId,
      generation: bound.generation,
    }
  }

  private async verifyLivePolicy(
    locus: ActiveLocus,
    child: LocusChildIdentity,
    signal: AbortSignal,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly diagnostic: string }> {
    if (
      locus.permission === undefined ||
      this.deps.child.withChildSession === undefined ||
      this.deps.resolveLivePolicy === undefined
    ) {
      return { ok: false, diagnostic: 'live sandbox policy verification capability is unavailable' }
    }
    try {
      const result = await this.deps.child.withChildSession({
        identity: child,
        signal,
        operation: async session => await this.deps.resolveLivePolicy!(session),
      })
      if (!result.ok) {
        return { ok: false, diagnostic: `continuation owner rejected live policy read (${result.reason})` }
      }
      const livePolicy = result.value as { readonly mode?: string; readonly workspaceRoot?: string } | undefined
      const verified = verifyLocusLivePolicy({
        permission: locus.permission,
        ...(locus.contextAnchor === undefined ? {} : { contextAnchor: locus.contextAnchor }),
      }, livePolicy)
      return verified.ok
        ? { ok: true }
        : { ok: false, diagnostic: verified.diagnostic }
    } catch {
      return { ok: false, diagnostic: 'live sandbox policy read failed' }
    }
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
      command.kind === 'unbind-invalid'
    ) {
      const text = controlValidationText(command)
      await this.sendControlReceipt(admission.message.replyTarget, text)
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
      await this.sendControlReceipt(admission.message.replyTarget, text)
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
      await this.sendControlReceipt(admission.message.replyTarget, text)
      return { kind: 'control', command, ok: false, reason: 'control-dispatch-failed', text }
    }
    if (!isControlDispatchResult(result)) {
      const text = '控制命令返回无效结果，未执行工作。'
      await this.sendControlReceipt(admission.message.replyTarget, text)
      return { kind: 'control', command, ok: false, reason: 'control-dispatch-failed', text }
    }
    if ('text' in result && result.text !== undefined) {
      await this.sendControlReceipt(admission.message.replyTarget, result.text)
    }
    return {
      kind: 'control',
      command,
      ok: result.ok,
      ...('reason' in result && result.reason !== undefined ? { reason: result.reason } : {}),
      ...('text' in result && result.text !== undefined ? { text: result.text } : {}),
    }
  }

  private async sendControlReceipt(target: LocusReplyTarget, text: string): Promise<void> {
    if (!nonEmpty(text)) return
    try {
      await this.deps.receipts?.sendControl?.(target, text)
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
    try {
      raw = await this.deps.locus.resolveCurrent(endpoint)
    } catch {
      return undefined
    }
    let locus = normalizeActiveLocus(raw, endpoint)
    if (locus !== undefined) return locus
    if (!needsInitialization) return undefined
    try {
      raw = await this.deps.locus.ensureForDelivery({
        endpoint,
        messageId: message.messageId,
        signal,
      })
    } catch {
      return undefined
    }
    locus = normalizeActiveLocus(raw, endpoint)
    return locus
  }

  private subscribeObserver(observer: LocusTurnCorrelationObserver): (() => void) | undefined {
    try {
      const disposer = observer.subscribe.call(observer, (event: LocusTurnCorrelationEvent) => {
        void this.observe(event)
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
        (durable.status === 'queued' || durable.status === 'running') &&
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
      if (event.phase === 'started') {
        if (pending.startedTurnId !== undefined && pending.startedTurnId !== turnId) {
          pending.conflicted = true
          this.log('settlement-ignored')
          return
        }
        if (pending.terminal !== undefined && pending.terminal.turnId !== turnId) {
          pending.conflicted = true
          this.log('settlement-ignored')
          return
        }
        // While dispatching, observer facts are only buffered. Persisting a
        // turn before bindQueued would make the later queue bind ambiguous.
        pending.startedTurnId = turnId
        if (!pending.dispatching) await this.bindObservedTurn(pending, turnId)
        return
      }
      if (pending.startedTurnId !== undefined && pending.startedTurnId !== turnId) {
        pending.conflicted = true
        this.log('settlement-ignored')
        return
      }
      if (pending.terminal !== undefined &&
          (pending.terminal.turnId !== turnId || pending.terminal.phase !== event.phase)) {
        pending.conflicted = true
        this.log('settlement-ignored')
        return
      }
      pending.terminal = {
        phase: event.phase,
        turnId,
        ...(event.reason !== undefined ? { reason: event.reason } : {}),
      }
      if (!pending.dispatching) {
        await this.bindObservedTurn(pending, turnId)
        await this.settleObservedTerminal(pending, pending.terminal)
      }
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
      if (bound === undefined) this.log('settlement-ignored')
    } catch {
      this.log('settlement-ignored')
    }
  }

  private async settleObservedTerminal(pending: PendingTurn, terminal: PendingTerminal): Promise<void> {
    if (pending.conflicted) return
    if (pending.startedTurnId !== undefined && pending.startedTurnId !== terminal.turnId) return
    const turnCorrelation: DeliveryTurnCorrelation = {
      ...pending.correlation,
      turnId: terminal.turnId,
    }
    let settled: {
      readonly changed: boolean
      readonly record: DeliveryRecord | undefined
      readonly reason?: string
    }
    try {
      settled = await this.deps.deliveries.settleByTurn({
        deliveryId: pending.deliveryId,
        executionId: pending.executionId,
        correlation: turnCorrelation,
        outcome: terminal.phase === 'failed' ? 'failed' : 'settled',
        settledAt: this.now(),
        ...(terminal.reason !== undefined ? { failureReason: terminal.reason } : {}),
      })
    } catch {
      this.log('settlement-ignored')
      return
    }
    if (!settled.changed) return
    this.pending.delete(pending.deliveryId)
    await this.receiptSettled(
      settled.record?.feedbackTarget ?? pending.target,
      terminal.phase === 'failed' ? 'failed' : 'settled',
    )
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
      if (refusal !== true) return this.dispatchUnknown(pending)
    } catch {
      return this.dispatchUnknown(pending)
    }
    await this.receiptSettled(pending.target, 'failed')
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
