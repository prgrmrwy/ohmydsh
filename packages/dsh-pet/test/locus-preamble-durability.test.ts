/**
 * The preamble decision against the REAL durable Delivery ledger.
 *
 * `preamblePosition` is unit-tested in locus-delivery-prompt.test.ts; this file
 * proves the evidence chain it depends on actually exists in the Host: an
 * accepted Delivery is durable WITHOUT an inbox binding (accept precedes
 * rendering), a queued one carries the binding, and a delivery that never
 * bound never counts as proof. That is the whole difference between
 * "rendered" and "delivered" — the regression this change repairs.
 */

import { describe, expect, it } from 'vitest'
import { renderLocusDeliveryFor } from '../src/host/locus/context.js'
import type { LocusPromptRecordFacts } from '../src/host/locus/context.js'
import { LocusRepository } from '../src/host/locus/persistence.js'
import { emptyMedium, openPetHarness, type PetHarness } from './harness.js'

const ENDPOINT = { chatId: 'oc_preamble' } as const
const LOCUS = 'locus-preamble'
const PARENT = 'session-main'
const CHILD = 'session-child'

async function boot(): Promise<{ harness: PetHarness; repository: LocusRepository }> {
  const harness = await openPetHarness(emptyMedium())
  const repository = new LocusRepository(harness.domain)
  await repository.putLocus({
    id: LOCUS,
    generation: 1,
    endpoint: ENDPOINT,
    parentSessionId: PARENT,
    childSessionId: CHILD,
    workspaceId: 'workspace-preamble',
    source: 'auto',
    state: 'active',
    childComposition: 'safe-v2',
    toolTier: { desired: 'shell', effective: 'shell' },
    permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
    busy: false,
    createdAt: 1,
    updatedAt: 1,
  })
  return { harness, repository }
}

function correlation() {
  return { endpoint: ENDPOINT, locusId: LOCUS, generation: 1, childSessionId: CHILD }
}

async function accept(repository: LocusRepository, messageId: string, acceptedAt: number): Promise<string> {
  const accepted = await repository.acceptDelivery({
    ...correlation(),
    messageId,
    senderOpenId: 'ou_owner',
    text: `text ${messageId}`,
    replyTarget: { chatId: ENDPOINT.chatId, messageId },
    acceptedAt,
  })
  return accepted.record.deliveryId
}

/** Render exactly the way the Host wiring does: durable record + deliveries. */
function render(repository: LocusRepository, messageId: string): string {
  const record = repository.getLocus(LOCUS)
  if (record === undefined) throw new Error('locus missing')
  const current = repository.findDeliveryByMessageId(messageId)
  const facts: LocusPromptRecordFacts = {
    id: record.id,
    generation: record.generation,
    endpoint: record.endpoint,
    parentSessionId: record.parentSessionId,
    childSessionId: record.childSessionId,
    workspaceId: record.workspaceId,
    state: record.state,
    childComposition: record.childComposition,
    toolTier: record.toolTier,
    permission: record.permission,
    contextAnchor: record.contextAnchor ?? { status: 'unknown' },
  }
  return renderLocusDeliveryFor({
    record: facts,
    message: {
      messageId,
      senderOpenId: 'ou_owner',
      text: `text ${messageId}`,
      replyTarget: { chatId: ENDPOINT.chatId, messageId },
    },
    deliveries: repository.listDeliveries(record.id),
    ...(current === undefined ? {} : { currentDeliveryId: current.deliveryId }),
  })
}

describe('preamble position over the durable ledger', () => {
  it('gives the first accepted Delivery the full preamble before any binding exists', async () => {
    const { harness, repository } = await boot()
    try {
      await accept(repository, 'om_first', 10)

      // Acceptance is durable admission, but the row carries no inbox binding
      // yet — that binding happens after rendering, so it cannot be required
      // to decide this same render.
      const row = repository.findDeliveryByMessageId('om_first')
      expect(row?.inboxMessageId).toBeUndefined()

      const prompt = render(repository, 'om_first')
      expect(prompt).toContain('### Endpoint')
      expect(prompt).toContain('### Tool tier')
      expect(prompt).toContain('- effective：shell')
    } finally {
      await harness.close()
    }
  })

  it('switches to the compact follow-up once a prior Delivery is bound', async () => {
    const { harness, repository } = await boot()
    try {
      const first = await accept(repository, 'om_first', 10)
      const bound = await repository.bindQueued({
        deliveryId: first,
        correlation: correlation(),
        executionId: 'exec-1',
        inboxMessageId: 'inbox-1',
        queuedAt: 11,
      })
      expect(bound?.inboxMessageId).toBe('inbox-1')

      await accept(repository, 'om_second', 20)
      const prompt = render(repository, 'om_second')

      expect(prompt).not.toContain('### Endpoint')
      expect(prompt).toContain('工具档位：shell')
      expect(prompt).toContain('om_second')
    } finally {
      await harness.close()
    }
  })

  it('keeps the full preamble while the previous Delivery never bound', async () => {
    const { harness, repository } = await boot()
    try {
      // The queue accepted nothing (or the process died before binding): the
      // child may never have seen the first prompt, so the next real delivery
      // must carry the preamble again. Repeating once is the accepted cost.
      await accept(repository, 'om_lost', 10)
      await accept(repository, 'om_next', 20)

      const prompt = render(repository, 'om_next')
      expect(prompt).toContain('### Endpoint')
      expect(prompt).toContain('### Context anchor')
    } finally {
      await harness.close()
    }
  })

  it('does not let an accepted-but-unbound backlog row consume the preamble', async () => {
    const { harness, repository } = await boot()
    try {
      await accept(repository, 'om_queued_a', 10)
      await accept(repository, 'om_queued_b', 20)

      // Two accepted rows, neither bound: still a first-delivery render.
      expect(render(repository, 'om_queued_b')).toContain('### Endpoint')
    } finally {
      await harness.close()
    }
  })

  it('decides from durable proof after a restart, not from runtime state', async () => {
    const { harness, repository } = await boot()
    try {
      const first = await accept(repository, 'om_first', 10)
      await repository.bindQueued({
        deliveryId: first,
        correlation: correlation(),
        executionId: 'exec-1',
        inboxMessageId: 'inbox-1',
        queuedAt: 11,
      })

      // A Host restart re-reads the same durable domain: the proof must survive
      // it, so the next delivery stays compact instead of re-sending the
      // preamble.
      const reopened = new LocusRepository(harness.domain)
      await accept(reopened, 'om_after_restart', 30)
      const prompt = render(reopened, 'om_after_restart')

      expect(prompt).not.toContain('### Endpoint')
      expect(prompt).toContain('工具档位：shell')
    } finally {
      await harness.close()
    }
  })
})
