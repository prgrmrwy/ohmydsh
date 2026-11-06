/**
 * A shared main session is NOT shared memory between its locus children.
 *
 * Several Feishu entries can hang off one main session. That makes them
 * siblings in the tree, and it is tempting to treat "same parent" as "same
 * context" — but each entry is a different group of people. If one child's
 * conversation reached another, a private discussion in one group would
 * surface in another, and nobody involved would have agreed to that.
 *
 * These tests pin the boundary at every seam that could leak it: reverse
 * discovery, the caller-bound context tool, and the durable Delivery ledger.
 * They are regression tests for an invariant, not for an implementation.
 */

import { describe, expect, it } from 'vitest'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import { emptyMedium, openPetHarness, type PetHarness } from './harness.js'

const PARENT = 'session-main-shared'
const ALPHA = { chatId: 'oc-team-alpha' } as const
const BETA = { chatId: 'oc-team-beta' } as const

/** Two entries of different teams, deliberately under ONE main session. */
async function twoSiblings(harness: PetHarness): Promise<LocusRepositoryV20> {
  await harness.domain.table('locus_mains').put(PARENT, {
    locusMainSessionId: PARENT, workSessionId: 'work-shared', generation: 1, status: 'active',
    spaceId: 'space-shared', workspaceId: 'ws-pet', createdAt: 1, updatedAt: 1,
  } as never)
  for (const [id, endpoint, child] of [
    ['locus-alpha', ALPHA, 'child-alpha'],
    ['locus-beta', BETA, 'child-beta'],
  ] as const) {
    await harness.domain.table('loci').put(endpoint.chatId, {
      endpoint, locusId: id, sessionId: child, state: 'active', accessMode: 'read-only',
      revision: 1, createdAt: 1, updatedAt: 1, locusMainSessionId: PARENT, workspaceId: 'ws-shared',
    } as never)
  }
  return new LocusRepositoryV20(harness.domain as never)
}

const correlation = (endpoint: typeof ALPHA | typeof BETA, locusId: string, sessionId: string) => ({ endpoint, locusId, sessionId })

describe('a shared main session does not merge sibling children', () => {
  it('resolves each child to its own locus only', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoSiblings(harness)
      // Child-oriented discovery is deliberately one row, never siblings.
      expect(repository.findBySessionId('child-alpha')?.row.locusId).toBe('locus-alpha')
      expect(repository.findBySessionId('child-beta')?.row.locusId).toBe('locus-beta')
    } finally {
      await harness.close()
    }
  })

  it('lists both entries for the OWNER, which is a different question', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoSiblings(harness)
      // The owner may see everything hanging off their main session. That is
      // management, not context: the children still cannot see each other.
      expect(repository.listGroupRowsOfMain(PARENT).map(row => row.locusId).sort())
        .toEqual(['locus-alpha', 'locus-beta'])
    } finally {
      await harness.close()
    }
  })

  it('gives child-oriented lookup no way to reach a sibling', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoSiblings(harness)
      // The caller-bound context tool resolves a locus THROUGH this lookup.
      // Pinning it here keeps the guarantee even if that tool is rewritten:
      // there is simply no query that turns one child into its sibling.
      const alpha = repository.findBySessionId('child-alpha')
      expect(alpha?.row.endpoint.chatId).toBe('oc-team-alpha')
      expect(JSON.stringify(alpha)).not.toContain('oc-team-beta')
      expect(JSON.stringify(alpha)).not.toContain('child-beta')
    } finally {
      await harness.close()
    }
  })

  it('keeps each sibling Delivery ledger separate', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoSiblings(harness)
      await repository.acceptDelivery({
        ...correlation(ALPHA, 'locus-alpha', 'child-alpha'),
        messageId: 'om-alpha-1',
        senderOpenId: 'ou-alpha',
        acceptedAt: 2,
      } as never)

      // A message to one group must not appear in the other's ledger, even
      // though both children answer under the same main session.
      expect(repository.listDeliveries('locus-alpha')).toHaveLength(1)
      expect(repository.listDeliveries('locus-beta')).toHaveLength(0)
    } finally {
      await harness.close()
    }
  })

  it('does not let one sibling settle the other\'s Delivery', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoSiblings(harness)
      const accepted = await repository.acceptDelivery({
        ...correlation(ALPHA, 'locus-alpha', 'child-alpha'),
        messageId: 'om-alpha-1',
        senderOpenId: 'ou-alpha',
        acceptedAt: 2,
      } as never)
      await repository.claimCurrentDelivery({ ...correlation(ALPHA, 'locus-alpha', 'child-alpha'), now: 2 })
      await repository.bindQueued({
        ...correlation(ALPHA, 'locus-alpha', 'child-alpha'),
        deliveryId: accepted.record.deliveryId,
        executionId: 'exec-alpha', inboxMessageId: 'inbox-exec-alpha',
        queuedAt: 3,
      })

      // The sibling's identity must not satisfy the settlement proof.
      const settled = await repository.settleByTurn({
        deliveryId: accepted.record.deliveryId,
        executionId: 'exec-alpha',
        turnId: 'child-beta#1',
        correlation: { ...correlation(BETA, 'locus-beta', 'child-beta'), turnId: 'child-beta#1' },
        outcome: 'settled',
        settledAt: 4,
      } as never)

      expect(settled.changed).toBe(false)
      expect(repository.findDeliveryByMessageId('om-alpha-1')?.status).not.toBe('settled')
    } finally {
      await harness.close()
    }
  })

  it('keeps an access-mode grant scoped to the entry it was granted for', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoSiblings(harness)

      await repository.setAccessMode({ expectedLocusId: 'locus-alpha', expectedRevision: 1 }, 'danger-full-access', 'ou_owner', 10)

      // Sharing a work root with one group is not sharing it with every group
      // that happens to hang off the same main session.
      expect(repository.getLocus('locus-alpha')?.accessMode).toBe('danger-full-access')
      expect(repository.getLocus('locus-beta')).toMatchObject({ accessMode: 'read-only', revision: 1 })
      expect(repository.getLocus('locus-beta')).not.toHaveProperty('grantedBy')
    } finally {
      await harness.close()
    }
  })
})
