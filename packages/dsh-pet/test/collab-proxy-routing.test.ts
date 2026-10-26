/**
 * `pet-locus-intent-triage` → "协作层发给代理的记录按 locus 路由"
 * (routing-01..04), against the REAL dsh-collab plugin and collab-kernel.
 *
 * Pet's proxy is attached through the real `dshCollab` service; children call
 * the real `collab_*` tools as their live Agent objects, so the stamp,
 * projection and relay delivery are dsh-collab's own.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { LocusEndpoint } from '../src/host/locus/aggregate.js'
import { endpointKeyOf } from '../src/host/locus/aggregate.js'
import { locusIdentity, locusSpaceId } from '../src/host/collab/naming.js'
import { LocusCollabProxy, type ProxyLocusRecord } from '../src/host/collab/proxy.js'
import { SUBAGENT_HEADER, openCollabWorld, result, settle, type CollabWorld } from './support/collab-host.js'

const MAIN = 'session-main-routing'
const ALPHA: LocusEndpoint = { chatId: 'oc-routing-alpha' }
const BETA: LocusEndpoint = { chatId: 'oc-routing-beta' }
const A = locusIdentity(endpointKeyOf(ALPHA))
const B = locusIdentity(endpointKeyOf(BETA))
const SPACE = locusSpaceId(MAIN)

let world: CollabWorld | undefined
afterEach(async () => { await world?.stop(); world = undefined })

function locus(id: string, endpoint: LocusEndpoint, child: string, state = 'active', generation = 1): ProxyLocusRecord {
  return { id, generation, endpoint, parentSessionId: MAIN, childSessionId: child, state }
}

/** Main live, two children live, space established through the proxy. */
async function setup(loci: ProxyLocusRecord[] = [locus('rec-a', ALPHA, 'child-a'), locus('rec-b', BETA, 'child-b')]) {
  world = await openCollabWorld()
  const w = world
  const main = w.session(MAIN)
  const childA = w.session('child-a', SUBAGENT_HEADER(MAIN))
  const childB = w.session('child-b', SUBAGENT_HEADER(MAIN))
  let records = loci
  const proxy = new LocusCollabProxy({ listLoci: () => records, liveAgent: id => w.live.get(id) })
  proxy.attach(w.service)
  const ensured = await proxy.ensureSpace(MAIN)
  expect(ensured).toEqual({ ok: true, spaceId: SPACE })
  return {
    w, proxy, main, childA, childB,
    setLoci(next: ProxyLocusRecord[]) { records = next; proxy.refresh() },
  }
}

const send = (w: CollabWorld, agent: unknown, cmdId: string, input: Record<string, unknown>) =>
  w.call(agent, 'collab_send_message', { spaceId: SPACE, cmdId, needsReply: false, ...input }).then(result)
const createRequest = (w: CollabWorld, agent: unknown, cmdId: string, itemId: string, extra: Record<string, unknown> = {}) =>
  w.call(agent, 'collab_create_item', { spaceId: SPACE, cmdId, itemId, kind: 'request', title: 'T', body: '{}', requiredAcks: [], assignee: 'main', ...extra }).then(result)

