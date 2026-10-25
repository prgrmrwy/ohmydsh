/**
 * `pet-locus-intent-triage` → "待办生命周期与 Delivery 结算解耦"
 * (lifecycle-01..06) on the collab `TodoBackend`, over the REAL dsh-collab
 * plugin and the REAL durable Delivery ledger.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { acceptTodo } from '../src/host/ledger/dispatch.js'
import { LocusRepository } from '../src/host/locus/persistence.js'
import type { DeliveryCorrelation } from '../src/host/locus/delivery.js'
import { locusSpaceId } from '../src/host/collab/naming.js'
import { eventsAfter, identityOf, openTodoWorld, readOverview, type TodoWorld } from './support/collab-todo.js'
import { result, settle } from './support/collab-host.js'
import { emptyMedium, openPetHarness, type PetHarness } from './harness.js'

const MAIN = 'session-main-life'
const ALPHA = { chatId: 'oc-life-alpha' }
const SPACE = locusSpaceId(MAIN)
const LOCUS = { id: 'rec-life-a', generation: 1, endpoint: ALPHA, parentSessionId: MAIN, childSessionId: 'child-life', state: 'active' }

let todo: TodoWorld | undefined
let harness: PetHarness | undefined
afterEach(async () => {
  await todo?.world.stop(); todo = undefined
  await harness?.close(); harness = undefined
})

async function ready() {
  todo = await openTodoWorld()
  todo.addLocus(LOCUS)
  await todo.loadMain(MAIN)
  return todo
}

/** Recording dispatch port (same shape as todo-dispatch.test.ts's fake; importing a test file would re-run its suites). */
function fakeDispatchPort(options: { status: 'idle' | 'running' }) {
  const calls: { kind: string; sessionId: string; text?: string }[] = []
  return {
    calls,
    resolve(sessionId: string) { calls.push({ kind: 'resolve', sessionId }); return { status: options.status } },
    async resume(sessionId: string) { calls.push({ kind: 'resume', sessionId }) },
    followup(sessionId: string, text: string) { calls.push({ kind: 'followup', sessionId, text }) },
  }
}

/** The same collaborators owner accept uses in production, over the collab backend. */
function acceptDeps(t: TodoWorld, port = fakeDispatchPort({ status: 'idle' })) {
  return {
    port,
    deps: {
      readTodo: (id: string) => t.backend.getTodoItem(id),
      registrarFor: () => ({ childCanExecute: false, childSessionId: LOCUS.childSessionId }),
      contextFor: () => ({ mainWasBriefedStandby: false }),
      port,
      advanceStatus: (id: string, to: 'accepted') => t.backend.advanceStatus(id, to, Date.now()),
      log: () => {},
    },
  }
}

/** A durable locus with A current and B backlogged, on the real Delivery ledger. */
async function deliveryQueue() {
  harness = await openPetHarness(emptyMedium())
  const repository = new LocusRepository(harness.domain)
  await repository.putLocus({
    id: LOCUS.id, generation: 1, endpoint: ALPHA, parentSessionId: MAIN, childSessionId: LOCUS.childSessionId,
    workspaceId: 'ws-life', source: 'auto', state: 'active', childComposition: 'safe-v1',
    permission: { desired: 'read', effective: 'read', verifiedAt: 1 }, busy: false, createdAt: 1, updatedAt: 1,
  })
  const correlation: DeliveryCorrelation = { endpoint: ALPHA, locusId: LOCUS.id, generation: 1, childSessionId: LOCUS.childSessionId }
  for (const messageId of ['om-a', 'om-b']) {
    await repository.acceptDelivery({ ...correlation, messageId, senderOpenId: 'ou_requester', acceptedAt: 2 } as never)
  }
  const current = await repository.claimCurrentDelivery({ correlation, now: 3 })
  return { repository, correlation, current: current! }
}

