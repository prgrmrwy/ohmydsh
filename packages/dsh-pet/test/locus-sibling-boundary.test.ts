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
import { LocusRepository } from '../src/host/locus/persistence.js'
import { emptyMedium, openPetHarness, type PetHarness } from './harness.js'

const PARENT = 'session-main-shared'
const ALPHA = { chatId: 'oc-team-alpha' } as const
const BETA = { chatId: 'oc-team-beta' } as const

/** Two entries of different teams, deliberately under ONE main session. */
async function twoSiblings(harness: PetHarness): Promise<LocusRepository> {
  const repository = new LocusRepository(harness.domain)
  for (const [id, endpoint, child] of [
    ['locus-alpha', ALPHA, 'child-alpha'],
    ['locus-beta', BETA, 'child-beta'],
  ] as const) {
    await repository.putLocus({
      id,
      generation: 1,
      endpoint,
      parentSessionId: PARENT,
      childSessionId: child,
      workspaceId: 'ws-shared',
      source: 'auto',
      state: 'active',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
      busy: false,
      createdAt: 1,
      updatedAt: 1,
    })
  }
  return repository
}

describe('a shared main session does not merge sibling children', () => {
  it('resolves each child to its own locus only', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoSiblings(harness)

      // Child-oriented discovery is deliberately one locus, never siblings.
      expect(repository.findByChildSessionId('child-alpha').map(row => row.id)).toEqual(['locus-alpha'])
      expect(repository.findByChildSessionId('child-beta').map(row => row.id)).toEqual(['locus-beta'])
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
      expect(repository.listByParentSession(PARENT).map(row => row.id).sort())
        .toEqual(['locus-alpha', 'locus-beta'])
    } finally {
      await harness.close()
    }
  })

  it('gives child-oriented lookup no way to reach a sibling', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoSiblings(harness)

      // The caller-bound context tool resolves a locus THROUGH this lookup
      // (its own boundary cases are covered in locus-context-tool.test.ts).
      // Pinning it here keeps the guarantee even if that tool is rewritten:
      // there is simply no query that turns one child into its sibling.
      const alpha = repository.findByChildSessionId('child-alpha')
      expect(alpha).toHaveLength(1)
      expect(alpha[0]?.endpoint.chatId).toBe('oc-team-alpha')
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
        endpoint: ALPHA,
        locusId: 'locus-alpha',
        generation: 1,
        childSessionId: 'child-alpha',
        messageId: 'om-alpha-1',
        senderOpenId: 'ou-alpha',
        acceptedAt: 2,
      })

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
        endpoint: ALPHA,
        locusId: 'locus-alpha',
        generation: 1,
        childSessionId: 'child-alpha',
        messageId: 'om-alpha-1',
        senderOpenId: 'ou-alpha',
        acceptedAt: 2,
      })
      await repository.bindQueued({
        deliveryId: accepted.record.deliveryId,
        correlation: {
          endpoint: ALPHA, locusId: 'locus-alpha', generation: 1, childSessionId: 'child-alpha',
        },
        executionId: 'exec-alpha',
        queuedAt: 3,
      })

      // The sibling's identity must not satisfy the settlement proof.
      const settled = await repository.settleByTurn({
        deliveryId: accepted.record.deliveryId,
        executionId: 'exec-alpha',
        correlation: {
          endpoint: BETA,
          locusId: 'locus-beta',
          generation: 1,
          childSessionId: 'child-beta',
          turnId: 'child-beta#1',
        },
        outcome: 'settled',
        settledAt: 4,
      })

      expect(settled.changed).toBe(false)
      expect(repository.findDeliveryByMessageId('om-alpha-1')?.status).toBe('queued')
    } finally {
      await harness.close()
    }
  })

  it('keeps a permission grant scoped to the entry it was granted for', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoSiblings(harness)

      await repository.setLocusMode('locus-alpha', 'write', 'ou_owner', 10)

      // Sharing a work root with one group is not sharing it with every group
      // that happens to hang off the same main session.
      expect(repository.getLocus('locus-alpha')?.permission.effective).toBe('write')
      expect(repository.getLocus('locus-beta')?.permission.effective).toBe('read')
      expect(repository.listPermissionAudit('locus-beta', 1)).toEqual([])
    } finally {
      await harness.close()
    }
  })
})
