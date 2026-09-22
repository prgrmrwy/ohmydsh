/** Race/control-plane tests for the unified locus channel controller. */

import { describe, expect, it, vi } from 'vitest'
import {
  LocusChannelController,
  type ActiveLocus,
  type LocusChildDeliveryPort,
  type LocusControllerDeps,
  type LocusTurnCorrelationEvent,
  type NormalizedLocusAdmission,
} from '../src/host/channel/locus-controller.js'
import type { LocusControlCommand } from '../src/host/locus/admission.js'
import { createLocusChildDelivery } from '../src/host/locus/child-delivery.js'
import {
  acceptDelivery,
  bindQueued,
  bindTurn,
  claimCurrentDelivery,
  createDeliveryLedger,
  type DeliveryAcceptance,
  type DeliveryCorrelation,
  type DeliveryLedgerState,
  type DeliveryRecord,
} from '../src/host/locus/delivery.js'
import type { LocusReplyTarget } from '../src/host/locus/context.js'
import { STORAGE_KEY_SEPARATOR } from '../src/host/locus/storage-key.js'

const ENDPOINT = { chatId: 'oc_race', threadId: 'omt_race' } as const
const LOCUS: ActiveLocus = {
  id: 'locus-race',
  endpoint: ENDPOINT,
  generation: 3,
  parentSessionId: 'session-parent',
  childSessionId: 'session-child',
  workspaceId: 'workspace-race',
  state: 'active',
  permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
}
const REPLY_TARGET: LocusReplyTarget = {
  chatId: ENDPOINT.chatId,
  threadId: ENDPOINT.threadId,
  messageId: 'message-race',
}

class SynchronousTurnObserver {
  readonly perTurnCorrelation = true as const
  private listener: ((event: LocusTurnCorrelationEvent) => void) | undefined

  subscribe(listener: (event: LocusTurnCorrelationEvent) => void): () => void {
    this.listener = listener
    return () => {
      this.listener = undefined
    }
  }

  emit(event: unknown): void {
    this.listener?.(event as LocusTurnCorrelationEvent)
  }
}

/**
 * A storage-shaped ledger backed by the pure Delivery state machine. Keeping
 * this seam real catches controller tests that accidentally skip a
 * transition or dispatch without first persisting the queue proof.
 *
 * This also implements the durable current-claim seam
 * (`claimCurrent`/`currentFinished`/`dispatchNext`/`scheduleCurrent`)
 * required by `LocusControllerDeps.deliveryDispatch` in production: the
 * controller refuses admission with `dispatch-state-unknown` when that
 * dependency is absent, so every fixture in this file must supply it.
 */
class MemoryDeliveryLedger {
  state: DeliveryLedgerState = createDeliveryLedger()
  readonly calls: string[] = []
  readonly history: DeliveryRecord[] = []
  readonly scheduled: DeliveryRecord[] = []

  findByMessageId(messageId: string): DeliveryRecord | undefined {
    return this.state.byMessageId[messageId]
  }

  getById(deliveryId: string): DeliveryRecord | undefined {
    return this.state.byDeliveryId[deliveryId]
  }

  accept(input: Parameters<typeof acceptDelivery>[1]): DeliveryAcceptance {
    this.calls.push('accept')
    const mutation = acceptDelivery(this.state, input)
    this.state = mutation.state
    if (!mutation.duplicate) this.history.push(mutation.record)
    return mutation
  }

  bindQueued(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
    readonly executionId: string
    readonly inboxMessageId: string
    readonly queuedAt?: number
  }): DeliveryRecord | undefined {
    this.calls.push('bindQueued')
    const pureInput = {
      ...input.correlation,
      deliveryId: input.deliveryId,
      executionId: input.executionId,
      inboxMessageId: input.inboxMessageId,
      ...(input.queuedAt !== undefined ? { queuedAt: input.queuedAt } : {}),
    }
    const mutation = bindQueued(this.state, pureInput)
    this.state = mutation.state
    if (mutation.record !== undefined && mutation.changed) this.history.push(mutation.record)
    return mutation.record
  }

  bindTurn(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
    readonly executionId: string
    readonly turnId: string
    readonly startedAt?: number
  }): DeliveryRecord | undefined {
    this.calls.push('bindTurn')
    const mutation = bindTurn(this.state, {
      ...input.correlation,
      deliveryId: input.deliveryId,
      executionId: input.executionId,
      turnId: input.turnId,
      ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
    })
    this.state = mutation.state
    if (mutation.record !== undefined && mutation.changed) this.history.push(mutation.record)
    return mutation.record
  }

  fail(input: {
    readonly deliveryId: string
    readonly correlation: DeliveryCorrelation
    readonly executionId?: string
    readonly reason: string
  }): boolean {
    this.calls.push('fail')
    const current = this.state.byDeliveryId[input.deliveryId]
    // Matches production `failBeforeDispatch`: a definitive pre-dispatch
    // refusal is valid from `accepted`, `queued`, OR a durably claimed
    // `current` row (this fixture's `claimCurrent` promotes accepted ->
    // current before `queueChild` is even attempted).
    if (
      current === undefined ||
      (current.status !== 'accepted' && current.status !== 'queued' && current.status !== 'current')
    ) return false
    if (
      current.locusId !== input.correlation.locusId ||
      current.generation !== input.correlation.generation ||
      current.childSessionId !== input.correlation.childSessionId ||
      current.endpoint.chatId !== input.correlation.endpoint.chatId ||
      current.endpoint.threadId !== input.correlation.endpoint.threadId
    ) return false
    const { queueState: _queueState, ...withoutQueueState } = current
    const failed = Object.freeze({
      ...withoutQueueState,
      status: 'failed' as const,
      dispatchFailure: current.status === 'queued' ? 'queued-not-started' as const : 'not-queued' as const,
      failureReason: input.reason,
      failedAt: 100,
    })
    this.state = {
      ...this.state,
      byDeliveryId: Object.freeze({ ...this.state.byDeliveryId, [failed.deliveryId]: failed }),
      byMessageId: Object.freeze({ ...this.state.byMessageId, [failed.messageId]: failed }),
    }
    this.history.push(failed)
    return true
  }

  /** Durable current-claim seam consumed by `LocusControllerDeps.deliveryDispatch`. */
  claimCurrent(input: {
    readonly correlation: DeliveryCorrelation
    readonly deliveryId?: string
    readonly now: number
  }): DeliveryRecord | undefined {
    this.calls.push('claimCurrent')
    const mutation = claimCurrentDelivery(this.state, {
      ...input.correlation,
      now: input.now,
      ...(input.deliveryId === undefined ? {} : { deliveryId: input.deliveryId }),
    })
    this.state = mutation.state
    if (mutation.changed && mutation.record !== undefined) this.history.push(mutation.record)
    return mutation.changed && mutation.record?.status === 'current' ? mutation.record : undefined
  }

  currentFinished(): void {
    this.calls.push('currentFinished')
  }

  async dispatchNext(): Promise<void> {
    this.calls.push('dispatchNext')
  }

  scheduleCurrent(record: DeliveryRecord): void {
    this.calls.push('scheduleCurrent')
    this.scheduled.push(record)
  }
}

