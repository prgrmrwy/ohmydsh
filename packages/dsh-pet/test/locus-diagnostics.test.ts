import { describe, expect, it } from 'vitest'
import { buildLocusDiagnostics } from '../src/host/locus/diagnostics.js'
import type { DeliveryRecord } from '../src/host/locus/delivery.js'
import type { LocusRecord } from '../src/host/locus/aggregate.js'

const CHAT = 'oc_project_00000000000000000042'
const CHILD = 'session-child-00000000000000000099'

function locus(overrides: Partial<LocusRecord> = {}): LocusRecord {
  return {
    id: 'locus-1',
    generation: 2,
    endpoint: { chatId: CHAT },
    parentSessionId: 'session-main',
    childSessionId: CHILD,
    workspaceId: 'ws-1',
    source: 'auto',
    state: 'active',
    permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
    busy: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as LocusRecord
}

function delivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    deliveryId: 'delivery-1',
    messageId: 'om_message_0000000000000000001',
    endpoint: { chatId: CHAT },
    locusId: 'locus-1',
    generation: 2,
    childSessionId: CHILD,
    senderOpenId: 'ou_sender_secret',
    text: '这是不应出现在诊断里的消息正文',
    sequence: 1,
    status: 'accepted',
    feedbackTarget: { chatId: CHAT, messageId: 'om_message_0000000000000000001' },
    acceptedAt: 10,
    ...overrides,
  } as DeliveryRecord
}

describe('message to execution diagnostic chain', () => {
  it('reports each stage with the exact locus generation and child', () => {
    const report = buildLocusDiagnostics(locus(), [
      delivery({ deliveryId: 'd1', sequence: 1, status: 'accepted' }),
      delivery({
        deliveryId: 'd2', sequence: 2, status: 'queued',
        messageId: 'om_second', executionId: 'exec-2', queuedAt: 20,
      }),
      delivery({
        deliveryId: 'd3', sequence: 3, status: 'settled',
        messageId: 'om_third', executionId: 'exec-3', turnId: `${CHILD}#1`,
        queuedAt: 30, startedAt: 31, settledAt: 32,
      }),
    ])

    // Newest first, so the freshest problem is at the top.
    expect(report.deliveries.map(row => row.stage)).toEqual(['settled', 'queued', 'accepted'])
    expect(report.stageCounts).toEqual({ accepted: 1, queued: 1, running: 0, settled: 1, failed: 0 })
    expect(report.locus).toMatchObject({ id: 'locus-1', generation: 2, state: 'active', permission: 'read' })
    // Proof presence is shown; the tokens themselves are not.
    expect(report.deliveries[0]).toMatchObject({ executionBound: true, turnBound: true })
    expect(report.deliveries[2]).toMatchObject({ executionBound: false, turnBound: false })
  })

  it('never exposes message text, sender, or full identifiers', () => {
    const report = buildLocusDiagnostics(locus(), [
      delivery({ executionId: 'exec-secret', turnId: 'turn-secret' }),
    ])
    const serialized = JSON.stringify(report)

    // A diagnostic that leaks the conversation is unusable in a shared
    // setting, and full ids would address chats and sessions the reader may
    // have no business seeing.
    expect(serialized).not.toContain('不应出现在诊断里')
    expect(serialized).not.toContain('ou_sender_secret')
    expect(serialized).not.toContain('exec-secret')
    expect(serialized).not.toContain('turn-secret')
    expect(serialized).not.toContain(CHAT)
    expect(serialized).not.toContain(CHILD)
    // Short labels still distinguish rows.
    expect(report.deliveries[0]?.child).toBe(`…${CHILD.slice(-8)}`)
    expect(report.deliveries[0]?.entry.chat).toBe(`…${CHAT.slice(-8)}`)
  })

  it('distinguishes a busy generation from an unavailable child', () => {
    const busy = buildLocusDiagnostics(locus({ busy: true }), [delivery()])
    const idle = buildLocusDiagnostics(locus(), [delivery()])

    // Same stage, different cause: one waits, the other needs investigation.
    expect(busy.deliveries[0]?.nextCheck).toContain('正忙')
    expect(idle.deliveries[0]?.nextCheck).toContain('未排队')
  })

  it('tells the owner what to check for a queued but unclaimed message', () => {
    const report = buildLocusDiagnostics(locus(), [
      delivery({ status: 'queued', executionId: 'exec-1', queuedAt: 20 }),
    ])

    // This is the case that used to look like "the message vanished".
    expect(report.deliveries[0]?.nextCheck).toContain('没有轮次认领')
    expect(report.deliveries[0]?.nextCheck).toContain('观察器')
  })

  it('explains a settled Delivery that produced no visible reply', () => {
    const report = buildLocusDiagnostics(locus(), [
      delivery({
        status: 'settled', executionId: 'e', turnId: 't',
        queuedAt: 20, startedAt: 21, settledAt: 22,
      }),
    ])

    // Host only posts mechanical receipts, so "settled but silent" is a child
    // behaviour, not a delivery failure.
    expect(report.deliveries[0]?.nextCheck).toContain('不代发业务内容')
    expect(report.deliveries[0]?.settledAt).toBe(22)
  })

  it('surfaces a failure reason and states that old work is not retried', () => {
    const report = buildLocusDiagnostics(locus(), [
      delivery({
        status: 'failed', executionId: 'e', turnId: 't',
        queuedAt: 20, startedAt: 21, failedAt: 25, failureReason: 'model error',
      }),
    ])

    expect(report.deliveries[0]).toMatchObject({
      stage: 'failed',
      failureReason: 'model error',
      settledAt: 25,
    })
    expect(report.deliveries[0]?.nextCheck).toContain('不会自动重试')
  })

  it('reports an unavailable generation with its stored reason', () => {
    const report = buildLocusDiagnostics(
      locus({ state: 'invalid', invalidReason: '主会话已归档' }),
      [],
    )

    expect(report.locus).toMatchObject({ state: 'invalid', invalidReason: '主会话已归档' })
    expect(report.deliveries).toEqual([])
  })

  it('ignores Deliveries belonging to another generation or locus', () => {
    const report = buildLocusDiagnostics(locus(), [
      delivery({ deliveryId: 'mine', sequence: 5 }),
      // A late row from the generation this one replaced must not be shown as
      // if it belonged to the current entry.
      delivery({ deliveryId: 'older', sequence: 4, generation: 1 }),
      delivery({ deliveryId: 'foreign', sequence: 3, locusId: 'locus-other' }),
    ])

    expect(report.deliveries).toHaveLength(1)
    expect(report.stageCounts.accepted).toBe(1)
  })

  it('marks a topic entry without revealing the thread identifier', () => {
    const report = buildLocusDiagnostics(
      locus({ endpoint: { chatId: CHAT, threadId: 'omt_secret_thread' } }),
      [delivery({ endpoint: { chatId: CHAT, threadId: 'omt_secret_thread' } })],
    )

    expect(report.deliveries[0]?.entry.topic).toBe(true)
    expect(JSON.stringify(report)).not.toContain('omt_secret_thread')
  })
})
