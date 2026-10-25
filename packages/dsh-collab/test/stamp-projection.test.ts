import { describe, it, expect, afterEach } from 'vitest'
import { hostContext, start, call, callAs, settle, tempRoot, bytes, type Host } from './support/world.js'
import { captureHost, gate, ledger, records, events, service, SUBAGENT } from './support/integrator.js'

/**
 * Stamped managed callers (pet-locus-collab-integration D3): real plugin,
 * real Integrations handle and kernel; the integrator adapter is a stand-in
 * providing only resolveCaller/visible/recipients (plus the SPI basics).
 */
const world = (run: (host: Host) => Promise<void>) => tempRoot('collab-stamp-', async root => { const host = hostContext(root); try { await run(host) } finally { await host.stop() } })
let restore: (() => void) | undefined
afterEach(() => { restore?.(); restore = undefined })

const PURPOSE = '主会话 的 Locus：open 的待办等用户决定何时开工。'
const ADDRESS = 'pet:s1'
const stampOf = (locusId: string) => ({ pet: { locusId } })
/** Test routing for main → pet messages: a single `@<locusId>` in the body. */
const route = (body: string) => { const all = [...body.matchAll(/@([a-z0-9]+)/g)]; return all.length === 1 ? all[0]![1] : undefined }

function petAdapter(options: { visible?: boolean } = {}) {
  const bound = new Map<unknown, unknown>()
  const held = new Set([ADDRESS])
  const hooks: { presence?: () => Promise<void> } = {}
  const adapter: any = {
    recipients: ['main'],
    async claim(address: string) { return held.has(address) },
    holds(address: string) { return held.has(address) },
    async presence() { await hooks.presence?.(); return 'reachable' },
    async deliver() {},
    resolveCaller(agent: unknown) { return bound.has(agent) ? { address: ADDRESS, stamp: bound.get(agent) } : undefined },
  }
  if (options.visible !== false) adapter.visible = (stamp: any, subject: any) => {
    const mine = stamp.pet.locusId
    if (subject.kind === 'item') return subject.item.author === 'main' || subject.item.ext?.pet?.locusId === mine
    if (subject.kind === 'message') {
      const m = subject.message
      return m.ext?.pet?.locusId === mine || (m.actor === 'main' && m.to === 'pet' && route(m.body) === mine)
    }
    return subject.name === 'main'
  }
  return { adapter, bound, hooks }
}

/** main (session-a) leads `s`, grants pet-locus, the adapter admits `pet`; L is locus a, M is locus b. */
async function locusSpace(host: Host, options: { visible?: boolean } = {}) {
  const captured = captureHost(); restore = captured.restore
  host.session('session-a', { live: true })
  host.session('session-l', { live: true, header: SUBAGENT })
  host.session('session-m', { live: true, header: SUBAGENT })
  await start(host, { extra: { managedChannels: ['pet-locus'] } })
  const pet = petAdapter(options)
  const handle = service(host).attach('pet-locus', pet.adapter)
  const A = host.live.get('session-a')
  const established = await handle.establish({ agent: A }, 's', 'est', { name: 'main', purpose: PURPOSE })
  if ('error' in established) throw new Error(JSON.stringify(established))
  const admitted = await handle.admit('s', 'adm-pet', { name: 'pet', address: ADDRESS })
  if ('error' in admitted) throw new Error(JSON.stringify(admitted))
  const L = host.live.get('session-l'), M = host.live.get('session-m')
  pet.bound.set(L, stampOf('a')); pet.bound.set(M, stampOf('b'))
  await settle()
  const kernel: any = captured.seen.host!.service
  const calls = { count: 0 }
  for (const method of ['createItem', 'reviseItem', 'ackItem', 'sendMessage', 'setStatus', 'advanceRequest']) {
    const original = kernel[method].bind(kernel)
    kernel[method] = (...args: any[]) => { calls.count++; return original(...args) }
  }
  let n = 0
  const as = (agent: any) => {
    const tool = (name: string, args: Record<string, unknown>) => callAs(host, agent, name, args)
    const c = () => `k-${++n}`
    return {
      tool,
      create: (input: Record<string, unknown>, cmdId = c()) => tool('collab_create_item', { spaceId: 's', cmdId, title: 'T', body: 'original', requiredAcks: [], kind: 'other', ...input }),
      revise: (itemId: string, expectedRevision: number, changes: Record<string, unknown>, cmdId = c()) => tool('collab_revise_item', { spaceId: 's', cmdId, itemId, expectedRevision, changes }),
      ack: (itemId: string, revision: number, cmdId = c()) => tool('collab_ack_item', { spaceId: 's', cmdId, itemId, revision }),
      advance: (itemId: string, progress: string, cmdId = c()) => tool('collab_advance_request', { spaceId: 's', cmdId, itemId, progress }),
      send: (to: string, body: string, extra: Record<string, unknown> = {}, cmdId = c()) => tool('collab_send_message', { spaceId: 's', cmdId, to, body, ...extra }),
      setStatus: (text: string, cmdId = c()) => tool('collab_set_status', { spaceId: 's', cmdId, text }),
      overview: () => tool('collab_read', { view: 'overview', spaceId: 's' }),
      since: (sinceSeq = 0) => tool('collab_read', { view: 'since', spaceId: 's', sinceSeq }),
      status: async () => { const out = await tool('collab_status', {}); return { out, space: out.spaces?.find((s: any) => s.spaceId === 's') } },
    }
  }
  return { handle, pet, L, M, A, calls, main: as(A), l: as(L), m: as(M) }
}
const ok = (value: any) => { expect(value.error).toBeUndefined(); return value }
const itemIds = (overview: any) => Object.keys(overview.items).sort()
const sinceItems = (records: any[]) => records.flatMap(r => r.events).filter((e: any) => e.type === 'item/created').map((e: any) => e.item.id).sort()
const OVERVIEW_KEYS = ['spaceId', 'serviceId', 'status', 'leader', 'convention', 'purpose', 'lastSeq', 'members', 'items', 'messages', 'deliveries', 'pendingDeliveries', 'inFlightDeliveries', 'presence'].sort()

