import { describe, it, expect, afterEach } from 'vitest'
import { hostContext, call, callAs, ops, settle, tempRoot, bytes, type Host } from './support/world.js'
import { captureHost, codeOf, events, gate, ledger, managedSpace, scriptedAdapter, service, SUBAGENT, type Scripted } from './support/integrator.js'

const world = (run: (host: Host) => Promise<void>) => tempRoot('collab-mcaller-', async root => { const host = hostContext(root); try { await run(host) } finally { await host.stop() } })
const UNAVAILABLE = { error: { code: 'COLLAB_CALLER_UNAVAILABLE' } }
let restore: (() => void) | undefined
afterEach(() => { restore?.(); restore = undefined })
const turns = async (until: () => boolean, max = 200) => { for (let i = 0; i < max && !until(); i++) await new Promise(resolve => setImmediate(resolve)) }

describe('工具调用者可解析为托管成员', () => {
  it('mcaller-01：受管子会话以托管成员身份写入', () => world(async host => {
    const { L } = await managedSpace(host)
    expect(L.session.header).toMatchObject({ origin: 'subagent', delegationDepth: 1 })
    const sent = await callAs(host, L, 'collab_send_message', { spaceId: 's', cmdId: 'm-1', to: 'aily', body: 'hello from locus' })
    expect(sent.error).toBeUndefined()
    const message = (await events(host, 's')).find((e: any) => e.type === 'message/sent')
    expect(message.actor).toBe('locus-a')
  }))

  it('mcaller-02：解除绑定后立即失去身份', () => world(async host => {
    const { L, scripted } = await managedSpace(host)
    expect((await callAs(host, L, 'collab_read', { view: 'overview', spaceId: 's' })).error).toBeUndefined()
    scripted.unbind(L)
    const out = await callAs(host, L, 'collab_read', { view: 'overview', spaceId: 's' })
    expect(out).toEqual(UNAVAILABLE)
    expect((await ops(host).overview('session-a', 's')).members['locus-a'].status).toBe('active')
  }))

  for (const [index, label] of ['接入方解除绑定', 'Host 换了 agent 对象', '会话被归档', '句柄 dispose 后重新 attach'].entries()) {
    it(`mcaller-03：在途调用在失效后不能完成（${index + 1}. ${label}）`, () => world(async host => {
      const { L, scripted, handle } = await managedSpace(host)
      const followups = host.followups.length
      const g = gate()
      let entered = 0
      scripted.hooks.presence = async () => { entered++; await g.wait() }
      const before = await bytes(ledger(host, 's'))
      const send = callAs(host, L, 'collab_send_message', { spaceId: 's', cmdId: 'm-run', to: 'aily', body: 'in flight', needsReply: true })
      const read = callAs(host, L, 'collab_read', { view: 'overview', spaceId: 's' })
      await turns(() => entered >= 2)
      expect(entered).toBe(2)
      let next: Scripted | undefined, replacement: any
      if (index === 0) scripted.unbind(L)
      if (index === 1) { replacement = host.makeAgent('session-l', L.session.header); host.live.set('session-l', replacement); scripted.bind(replacement, 'loc:1') }
      if (index === 2) host.archived.push('session-l')
      if (index === 3) { handle.dispose(); next = scriptedAdapter(); next.bind(L, 'loc:1'); service(host).attach('pet-locus', next.adapter) }
      g.release()
      expect(JSON.stringify(await send)).toBe('{"error":{"code":"COLLAB_CALLER_UNAVAILABLE"}}')
      expect(await read).toEqual(UNAVAILABLE)
      await settle()
      expect(await bytes(ledger(host, 's'))).toEqual(before)
      expect(host.followups.length).toBe(followups)
      if (index === 1) expect((await callAs(host, replacement, 'collab_send_message', { spaceId: 's', cmdId: 'm-new', to: 'aily', body: 'from A2' })).error).toBeUndefined()
      if (index === 3) expect((await callAs(host, L, 'collab_send_message', { spaceId: 's', cmdId: 'm-new', to: 'aily', body: 'via H2' })).error).toBeUndefined()
    }))
  }

  it('mcaller-04：状态入口在返回前重验', () => world(async host => {
    const captured = captureHost(); restore = captured.restore
    const { L, handle } = await managedSpace(host)
    const kernel: any = captured.seen.host!.service, original = kernel.readSince.bind(kernel)
    const g = gate()
    kernel.readSince = async (ctx: any, seq: number) => { if (ctx.principal.kind === 'internal') await g.wait(); return original(ctx, seq) }
    const status = callAs(host, L, 'collab_status', {})
    await g.reached
    handle.dispose()
    const next = scriptedAdapter(); next.bind(L, 'loc:1'); service(host).attach('pet-locus', next.adapter)
    g.release()
    expect(JSON.stringify(await status)).toBe('{"error":{"code":"COLLAB_CALLER_UNAVAILABLE"}}')
  }))

  it('mcaller-05：普通会话不能被接入方冒认', () => world(async host => {
    const { scripted } = await managedSpace(host)
    const A = host.live.get('session-a')
    scripted.bound.set(A, 'loc:9'); scripted.held.add('loc:9')
    const before = await bytes(ledger(host, 's'))
    for (const [name, args] of [['collab_read', { view: 'overview', spaceId: 's' }], ['collab_set_status', { spaceId: 's', cmdId: 'st-1', text: 'x' }], ['collab_status', {}], ['collab_space', { action: 'create', spaceId: 'n', cmdId: 'n-1', name: 'aily' }]] as const) {
      expect(await call(host, 'session-a', name, args)).toEqual(UNAVAILABLE)
    }
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))

  it('mcaller-06：排除名单与归档对托管调用者同样生效', async () => {
    for (const mode of ['archived', 'denied'] as const) {
      await world(async host => {
        const { L, scripted } = await managedSpace(host, mode === 'denied' ? { denySessionIds: ['session-l'] } : {})
        if (mode === 'archived') host.archived.push('session-l')
        const calls = scripted.calls.resolveCaller
        expect(await callAs(host, L, 'collab_read', { view: 'overview', spaceId: 's' })).toEqual(UNAVAILABLE)
        expect(await callAs(host, L, 'collab_status', {})).toEqual(UNAVAILABLE)
        expect(scripted.calls.resolveCaller).toBe(calls)
      })
    }
  })

  it('mcaller-07：未被认领的子会话仍被拒绝', () => world(async host => {
    const { scripted } = await managedSpace(host)
    host.session('session-m', { live: true, header: SUBAGENT })
    const before = await bytes(ledger(host, 's'))
    const calls = scripted.calls.resolveCaller
    expect(await call(host, 'session-m', 'collab_set_status', { spaceId: 's', cmdId: 'm-1', text: 'x' })).toEqual(UNAVAILABLE)
    expect(await call(host, 'session-m', 'collab_read', { view: 'overview', spaceId: 's' })).toEqual(UNAVAILABLE)
    expect(scripted.calls.resolveCaller).toBeGreaterThan(calls)
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))

  it('mcaller-08：托管调用者的状态入口', () => world(async host => {
    host.session('session-d')
    const { L } = await managedSpace(host, { allowedSessionIds: ['session-d'] })
    const asked = await ops(host).send('session-a', 's', 'locus-a', 'please answer', true)
    expect(asked.error).toBeUndefined()
    await settle()
    const out = await callAs(host, L, 'collab_status', {})
    expect(out.error).toBeUndefined()
    const space = out.spaces.find((s: any) => s.spaceId === 's')
    expect(space).toMatchObject({ spaceId: 's', self: 'locus-a', leader: 'aily' })
    expect(space.pending.replies).toContainEqual({ seq: asked.seq, from: 'aily' })
    expect(out.contacts).toEqual([])
  }))
})
