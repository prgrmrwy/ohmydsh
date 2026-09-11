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
import {
  acceptDelivery,
  bindQueued,
  bindTurn,
  createDeliveryLedger,
  settleByTurn,
  type DeliveryAcceptance,
  type DeliveryCorrelation,
  type DeliveryLedgerState,
  type DeliveryRecord,
  type DeliveryTurnCorrelation,
} from '../src/host/locus/delivery.js'
import type { LocusReplyTarget } from '../src/host/locus/context.js'

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
 * this seam real catches controller tests that accidentally skip a transition
 * or settle without first persisting the queue/turn proof.
 */
class MemoryDeliveryLedger {
  state: DeliveryLedgerState = createDeliveryLedger()
  readonly calls: string[] = []
  readonly history: DeliveryRecord[] = []

  findByMessageId(messageId: string): DeliveryRecord | undefined {
    return this.state.byMessageId[messageId]
  }

  accept(input: Parameters<typeof acceptDelivery>[1]): DeliveryAcceptance {
    this.calls.push('accept')
    const mutation = acceptDelivery(this.state, input)
    this.state = mutation.state
    this.history.push(mutation.record)
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
    if (current === undefined || current.status !== 'accepted') return false
    if (
      current.locusId !== input.correlation.locusId ||
      current.generation !== input.correlation.generation ||
      current.childSessionId !== input.correlation.childSessionId ||
      current.endpoint.chatId !== input.correlation.endpoint.chatId ||
      current.endpoint.threadId !== input.correlation.endpoint.threadId
    ) return false
    const failed = Object.freeze({
      ...current,
      status: 'failed' as const,
      dispatchFailure: 'not-queued' as const,
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

  settleByTurn(input: {
    readonly deliveryId: string
    readonly executionId: string
    readonly correlation: DeliveryTurnCorrelation
    readonly outcome: 'settled' | 'failed'
    readonly settledAt: number
    readonly failureReason?: string
  }): {
    changed: boolean
    record?: DeliveryRecord
    reason?: string
  } {
    this.calls.push('settleByTurn')
    const mutation = settleByTurn(this.state, {
      ...input,
      turnId: input.correlation.turnId,
    })
    this.state = mutation.state
    if (mutation.record !== undefined && mutation.changed) this.history.push(mutation.record)
    return {
      changed: mutation.changed,
      ...(mutation.record !== undefined ? { record: mutation.record } : {}),
      ...(mutation.reason !== undefined ? { reason: mutation.reason } : {}),
    }
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

function correlation(turnId?: string): DeliveryCorrelation | DeliveryTurnCorrelation {
  return {
    endpoint: ENDPOINT,
    locusId: LOCUS.id!,
    generation: LOCUS.generation,
    childSessionId: LOCUS.childSessionId,
    ...(turnId !== undefined ? { turnId } : {}),
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
    correlation: correlation(turnId) as DeliveryTurnCorrelation,
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

function makeHarness(
  queue: (
    input: Parameters<LocusChildDeliveryPort['queueChild']>[0],
    observer: SynchronousTurnObserver,
  ) =>
    | { readonly accepted: true; readonly executionId: string }
    | Promise<{ readonly accepted: true; readonly executionId: string }>,
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
    queueChild: input => {
      queueInputs.push(input)
      return queue(input, observer)
    },
  }
  const deps: LocusControllerDeps = {
    locus: {
      resolveCurrent: () => LOCUS,
      ensureForDelivery: () => LOCUS,
    },
    deliveries: ledger,
    child,
    resolveLivePolicy: () => ({ mode: 'read-only', workspaceRoot: '/repo' }),
    turns: observer,
    receipts: { markAccepted, markSettled },
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
  it.each(['started', 'completed', 'failed'] as const)(
    'buffers a synchronous %s observer event emitted before queue bind',
    async phase => {
      const harness = makeHarness((input, observer) => {
        observer.emit(eventFor(input, phase, 'turn-sync'))
        return { accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }
      })

      const result = await harness.controller.handleAdmission(acceptedAdmission())

      expect(result.kind).toBe('accepted')
      expect(harness.ledger.calls).toEqual([
        'accept',
        'bindQueued',
        'bindTurn',
        ...(phase === 'started' ? [] : ['settleByTurn']),
      ])
      expect(harness.ledger.history.map(record => record.status)).toEqual([
        'accepted',
        'queued',
        'running',
        ...(phase === 'started' ? [] : [phase === 'completed' ? 'settled' : 'failed']),
      ])
      expect(harness.markAccepted).toHaveBeenCalledOnce()
      if (phase === 'started') expect(harness.markSettled).not.toHaveBeenCalled()
      else expect(harness.markSettled).toHaveBeenCalledWith(REPLY_TARGET, phase === 'completed' ? 'settled' : 'failed')
    },
  )

  it.each(['completed', 'failed'] as const)(
    'handles terminal-%s-before-start without losing the exact turn',
    async phase => {
      const harness = makeHarness((input, observer) => {
        observer.emit(eventFor(input, phase, 'turn-terminal-first'))
        observer.emit(eventFor(input, 'started', 'turn-terminal-first'))
        return { accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }
      })

      await expect(harness.controller.handleAdmission(acceptedAdmission())).resolves.toMatchObject({
        kind: 'accepted',
      })
      expect(harness.ledger.history.map(record => record.status)).toEqual([
        'accepted',
        'queued',
        'running',
        phase === 'completed' ? 'settled' : 'failed',
      ])
      expect(harness.ledger.state.byDeliveryId['delivery-1']?.turnId).toBe('turn-terminal-first')
    },
  )

  it('blocks settlement when observer evidence contains conflicting turn ids', async () => {
    const harness = makeHarness((input, observer) => {
      observer.emit(eventFor(input, 'started', 'turn-a'))
      observer.emit(eventFor(input, 'completed', 'turn-b'))
      return { accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }
    })

    const result = await harness.controller.handleAdmission(acceptedAdmission())

    expect(result.kind).toBe('accepted')
    expect(harness.ledger.calls).toEqual(['accept', 'bindQueued'])
    expect(harness.ledger.state.byDeliveryId['delivery-1']?.status).toBe('queued')
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
    expect(harness.ledger.calls).toEqual(['accept', 'bindQueued'])
    expect(harness.ledger.state.byDeliveryId['delivery-1']?.status).toBe('queued')
    expect(harness.markSettled).not.toHaveBeenCalled()
    expect(harness.diagnostics).toContain('settlement-ignored')
  })

  it('persists exactly accepted -> queued -> running -> settled across the bind race', async () => {
    const harness = makeHarness((input, observer) => {
      observer.emit(eventFor(input, 'started', 'turn-exact'))
      observer.emit(eventFor(input, 'completed', 'turn-exact'))
      return { accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }
    })
    await expect(harness.controller.handleAdmission(acceptedAdmission())).resolves.toMatchObject({
      kind: 'accepted',
    })

    // The observer may ask for an idempotent bind/settle retry while the
    // controller drains facts captured during queueing. The durable history,
    // rather than the number of retry calls, is the exact state-machine proof.
    expect(harness.ledger.calls.filter(call => call === 'bindQueued')).toHaveLength(1)
    expect(harness.ledger.history.map(record => record.status)).toEqual([
      'accepted',
      'queued',
      'running',
      'settled',
    ])
    const [, queued, running, settled] = harness.ledger.history
    expect(queued?.queuedAt).toBeLessThan(running?.startedAt ?? Number.POSITIVE_INFINITY)
    expect(running?.startedAt).toBeLessThan(settled?.settledAt ?? Number.POSITIVE_INFINITY)
  })
})

describe('LocusChannelController live policy gate', () => {
  it.each([
    { name: 'unknown policy', live: undefined },
    { name: 'mode drift to workspace-write', live: { mode: 'workspace-write', workspaceRoot: '/repo' } },
    { name: 'mode drift to danger-full-access', live: { mode: 'danger-full-access', workspaceRoot: '/repo' } },
  ])('invalidates before accept for $name with zero queue or reaction', async ({ live }) => {
    const observer = new SynchronousTurnObserver()
    const ledger = new MemoryDeliveryLedger()
    const queued = vi.fn()
    const marked = vi.fn()
    const invalidate = vi.fn()
    const controller = new LocusChannelController({
      locus: { resolveCurrent: () => LOCUS, ensureForDelivery: () => LOCUS },
      deliveries: ledger,
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        withChildSession: async input => ({ ok: true as const, value: await input.operation({ id: LOCUS.childSessionId }) }),
        queueChild: queued,
      },
      resolveLivePolicy: () => live,
      invalidatePolicyDrift: invalidate,
      turns: observer,
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
      locus: { resolveCurrent: () => writeLocus, ensureForDelivery: () => writeLocus },
      deliveries: ledger,
      child: {
        ensureChild: () => ({ parentSessionId: writeLocus.parentSessionId, childSessionId: writeLocus.childSessionId }),
        withChildSession: async input => ({ ok: true as const, value: await input.operation({ id: writeLocus.childSessionId }) }),
        queueChild: queued,
      },
      resolveLivePolicy: () => ({ mode: 'workspace-write', workspaceRoot: '/other' }),
      invalidatePolicyDrift: ({ reason }) => { persisted.push(reason) },
      turns: observer,
      receipts: { markAccepted: marked, markSettled: vi.fn() },
    })

    await expect(controller.handleAdmission(acceptedAdmission('message-root-drift'))).resolves.toEqual({
      kind: 'refused', reason: 'policy-drift',
    })
    expect(persisted).toEqual([expect.stringContaining('不精确一致')])
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
      locus: {
        resolveCurrent: () => LOCUS,
        ensureForDelivery: () => LOCUS,
      },
      deliveries: harness.ledger,
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      turns: harness.observer,
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
      endpoint: { chatId: ENDPOINT.chatId, threadId: ENDPOINT.threadId, key: `${ENDPOINT.chatId}\u0000${ENDPOINT.threadId}` },
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
      locus: { resolveCurrent: () => undefined, ensureForDelivery: () => LOCUS },
      deliveries: harness.ledger,
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      turns: harness.observer,
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
      locus: { resolveCurrent: () => LOCUS, ensureForDelivery: () => LOCUS },
      deliveries: harness.ledger,
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      turns: harness.observer,
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
      locus: { resolveCurrent: () => LOCUS, ensureForDelivery: () => LOCUS },
      deliveries: harness.ledger,
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      turns: harness.observer,
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

  it('durably fails the exact accepted Delivery when queueing definitively refuses', async () => {
    const harness = makeHarness(() => ({ accepted: false, reason: 'queue-refused' }))
    const controller = harness.controller
    const result = await controller.handleAdmission(acceptedAdmission())
    expect(result).toMatchObject({ kind: 'refused', reason: 'queue-failed' })
    expect(harness.markAccepted).not.toHaveBeenCalled()
    expect(harness.markSettled).toHaveBeenCalledWith(REPLY_TARGET, 'failed')
    expect(harness.ledger.calls).toEqual(['accept', 'fail'])
    expect(harness.ledger.state.byMessageId['message-race']).toMatchObject({
      status: 'failed', dispatchFailure: 'not-queued', failureReason: 'queue-refused',
    })
    controller.dispose()
  })

  it('rejects a short bind prefix without invoking the dispatch seam or Delivery', async () => {
    const harness = makeHarness(input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }))
    const dispatch = vi.fn()
    const controller = new LocusChannelController({
      locus: { resolveCurrent: () => LOCUS, ensureForDelivery: () => LOCUS },
      deliveries: harness.ledger,
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      turns: harness.observer,
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
      locus: { resolveCurrent: () => LOCUS, ensureForDelivery: () => LOCUS },
      deliveries: harness.ledger,
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      turns: harness.observer,
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
      locus: { resolveCurrent: () => LOCUS, ensureForDelivery: () => LOCUS },
      deliveries: harness.ledger,
      child: {
        ensureChild: () => ({ parentSessionId: LOCUS.parentSessionId, childSessionId: LOCUS.childSessionId }),
        queueChild: input => ({ accepted: true, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
      },
      turns: harness.observer,
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
