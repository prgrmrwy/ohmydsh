/**
 * `pet-locus-intent-triage` → "协作层不可用时台账与待办 fail closed".
 *
 * availability-01: with dsh-collab absent (no handle), registration fails as
 * "collaboration layer unavailable", writes nothing, and the Delivery still
 * settles — and the reply itself still goes out through `pet_locus_finish`
 * (the reply path in this Host; there is no separate `pet_locus_reply` tool).
 * availability-02: the owner list says "unavailable" and still lists legacy.
 * availability-03: after dsh-collab returns, Pet re-attaches, rebuilds and a
 * new-generation child registers again into the same space.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackFailureText, trackTodo } from '../src/host/ledger/track.js'
import { LocusCollabProxy } from '../src/host/collab/proxy.js'
import { CollabTodoBackend } from '../src/host/collab/todo-backend.js'
import { LocusRepository } from '../src/host/locus/persistence.js'
import type { DeliveryCorrelation } from '../src/host/locus/delivery.js'
import { authorizedFor, identityOf, openTodoWorld } from './support/collab-todo.js'
import { legacyTodoBackend } from '../src/host/ledger/backend.js'
import { SharedFactLedgerStore } from '../src/host/ledger/store.js'
import { createOwnerLedger } from '../src/host/ledger/owner-ledger.js'
import { PET_LOCUS_FINISH_TOOL, PET_LOCUS_TRACK_TOOL, registerPetTools } from '../src/host/tools.js'
import { locusSpaceId } from '../src/host/collab/naming.js'
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
  it('availability-01：协作层缺失时登记失败而回复照常（pet_locus_track 与 pet_locus_finish 两个工具）', async () => {
    const child = { id: LOCUS.childSessionId }
    const proxy = new LocusCollabProxy({ listLoci: () => [LOCUS], liveAgent: id => id === child.id ? child : undefined })
    const backend = new CollabTodoBackend({ proxy, childOf: () => LOCUS.childSessionId, liveAgent: id => id === child.id ? child : undefined })
    const definitions: { name: string; execute(args: unknown, exec: unknown): Promise<unknown> }[] = []
    const record = authorizedFor(LOCUS)
    const finishCurrentDelivery = vi.fn(async () => ({ sent: true as const, outcome: 'reply' as const }))
    const locusRepository = { findByChildSessionId: () => [record], authorizeCurrentDelivery: async () => record }
    const capability = () => ({ deliveryId: `delivery-om-${LOCUS.id}`, executionId: 'exec', turnId: `${child.id}#1`, source: 'delivery' as const })
    registerPetTools({ tools: { register: (definition: never) => { definitions.push(definition); return () => {} } } } as never, {
      repository: {} as never,
      locusRepository,
      locusLifecycle: { locusRepository, authorizeCurrentDelivery: async () => record, lark: {} as never, currentCapability: capability, finishCurrentDelivery },
      intentTriage: {
        loci: { findByChildSessionId: () => [] },
        currentCapability: capability,
        authorizeCurrentDelivery: async () => record,
        track: { store: backend, now: () => 4, newItemId: () => 'todo-avail-tool' },
      } as never,
    })
    const exec = { agent: child, signal: new AbortController().signal }
    const tracked = await definitions.find(item => item.name === PET_LOCUS_TRACK_TOOL)!.execute({ summary: '要改', detail: '' }, exec)
    expect(tracked).toEqual({ ok: false, reason: 'collab-unavailable' })
    const replied = await definitions.find(item => item.name === PET_LOCUS_FINISH_TOOL)!.execute({ outcome: 'reply', text: '已收到，暂时无法登记' }, exec)
    expect(replied).toEqual({ sent: true, outcome: 'reply' })
    expect(finishCurrentDelivery).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'reply', text: '已收到，暂时无法登记' }))
  })

  it('availability-02：管理面不把不可用显示为空', async () => {
    harness = await openPetHarness(emptyMedium())
    const store = new SharedFactLedgerStore(harness.domain)
    await store.registerTodoItem({
      itemId: 'todo-old', parentSessionId: MAIN, locusId: LOCUS.id, generation: 1, endpoint: ALPHA,
      triggerMessageId: 'om-old', requestedBy: 'ou_requester', evidence: { summary: '旧版待办', detail: '' }, createdAt: 1,
    })
    // dsh-collab absent: the proxy never attaches.
    const proxy = new LocusCollabProxy({ listLoci: () => [LOCUS], liveAgent: () => undefined })
    const owner = createOwnerLedger({
      collab: new CollabTodoBackend({ proxy, childOf: () => undefined, liveAgent: () => undefined }),
      legacy: legacyTodoBackend(store),
      collabAvailable: () => proxy.currentHandle() !== undefined,
      unroutable: () => [],
    })
    const view = await owner.list(MAIN)
    expect(view.collab).toBe('unavailable')
    expect(view.items.map(item => [item.itemId, item.legacy])).toEqual([['todo-old', true]])
  })

  it('availability-03：协作层恢复后自动重新可用', async () => {
    const t = await openTodoWorld()
    try {
      const gen2 = { id: 'rec-avail-g2', generation: 2, endpoint: ALPHA, parentSessionId: MAIN, childSessionId: 'child-avail-g2', state: 'active' }
      t.addLocus(gen2)
      await t.loadMain(MAIN)
      expect((await t.register(gen2.id, { summary: '第 2 代', detail: '' }, 'todo-avail-g2')).ok).toBe(true)
      const membersBefore = (t.world.live.get(MAIN) && (await t.records(MAIN)).flatMap((r: any) => r.events).filter((e: any) => e.type === 'member/joined').map((e: any) => e.member.name))

      // dsh-collab goes away: Pet's handle is disposed.
      const detach = t.proxy.currentHandle()!
      detach.dispose()
      expect((await t.register(gen2.id, { summary: '不可用期间', detail: '' }, 'todo-avail-down')).ok).toBe(false)
      // Meanwhile the locus switches to generation 3.
      t.updateLocus(gen2.id, { state: 'retired' })
      t.addLocus({ id: 'rec-avail-g3', generation: 3, endpoint: ALPHA, parentSessionId: MAIN, childSessionId: 'child-avail-g3', state: 'active' })

      // dsh-collab comes back: Pet re-attaches and rebuilds from durable facts.
      t.proxy.attach(t.world.service)
      t.proxy.refresh()
      await t.proxy.ensureAll()
      const registered = await t.register('rec-avail-g3', { summary: '第 3 代', detail: '' }, 'todo-avail-g3')
      expect(registered.ok).toBe(true)
      const records = await t.records(MAIN)
      const created = records.flatMap((r: any) => r.events).filter((e: any) => e.type === 'item/created').map((e: any) => e.item)
      const g3 = created.find((item: any) => item.id === 'todo-avail-g3')
      expect(g3).toMatchObject({ author: 'pet', ext: { pet: { locusId: identityOf(ALPHA) } } })
      expect(created.some((item: any) => item.id === 'todo-avail-down')).toBe(false)
      const membersAfter = records.flatMap((r: any) => r.events).filter((e: any) => e.type === 'member/joined').map((e: any) => e.member.name)
      expect(membersAfter).toEqual(membersBefore)
      expect(locusSpaceId(MAIN)).toBe(records[0].events[0].spaceId)
    } finally {
      await t.world.stop()
    }
  })
})