interface Harness {
  readonly controller: LocusChannelController
  readonly observer: SynchronousTurnObserver
  readonly ledger: MemoryDeliveryLedger
  readonly queueInputs: Parameters<LocusChildDeliveryPort['queueChild']>[0][]
  readonly markAccepted: ReturnType<typeof vi.fn>
  readonly markSettled: ReturnType<typeof vi.fn>
  readonly diagnostics: string[]
}

function correlation(): DeliveryCorrelation {
  return {
    endpoint: ENDPOINT,
    locusId: LOCUS.id!,
    generation: LOCUS.generation,
    childSessionId: LOCUS.childSessionId,
  }
}

function eventFor(
  input: Parameters<LocusChildDeliveryPort['queueChild']>[0],
  phase: 'started' | 'completed' | 'failed',
  turnId: string,
): LocusTurnCorrelationEvent {
  return {
    phase,
    deliveryId: input.deliveryId,
    executionId: input.executionId,
    turnId,
    correlation: correlation(),
    ...(phase === 'failed' ? { reason: 'child failed' } : {}),
  }
}

function acceptedAdmission(messageId = 'message-race'): NormalizedLocusAdmission {
  return {
    kind: 'accepted',
    authorization: 'authorized',
    needsInitialization: false,
    message: {
      kind: 'message',
      messageId,
      endpoint: ENDPOINT,
      chatType: 'group',
      senderOpenId: 'ou-owner',
      text: 'inspect the race',
      replyTarget: { ...REPLY_TARGET, messageId },
    },
  }
}

function controlAdmission(command: LocusControlCommand = { kind: 'scope', mode: 'write' }): NormalizedLocusAdmission {
  return {
    kind: 'control',
    command,
    authorization: 'authorized',
    message: {
      kind: 'message',
      messageId: 'message-control',
      endpoint: ENDPOINT,
      chatType: 'group',
      senderOpenId: 'ou-owner',
      text: '/scope write',
      replyTarget: { ...REPLY_TARGET, messageId: 'message-control' },
    },
  }
}

/** Base deps shared by every fixture in this file; override per-test as needed. */
function baseDeps(ledger: MemoryDeliveryLedger, observer: SynchronousTurnObserver): Pick<
  LocusControllerDeps,
  'locus' | 'deliveries' | 'deliveryDispatch' | 'turns'
> {
  return {
    locus: {
      resolveCurrent: () => LOCUS,
      ensureForDelivery: () => LOCUS,
    },
    deliveries: ledger,
    deliveryDispatch: ledger,
    turns: observer,
  }
}

function makeHarness(
  queue: (
    input: Parameters<LocusChildDeliveryPort['queueChild']>[0],
    observer: SynchronousTurnObserver,
  ) =>
    | Awaited<ReturnType<LocusChildDeliveryPort['queueChild']>>
    | Promise<Awaited<ReturnType<LocusChildDeliveryPort['queueChild']>>>,
  options: {
    readonly media?: LocusControllerDeps['media']
    readonly addressing?: LocusControllerDeps['addressing']
    readonly beforeQueueFence?: (
      input: Parameters<LocusChildDeliveryPort['queueChild']>[0],
      attempt: number,
    ) => void | Promise<void>
  } = {},
): Harness {
  const observer = new SynchronousTurnObserver()
  const ledger = new MemoryDeliveryLedger()
  const queueInputs: Parameters<LocusChildDeliveryPort['queueChild']>[0][] = []
  const markAccepted = vi.fn()
  const markSettled = vi.fn()
  const diagnostics: string[] = []
  const child: LocusChildDeliveryPort = {
    ensureChild: () => ({
      parentSessionId: LOCUS.parentSessionId,
      childSessionId: LOCUS.childSessionId,
    }),
    withChildSession: async input => ({ ok: true as const, value: await input.operation({ id: LOCUS.childSessionId }) }),
    queueChild: async input => {
      queueInputs.push(input)
      await options.beforeQueueFence?.(input, queueInputs.length)
      if (!await input.fenceBeforeQueue()) return { accepted: false, reason: 'child-proof-failed' }
      return queue(input, observer)
    },
  }
  const deps: LocusControllerDeps = {
    ...baseDeps(ledger, observer),
    child,
    resolveLivePolicy: () => ({ mode: 'read-only', workspaceRoot: '/repo' }),
    receipts: { markAccepted, markSettled },
    ...(options.media === undefined ? {} : { media: options.media }),
    ...(options.addressing === undefined ? {} : { addressing: options.addressing }),
    now: (() => {
      let value = 100
      return () => value++
    })(),
    log: code => diagnostics.push(code),
  }
  return {
    controller: new LocusChannelController(deps),
    observer,
    ledger,
    queueInputs,
    markAccepted,
    markSettled,
    diagnostics,
  }
}