describe('协作层发给代理的记录按 locus 路由', () => {
  it('notify-only result registers while a silent question is not swept in', async () => {
    const { w, proxy, main } = await setup()
    const silent = await send(w, main, 'silent', { to: 'pet', body: `请 ${B} 之后回答`, notify: false, needsReply: true })
    const notice = await send(w, main, 'notice', { to: 'pet', body: `${B} 结果已就绪`, notify: true, needsReply: false })
    expect(silent.error).toBeUndefined(); expect(notice.error).toBeUndefined()
    await settle()
    expect(proxy.inbox().map(entry => entry.seq)).toEqual([notice.seq])
    expect(proxy.inbox()[0]?.route).toEqual({ kind: 'locus', locusId: B, via: 'mention' })
    expect(w.counts.resolveAgent).toBe(0)
    expect(w.counts.followup).toBe(0)
  })
  it('routing-01：回应消息沿 ref 路由到最近的戳', async () => {
    // The spec GIVEN (B's Rb refs A's Ra) cannot be written through the tools:
    // dsh-collab refuses a stamped child's ref to a sibling's record
    // (COLLAB_BAD_REF, asserted below). The deepest chain a real space can
    // hold is: Ra (A) ← main item I (ref Ra) ; Rb (B) ← M (main → pet, ref Rb).
    // "Nearest, not oldest" with two stamps on one chain is covered by the
    // pure routing test on the same function.
    const { w, proxy, main, childA, childB } = await setup()
    const ra = await createRequest(w, childA, 'ra', 'todo-ra')
    expect(ra.error).toBeUndefined()
    expect((await send(w, childB, 'rb-bad', { to: 'main', body: 'x', ref: ra.seq })).error?.code).toBe('COLLAB_BAD_REF')
    const i = await w.call(main, 'collab_create_item', { spaceId: SPACE, cmdId: 'i', itemId: 'note-i', kind: 'other', title: 'T', body: 'b', requiredAcks: [], ref: ra.seq }).then(result)
    expect(i.error).toBeUndefined()
    const rb = await send(w, childB, 'rb', { to: 'main', body: 'B 的结论' })
    expect(rb.error).toBeUndefined()
    const m = await send(w, main, 'm', { to: 'pet', body: '收到，按这个改', needsReply: true, ref: rb.seq })
    expect(m.error).toBeUndefined()
    const mi = await send(w, main, 'mi', { to: 'pet', body: '这条也看下', needsReply: true, ref: i.seq })
    expect(mi.error).toBeUndefined()
    await settle()

    const routeOf = (seq: number) => proxy.inbox().filter(entry => entry.seq === seq).map(entry => entry.route)
    expect(routeOf(m.seq)).toEqual([{ kind: 'locus', locusId: B, via: 'ref' }])
    // Walks past main's unstamped item to the nearest stamp.
    expect(routeOf(mi.seq)).toEqual([{ kind: 'locus', locusId: A, via: 'ref' }])
    // Registration only: no session was resumed and nobody got a follow-up turn.
    expect(w.counts.resolveAgent).toBe(0)
    expect(w.counts.followup).toBe(0)
  })

  it('routing-02：正文点名', async () => {
    const { w, proxy, main } = await setup()
    const m = await send(w, main, 'm', { to: 'pet', body: `请 ${B} 看一下`, needsReply: true })
    expect(m.error).toBeUndefined()
    await settle()
    expect(proxy.inbox().filter(entry => entry.seq === m.seq))
      .toEqual([expect.objectContaining({ route: { kind: 'locus', locusId: B, via: 'mention' } })])
  })

  it('routing-03：无法路由不猜', async () => {
    const { w, proxy, main, childA, childB } = await setup()
    const m = await send(w, main, 'm', { to: 'pet', body: '大家看一下这个', needsReply: true })
    expect(m.error).toBeUndefined()
    await settle()
    expect(proxy.inbox().filter(entry => entry.seq === m.seq))
      .toEqual([expect.objectContaining({ route: { kind: 'unroutable' } })])
    // Visible to no child; the main session still sees it.
    for (const child of [childA, childB]) {
      const overview = result(await w.call(child, 'collab_read', { view: 'overview', spaceId: SPACE }))
      expect(overview.error).toBeUndefined()
      expect(JSON.stringify(overview)).not.toContain('大家看一下这个')
      const since = result(await w.call(child, 'collab_read', { view: 'since', spaceId: SPACE, sinceSeq: 0 }))
      expect(JSON.stringify(since)).not.toContain('大家看一下这个')
    }
    const own = result(await w.call(main, 'collab_read', { view: 'overview', spaceId: SPACE }))
    expect(JSON.stringify(own)).toContain('大家看一下这个')
  })

  it('routing-04：零 active child 时终态仍登记', async () => {
    const { w, proxy, main, childA, setLoci } = await setup([locus('rec-a', ALPHA, 'child-a')])
    const ra = await createRequest(w, childA, 'ra', 'todo-ra')
    expect(ra.error).toBeUndefined()
    const accepted = await w.call(main, 'collab_advance_request', { spaceId: SPACE, cmdId: 'acc', itemId: 'todo-ra', progress: 'accepted' }).then(result)
    expect(accepted.error).toBeUndefined()
    // The locus's last child retires: no active child remains for this main session.
    setLoci([locus('rec-a', ALPHA, 'child-a', 'retired')])
    w.unload('child-a')
    expect(proxy.childRoute('child-a')).toBeUndefined()

    const done = await w.call(main, 'collab_advance_request', { spaceId: SPACE, cmdId: 'done', itemId: 'todo-ra', progress: 'done' }).then(result)
    expect(done.error).toBeUndefined()
    await settle()

    expect(proxy.inbox().filter(entry => entry.seq === done.seq))
      .toEqual([expect.objectContaining({ subject: 'request-terminal', itemId: 'todo-ra', progress: 'done', route: { kind: 'locus', locusId: A, via: 'ref' } })])
    const overview = result(await w.call(main, 'collab_read', { view: 'overview', spaceId: SPACE }))
    expect(overview.presence?.pet).toBe('reachable')
    expect(w.counts.resolveAgent).toBe(0)
    expect(w.counts.followup).toBe(0)
  })
})