describe('托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间', () => {
  it('stamp-01：托管调用者写入带戳且 cmdId 带命名空间', () => world(async host => {
    const { l } = await locusSpace(host)
    const args = { spaceId: 's', cmdId: 'c-1', itemId: 'todo-1', kind: 'request', assignee: 'main', title: 'T', body: 'B', requiredAcks: [] }
    ok(await l.tool('collab_create_item', args))
    expect(Object.keys(args)).not.toContain('ext')
    const record = (await records(host, 's')).find((r: any) => r.events.some((e: any) => e.type === 'item/created'))
    expect(record.events.find((e: any) => e.type === 'item/created').item.ext).toEqual({ pet: { locusId: 'a' } })
    expect(record.receipt.cmdId).toMatch(/^[0-9a-f]{16}:c-1$/)
  }))

  it('stamp-02：不同戳的同名 cmdId 互不干扰', () => world(async host => {
    const { l, m } = await locusSpace(host)
    const a = ok(await l.setStatus('x', 's-1'))
    const b = ok(await m.setStatus('y', 's-1'))
    expect(b.seq).not.toBe(a.seq)
    const length = (await records(host, 's')).length
    expect(await l.setStatus('x', 's-1')).toEqual(a)
    expect((await records(host, 's')).length).toBe(length)
    expect((await events(host, 's')).filter((e: any) => e.type === 'member/statusText').map((e: any) => e.text)).toEqual(['x', 'y'])
  }))

  it('stamp-03：兄弟条目对读取不可见', () => world(async host => {
    const { main, l, m } = await locusSpace(host)
    ok(await main.create({ itemId: 'i0' }))
    ok(await l.create({ itemId: 'ia' }))
    const ib = ok(await m.create({ itemId: 'ib', kind: 'request', assignee: 'pet', requiredAcks: ['pet'] }))
    expect(itemIds(ok(await l.overview()))).toEqual(['i0', 'ia'])
    const since = ok(await l.since(0))
    expect(sinceItems(since)).toEqual(['i0', 'ia'])
    expect(since.find((r: any) => r.seq === ib.seq)).toEqual(expect.objectContaining({ seq: ib.seq, events: [] }))
    expect(since.map((r: any) => r.seq)).toEqual((await records(host, 's')).map((r: any) => r.seq))
    const { space } = await l.status()
    expect(space.pending).toEqual({ acks: [], replies: [], requests: [], hidden: 0 })
    expect(itemIds(ok(await main.overview()))).toEqual(['i0', 'ia', 'ib'])
    expect(sinceItems(ok(await main.since(0)))).toEqual(['i0', 'ia', 'ib'])
  }))

  it('stamp-04：公开记录引用隐藏记录仍能重放', () => world(async host => {
    const { main, l, m } = await locusSpace(host)
    const ib = ok(await m.create({ itemId: 'ib' }))
    ok(await main.create({ itemId: 'i0', ref: ib.seq }))
    expect(itemIds(ok(await l.overview()))).toEqual(['i0'])
    const { out } = await l.status()
    expect(out.error).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain('dangling')
  }))

  it('stamp-05：同一提交中的 dispatch 不泄露兄弟消息', () => world(async host => {
    const { l, m } = await locusSpace(host)
    const sent = ok(await m.send('main', 'from b', { needsReply: true }))
    const raw = (await records(host, 's')).find((r: any) => r.seq === sent.seq)
    const deliveryId = raw.events.find((e: any) => e.type === 'dispatch/intended').delivery.deliveryId
    const since = ok(await l.since(0))
    expect(since.find((r: any) => r.seq === sent.seq).events).toEqual([])
    expect(JSON.stringify(since)).not.toContain(deliveryId)
    const overview = ok(await l.overview())
    expect(JSON.stringify([overview.pendingDeliveries, overview.inFlightDeliveries, overview.deliveries])).not.toContain(deliveryId)
    await settle()
    expect(JSON.stringify(ok(await l.since(0)))).not.toContain(deliveryId)
  }))

  it('stamp-06：状态文本不能传话', () => world(async host => {
    const { l, m } = await locusSpace(host)
    ok(await l.setStatus('给 B 的话'))
    expect(ok(await m.overview()).members.pet.statusText).toBe('')
    const since = ok(await m.since(0))
    expect(since.flatMap((r: any) => r.events).some((e: any) => e.type === 'member/statusText')).toBe(false)
    expect(JSON.stringify(since)).not.toContain('给 B 的话')
  }))

  it('stamp-07：隐藏条目的标识不经任何字段泄露', () => world(async host => {
    const { main, l, m } = await locusSpace(host)
    ok(await m.create({ itemId: 'zq7-secret-marker' }))
    const overview = ok(await l.overview())
    const { out } = await l.status()
    expect(JSON.stringify(overview)).not.toContain('zq7-secret-marker')
    expect(JSON.stringify(out)).not.toContain('zq7-secret-marker')
    expect(Object.keys(overview).sort()).toEqual(OVERVIEW_KEYS)
    expect(Object.keys(ok(await main.overview()).itemSeq)).toContain('zq7-secret-marker')
  }))

  it('stamp-08：不能借主会话的公开条目传话', () => world(async host => {
    const { main, l, m, calls } = await locusSpace(host)
    ok(await main.create({ itemId: 'i0' }))
    await settle()
    const before = await bytes(ledger(host, 's')), count = calls.count
    expect(await l.revise('i0', 1, { body: '给 B 的话' })).toEqual({ error: { code: 'COLLAB_ITEM_NOT_FOUND' } })
    expect(calls.count).toBe(count)
    expect(await bytes(ledger(host, 's'))).toEqual(before)
    expect(ok(await m.overview()).items.i0.body).toBe('original')
  }))

  it('stamp-09：可以修订自己的条目', () => world(async host => {
    const { l } = await locusSpace(host)
    ok(await l.create({ itemId: 'ia' }))
    ok(await l.revise('ia', 1, { body: 'revised' }))
    const revised = (await events(host, 's')).find((e: any) => e.type === 'item/revised')
    expect(revised.item.ext).toEqual({ pet: { locusId: 'a' } })
    expect(revised.item.body).toBe('revised')
  }))

  it('stamp-10：主会话的条目对子会话只读', () => world(async host => {
    const { main, l, m, calls } = await locusSpace(host)
    const i1 = ok(await main.create({ itemId: 'i1', requiredAcks: ['pet'] }))
    ok(await main.create({ itemId: 'r1', kind: 'request', assignee: 'pet' }))
    await settle()
    const seenBefore = ok(await m.overview()).items
    expect(Object.keys(seenBefore).sort()).toEqual(['i1', 'r1'])
    const before = await bytes(ledger(host, 's')), count = calls.count
    expect(await l.ack('i1', 1)).toEqual({ error: { code: 'COLLAB_ITEM_NOT_FOUND' } })
    expect(await l.advance('r1', 'accepted')).toEqual({ error: { code: 'COLLAB_ITEM_NOT_FOUND' } })
    expect(await l.send('main', 'about i1', { ref: i1.seq })).toEqual({ error: { code: 'COLLAB_BAD_REF' } })
    expect(calls.count).toBe(count)
    expect(await bytes(ledger(host, 's'))).toEqual(before)
    expect(ok(await m.overview()).items).toEqual(seenBefore)
    for (const who of [l, m]) {
      const { out, space } = await who.status()
      expect(space.pending.acks).toEqual([])
      expect(space.pending.requests).toEqual([])
      expect(out.next.filter((n: any) => n.kind === 'ack' || n.kind === 'advance_request')).toEqual([])
    }
  }))

  it('stamp-11：可以引用主会话发给自己的消息', () => world(async host => {
    const { main, l, m, calls } = await locusSpace(host)
    const asked = ok(await main.send('pet', '@a please check', { needsReply: true }))
    await settle()
    ok(await l.send('main', 'checked', { ref: asked.seq, needsReply: true }))
    const count = calls.count
    expect(await m.send('main', 'checked', { ref: asked.seq, needsReply: true })).toEqual({ error: { code: 'COLLAB_BAD_REF' } })
    expect(calls.count).toBe(count)
  }))

  it('stamp-12：不同 Locus 新开独立话题不继承其它根的额度', () => world(async host => {
    const { l, m } = await locusSpace(host)
    const root = ok(await l.send('main', 'q-1', { needsReply: true }))
    for (let i = 2; i <= 20; i++) ok(await l.send('main', `q-${i}`, { needsReply: true, ref: root.seq }))
    expect(await l.send('main', 'q-21', { needsReply: true, ref: root.seq })).toEqual({ error: { code: 'COLLAB_THREAD_LIMIT' } })
    ok(await m.send('main', 'b-1', { needsReply: true }))
  }))

  it('stamp-13：成员计数不进投影', () => world(async host => {
    const { main, l, m } = await locusSpace(host)
    const before = ok(await main.overview()).members.main.wakeCount
    ok(await m.send('main', 'wake', { needsReply: true }))
    const full = ok(await main.overview()).members.main
    expect(full.wakeCount).toBe(before + 1)
    const projected = ok(await l.overview()).members.main
    expect(Object.keys(projected).sort()).toEqual(['binding', 'kind', 'name', 'status', 'statusText'])
    expect(Object.keys(projected.binding)).toEqual(['channel'])
  }))

  it('stamp-14：不能修改、确认或引用兄弟条目', () => world(async host => {
    const { l, m, calls } = await locusSpace(host)
    const ib = ok(await m.create({ itemId: 'ib', kind: 'request', assignee: 'pet', requiredAcks: ['pet'] }))
    await settle()
    const before = await bytes(ledger(host, 's')), count = calls.count
    for (const out of [await l.revise('ib', 5, { body: 'x' }), await l.ack('ib', 1), await l.advance('ib', 'accepted')]) {
      expect(out).toEqual({ error: { code: 'COLLAB_ITEM_NOT_FOUND' } })
    }
    expect(await l.create({ itemId: 'ia', ref: ib.seq })).toEqual({ error: { code: 'COLLAB_BAD_REF' } })
    expect(calls.count).toBe(count)
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))

  it('stamp-15：无权调用者拿不到旧收据', () => world(async host => {
    const { l, m } = await locusSpace(host)
    ok(await m.create({ itemId: 'ib' }))
    const revised = ok(await m.revise('ib', 1, { body: 'b' }, 'r-1'))
    const out = await l.revise('ib', 1, { body: 'b' }, 'r-1')
    expect(out).toEqual({ error: { code: 'COLLAB_ITEM_NOT_FOUND' } })
    expect(JSON.stringify(out)).not.toContain(String(revised.seq))
  }))

  it('stamp-16：带戳调用者只能发给 main', () => world(async host => {
    const { l, calls } = await locusSpace(host)
    const count = calls.count
    for (const to of ['pet', 'aily', 'b']) expect(await l.send(to, 'hi', { needsReply: true })).toEqual({ error: { code: 'COLLAB_BAD_RECIPIENT' } })
    expect(calls.count).toBe(count)
  }))

  it('stamp-17：戳在途变化时调用失效', () => world(async host => {
    const { l, L, pet } = await locusSpace(host)
    const g = gate()
    pet.hooks.presence = () => g.wait()
    await settle()
    const before = await bytes(ledger(host, 's'))
    const sending = l.send('main', 'in flight', { needsReply: true })
    await g.reached
    pet.bound.set(L, stampOf('b'))
    g.release()
    expect(JSON.stringify(await sending)).toBe('{"error":{"code":"COLLAB_CALLER_UNAVAILABLE"}}')
    await settle()
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))

  it('stamp-18：超长或非对象的戳视为未解析', () => world(async host => {
    const { l, L, pet } = await locusSpace(host)
    const long = { p: 'x'.repeat(1017) }
    expect(Buffer.byteLength(JSON.stringify(long))).toBe(1025)
    for (const stamp of [long, ['a'], 'a']) {
      pet.bound.set(L, stamp)
      for (const out of [await l.overview(), await l.setStatus('x'), (await l.status()).out]) expect(out).toEqual({ error: { code: 'COLLAB_CALLER_UNAVAILABLE' } })
    }
    // 1024 bytes is still a stamp.
    pet.bound.set(L, { p: 'x'.repeat(1016) })
    ok(await l.overview())
  }))

  it('stamp-19：不提供 visible 时不投影也不做写授权', () => world(async host => {
    const { main, l } = await locusSpace(host, { visible: false })
    ok(await main.create({ itemId: 'i0' }))
    await settle()
    const since = ok(await l.since(0))
    expect(since).toEqual((await records(host, 's')).map(({ sha256: _, ...record }: any) => record))
    ok(await l.revise('i0', 1, { body: 'changed' }))
    expect(ok(await main.overview()).items.i0.body).toBe('changed')
    expect(ok(await l.overview()).itemSeq).toBeDefined()
  }))
})

describe('托管调用者经句柄写入（接入方附加事实）', () => {
  it('stamp-h1：句柄写入合并戳且戳优先；带附加事实的条目对子会话只读', () => world(async host => {
    const { handle, L, l, calls } = await locusSpace(host)
    const created = await handle.command({ agent: L }, 's', 'track-1', { op: 'createItem', input: { itemId: 'todo-1', kind: 'request', assignee: 'main', title: 'T', body: 'B', requiredAcks: [], ext: { pet: { locusId: 'b', kind: 'todo', generation: 2 } } } })
    ok(created)
    const record = (await records(host, 's')).find((r: any) => r.seq === created.seq)
    expect(record.events[0].item.ext).toEqual({ pet: { locusId: 'a', kind: 'todo', generation: 2 } })
    expect(record.receipt.cmdId).toMatch(/^[0-9a-f]{16}:track-1$/)
    // Visible to its own locus, but not one of the child's own writes.
    expect(Object.keys(ok(await l.overview()).items)).toEqual(['todo-1'])
    const count = calls.count
    expect(await l.advance('todo-1', 'accepted')).toEqual({ error: { code: 'COLLAB_ITEM_NOT_FOUND' } })
    expect(calls.count).toBe(count)
    const read = await handle.read({ agent: L }, 's', 'overview')
    expect(Object.keys((read as any).items)).toEqual(['todo-1'])
    expect((read as any).itemSeq).toBeUndefined()
  }))
})

describe('接入方 visible 的同步查询（AMD-1）', () => {
  it('stamp-20：visible 可沿 ref 链查前序记录', () => world(async host => {
    const { pet, main, l, m } = await locusSpace(host)
    const lookups: { seq: number; record: any }[] = []
    /** Pet-like rule: main → pet messages follow `ref` to the nearest stamped record. */
    const nearest = (ref: unknown, lookup: any): string | undefined => {
      for (let seq = ref, hops = 0; typeof seq === 'number' && hops < 64; hops++) {
        const record = lookup.recordAt(seq)
        lookups.push({ seq, record })
        const subject = record?.kind === 'item' ? record.item : record?.kind === 'message' ? record.message : undefined
        if (!subject) return
        if (subject.ext?.pet?.locusId) return subject.ext.pet.locusId
        seq = subject.ref
      }
    }
    pet.adapter.visible = (stamp: any, subject: any, lookup: any) => {
      const mine = stamp.pet.locusId
      if (subject.kind === 'item') return subject.item.author === 'main' || subject.item.ext?.pet?.locusId === mine
      if (subject.kind === 'message') {
        const message = subject.message
        if (message.ext?.pet?.locusId === mine) return true
        return message.actor === 'main' && message.to === 'pet' && nearest(message.ref, lookup) === mine
      }
      return subject.name === 'main'
    }
    const ma = ok(await l.send('main', 'from a'))
    const reply = ok(await main.send('pet', 'answer without naming anyone', { needsReply: false, ref: ma.seq }))
    const has = (records: any[]) => records.some((r: any) => r.events.some((e: any) => e.type === 'message/sent' && e.message.id === String(reply.seq)))
    expect(has(ok(await l.since(0)))).toBe(true)
    expect(has(ok(await m.since(0)))).toBe(false)
    const seen = lookups.find(x => x.seq === ma.seq)
    expect(seen?.record).toMatchObject({ kind: 'message', message: { id: String(ma.seq), actor: 'pet', body: 'from a', ext: { pet: { locusId: 'a' } } } })
    // The same lookup serves write-target checks: only the routed locus may answer M.
    ok(await l.send('main', 'thanks', { ref: reply.seq }))
    expect(await m.send('main', 'thanks', { ref: reply.seq })).toEqual({ error: { code: 'COLLAB_BAD_REF' } })
  }))
})
