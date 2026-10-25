/**
 * `pet-locus-intent-triage` → "共享事实台账按主会话归属并对同源只读开放"
 * (scope-01..06), against the REAL dsh-collab plugin and collab-kernel.
 *
 * Todo registration through `pet_locus_track` moves onto the space in task
 * group 7; until then a child's todo is written the way that tool will write
 * it — a stamped `collab_create_item` request with `assignee: 'main'` and no
 * required acks — through the real tool surface.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { endpointKeyOf, type LocusEndpoint } from '../src/host/locus/aggregate.js'
import { locusIdentity, locusSpaceId, petAddress } from '../src/host/collab/naming.js'
import { LocusCollabProxy, type ProxyLocusRecord } from '../src/host/collab/proxy.js'
import { SUBAGENT_HEADER, openCollabWorld, result, settle, type CollabWorld } from './support/collab-host.js'
import { CollabTodoBackend } from '../src/host/collab/todo-backend.js'
import { trackFailureText, trackTodo } from '../src/host/ledger/track.js'
import { authorizedFor } from './support/collab-todo.js'

const MAIN = 'session-main-scope'
const OTHER_MAIN = 'session-main-other'
const ALPHA: LocusEndpoint = { chatId: 'oc-scope-alpha' }
const BETA: LocusEndpoint = { chatId: 'oc-scope-beta' }
const GAMMA: LocusEndpoint = { chatId: 'oc-scope-gamma' }
const SPACE = locusSpaceId(MAIN)

let world: CollabWorld | undefined
afterEach(async () => { await world?.stop(); world = undefined })

function locus(id: string, endpoint: LocusEndpoint, child: string, extra: Partial<ProxyLocusRecord> = {}): ProxyLocusRecord {
  return { id, generation: 1, endpoint, parentSessionId: MAIN, childSessionId: child, state: 'active', ...extra }
}

async function open(initial: ProxyLocusRecord[]) {
  world = await openCollabWorld()
  const w = world
  let records = initial
  const proxy = new LocusCollabProxy({ listLoci: () => records, liveAgent: id => w.live.get(id) })
  proxy.attach(w.service)
  return { w, proxy, setLoci(next: ProxyLocusRecord[]) { records = next; proxy.refresh() } }
}

const registerTodo = (w: CollabWorld, agent: unknown, itemId: string, summary: string) =>
  w.call(agent, 'collab_create_item', {
    spaceId: SPACE, cmdId: `track-${itemId}`, itemId, kind: 'request', title: summary,
    body: JSON.stringify({ summary, detail: '定位与建议' }), requiredAcks: [], assignee: 'main',
  }).then(result)
const overview = (w: CollabWorld, agent: unknown, spaceId = SPACE) =>
  w.call(agent, 'collab_read', { view: 'overview', spaceId }).then(result)
const since = (w: CollabWorld, agent: unknown, spaceId = SPACE) =>
  w.call(agent, 'collab_read', { view: 'since', spaceId, sinceSeq: 0 }).then(result)

describe('共享事实台账按主会话归属并对同源只读开放', () => {
  it('scope-01：兄弟子会话读不到彼此登记的结论', async () => {
    const { w, proxy } = await open([locus('rec-a', ALPHA, 'child-a'), locus('rec-b', BETA, 'child-b')])
    const main = w.session(MAIN)
    const childA = w.session('child-a', SUBAGENT_HEADER(MAIN))
    const childB = w.session('child-b', SUBAGENT_HEADER(MAIN))
    expect(await proxy.ensureSpace(MAIN)).toMatchObject({ ok: true })

    const todo = await registerTodo(w, childA, 'todo-a1', '按钮点击无反应')
    expect(todo.error).toBeUndefined()

    for (const read of [overview(w, childB), since(w, childB)]) {
      const value = await read
      expect(value.error).toBeUndefined()
      expect(JSON.stringify(value)).not.toContain('todo-a1')
      expect(JSON.stringify(value)).not.toContain('按钮点击无反应')
    }
    const fromMain = await overview(w, main)
    expect(fromMain.items['todo-a1']).toMatchObject({ author: 'pet', ext: { pet: { locusId: locusIdentity(endpointKeyOf(ALPHA)) } } })
    // The registrant itself still sees its own todo.
    expect((await overview(w, childA)).items['todo-a1']).toBeDefined()
  })

  it('scope-02：跨主会话不可读', async () => {
    const { w, proxy } = await open([
      locus('rec-a', ALPHA, 'child-a'),
      { id: 'rec-x', generation: 1, endpoint: GAMMA, parentSessionId: OTHER_MAIN, childSessionId: 'child-x', state: 'active' },
    ])
    w.session(MAIN)
    w.session(OTHER_MAIN)
    const childA = w.session('child-a', SUBAGENT_HEADER(MAIN))
    const childX = w.session('child-x', SUBAGENT_HEADER(OTHER_MAIN))
    expect(await proxy.ensureSpace(MAIN)).toMatchObject({ ok: true })
    expect(await proxy.ensureSpace(OTHER_MAIN)).toMatchObject({ ok: true })
    expect((await registerTodo(w, childA, 'todo-a1', '本台账的待办')).error).toBeUndefined()

    const existing = await overview(w, childX, SPACE)
    const absent = await overview(w, childX, locusSpaceId('session-never-existed'))
    // Uniform refusal: the reply does not reveal that this ledger exists.
    expect(existing).toEqual({ error: { code: 'COLLAB_SPACE_UNAVAILABLE' } })
    expect(absent).toEqual(existing)
    expect(JSON.stringify(await since(w, childX, SPACE))).toBe(JSON.stringify(existing))
  })

  it('scope-03：台账不随条目清空而消失', async () => {
    const { w, proxy } = await open([locus('rec-a', ALPHA, 'child-a')])
    const main = w.session(MAIN)
    const childA = w.session('child-a', SUBAGENT_HEADER(MAIN))
    expect(await proxy.ensureSpace(MAIN)).toEqual({ ok: true, spaceId: SPACE })
    expect((await registerTodo(w, childA, 'todo-1', '唯一一条')).error).toBeUndefined()
    // The owner's disposition, recorded by the proxy's manager command.
    const done = await proxy.currentHandle()!.disposeRequest(SPACE, 'done-1', { itemId: 'todo-1', progress: 'done' })
    expect((done as { error?: unknown }).error).toBeUndefined()
    expect((await overview(w, main)).items['todo-1'].progress).toBe('done')
    await settle()

    // The ledger stays: the same space, Leader and proxy member remain.
    const after = await overview(w, main)
    expect(after.error).toBeUndefined()
    expect(after.leader).toBe('main')
    expect(after.members.pet).toMatchObject({ status: 'active', binding: { address: petAddress(MAIN) } })
    // A later registration reuses it rather than establishing another one.
    expect(await proxy.ensureSpace(MAIN)).toEqual({ ok: true, spaceId: SPACE })
    expect((await registerTodo(w, childA, 'todo-2', '之后的一条')).error).toBeUndefined()
    const reused = await overview(w, main)
    expect(Object.keys(reused.items).sort()).toEqual(['todo-1', 'todo-2'])
    expect(Object.keys(reused.members).sort()).toEqual(['main', 'pet'])
  })

  it('scope-04：新增条目类型不改既有语义', async () => {
    const { w, proxy } = await open([locus('rec-a', ALPHA, 'child-a'), locus('rec-b', BETA, 'child-b')])
    const main = w.session(MAIN)
    const childA = w.session('child-a', SUBAGENT_HEADER(MAIN))
    const childB = w.session('child-b', SUBAGENT_HEADER(MAIN))
    expect(await proxy.ensureSpace(MAIN)).toMatchObject({ ok: true })
    expect((await registerTodo(w, childA, 'todo-1', '待办')).error).toBeUndefined()
    const before = (await overview(w, main)).items['todo-1']
    const tryAdvance = (cmdId: string) => w.call(childA, 'collab_advance_request', { spaceId: SPACE, cmdId, itemId: 'todo-1', progress: 'accepted' }).then(result)
    const refusedBefore = await tryAdvance('adv-before')
    expect(refusedBefore.error).toBeDefined()

    // A second kind of entry appears in the same space.
    const note = await w.call(childA, 'collab_create_item', { spaceId: SPACE, cmdId: 'note-1', itemId: 'note-1', kind: 'other', title: '结论', body: 'b', requiredAcks: [] }).then(result)
    expect(note.error).toBeUndefined()

    // The existing todo is not rewritten, and its authorization and lifecycle
    // are unchanged: the child is refused exactly as before, its sibling still
    // cannot see it, and it is still open.
    expect((await overview(w, main)).items['todo-1']).toEqual(before)
    expect(await tryAdvance('adv-after')).toEqual(refusedBefore)
    expect(JSON.stringify(await overview(w, childB))).not.toContain('todo-1')
    expect((await overview(w, main)).items['todo-1'].progress).toBe('open')
  })

  it('scope-05：换代后登记照旧归入同一代理', async () => {
    const gen2 = locus('rec-alpha-g2', ALPHA, 'child-g2', { generation: 2 })
    const { w, proxy, setLoci } = await open([gen2])
    const main = w.session(MAIN)
    const childG2 = w.session('child-g2', SUBAGENT_HEADER(MAIN))
    expect(await proxy.ensureSpace(MAIN)).toMatchObject({ ok: true })
    expect((await registerTodo(w, childG2, 'todo-g2', '第 2 代登记')).error).toBeUndefined()
    const membersBefore = (await overview(w, main)).members

    // Switch to generation 3: a NEW record id and a new child; the old one retires.
    setLoci([{ ...gen2, state: 'retired' }, locus('locus-runtime-999-abc', ALPHA, 'child-g3', { generation: 3 })])
    const childG3 = w.session('child-g3', SUBAGENT_HEADER(MAIN))
    expect((await registerTodo(w, childG3, 'todo-g3', '第 3 代登记')).error).toBeUndefined()

    const items = (await overview(w, main)).items
    expect(items['todo-g3'].author).toBe('pet')
    expect(items['todo-g3'].ext.pet.locusId).toBe(items['todo-g2'].ext.pet.locusId)
    expect((await overview(w, main)).members).toEqual(membersBefore)
    // The retired generation's child, even still loaded, is no caller any more.
    expect(await overview(w, childG2)).toEqual({ error: { code: 'COLLAB_CALLER_UNAVAILABLE' } })
    // ...and the new generation reads its predecessor's todo as its own.
    expect((await overview(w, childG3)).items['todo-g2']).toBeDefined()
  })

  it('scope-06：主会话未加载时不为建空间唤醒它（collab_status 部分）', async () => {
    const { w, proxy } = await open([locus('rec-a', ALPHA, 'child-a')])
    // Main is NOT loaded; its first locus child is.
    const childA = w.session('child-a', SUBAGENT_HEADER(MAIN))

    expect(await proxy.ensureSpace(MAIN)).toEqual({ ok: false, reason: 'main-not-loaded' })
    const status = await w.call(childA, 'collab_status', {}).then(result)
    expect(status).toEqual({ error: { code: 'COLLAB_CALLER_UNAVAILABLE' } })
    // Not resumed, and no space was created behind its back.
    expect(w.counts.resolveAgent).toBe(0)
    expect(w.live.has(MAIN)).toBe(false)
    expect(proxy.isEstablished(MAIN)).toBe(false)

    // Once the main session loads, the same call establishes the space.
    w.session(MAIN)
    expect(await proxy.ensureSpace(MAIN)).toEqual({ ok: true, spaceId: SPACE })
    expect((await w.call(childA, 'collab_status', {}).then(result)).error).toBeUndefined()
  })

  it('scope-06：主会话未加载时不为建空间唤醒它（pet_locus_track 部分）', async () => {
    const { w, proxy } = await open([locus('rec-a', ALPHA, 'child-a')])
    w.session('child-a', SUBAGENT_HEADER(MAIN))
    const backend = new CollabTodoBackend({
      proxy,
      childOf: ({ locusId }) => locusId === 'rec-a' ? 'child-a' : undefined,
      liveAgent: id => w.live.get(id),
    })
    const record = locus('rec-a', ALPHA, 'child-a')
    const registered = await trackTodo(authorizedFor(record), { summary: '主会话没加载', detail: '' }, {
      store: backend, now: () => 1_000, newItemId: () => 'todo-early',
    })
    expect(registered).toEqual({ ok: false, reason: 'space-not-ready' })
    expect(trackFailureText('space-not-ready')).toContain('尚未就绪')
    expect(w.counts.resolveAgent).toBe(0)
    expect(w.live.has(MAIN)).toBe(false)
    // Nothing was written anywhere: the space does not even exist.
    expect(await proxy.currentHandle()!.readManaged(SPACE)).toEqual({ error: { code: 'COLLAB_SPACE_UNAVAILABLE' } })
  })
})