describe('LocusChannelController queue/turn races', () => {
  it('durably accepts multi-bot addressing before queueing without Host intent filtering', async () => {
    const admission = acceptedAdmission('message-multi-bot')
    if (admission.kind !== 'accepted') throw new Error('fixture must be accepted')
    const withMentions: NormalizedLocusAdmission = {
      ...admission,
      message: {
        ...admission.message,
        addressing: {
          status: 'unknown',
          occurrences: [
            { kind: 'self-bot', displayName: 'Pet', stableId: 'ou-self' },
            { kind: 'unknown', displayName: 'Review Bot', stableId: 'ou-other' },
          ],
          selfMentioned: true,
          otherBotCount: 0,
          orderKnown: true,
        },
      },
    }
    const harness = makeHarness(
      input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      { addressing: { listChatBots: async () => ({ kind: 'ok', bots: [{ openId: 'ou-self' }, { openId: 'ou-other' }] }) } },
    )

    const result = await harness.controller.handleAdmission(withMentions)
    expect(result.kind).toBe('accepted')
    expect(harness.ledger.state.byDeliveryId['delivery-1']?.addressing).toMatchObject({
      status: 'known', selfMentioned: true, otherBotCount: 1,
      occurrences: [{ kind: 'self-bot' }, { kind: 'other-bot' }],
    })
    expect(harness.queueInputs).toHaveLength(1)
  })

  it('names the asker so the agent addresses a person instead of echoing the open id', async () => {
    // The delivery prompt reports the sender and tells the agent to address
    // people by display name. Handed only an `ou_…`, an agent writes that id,
    // which the platform renders as plain text: nobody is notified and the
    // identifier lands in the chat.
    const harness = makeHarness(
      input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      {
        addressing: {
          listChatBots: async () => ({ kind: 'ok', bots: [] }),
          resolveMemberName: async (chatId, openId) =>
            chatId === ENDPOINT.chatId && openId === 'ou-owner' ? '张勇' : undefined,
        },
      },
    )

    const result = await harness.controller.handleAdmission(acceptedAdmission('message-named'))

    expect(result.kind).toBe('accepted')
    expect(harness.ledger.state.byDeliveryId['delivery-1']?.senderName).toBe('张勇')
  })

  it('keeps the open id when the member name cannot be resolved', async () => {
    const harness = makeHarness(
      input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      {
        addressing: {
          listChatBots: async () => ({ kind: 'ok', bots: [] }),
          resolveMemberName: async () => undefined,
        },
      },
    )

    expect((await harness.controller.handleAdmission(acceptedAdmission('message-unnamed'))).kind).toBe('accepted')
    expect(harness.ledger.state.byDeliveryId['delivery-1']?.senderName).toBeUndefined()
    expect(harness.ledger.state.byDeliveryId['delivery-1']?.senderOpenId).toBe('ou-owner')
  })

  it('keeps unknown kinds when async chat-bot enrichment fails but still durably queues', async () => {
    const admission = acceptedAdmission('message-membership-failed')
    if (admission.kind !== 'accepted') throw new Error('fixture must be accepted')
    const withMentions: NormalizedLocusAdmission = {
      ...admission,
      message: {
        ...admission.message,
        addressing: {
          status: 'unknown',
          occurrences: [{ kind: 'unknown', displayName: 'Unproven', stableId: 'ou-unproven' }],
          selfMentioned: false,
          otherBotCount: 0,
          orderKnown: true,
        },
      },
    }
    const harness = makeHarness(
      input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      { addressing: { listChatBots: async () => ({ kind: 'error' }) } },
    )

    expect((await harness.controller.handleAdmission(withMentions)).kind).toBe('accepted')
    expect(harness.ledger.state.byDeliveryId['delivery-1']?.addressing).toMatchObject({
      status: 'unknown', occurrences: [{ kind: 'unknown', displayName: 'Unproven' }],
    })
    expect(harness.queueInputs).toHaveLength(1)
  })

  it('continues text Delivery when the production media gate is unavailable', async () => {
    const admitCurrentImage = vi.fn(async () => ({ kind: 'ready' as const, content: [] }))
    const harness = makeHarness(
      input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      {
        media: {
          available: false,
          diagnostic: 'cross-child-media-isolation-unavailable',
          admitCurrentImage,
        },
      },
    )

    await expect(harness.controller.handleAdmission(acceptedAdmission())).resolves.toMatchObject({ kind: 'accepted' })
    expect(admitCurrentImage).not.toHaveBeenCalled()
    expect(harness.queueInputs).toHaveLength(1)
    expect(harness.queueInputs[0]?.content).toEqual([
      { type: 'text', text: 'inspect the race' },
      { type: 'text', text: '[当前 Host 的图片读取能力不可用。]' },
    ])
    expect(harness.ledger.state.byDeliveryId['delivery-1']?.status).toBe('current')
  })

  it('retries one typed image refusal as text-only for the same exact current without rerunning media admission', async () => {
    const admitCurrentImage = vi.fn(async () => ({
      kind: 'ready' as const,
      content: [
        { type: 'text' as const, text: '[图片：screenshot.png]' },
        {
          type: 'image' as const,
          attachment: {
            attachmentId: 'attachment-text-fallback' as never,
            mediaType: 'image/png' as const,
            bytes: 8,
            width: 1,
            height: 1,
          },
        },
      ],
    }))
    const harness = makeHarness(
      input => input.content.some(block => block.type === 'image')
        ? { accepted: false, reason: 'image-route-unsupported' }
        : { accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` },
      { media: { available: true, admitCurrentImage } },
    )

    await expect(harness.controller.handleAdmission(acceptedAdmission())).resolves.toMatchObject({ kind: 'accepted' })

    expect(admitCurrentImage).toHaveBeenCalledOnce()
    expect(harness.queueInputs).toHaveLength(2)
    const [typed, fallback] = harness.queueInputs
    expect(typed?.content.some(block => block.type === 'image')).toBe(true)
    expect(fallback).toMatchObject({
      deliveryId: typed?.deliveryId,
      executionId: typed?.executionId,
      child: typed?.child,
      replyTarget: typed?.replyTarget,
    })
    expect(fallback?.content).toEqual([
      { type: 'text', text: 'inspect the race' },
      { type: 'text', text: '[当前模型无法查看图片；请仅依据以上文字回复，不要声称已看见或理解图片内容。]' },
    ])
    expect(harness.ledger.calls.filter(call => call === 'bindQueued')).toHaveLength(1)
    expect(harness.ledger.state.byDeliveryId['delivery-1']?.status).toBe('current')
  })

  it('terminally fails the exact current only when its one text fallback also refuses', async () => {
    const admitCurrentImage = vi.fn(async () => ({
      kind: 'ready' as const,
      content: [{
        type: 'image' as const,
        attachment: {
          attachmentId: 'attachment-fallback-fails' as never,
          mediaType: 'image/png' as const,
          bytes: 8,
          width: 1,
          height: 1,
        },
      }],
    }))
    const harness = makeHarness(
      input => input.content.some(block => block.type === 'image')
        ? { accepted: false, reason: 'image-route-unsupported' }
        : { accepted: false, reason: 'inbox-failed' },
      { media: { available: true, admitCurrentImage } },
    )

    await expect(harness.controller.handleAdmission(acceptedAdmission())).resolves.toMatchObject({
      kind: 'refused', reason: 'queue-failed',
    })
    expect(admitCurrentImage).toHaveBeenCalledOnce()
    expect(harness.queueInputs).toHaveLength(2)
    expect(harness.ledger.state.byDeliveryId['delivery-1']).toMatchObject({
      status: 'failed', failureReason: 'inbox-failed',
    })
  })

  it('does not retry any queue refusal other than image-route-unsupported', async () => {
    const admitCurrentImage = vi.fn(async () => ({
      kind: 'ready' as const,
      content: [{
        type: 'image' as const,
        attachment: {
          attachmentId: 'attachment-no-retry' as never,
          mediaType: 'image/png' as const,
          bytes: 8,
          width: 1,
          height: 1,
        },
      }],
    }))
    const harness = makeHarness(
      () => ({ accepted: false, reason: 'inbox-failed' }),
      { media: { available: true, admitCurrentImage } },
    )

    await expect(harness.controller.handleAdmission(acceptedAdmission())).resolves.toMatchObject({
      kind: 'refused', reason: 'queue-failed',
    })
    expect(admitCurrentImage).toHaveBeenCalledOnce()
    expect(harness.queueInputs).toHaveLength(1)
    expect(harness.ledger.state.byDeliveryId['delivery-1']).toMatchObject({
      status: 'failed', failureReason: 'inbox-failed',
    })
  })

  it('does not let A text fallback enter B after current changes during typed refusal', async () => {
    const admitCurrentImage = vi.fn(async () => ({
      kind: 'ready' as const,
      content: [{
        type: 'image' as const,
        attachment: {
          attachmentId: 'attachment-old-a' as never,
          mediaType: 'image/png' as const,
          bytes: 8,
          width: 1,
          height: 1,
        },
      }],
    }))
    let harness!: Harness
    harness = makeHarness(
      input => {
        const oldA = harness.ledger.state.byDeliveryId[input.deliveryId]!
        const expiredA = Object.freeze({ ...oldA, status: 'expired' as const, queueState: undefined })
        const acceptedB = acceptDelivery(harness.ledger.state, {
          ...correlation(), messageId: 'message-b-fallback-race', acceptedAt: 200,
          senderOpenId: 'ou-owner', text: 'message b',
        })
        const b = Object.freeze({ ...acceptedB.record, status: 'current' as const, queueState: 'current' as const })
        harness.ledger.state = Object.freeze({
          ...acceptedB.state,
          byDeliveryId: Object.freeze({
            ...acceptedB.state.byDeliveryId,
            [expiredA.deliveryId]: expiredA,
            [b.deliveryId]: b,
          }),
          byMessageId: Object.freeze({
            ...acceptedB.state.byMessageId,
            [expiredA.messageId]: expiredA,
            [b.messageId]: b,
          }),
        })
        return { accepted: false, reason: 'image-route-unsupported' }
      },
      { media: { available: true, admitCurrentImage } },
    )

    await expect(harness.controller.handleAdmission(acceptedAdmission())).resolves.toMatchObject({
      kind: 'refused', reason: 'dispatch-state-unknown',
    })
    expect(admitCurrentImage).toHaveBeenCalledOnce()
    expect(harness.queueInputs).toHaveLength(1)
    expect(harness.queueInputs[0]?.deliveryId).toBe('delivery-1')
    expect(harness.ledger.state.byDeliveryId['delivery-1']).toMatchObject({ status: 'expired' })
    expect(harness.ledger.state.byMessageId['message-b-fallback-race']).toMatchObject({ status: 'current' })
  })

  it('revalidates at the fallback queue seam so A cannot enter B after the controller precheck', async () => {
    const admitCurrentImage = vi.fn(async () => ({
      kind: 'ready' as const,
      content: [{
        type: 'image' as const,
        attachment: {
          attachmentId: 'attachment-seam-race' as never,
          mediaType: 'image/png' as const,
          bytes: 8,
          width: 1,
          height: 1,
        },
      }],
    }))
    let harness!: Harness
    harness = makeHarness(
      input => input.content.some(block => block.type === 'image')
        ? { accepted: false, reason: 'image-route-unsupported' }
        : { accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` },
      {
        media: { available: true, admitCurrentImage },
        beforeQueueFence: (_input, attempt) => {
          if (attempt !== 2) return
          const oldA = harness.ledger.state.byDeliveryId['delivery-1']!
          const expiredA = Object.freeze({ ...oldA, status: 'expired' as const, queueState: undefined })
          const acceptedB = acceptDelivery(harness.ledger.state, {
            ...correlation(), messageId: 'message-b-at-fallback-seam', acceptedAt: 200,
            senderOpenId: 'ou-owner', text: 'message b',
          })
          const b = Object.freeze({ ...acceptedB.record, status: 'current' as const, queueState: 'current' as const })
          harness.ledger.state = Object.freeze({
            ...acceptedB.state,
            byDeliveryId: Object.freeze({
              ...acceptedB.state.byDeliveryId,
              [expiredA.deliveryId]: expiredA,
              [b.deliveryId]: b,
            }),
            byMessageId: Object.freeze({
              ...acceptedB.state.byMessageId,
              [expiredA.messageId]: expiredA,
              [b.messageId]: b,
            }),
          })
        },
      },
    )

    await expect(harness.controller.handleAdmission(acceptedAdmission())).resolves.toMatchObject({
      kind: 'refused', reason: 'dispatch-state-unknown',
    })
    expect(admitCurrentImage).toHaveBeenCalledOnce()
    expect(harness.queueInputs).toHaveLength(2)
    expect(harness.queueInputs[1]?.content.some(block => block.type === 'image')).toBe(false)
    expect(harness.ledger.state.byMessageId['message-b-at-fallback-seam']).toMatchObject({ status: 'current' })
  })

  it('drops downloaded image content when the exact Delivery stops being current before typed queueing', async () => {
    let harness!: Harness
    harness = makeHarness(
      input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      {
        media: {
          available: true,
          async admitCurrentImage() {
            const current = harness.ledger.state.byDeliveryId['delivery-1']!
            const expired = Object.freeze({ ...current, status: 'expired' as const })
            harness.ledger.state = Object.freeze({
              ...harness.ledger.state,
              byDeliveryId: Object.freeze({ ...harness.ledger.state.byDeliveryId, [current.deliveryId]: expired }),
              byMessageId: Object.freeze({ ...harness.ledger.state.byMessageId, [current.messageId]: expired }),
            })
            return {
              kind: 'ready',
              content: [{
                type: 'image',
                attachment: {
                  attachmentId: 'attachment-race' as never,
                  mediaType: 'image/png',
                  bytes: 8,
                  width: 1,
                  height: 1,
                },
              }],
            }
          },
        },
      },
    )

    const result = await harness.controller.handleAdmission(acceptedAdmission())

    expect(result).toMatchObject({ kind: 'refused' })
    expect(harness.queueInputs).toEqual([])
  })

  it.each(['started', 'completed', 'failed'] as const)(
    'buffers a synchronous %s observer event emitted before queue bind, which never settles the Delivery',
    async phase => {
      const harness = makeHarness((input, observer) => {
        observer.emit(eventFor(input, phase, 'turn-sync'))
        return { accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }
      })

      const result = await harness.controller.handleAdmission(acceptedAdmission())

      expect(result.kind).toBe('accepted')
      // `claimCurrent` promotes accepted -> current before queueing. Only a
      // `started` observer event binds the exact turn id; `completed`/`failed`
      // are diagnostic-only execution evidence and MUST NOT transition the
      // locus-level Delivery — only `pet_locus_finish` (via
      // `markDeliveryFinishing`/`completeCurrentDelivery`, not exercised by
      // this controller-only harness) or deadline expiry may terminate it.
      expect(harness.ledger.calls).toEqual([
        'accept', 'claimCurrent', 'bindQueued', 'scheduleCurrent',
        ...(phase === 'started' ? ['bindTurn'] : []),
      ])
      expect(harness.ledger.history.map(record => record.status)).toEqual([
        'accepted', 'current', 'current',
        ...(phase === 'started' ? ['current'] : []),
      ])
      expect(harness.ledger.state.byDeliveryId['delivery-1']?.status).toBe('current')
      expect(harness.markAccepted).toHaveBeenCalledOnce()
      // Only durable acceptance produces a receipt; observer phase is not a
      // business settlement and therefore never produces a settled receipt.
      expect(harness.markSettled).not.toHaveBeenCalled()
      if (phase !== 'started') expect(harness.diagnostics).toContain('settlement-ignored')
    },
  )

  it.each(['completed', 'failed'] as const)(
    'handles terminal-%s-before-start without losing the exact turn, and still does not settle the Delivery',
    async phase => {
      const harness = makeHarness((input, observer) => {
        observer.emit(eventFor(input, phase, 'turn-terminal-first'))
        observer.emit(eventFor(input, 'started', 'turn-terminal-first'))
        return { accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }
      })

      await expect(harness.controller.handleAdmission(acceptedAdmission())).resolves.toMatchObject({
        kind: 'accepted',
      })
      expect(harness.ledger.state.byDeliveryId['delivery-1']?.status).toBe('current')
      expect(harness.ledger.state.byDeliveryId['delivery-1']?.turnId).toBe('turn-terminal-first')
      expect(harness.markSettled).not.toHaveBeenCalled()
    },
  )

  it('keeps the Delivery current when observer evidence contains conflicting turn ids', async () => {
    const harness = makeHarness((input, observer) => {
      observer.emit(eventFor(input, 'started', 'turn-a'))
      observer.emit(eventFor(input, 'completed', 'turn-b'))
      return { accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }
    })

    const result = await harness.controller.handleAdmission(acceptedAdmission())

    expect(result.kind).toBe('accepted')
    // `turn-a` (`started`) binds successfully; the later `completed` event
    // names a DIFFERENT turn id and is rejected as conflicting evidence
    // rather than silently overwriting the bound turn.
    expect(harness.ledger.calls).toEqual(['accept', 'claimCurrent', 'bindQueued', 'scheduleCurrent', 'bindTurn'])
    expect(harness.ledger.state.byDeliveryId['delivery-1']?.turnId).toBe('turn-a')
    expect(harness.ledger.state.byDeliveryId['delivery-1']?.status).toBe('current')
    expect(harness.markSettled).not.toHaveBeenCalled()
    expect(harness.diagnostics).toContain('settlement-ignored')
  })

  it('ignores activation-only observer events instead of treating them as a turn', async () => {
    const harness = makeHarness((input, observer) => {
      observer.emit({
        phase: 'activated',
        deliveryId: input.deliveryId,
        executionId: input.executionId,
        childSessionId: input.child.childSessionId,
        correlation: correlation(),
      })
      return { accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }
    })

    await expect(harness.controller.handleAdmission(acceptedAdmission())).resolves.toMatchObject({
      kind: 'accepted',
    })
    expect(harness.ledger.calls).toEqual(['accept', 'claimCurrent', 'bindQueued', 'scheduleCurrent'])
    expect(harness.ledger.state.byDeliveryId['delivery-1']?.status).toBe('current')
    expect(harness.markSettled).not.toHaveBeenCalled()
    expect(harness.diagnostics).toContain('settlement-ignored')
  })

  it('persists exactly accepted -> current -> queued -> running across the bind race, with no auto-settlement', async () => {
    const harness = makeHarness((input, observer) => {
      observer.emit(eventFor(input, 'started', 'turn-exact'))
      observer.emit(eventFor(input, 'completed', 'turn-exact'))
      return { accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }
    })
    await expect(harness.controller.handleAdmission(acceptedAdmission())).resolves.toMatchObject({
      kind: 'accepted',
    })

    // The observer may ask for an idempotent bind retry while the controller
    // drains facts captured during queueing. The durable history, rather than
    // the number of retry calls, is the exact state-machine proof.
    expect(harness.ledger.calls.filter(call => call === 'bindQueued')).toHaveLength(1)
    expect(harness.ledger.history.map(record => record.status)).toEqual([
      'accepted', 'current', 'current', 'current',
    ])
    const record = harness.ledger.state.byDeliveryId['delivery-1']
    expect(record?.status).toBe('current')
    expect(record?.turnId).toBe('turn-exact')
    expect(record?.queuedAt).toBeLessThanOrEqual(record?.startedAt ?? Number.POSITIVE_INFINITY)
  })
})

