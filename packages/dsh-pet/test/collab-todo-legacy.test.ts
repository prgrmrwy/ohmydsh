/**
 * `pet-locus-intent-triage` → "存量待办只读保留为旧版" (legacy-01..02), and the
 * owner surface for unroutable proxy deliveries (design D5 rule 3).
 *
 * Legacy todos live in the Pet Domain store from before this change; new todos
 * live only in the Locus collaboration space (real dsh-collab plugin here).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { legacyTodoBackend } from '../src/host/ledger/backend.js'
import { SharedFactLedgerStore } from '../src/host/ledger/store.js'
import { createOwnerLedger } from '../src/host/ledger/owner-ledger.js'
import { locusSpaceId } from '../src/host/collab/naming.js'
import { openTodoWorld, readOverview, type TodoWorld } from './support/collab-todo.js'
import { result, settle } from './support/collab-host.js'
import { emptyMedium, openPetHarness, type PetHarness } from './harness.js'

const MAIN = 'session-main-legacy'
const ALPHA = { chatId: 'oc-legacy-alpha' }
const BETA = { chatId: 'oc-legacy-beta' }
const LOCUS_A = { id: 'rec-legacy-a', generation: 1, endpoint: ALPHA, parentSessionId: MAIN, childSessionId: 'child-legacy-a', state: 'active' }
const LOCUS_B = { id: 'rec-legacy-b', generation: 1, endpoint: BETA, parentSessionId: MAIN, childSessionId: 'child-legacy-b', state: 'active' }

let todo: TodoWorld | undefined
let harness: PetHarness | undefined
afterEach(async () => {
  await todo?.world.stop(); todo = undefined
  await harness?.close(); harness = undefined
})

async function world() {
  harness = await openPetHarness(emptyMedium())
  const store = new SharedFactLedgerStore(harness.domain)
  await store.registerTodoItem({
    itemId: 'todo-before-upgrade', parentSessionId: MAIN, locusId: LOCUS_A.id, generation: 1, endpoint: ALPHA,
    triggerMessageId: 'om-before', requestedBy: 'ou_requester', evidence: { summary: '升级前登记', detail: '旧证据' }, createdAt: 1,
  })
  todo = await openTodoWorld()
  todo.addLocus(LOCUS_A)
  todo.addLocus(LOCUS_B)
  await todo.loadMain(MAIN)
  const t = todo
  const owner = createOwnerLedger({
    collab: t.backend,
    legacy: legacyTodoBackend(store),
    collabAvailable: () => t.proxy.currentHandle() !== undefined,
    unroutable: parent => t.proxy.inbox().filter(entry => entry.parentSessionId === parent && entry.route.kind === 'unroutable'),
  })
  const ledgerRows = () => [...harness!.domain.table('ledger_item').entries()].map(([key, value]) => [key, JSON.stringify(value)])
  return { t, store, owner, ledgerRows }
}

describe('存量待办只读保留为旧版', () => {
  it('legacy-01：旧版待办只在管理面', async () => {
    const { t, owner, ledgerRows } = await world()
    const rowsBefore = ledgerRows()
    expect((await t.register(LOCUS_B.id, { summary: '升级后登记', detail: '' }, 'todo-after-upgrade')).ok).toBe(true)

    const view = await owner.list(MAIN)
    expect(view.collab).toBe('available')
    expect(view.items.map(item => [item.itemId, item.legacy === true])).toEqual([
      ['todo-before-upgrade', true],
      ['todo-after-upgrade', false],
    ])
    // The registering child reads only the new one through the collaboration tools.
    const read = await readOverview(t.world, t.world.live.get(LOCUS_B.childSessionId), MAIN)
    expect(Object.keys(read.items)).toEqual(['todo-after-upgrade'])
    expect(JSON.stringify(read)).not.toContain('todo-before-upgrade')
    // New registrations never touch the local table.
    expect(ledgerRows()).toEqual(rowsBefore)
  })

  it('legacy-02：旧版待办只读', async () => {
    const { t, store, owner, ledgerRows } = await world()
    const rowsBefore = ledgerRows()
    const spaceBefore = JSON.stringify(await t.records(MAIN))
    const view = await owner.list(MAIN)
    const legacy = view.items.find(item => item.itemId === 'todo-before-upgrade')!
    expect(legacy).toMatchObject({ legacy: true, endpoint: ALPHA, triggerMessageId: 'om-before', status: 'open' })
    for (const action of ['accept', 'done', 'drop'] as const) {
      await expect(owner.guard('todo-before-upgrade', action)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    }
    // Neither the local record nor the collaboration space changed.
    expect(ledgerRows()).toEqual(rowsBefore)
    expect(store.getTodoItem('todo-before-upgrade')?.status).toBe('open')
    expect(JSON.stringify(await t.records(MAIN))).toBe(spaceBefore)
    // A collab todo is not refused by the legacy guard.
    expect((await t.register(LOCUS_B.id, { summary: '新的', detail: '' }, 'todo-new')).ok).toBe(true)
    await expect(owner.guard('todo-new', 'done')).resolves.toBeUndefined()
  })

  it('无法路由的登记在管理面可见，且不在任何子会话可见', async () => {
    const { t, owner } = await world()
    const main = t.world.live.get(MAIN)
    const sent = result(await t.world.call(main, 'collab_send_message', { spaceId: locusSpaceId(MAIN), cmdId: 'unroutable-1', to: 'pet', body: '大家看看', needsReply: true }))
    expect(sent.error).toBeUndefined()
    await settle()
    const view = await owner.list(MAIN)
    expect(view.unroutable).toEqual([expect.objectContaining({ seq: sent.seq, subject: 'message' })])
    for (const child of [LOCUS_A.childSessionId, LOCUS_B.childSessionId]) {
      expect(JSON.stringify(await readOverview(t.world, t.world.live.get(child), MAIN))).not.toContain('大家看看')
    }
  })
})

describe('the Host wires the owner ledger into both todo routes (regression guard)', () => {
  it('list goes through createOwnerLedger and every disposition passes the legacy guard first', async () => {
    const fs = await import('node:fs')
    const index = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const block = index.slice(index.indexOf('    todoLedger: {'), index.indexOf('    locusDiagnostics:'))
    expect(block).toContain('list: parentSessionId => ownerLedger.list(parentSessionId)')
    const advance = block.slice(block.indexOf('advance: async'))
    expect(advance.indexOf('await ownerLedger.guard(itemId, action)')).toBeGreaterThan(-1)
    expect(advance.indexOf('await ownerLedger.guard(itemId, action)')).toBeLessThan(advance.indexOf('todoBackend.advanceStatus'))
    expect(advance.indexOf('await ownerLedger.guard(itemId, action)')).toBeLessThan(advance.indexOf('acceptTodo('))
  })
})