describe('待办生命周期与 Delivery 结算解耦（collab）', () => {
  it('lifecycle-01：登记后队列继续前进', async () => {
    const t = await ready()
    const { repository, correlation, current } = await deliveryQueue()
    expect(current.messageId).toBe('om-a')
    expect((await t.register(LOCUS.id, { summary: '要改代码', detail: '' }, 'todo-q')).ok).toBe(true)

    await repository.markDeliveryFinishing({ ...correlation, deliveryId: current.deliveryId, now: 4 })
    await repository.completeCurrentDelivery({ ...correlation, deliveryId: current.deliveryId, now: 5, outcome: 'reply', outboundResult: 'success' })
    const next = await repository.claimCurrentDelivery({ correlation, now: 6 })
    expect(next?.messageId).toBe('om-b')
    expect((await t.backend.getTodoItem('todo-q'))?.status).toBe('open')
  })

  it('lifecycle-02：回复完成不等于事情做完', async () => {
    const t = await ready()
    const { repository, correlation, current } = await deliveryQueue()
    expect((await t.register(LOCUS.id, { summary: '修 bug', detail: '' }, 'todo-r')).ok).toBe(true)
    await repository.markDeliveryFinishing({ ...correlation, deliveryId: current.deliveryId, now: 4 })
    await repository.completeCurrentDelivery({ ...correlation, deliveryId: current.deliveryId, now: 5, outcome: 'reply', outboundResult: 'success' })
    expect(repository.findDeliveryByMessageId('om-a')?.status).toBe('replied')
    const record = await t.backend.getTodoItem('todo-r')
    expect(record?.status).toBe('open')
    const item = (await readOverview(t.world, t.world.live.get(MAIN), MAIN)).items['todo-r']
    expect(item.progress).toBe('open')
  })

  it('lifecycle-03：待办状态变化不外发', async () => {
    const t = await ready()
    expect((await t.register(LOCUS.id, { summary: '外发检查', detail: '' }, 'todo-o')).ok).toBe(true)
    const before = (await t.records(MAIN)).at(-1).seq
    await t.backend.advanceStatus('todo-o', 'done', 2_000)
    await settle()
    // Only the disposition is committed: no message, no wake, no follow-up turn.
    expect(eventsAfter(await t.records(MAIN), before)).toEqual(['request/progressed'])
    expect(t.world.counts.followup).toBe(0)
    expect(t.proxy.inbox()).toEqual([])
  })

  it('lifecycle-04：子会话不能推进待办状态', async () => {
    const t = await ready()
    expect((await t.register(LOCUS.id, { summary: '自己登记', detail: '' }, 'todo-c')).ok).toBe(true)
    const before = await t.records(MAIN)
    const child = t.world.live.get(LOCUS.childSessionId)
    for (const progress of ['accepted', 'done', 'rejected']) {
      const refused = result(await t.world.call(child, 'collab_advance_request', { spaceId: SPACE, cmdId: `adv-${progress}`, itemId: 'todo-c', progress }))
      expect(refused).toEqual({ error: { code: 'COLLAB_ITEM_NOT_FOUND' } })
    }
    // Refused at the dsh-collab entry: the kernel received nothing.
    expect(await t.records(MAIN)).toEqual(before)
    expect((await t.backend.getTodoItem('todo-c'))?.status).toBe('open')
  })

  it('lifecycle-05：主会话做完后自行标记完成', async () => {
    const t = await ready()
    expect((await t.register(LOCUS.id, { summary: '受理后完成', detail: '' }, 'todo-m')).ok).toBe(true)
    const { port, deps } = acceptDeps(t)
    expect((await acceptTodo('todo-m', deps)).ok).toBe(true)
    expect(port.calls.filter(call => call.kind === 'followup')).toHaveLength(1)

    const main = t.world.live.get(MAIN)
    const done = result(await t.world.call(main, 'collab_advance_request', { spaceId: SPACE, cmdId: 'main-done', itemId: 'todo-m', progress: 'done' }))
    expect(done.error).toBeUndefined()
    await settle()

    expect((await t.backend.getTodoItem('todo-m'))?.status).toBe('done')
    expect(t.proxy.inbox().filter(entry => entry.itemId === 'todo-m'))
      .toEqual([expect.objectContaining({ subject: 'request-terminal', progress: 'done', route: { kind: 'locus', locusId: identityOf(ALPHA), via: 'ref' } })])
    expect(t.world.counts.followup).toBe(0)
  })

  it('lifecycle-06：不经受理直接了结', async () => {
    const t = await ready()
    for (const [itemId, to] of [['todo-d1', 'done'], ['todo-d2', 'dropped']] as const) {
      expect((await t.register(LOCUS.id, { summary: itemId, detail: '' }, itemId)).ok).toBe(true)
      const before = (await t.records(MAIN)).at(-1).seq
      expect((await t.backend.advanceStatus(itemId, to, 3_000)).status).toBe(to)
      const committed = (await t.records(MAIN)).filter(record => record.seq > before)
      expect(committed.flatMap(record => record.events.map((event: any) => event.type))).toEqual(['request/progressed'])
    }
    await settle()
    expect(t.world.counts.followup).toBe(0)
  })
})