describe('LocusChannelController live policy gate', () => {
  // A live policy that was READ and disagrees with the durable grant is real
  // drift, and retiring the generation is the correct fail-closed answer.
  it.each([
    { name: 'mode drift to workspace-write', live: { mode: 'workspace-write', workspaceRoot: '/repo' } },
    { name: 'mode drift to danger-full-access', live: { mode: 'danger-full-access', workspaceRoot: '/repo' } },
  ])('invalidates before accept for $name with zero queue or reaction', async ({ live }) => {
    const observer = new SynchronousTurnObserver()
    const ledger = new MemoryDeliveryLedger()
    const queued = vi.fn()
    const marked = vi.fn()
    const invalidate = vi.fn()
    const controller = new LocusChannelController({
      ...baseDeps(ledger, observer),
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        withChildSession: async input => ({ ok: true as const, value: await input.operation({ id: LOCUS.childSessionId }) }),
        queueChild: queued,
      },
      resolveLivePolicy: () => live,
      invalidatePolicyDrift: invalidate,
      receipts: { markAccepted: marked, markSettled: vi.fn() },
    })

    await expect(controller.handleAdmission(acceptedAdmission('message-drift'))).resolves.toEqual({
      kind: 'refused', reason: 'policy-drift',
    })
    expect(invalidate).toHaveBeenCalledOnce()
    expect(ledger.calls).toEqual([])
    expect(queued).not.toHaveBeenCalled()
    expect(marked).not.toHaveBeenCalled()
  })

  // The message is still refused (serving work against a policy nobody could
  // confirm would be fail-open), but the GENERATION is kept. Retiring it here
  // was the bug: not being able to read a policy says nothing about whether the
  // stored grant still matches, and treating it as drift made a transient
  // condition permanent — every Host restart plus every other message lost its
  // reply, while the recovery added another child session for the same group.
  it('refuses without retiring the generation when the policy cannot be read', async () => {
    const observer = new SynchronousTurnObserver()
    const ledger = new MemoryDeliveryLedger()
    const queued = vi.fn()
    const marked = vi.fn()
    const invalidate = vi.fn()
    const controller = new LocusChannelController({
      ...baseDeps(ledger, observer),
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        withChildSession: async input => ({ ok: true as const, value: await input.operation({ id: LOCUS.childSessionId }) }),
        queueChild: queued,
      },
      resolveLivePolicy: () => undefined,
      invalidatePolicyDrift: invalidate,
      receipts: { markAccepted: marked, markSettled: vi.fn() },
    })

    await expect(controller.handleAdmission(acceptedAdmission('message-unreadable'))).resolves.toEqual({
      kind: 'refused', reason: 'policy-unreadable',
    })
    expect(invalidate).not.toHaveBeenCalled()
    expect(ledger.calls).toEqual([])
    expect(queued).not.toHaveBeenCalled()
    expect(marked).not.toHaveBeenCalled()
  })

  // Same for a child the Host cannot reach right now: report it as
  // unreadable, never as drift.
  it('refuses without retiring the generation when the child cannot be reached', async () => {
    const observer = new SynchronousTurnObserver()
    const ledger = new MemoryDeliveryLedger()
    const invalidate = vi.fn()
    const controller = new LocusChannelController({
      ...baseDeps(ledger, observer),
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        withChildSession: async () => ({ ok: false as const, reason: 'child-session-access-failed' }),
        queueChild: vi.fn(),
      },
      resolveLivePolicy: () => ({ mode: 'read-only', workspaceRoot: '/repo' }),
      invalidatePolicyDrift: invalidate,
      receipts: { markAccepted: vi.fn(), markSettled: vi.fn() },
    })

    await expect(controller.handleAdmission(acceptedAdmission('message-unreachable'))).resolves.toEqual({
      kind: 'refused', reason: 'policy-unreadable',
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('rejects a write root mismatch before accept and persists the pause diagnostic', async () => {
    const writeLocus: ActiveLocus = {
      ...LOCUS,
      permission: { desired: 'write', effective: 'write', verifiedAt: 1, grantedBy: 'host:test' },
      contextAnchor: {
        status: 'confirmed', authorization: 'authorized', executionRoot: '/repo',
        provenance: 'host:sandbox-policy', confirmedAt: 1,
      },
    }
    const observer = new SynchronousTurnObserver()
    const ledger = new MemoryDeliveryLedger()
    const queued = vi.fn()
    const marked = vi.fn()
    const persisted: string[] = []
    const controller = new LocusChannelController({
      ...baseDeps(ledger, observer),
      locus: { resolveCurrent: () => writeLocus, ensureForDelivery: () => writeLocus },
      child: {
        ensureChild: () => ({ parentSessionId: writeLocus.parentSessionId, childSessionId: writeLocus.childSessionId }),
        withChildSession: async input => ({ ok: true as const, value: await input.operation({ id: writeLocus.childSessionId }) }),
        queueChild: queued,
      },
      // The locus is granted `write`, which means full access: a live policy
      // that reports anything narrower is drift, and drift must stop dispatch
      // before any Delivery side effect (ADR-0005).
      resolveLivePolicy: () => ({ mode: 'workspace-write', workspaceRoot: '/other' }),
      invalidatePolicyDrift: ({ reason }) => { persisted.push(reason) },
      receipts: { markAccepted: marked, markSettled: vi.fn() },
    })

    await expect(controller.handleAdmission(acceptedAdmission('message-root-drift'))).resolves.toEqual({
      kind: 'refused', reason: 'policy-drift',
    })
    // The invariant under test — drift stops dispatch BEFORE any Delivery
    // side effect — is unchanged. Only the recorded reason moved: the write
    // master switch demotes this locus to read first, so the persisted
    // diagnostic now names the switch instead of the mode mismatch.
    expect(persisted).toEqual([expect.stringContaining('写档已全局停用')])
    expect(ledger.calls).toEqual([])
    expect(queued).not.toHaveBeenCalled()
    expect(marked).not.toHaveBeenCalled()
  })
})

describe('LocusChannelController control commands', () => {
  it('dispatches an authorized control command without queueing Delivery work', async () => {
    const harness = makeHarness(input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }))
    const dispatch = vi.fn(async (request: { command: LocusControlCommand; endpoint: { chatId: string; threadId?: string; key: string }; senderId: string }) => ({
      ok: true as const,
      text: `scope ${request.command.kind} applied`,
    }))
    const receipts = vi.fn()
    const controller = new LocusChannelController({
      ...baseDeps(harness.ledger, harness.observer),
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      controlDispatch: { dispatch },
      receipts: { sendControl: receipts },
    })

    await expect(controller.handleAdmission(controlAdmission())).resolves.toEqual({
      kind: 'control',
      command: { kind: 'scope', mode: 'write' },
      ok: true,
      text: 'scope scope applied',
    })
    expect(dispatch).toHaveBeenCalledWith({
      command: { kind: 'scope', mode: 'write' },
      endpoint: { chatId: ENDPOINT.chatId, threadId: ENDPOINT.threadId, key: `${ENDPOINT.chatId}${STORAGE_KEY_SEPARATOR}${ENDPOINT.threadId}` },
      senderId: 'ou-owner',
      authorization: 'authorized',
    })
    expect(receipts).toHaveBeenCalledWith({ ...REPLY_TARGET, messageId: 'message-control' }, 'scope scope applied')
    expect(harness.ledger.calls).toEqual([])
    expect(harness.queueInputs).toHaveLength(0)
    expect(harness.markAccepted).not.toHaveBeenCalled()
    expect(harness.markSettled).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('passes a protected legacy marker to the explicit bind dispatcher without creating a Delivery', async () => {
    const harness = makeHarness(input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }))
    const dispatch = vi.fn(async () => ({ ok: true as const, text: 'rebuilt read locus' }))
    const controller = new LocusChannelController({
      ...baseDeps(harness.ledger, harness.observer),
      locus: { resolveCurrent: () => undefined, ensureForDelivery: () => LOCUS },
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      controlDispatch: { dispatch },
    })

    await expect(controller.handleAdmission({
      ...controlAdmission({ kind: 'bind', prefix: 'abc123' }),
      authorization: 'legacy',
    })).resolves.toMatchObject({ kind: 'control', ok: true })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ authorization: 'legacy' }))
    expect(harness.ledger.calls).toEqual([])
    expect(harness.queueInputs).toHaveLength(0)
    controller.dispose()
  })

  it.each([
    { kind: 'bind', prefix: 'abc123' },
    { kind: 'unbind' },
    { kind: 'scope', mode: 'read' },
  ] as const)('dispatches valid $kind controls without queueing Delivery', async command => {
    const harness = makeHarness(input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }))
    const dispatch = vi.fn(async () => ({ ok: true as const, text: `${command.kind} applied` }))
    const receipts = vi.fn()
    const controller = new LocusChannelController({
      ...baseDeps(harness.ledger, harness.observer),
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      controlDispatch: { dispatch },
      receipts: { sendControl: receipts },
    })

    await expect(controller.handleAdmission(controlAdmission(command))).resolves.toMatchObject({
      kind: 'control',
      command,
      ok: true,
      text: `${command.kind} applied`,
    })
    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ command, senderId: 'ou-owner' })
    expect(receipts).toHaveBeenCalledOnce()
    expect(harness.ledger.calls).toEqual([])
    expect(harness.queueInputs).toHaveLength(0)
    controller.dispose()
  })

  it('keeps a defense-in-depth not-allowed control result silent', async () => {
    const harness = makeHarness(input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }))
    const receipts = vi.fn()
    const controller = new LocusChannelController({
      ...baseDeps(harness.ledger, harness.observer),
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      controlDispatch: { dispatch: async () => ({ ok: false, reason: 'not-allowed', silent: true }) },
      receipts: { sendControl: receipts },
    })

    await expect(controller.handleAdmission(controlAdmission({ kind: 'unbind' }))).resolves.toEqual({
      kind: 'control',
      command: { kind: 'unbind' },
      ok: false,
      reason: 'not-allowed',
    })
    expect(receipts).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('durably fails the exact accepted Delivery when queueing definitively refuses, and advances the locus', async () => {
    const harness = makeHarness(() => ({ accepted: false, reason: 'queue-refused' }))
    const controller = harness.controller
    const result = await controller.handleAdmission(acceptedAdmission())
    expect(result).toMatchObject({ kind: 'refused', reason: 'queue-failed' })
    expect(harness.markAccepted).not.toHaveBeenCalled()
    expect(harness.markSettled).toHaveBeenCalledWith(REPLY_TARGET, 'failed')
    // `queueChild` fails immediately, before `bindQueued`/`scheduleCurrent` are
    // ever reached; `claimCurrent` already promoted the row to `current`, so
    // `fail` must durably fail it FROM `current` (matching production
    // `failBeforeDispatch`), then advance the locus so a later backlog row is
    // not permanently stranded behind this refusal.
    expect(harness.ledger.calls).toEqual(['accept', 'claimCurrent', 'fail', 'currentFinished', 'dispatchNext'])
    expect(harness.ledger.state.byMessageId['message-race']).toMatchObject({
      status: 'failed', dispatchFailure: 'not-queued', failureReason: 'queue-refused',
    })
    controller.dispose()
  })

  it('rejects a short bind prefix without invoking the dispatch seam or Delivery', async () => {
    const harness = makeHarness(input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }))
    const dispatch = vi.fn()
    const controller = new LocusChannelController({
      ...baseDeps(harness.ledger, harness.observer),
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      controlDispatch: { dispatch },
      receipts: { sendControl: vi.fn() },
    })

    await expect(controller.handleAdmission(controlAdmission({ kind: 'bind', prefix: 'abc' }))).resolves.toMatchObject({
      kind: 'control',
      ok: false,
      reason: 'invalid-command',
      text: '会话 id 前缀太短，请至少提供 6 位。',
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(harness.ledger.calls).toEqual([])
    expect(harness.queueInputs).toHaveLength(0)
    controller.dispose()
  })

  it('rejects an extra bind argument without invoking the dispatch seam or Delivery', async () => {
    const harness = makeHarness(input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }))
    const dispatch = vi.fn()
    const controller = new LocusChannelController({
      ...baseDeps(harness.ledger, harness.observer),
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      controlDispatch: { dispatch },
      receipts: { sendControl: vi.fn() },
    })

    await expect(controller.handleAdmission(controlAdmission({ kind: 'bind-invalid' }))).resolves.toMatchObject({
      kind: 'control',
      ok: false,
      reason: 'invalid-command',
      text: '绑定命令只接受一个会话 id 前缀。',
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(harness.ledger.calls).toEqual([])
    expect(harness.queueInputs).toHaveLength(0)
    controller.dispose()
  })

  it('rejects malformed controls without invoking the dispatch seam or Delivery', async () => {
    const harness = makeHarness(input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }))
    const dispatch = vi.fn()
    const controller = new LocusChannelController({
      ...baseDeps(harness.ledger, harness.observer),
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      controlDispatch: { dispatch },
      receipts: { sendControl: vi.fn() },
    })

    await expect(controller.handleAdmission(controlAdmission({ kind: 'bind-missing-prefix' }))).resolves.toMatchObject({
      kind: 'control',
      ok: false,
      reason: 'invalid-command',
      text: '请提供至少 6 位的主会话 id 前缀。',
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(harness.ledger.calls).toEqual([])
    expect(harness.queueInputs).toHaveLength(0)
    controller.dispose()
  })
})

