/**
 * `pet-locus-intent-triage` → "协作层不可用时台账与待办 fail closed".
 *
 * Partial evidence for availability-01 within task group 7: with dsh-collab
 * absent (no handle), registration fails as "collaboration layer unavailable",
 * writes nothing, and the Delivery still settles. The `pet_locus_reply` half
 * and availability-02/03 belong to later task groups.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { trackFailureText, trackTodo } from '../src/host/ledger/track.js'
import { LocusCollabProxy } from '../src/host/collab/proxy.js'
import { CollabTodoBackend } from '../src/host/collab/todo-backend.js'
import { LocusRepository } from '../src/host/locus/persistence.js'
import type { DeliveryCorrelation } from '../src/host/locus/delivery.js'
import { authorizedFor } from './support/collab-todo.js'
import { emptyMedium, openPetHarness, type PetHarness } from './harness.js'

const MAIN = 'session-main-avail'
const ALPHA = { chatId: 'oc-avail-alpha' }
const LOCUS = { id: 'rec-avail', generation: 1, endpoint: ALPHA, parentSessionId: MAIN, childSessionId: 'child-avail', state: 'active' }

let harness: PetHarness | undefined
afterEach(async () => { await harness?.close(); harness = undefined })

describe('协作层不可用时台账与待办 fail closed', () => {
  it('availability-01（登记与 Delivery 部分）：协作层缺失时登记失败而 Delivery 照常结算', async () => {
    // dsh-collab absent: the proxy never attaches, so there is no handle.
    const child = { id: LOCUS.childSessionId }
    const proxy = new LocusCollabProxy({ listLoci: () => [LOCUS], liveAgent: id => id === child.id ? child : undefined })
    const backend = new CollabTodoBackend({ proxy, childOf: () => LOCUS.childSessionId, liveAgent: id => id === child.id ? child : undefined })

    harness = await openPetHarness(emptyMedium())
    const repository = new LocusRepository(harness.domain)
    await repository.putLocus({
      id: LOCUS.id, generation: 1, endpoint: ALPHA, parentSessionId: MAIN, childSessionId: LOCUS.childSessionId,
      workspaceId: 'ws-avail', source: 'auto', state: 'active', childComposition: 'safe-v1',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 }, busy: false, createdAt: 1, updatedAt: 1,
    })
    const correlation: DeliveryCorrelation = { endpoint: ALPHA, locusId: LOCUS.id, generation: 1, childSessionId: LOCUS.childSessionId }
    await repository.acceptDelivery({ ...correlation, messageId: 'om-avail', senderOpenId: 'ou_requester', acceptedAt: 2 } as never)
    const current = (await repository.claimCurrentDelivery({ correlation, now: 3 }))!

    const registered = await trackTodo(authorizedFor(LOCUS), { summary: '要改', detail: '' }, {
      store: backend, now: () => 4, newItemId: () => 'todo-avail',
    })
    expect(registered).toEqual({ ok: false, reason: 'collab-unavailable' })
    expect(trackFailureText('collab-unavailable')).toContain('协作层当前不可用')
    expect(trackFailureText('collab-unavailable')).not.toBe(trackFailureText('space-not-ready'))
    // No local substitute record: the owner read is refused as unavailable, not shown as empty.
    await expect(backend.listForParent(MAIN)).rejects.toMatchObject({ code: 'COLLAB_UNAVAILABLE' })

    // The Delivery is unaffected and settles normally.
    await repository.markDeliveryFinishing({ ...correlation, deliveryId: current.deliveryId, now: 5 })
    await repository.completeCurrentDelivery({ ...correlation, deliveryId: current.deliveryId, now: 6, outcome: 'reply', outboundResult: 'success' })
    expect(repository.findDeliveryByMessageId('om-avail')?.status).toBe('replied')
  })
})