describe('LocusChannelController dispatchNext / currentFinished / scheduleCurrent', () => {
  it('claims and queues the oldest backlog Delivery after a terminal transition, exactly once', async () => {
    const harness = makeHarness(input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }))
    // Seed A as current and B as backlog directly on the durable ledger, the
    // way persistence would look after A was claimed and B arrived later.
    const acceptedA = acceptDelivery(harness.ledger.state, {
      ...correlation(), messageId: 'message-a', acceptedAt: 1, senderOpenId: 'ou-owner', text: 'message a',
    })
    const acceptedB = acceptDelivery(acceptedA.state, {
      ...correlation(), messageId: 'message-b', acceptedAt: 2, senderOpenId: 'ou-owner', text: 'message b',
    })
    const claimedA = claimCurrentDelivery(acceptedB.state, { ...correlation(), now: 3 })
    harness.ledger.state = claimedA.state

    await harness.controller.dispatchNext(correlation())

    // With A still current, dispatchNext must not claim/queue B.
    expect(harness.queueInputs).toHaveLength(0)
    expect(harness.ledger.state.byMessageId['message-b']?.status).toBe('accepted')

    // Now finish A through the exact same durable transitions the Host
    // lifecycle uses, then dispatch again.
    const finishedA = { ...harness.ledger.state.byDeliveryId[claimedA.record!.deliveryId]! }
    const finishedState = Object.freeze({ ...finishedA, status: 'replied' as const, queueState: undefined })
    harness.ledger.state = {
      ...harness.ledger.state,
      byDeliveryId: Object.freeze({
        ...harness.ledger.state.byDeliveryId,
        [finishedA.deliveryId]: finishedState,
      }),
      byMessageId: Object.freeze({
        ...harness.ledger.state.byMessageId,
        [finishedA.messageId]: finishedState,
      }),
    }

    await harness.controller.dispatchNext(correlation())
    expect(harness.queueInputs).toHaveLength(1)
    expect(harness.queueInputs[0]?.deliveryId).toBe(acceptedB.record.deliveryId)
    expect(harness.ledger.state.byDeliveryId[acceptedB.record.deliveryId]?.status).toBe('current')

    // A second dispatchNext call while B is already current must not queue a
    // duplicate physical dispatch.
    await harness.controller.dispatchNext(correlation())
    expect(harness.queueInputs).toHaveLength(1)
  })

  it('removes in-memory pending state and never sends business text when currentFinished is called', async () => {
    const harness = makeHarness(input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }))
    await harness.controller.handleAdmission(acceptedAdmission())
    const deliveryId = 'delivery-1'

    harness.controller.currentFinished({ deliveryId, correlation: correlation(), outcome: 'settled' })

    expect(harness.markSettled).toHaveBeenCalledWith(REPLY_TARGET, 'settled')
    // A second call for the same, already-removed pending entry is a no-op:
    // it must not emit a duplicate receipt.
    harness.markSettled.mockClear()
    harness.controller.currentFinished({ deliveryId, correlation: correlation(), outcome: 'settled' })
    expect(harness.markSettled).not.toHaveBeenCalled()
  })
})

/**
 * The safe-composition proof has to survive the controller's own normalization.
 *
 * `normalizeActiveLocus` rebuilds the locus field by field before anything else
 * sees it, and `createLocusChildDelivery.ensureChild` refuses any locus that does
 * not present `childComposition: 'safe-v1'`. Every other fixture in this file
 * stubs `deps.child`, and the child-delivery suite hand-writes its loci with the
 * field already present — so the two halves never met and a normalizer that
 * dropped the field rejected every live delivery as a bare `child-unavailable`.
 * These tests drive the REAL child delivery port through a locus record shaped
 * the way the repository/resolution port actually produces it.
 */
describe('LocusChannelController safe-composition proof', () => {
  function deliveryHarness(record: ActiveLocus, diagnostics: string[]) {
    const calls: string[] = []
    const adoptChild = vi.fn(async (input: { parentSessionId: string; childSessionId: string }) => {
      calls.push('adopt')
      return {
        ok: true as const,
        adopted: true,
        identity: {
          parentSessionId: input.parentSessionId,
          childSessionId: input.childSessionId,
        },
      }
    })
    const createAdapter = vi.fn(() => ({
      activeChild: undefined,
      createChild: vi.fn(),
      adoptChild,
      queuePrompt: vi.fn(async (input: { fenceBeforeQueue?: () => boolean | PromiseLike<boolean> }) => {
        if (input.fenceBeforeQueue !== undefined && !await input.fenceBeforeQueue()) {
          return { ok: false as const, reason: 'child-proof-failed' }
        }
        return { ok: true as const, messageId: 'inbox-proof' }
      }),
      withChildSession: vi.fn(async (input: { operation: (session: unknown) => unknown }) => ({
        ok: true as const,
        value: await input.operation({ id: LOCUS.childSessionId }),
      })),
      dispose: vi.fn(),
    }))
    const child = createLocusChildDelivery({
      createAdapter: () => createAdapter() as never,
      log: code => diagnostics.push(code),
    })
    const ledger = new MemoryDeliveryLedger()
    const observer = new SynchronousTurnObserver()
    const deps: LocusControllerDeps = {
      ...baseDeps(ledger, observer),
      locus: { resolveCurrent: () => record, ensureForDelivery: () => record },
      child,
      resolveLivePolicy: () => ({ mode: 'read-only', workspaceRoot: '/repo' }),
      receipts: { markAccepted: vi.fn(), markSettled: vi.fn() },
      log: code => diagnostics.push(code),
    }
    return { controller: new LocusChannelController(deps), calls, createAdapter, adoptChild, ledger, diagnostics }
  }

  it('carries the durable safe-v1 proof from the locus record into child adoption', async () => {
    const diagnostics: string[] = []
    const harness = deliveryHarness({ ...LOCUS, childComposition: 'safe-v1' }, diagnostics)

    const result = await harness.controller.handleAdmission(acceptedAdmission('message-proof'))

    expect(result.kind).toBe('accepted')
    expect(harness.calls).toEqual(['adopt'])
    expect(harness.adoptChild).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: LOCUS.parentSessionId,
      childSessionId: LOCUS.childSessionId,
    }))
    expect(diagnostics).not.toContain('safe-composition-unproven')
  })

  it('still refuses a record without the proof before any adapter is allocated', async () => {
    const diagnostics: string[] = []
    const harness = deliveryHarness({ ...LOCUS }, diagnostics)

    const result = await harness.controller.handleAdmission(acceptedAdmission('message-unproven'))

    expect(result).toEqual({ kind: 'refused', reason: 'child-unavailable' })
    expect(harness.createAdapter).not.toHaveBeenCalled()
    // The refusal reason must be observable: wiring this port is what turns an
    // undiagnosable `child-unavailable` into an actionable code.
    expect(diagnostics).toContain('safe-composition-unproven')
  })
})

/**
 * Which refusals from the READ path may be bypassed by establishing a
 * replacement.
 *
 * `resolveCurrent` refuses every unavailable generation on purpose — an owner
 * exit must not be resurrected, and a generation without the safe-v1 proof must
 * never be served. The channel used to treat any such refusal as fatal, which
 * made the read path the LAST gate: every other layer had been taught to allow
 * recovery, and the mention still died here with `locus-read-failed` before
 * `ensureForDelivery` — the one port that owns the replacement policy — was
 * ever consulted.
 */
describe('unavailable current generation vs bootstrap', () => {
  const invalid = () => { throw new Error('This locus is invalid and must be rebuilt.') }

  it('consults the establishing port when the endpoint may bootstrap', async () => {
    const harness = makeHarness(
      input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
    )
    const ensureForDelivery = vi.fn(() => LOCUS)
    const controller = new LocusChannelController({
      ...baseDeps(harness.ledger, harness.observer),
      locus: { resolveCurrent: invalid, ensureForDelivery },
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
    })

    const result = await controller.handleAdmission({
      ...acceptedAdmission('message-recover'),
      authorization: 'unusable',
      needsInitialization: true,
    })

    // The assertion that matters: the establishing port owns the replacement
    // policy and was actually consulted. Whether THIS synthetic locus then
    // clears the later delivery gates (this harness refuses it as
    // `policy-drift`) is a different concern.
    expect(ensureForDelivery).toHaveBeenCalledOnce()
    expect(result).not.toMatchObject({ reason: 'locus-read-failed' })

    controller.dispose()
  })

  it('keeps the read refusal fatal when the endpoint may not bootstrap', async () => {
    const harness = makeHarness(
      input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
    )
    const ensureForDelivery = vi.fn(() => LOCUS)
    const controller = new LocusChannelController({
      ...baseDeps(harness.ledger, harness.observer),
      locus: { resolveCurrent: invalid, ensureForDelivery },
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
    })

    await expect(controller.handleAdmission({
      ...acceptedAdmission('message-no-bootstrap'),
      authorization: 'authorized',
      needsInitialization: false,
    })).resolves.toMatchObject({ kind: 'refused' })
    expect(ensureForDelivery).not.toHaveBeenCalled()
    controller.dispose()
  })
})
