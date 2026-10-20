import { describe, it, expect } from 'vitest'
import { SessionAccess, SessionProvider } from '../src/session-provider.js'
const header = (id: string, extra = {}) => ({ id, cwd: `/work/${id}`, ...extra })
function fixture() {
  const live = new Map<string, any>()
  const headers = new Map<string, any>([['a', header('a')], ['b', header('b', { parentSession: 'ordinary-fork' })]])
  const archived: string[] = []
  const calls: any[] = []
  let resolve = async (id: string) => ({ agent: live.get(id) })
  const ctx: any = {
    agents: { get: (id: string) => live.get(id), isOwnedBy: () => false },
    sessions: { get: (id: string) => live.get(id)?.session },
    sessionQuery: { listSessions: async () => [...headers.values()].map(header => ({ header, live: false, persisted: true })), observeSession() { throw new Error('no content reads') } },
    workspaceRegistry: { archivedSessionIds: archived },
    sessionController: { resolveAgent: (id: string) => { calls.push(['resolve', id]); return resolve(id) } },
  }
  // Unit doubles intentionally implement only the consumed Agent surface;
  // concrete complete Agents are covered by controller-seams.
  const agent = (id: string, extra = {}): any => ({ id, session: { id, header: header(id, extra) }, followup: (message: any) => { calls.push(['followup', id, message]) } })
  const a = agent('a'); live.set('a', a)
  const access = new SessionAccess(ctx, { admission: 'allowlist', allowedSessionIds: ['a', 'b', 'missing', 'derived'], denySessionIds: [] })
  const provider = new SessionProvider(access)
  const member: any = { kind: 'agent', binding: { providerId: 'dsh-session', channel: 'dsh-session', address: 'b', capabilities: { confirm: false } } }
  const pointer: any = { spaceId: 's', toSeq: 1, counts: { message: 1, item: 0, decision: 0, member: 0 }, from: 'a', title: 'SECRET_TITLE', body: 'SECRET_BODY' }
  return { ctx, live, headers, archived, calls, access, provider, member, pointer, a, agent, resolver: (next: typeof resolve) => { resolve = next } }
}
describe('exact session trust and delivery', () => {
  it('session-identity: caller must match session ID, allowlist, origin and actual ownership', async () => {
    const f = fixture()
    expect(await f.access.caller({ agent: f.a })).toBe('a')
    for (const agent of [undefined, f.agent('outside'), { ...f.a, id: 'b' }]) {
      expect(() => f.access.caller({ agent })).toThrow('COLLAB_CALLER_UNAVAILABLE')
    }
    for (const extra of [{ origin: 'subagent' }, { delegationDepth: 1 }, { parentSession: 'parent' }]) {
      const managed = f.agent('a', extra)
      f.live.set('a', managed)
      f.live.set('parent', f.agent('parent'))
      f.ctx.agents.isOwnedBy = () => true
      expect(() => f.access.caller({ agent: managed })).toThrow('COLLAB_CALLER_UNAVAILABLE')
    }
    f.live.set('a', f.a)
    f.ctx.agents.isOwnedBy = () => false
    f.archived.push('a')
    expect(() => f.access.caller({ agent: f.a })).toThrow('COLLAB_CALLER_UNAVAILABLE')
  })
  it('session-registry: unregistered, removed and replaced caller handles are rejected', () => {
    const f = fixture()
    expect(() => f.access.caller({ agent: f.agent('a') })).toThrow('COLLAB_CALLER_UNAVAILABLE')
    f.live.delete('a')
    expect(() => f.access.caller({ agent: f.a })).toThrow('COLLAB_CALLER_UNAVAILABLE')
    const replacement = f.agent('a')
    f.live.set('a', replacement)
    expect(() => f.access.caller({ agent: f.a })).toThrow('COLLAB_CALLER_UNAVAILABLE')
    expect(f.access.caller({ agent: replacement })).toBe('a')
  })
  it('session-discovery: only allowlisted exact headers, ordinary forks allowed, no content or activation', async () => {
    const f = fixture()
    f.headers.set('derived', header('derived', { origin: 'subagent' }))
    f.headers.set('outside', header('outside'))
    let forbiddenReads = 0, headerReads = 0
    const forbidden = () => { forbiddenReads++; throw new Error('content API is forbidden') }
    f.ctx.sessionController.inspect = forbidden
    f.ctx.sessionQuery.observeSession = forbidden
    f.ctx.sessions.readTitleSnapshots = forbidden
    f.ctx.sessionQuery.listSessions = async () => {
      headerReads++
      return [...f.headers.values()].map(header => ({ header, get events() { return forbidden() }, get messages() { return forbidden() }, get title() { return forbidden() } }))
    }
    const list = await f.access.contacts('self')
    expect(list).toEqual([{ sessionId: 'a', cwd: '/work/a' }, { sessionId: 'b', cwd: '/work/b' }])
    expect((await f.access.contacts('a')).map(x => x.sessionId)).toEqual(['b'])
    expect(headerReads).toBeGreaterThan(0)
    expect(forbiddenReads).toBe(0)
    expect(f.calls).toEqual([])
    expect(await f.provider.claim('b', 'agent')).not.toBeNull()
    for (const [id, kind] of [['b', 'human'], ['missing', 'agent'], ['derived', 'agent'], ['outside', 'agent'], ['b-prefix', 'agent']]) expect(await f.provider.claim(id, kind as any)).toBeNull()
    expect(await f.provider.presence({ ...f.member, binding: { ...f.member.binding, address: 'missing' } })).toBe('unknown')
    f.archived.push('b')
    expect(await f.provider.presence(f.member)).toBe('unreachable')
  })
  it('session-cold-race: publishing a managed live handle while enumerating invalidates old ordinary headers', async () => {
    const f = fixture()
    let release!: (value: any) => void
    f.ctx.sessionQuery.listSessions = () => new Promise(resolve => { release = resolve })
    const pending = f.provider.claim('b', 'agent')
    f.live.set('b', f.agent('b', { origin: 'subagent' }))
    release([{ header: header('b') }])
    expect(await pending).toBeNull()
  })
  it('session-cold-presence: exact persisted header stays unknown without activating and no registry write occurs', async () => {
    const f = fixture()
    expect(f.live.has('b')).toBe(false)
    expect(await f.provider.presence(f.member)).toBe('unknown')
    expect(f.calls).toEqual([])
    expect(f.live.has('b')).toBe(false)
  })
  it('session-unknown: absent, unreadable and malformed enumeration never permits restore or followup', async () => {
    for (const enumerate of [async () => [], async () => { throw new Error('backend unavailable') }, async () => [{ header: null }], async () => [{ header: { id: 'different' } }]]) {
      const f = fixture()
      f.ctx.sessionQuery.listSessions = enumerate
      expect(await f.provider.presence(f.member)).toBe('unknown')
      expect(await f.provider.claim('b', 'agent')).toBeNull()
      await expect(f.provider.deliver(f.member, f.pointer)).rejects.toMatchObject({ code: 'COLLAB_SESSION_UNAVAILABLE' })
      expect(f.calls).toEqual([])
    }
  })
  it('session-delivery: no body/title, fixed plugin source, returns without waiting whenIdle', async () => {
    const f = fixture()
    f.live.set('b', f.agent('b'))
    await f.provider.deliver(f.member, f.pointer)
    const [kind, id, message] = f.calls.at(-1)
    expect([kind, id]).toEqual(['followup', 'b'])
    expect(message.source.kind).toBe('plugin:dsh-collab')
    expect(typeof message.id).toBe('string')
    expect(JSON.stringify(message)).not.toMatch(/SECRET_TITLE|SECRET_BODY/)
    expect(JSON.stringify(message)).toContain('不是额外授权')
  })
  it('session-races: archive/close after live header observation and replacement handle cannot pass', async () => {
    const f = fixture()
    f.live.set('b', f.agent('b'))
    const presence = f.provider.presence(f.member)
    f.archived.push('b')
    expect(await presence).toBe('unreachable')
    f.archived.length = 0
    const claim = f.provider.claim('b', 'agent')
    f.archived.push('b')
    expect(await claim).toBeNull()
    f.archived.length = 0
    const delivery = f.provider.deliver(f.member, f.pointer)
    f.archived.push('b')
    await expect(delivery).rejects.toMatchObject({ code: 'COLLAB_SESSION_UNAVAILABLE' })
    expect(f.calls.some(x => x[0] === 'resolve')).toBe(false)
    const g = fixture(), old = g.agent('b')
    g.live.set('b', old)
    const original = g.access.header.bind(g.access)
    let reads = 0
    g.access.header = async id => {
      const h = await original(id)
      if (++reads === 2) g.live.set('b', g.agent('b'))
      return h
    }
    await expect(g.provider.deliver(g.member, g.pointer)).rejects.toMatchObject({ code: 'COLLAB_SESSION_UNAVAILABLE' })
    expect(g.calls.some(x => x[0] === 'followup')).toBe(false)
  })
  it('session-late: close, changed ID, archive and missing identity must fence followup', async () => {
    const f = fixture()
    let release!: (value: any) => void
    f.resolver(() => new Promise(resolve => { release = resolve }))
    const pending = f.provider.deliver(f.member, f.pointer)
    for (let turn = 0; !release && turn < 20; turn++) await new Promise(resolve => setImmediate(resolve))
    expect(release).toBeTypeOf('function')
    f.provider.close()
    release({ agent: f.agent('b') })
    await expect(pending).rejects.toMatchObject({ code: 'COLLAB_SERVICE_CLOSING' })
    expect(f.calls.some(x => x[0] === 'followup')).toBe(false)
    const archived = fixture()
    let resume!: (value: any) => void, entered!: () => void
    const resolving = new Promise<void>(resolve => { entered = resolve })
    archived.resolver(() => { entered(); return new Promise(resolve => { resume = resolve }) })
    const old = archived.provider.deliver(archived.member, archived.pointer)
    await resolving
    archived.archived.push('b')
    resume({ agent: archived.agent('b') })
    await expect(old).rejects.toMatchObject({ code: 'COLLAB_SESSION_UNAVAILABLE' })
    expect(archived.calls.some(x => x[0] === 'followup')).toBe(false)
    const g = fixture()
    g.resolver(async () => ({ agent: g.agent('wrong') }))
    await expect(g.provider.deliver(g.member, g.pointer)).rejects.toMatchObject({ code: 'COLLAB_SESSION_UNAVAILABLE' })
    const wrongSession = fixture()
    const mismatched = wrongSession.agent('b'); mismatched.session.id = 'different'
    wrongSession.resolver(async () => ({ agent: mismatched }))
    await expect(wrongSession.provider.deliver(wrongSession.member, wrongSession.pointer)).rejects.toMatchObject({ code: 'COLLAB_SESSION_UNAVAILABLE' })
    expect(wrongSession.calls.some(x => x[0] === 'followup')).toBe(false)
    g.headers.delete('b')
    await expect(g.provider.deliver(g.member, g.pointer)).rejects.toMatchObject({ code: 'COLLAB_SESSION_UNAVAILABLE' })
    expect(g.calls.some(x => x[0] === 'followup')).toBe(false)
  })
})

// ---- dsh-collab-invite-admission: admission, claim and wake (real apply()) ----
import { hostContext, start, call, ops, settle, tempRoot, bytes, exists, type Host } from './support/world.js'
import { join as pathJoin } from 'node:path'
const codeOf = async (run: Promise<any>) => { try { const value = await run; return value?.error?.code ?? 'OK' } catch (error: any) { return error?.code ?? 'THROWN' } }
const ledger = (host: Host, spaceId: string) => pathJoin(host.root, 'data', `${spaceId}.jsonl`)
const records = async (host: Host, spaceId: string) => ((await bytes(ledger(host, spaceId)))?.toString() ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const world = (run: (host: Host) => Promise<void>) => tempRoot('collab-admit-', async root => { const host = hostContext(root); try { await run(host) } finally { await host.stop() } })

describe('invite admission', () => {
  it('admit-01：跨 workspace 调用仍归属实际会话', () => world(async host => {
    host.session('session-a', { live: true, header: { cwd: pathJoin(host.root, 'ws-a') } }); host.session('session-b', { live: true, header: { cwd: pathJoin(host.root, 'ws-b') } })
    await start(host); const op = ops(host)
    expect((await op.create('session-a', 's', 'a')).seq).toBe(1)
    await op.invite('session-a', 's', 'b', 'session-b'); await settle(); await op.join('session-b', 's')
    await op.setStatus('session-b', 's', 'from b')
    const last = (await records(host, 's')).filter(r => r.kind === 'command').at(-1)
    expect(last.events.find((e: any) => e.type === 'member/statusText').actor).toBe('b')
    expect(host.live.get('session-b').session.header.cwd).toBe(pathJoin(host.root, 'ws-b'))
    expect(host.live.get('session-b').session.header.parentSession).toBeUndefined()
  }))
  it('admit-02：参数伪造身份被拒绝', () => world(async host => {
    host.session('session-a', { live: true }); await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a'); const before = await bytes(ledger(host, 's'))
    for (const extra of [{ actor: 'x' }, { principal: { kind: 'internal' } }, { sessionId: 'session-b' }, { providerId: 'p' }]) {
      expect(await codeOf(call(host, 'session-a', 'collab_set_status', { spaceId: 's', cmdId: 'forged', text: 'x', ...extra }))).toBe('COLLAB_BAD_ARGUMENTS')
    }
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))
  it('admit-03：无调用会话不能访问', () => world(async host => {
    host.session('session-a', { live: true }); await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a')
    expect(await codeOf(call(host, undefined, 'collab_space', { action: 'create', spaceId: 'n', cmdId: 'c', name: 'a' }))).toBe('COLLAB_CALLER_UNAVAILABLE')
    expect(await codeOf(op.overview(undefined as never, 's'))).toBe('COLLAB_CALLER_UNAVAILABLE')
    expect(await exists(ledger(host, 'n'))).toBe(false)
  }))
  it('admit-04：邀请模式下未配置名单的普通会话可建空间', () => world(async host => {
    host.session('session-a', { live: true })
    const config = { admission: 'invite', allowedSessionIds: [] as string[] }
    await start(host, config); const op = ops(host)
    expect(await op.create('session-a', 's', 'a')).toEqual({ seq: 1, spaceId: 's' })
    expect((await op.overview('session-a', 's')).leader).toBe('a')
    expect(config).toEqual({ admission: 'invite', allowedSessionIds: [] })
  }))
  it('admit-05：排除名单与派生会话不可调用', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-p', { live: true }); host.session('session-s', { live: true, header: { origin: 'subagent', delegationDepth: 1 } })
    await start(host, { denySessionIds: ['session-p'] }); const op = ops(host)
    await op.create('session-a', 's', 'a'); const before = await bytes(ledger(host, 's'))
    for (const id of ['session-p', 'session-s']) {
      expect(await codeOf(op.create(id, `own-${id}`, 'x'))).toBe('COLLAB_CALLER_UNAVAILABLE')
      expect(await codeOf(op.setStatus(id, 's', 'x'))).toBe('COLLAB_CALLER_UNAVAILABLE')
      expect(await codeOf(op.overview(id, 's'))).toBe('COLLAB_CALLER_UNAVAILABLE')
      expect(await exists(ledger(host, `own-${id}`))).toBe(false)
    }
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))
  it('admit-06：兼容模式保持首版行为', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-c', { live: true })
    await start(host, { admission: 'allowlist', allowedSessionIds: ['session-a'] }); const op = ops(host)
    await op.create('session-a', 's', 'a')
    expect(await codeOf(op.create('session-c', 'c-space', 'c'))).toBe('COLLAB_CALLER_UNAVAILABLE')
    expect(await codeOf(op.invite('session-a', 's', 'c', 'session-c'))).toBe('COLLAB_ADDRESS_UNCLAIMED')
    const state = await op.overview('session-a', 's')
    expect(Object.keys(state.members)).toEqual(['a']); expect(state.deliveries).toEqual({})
  }))
  it('admit-07：非法配置拒绝启动', async () => {
    for (const extra of [{ admission: 'open' }, { allowedSessionIds: ['x'], denySessionIds: ['x'] }, { denySessionIds: [''] }, { denySessionIds: ['y', 'y'] }]) {
      await tempRoot('collab-admit-', async root => {
        const host = hostContext(root)
        const dataDir = pathJoin(root, 'never')
        await expect(start(host, { extra }, dataDir)).rejects.toMatchObject({ code: 'COLLAB_BAD_CONFIG' })
        expect(host.tools.size).toBe(0)
        expect(await exists(dataDir)).toBe(false)
      })
    }
  })
})

describe('claim by exact identity', () => {
  it('claim-01：邀请即授权且无需重启', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b-cold')
    const config = { admission: 'invite' }
    await start(host, config); const op = ops(host)
    await op.create('session-a', 's', 'a')
    expect((await op.invite('session-a', 's', 'b', 'session-b-cold')).seq).toBe(2)
    await settle()
    expect(host.followups.filter(f => f.id === 'session-b-cold')).toHaveLength(1)
    expect((await op.join('session-b-cold', 's')).seq).toBeGreaterThan(2)
    expect((await op.setStatus('session-b-cold', 's', 'joined')).error).toBeUndefined()
    expect((await op.overview('session-b-cold', 's')).members.b.status).toBe('active')
    expect(config).toEqual({ admission: 'invite' })
  }))
  it('claim-02：被邀请不等于可读', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b', { live: true })
    await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a'); await op.invite('session-a', 's', 'b', 'session-b'); await settle()
    const read = await op.overview('session-b', 's')
    expect(read).toEqual({ error: { code: 'COLLAB_MEMBER_INACTIVE' } })
    expect((await op.overview('session-a', 's')).members.b.status).toBe('invited')
    expect((await records(host, 's')).flatMap(r => r.events).some((e: any) => e.type === 'member/joined' && e.member.name === 'b')).toBe(false)
  }))
  it('claim-03：短前缀不能邀请', () => world(async host => {
    host.session('session-a', { live: true }); host.session('shared-prefix-1'); host.session('shared-prefix-2')
    await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a')
    expect(await codeOf(op.invite('session-a', 's', 'b', 'shared-prefix'))).toBe('COLLAB_ADDRESS_UNCLAIMED')
    const state = await op.overview('session-a', 's')
    expect(Object.keys(state.members)).toEqual(['a']); expect(state.deliveries).toEqual({})
  }))
  it('claim-04：不认领人或受管子代理', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-deny'); host.session('session-sub', { header: { origin: 'subagent' } })
    await start(host, { denySessionIds: ['session-deny'] }); const op = ops(host)
    await op.create('session-a', 's', 'a')
    for (const id of ['session-missing', 'session-deny', 'session-sub']) expect(await codeOf(op.invite('session-a', 's', 'x', id))).toBe('COLLAB_ADDRESS_UNCLAIMED')
    const access = new SessionAccess(host.ctx, { admission: 'invite', allowedSessionIds: [], denySessionIds: ['session-deny'] })
    expect(await new SessionProvider(access).claim('session-a', 'human')).toBeNull()
    await settle()
    expect(host.counts.resolveAgent).toBe(0); expect(host.counts.followup).toBe(0)
    expect(Object.keys((await op.overview('session-a', 's')).members)).toEqual(['a'])
  }))
  it('claim-07：名单外会话不可访问', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-c', { live: true })
    await start(host, { admission: 'allowlist', allowedSessionIds: ['session-a'] }); const op = ops(host)
    await op.create('session-a', 's', 'a'); const before = await bytes(ledger(host, 's'))
    expect(await codeOf(op.overview('session-c', 's'))).toBe('COLLAB_CALLER_UNAVAILABLE')
    expect(await codeOf(op.setStatus('session-c', 's', 'x'))).toBe('COLLAB_CALLER_UNAVAILABLE')
    expect(await codeOf(op.invite('session-a', 's', 'c', 'session-c'))).toBe('COLLAB_ADDRESS_UNCLAIMED')
    expect(await bytes(ledger(host, 's'))).toEqual(before)
    // No tool can change the lists: every tool schema lacks list fields.
    for (const tool of host.tools.values()) expect(JSON.stringify(tool)).not.toMatch(/allowedSessionIds|denySessionIds/)
  }))
  it('claim-08：冷会话被发现但不激活', () => world(async host => {
    host.session('session-b', { live: true }); host.session('session-d-cold')
    await start(host, { allowedSessionIds: ['session-d-cold'] })
    const out = await ops(host).status('session-b')
    expect(out.contacts).toEqual([{ sessionId: 'session-d-cold', cwd: host.headers.get('session-d-cold')!.cwd }])
    expect(host.counts.resolveAgent).toBe(0); expect(host.counts.followup).toBe(0)
    expect(host.counts.observeSession).toBe(0); expect(host.counts.inspect).toBe(0)
  }))
  it('claim-05：冷核验只读元数据', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b-cold'); host.session('session-other', { header: { cwd: '/secret/other-cwd' } })
    await start(host); const op = ops(host)
    // Exact claim step in isolation: header metadata only.
    const access = new SessionAccess(host.ctx, { admission: 'invite', allowedSessionIds: [], denySessionIds: [] })
    expect(await new SessionProvider(access).claim('session-b-cold', 'agent')).not.toBeNull()
    expect({ observe: host.counts.observeSession, inspect: host.counts.inspect, resolve: host.counts.resolveAgent }).toEqual({ observe: 0, inspect: 0, resolve: 0 })
    await op.create('session-a', 's', 'a')
    const invited = await op.invite('session-a', 's', 'b', 'session-b-cold')
    expect(invited.seq).toBe(2)
    expect(JSON.stringify(invited)).not.toMatch(/session-other|other-cwd/)
    expect({ observe: host.counts.observeSession, inspect: host.counts.inspect }).toEqual({ observe: 0, inspect: 0 })
    await settle()
  }))
  it('claim-06：元数据列表不可用时不认领', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b-cold')
    await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a')
    host.failMetadata()
    expect(await codeOf(op.invite('session-a', 's', 'b', 'session-b-cold'))).toBe('COLLAB_ADDRESS_UNCLAIMED')
    const state = await op.overview('session-a', 's')
    expect(Object.keys(state.members)).toEqual(['a']); expect(state.deliveries).toEqual({})
  }))
})

describe('wake admission', () => {
  it('wake-03：不满足准入条件的目标不投递', () => tempRoot('collab-admit-', async root => {
    let host = hostContext(root)
    host.session('session-a', { live: true }); host.session('session-b', { live: true })
    await start(host); let op = ops(host)
    await op.create('session-a', 's', 'a'); await op.invite('session-a', 's', 'b', 'session-b'); await settle(); await op.join('session-b', 's')
    await settle(); await host.stop()
    // Operator adds B to denySessionIds, then build + restart: a fresh Host.
    host = hostContext(root)
    host.session('session-a', { live: true }); host.session('session-b', { live: true })
    try {
      await start(host, { denySessionIds: ['session-b'] }); op = ops(host)
      const before = (await records(host, 's')).length
      expect((await op.send('session-a', 's', 'b', 'please reply', true)).seq).toBeGreaterThan(before)
      await settle()
      expect(host.counts.resolveAgent).toBe(0); expect(host.followups).toHaveLength(0)
      const outcomes = (await records(host, 's')).flatMap(r => r.events).filter((e: any) => e.type === 'dispatch/completed' && e.outcome === 'succeeded')
      const intended = (await records(host, 's')).slice(before).flatMap(r => r.events).filter((e: any) => e.type === 'dispatch/intended' && e.delivery.member === 'b')
      for (const i of intended) expect(outcomes.some((o: any) => o.deliveryId === i.delivery.deliveryId)).toBe(false)
      const provider = new SessionProvider(new SessionAccess(host.ctx, { admission: 'invite', allowedSessionIds: [], denySessionIds: ['session-b'] }))
      await expect(provider.deliver({ name: 'b', kind: 'agent', binding: { channel: 'dsh-session', address: 'session-b', supports: { wake: true, confirm: false } } } as any, { spaceId: 's', toSeq: 9, counts: { message: 1, item: 0, decision: 0, member: 0 }, from: 'a' })).rejects.toMatchObject({ code: 'COLLAB_SESSION_UNAVAILABLE' })
      expect(host.counts.resolveAgent).toBe(0); expect(host.followups).toHaveLength(0)
    } finally { await host.stop() }
  }))
})

describe('cold restore and delivery', () => {
  const bMember: any = { name: 'b', kind: 'agent', binding: { channel: 'dsh-session', address: 'session-b', supports: { wake: true, confirm: false } } }
  const pointer: any = { spaceId: 's', toSeq: 2, counts: { message: 0, item: 0, decision: 0, member: 1 }, from: 'a', invited: true, title: 'SECRET_TITLE', body: 'SECRET_BODY' }
  const provider = (host: Host, deny: string[] = []) => new SessionProvider(new SessionAccess(host.ctx, { admission: 'invite', allowedSessionIds: [], denySessionIds: deny }))
  it('cold-02：邀请模式下名单外冷会话可投递', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b')
    await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a'); await op.invite('session-a', 's', 'b', 'session-b'); await settle()
    expect(host.counts.resolveAgent).toBe(1)
    const received = host.followups.filter(f => f.id === 'session-b')
    expect(received).toHaveLength(1)
    expect(received[0]!.message.content.map((c: any) => c.text).join('')).toContain('"invited":true')
  }))
  it('cold-03：presence不触发恢复', () => world(async host => {
    host.session('session-b')
    expect(await provider(host).presence(bMember)).toBe('unknown')
    expect(host.counts.resolveAgent).toBe(0); expect(host.followups).toHaveLength(0); expect(host.live.has('session-b')).toBe(false)
  }))
  it('cold-04：枚举缺失不能证明删除', () => world(async host => {
    for (const mode of ['missing', 'throws']) {
      if (mode === 'throws') { host.session('session-b'); host.failMetadata() }
      expect(await provider(host).presence(bMember)).toBe('unknown')
      await expect(provider(host).deliver(bMember, pointer)).rejects.toMatchObject({ code: 'COLLAB_SESSION_UNAVAILABLE' })
      expect(host.counts.resolveAgent).toBe(0); expect(host.followups).toHaveLength(0)
    }
  }))
  it('cold-05：恢复期间被归档不晚发', () => world(async host => {
    host.session('session-b')
    let release!: () => void, entered!: () => void
    const resolving = new Promise<void>(resolve => { entered = resolve })
    const original = host.defaultResolver()
    host.setResolver(async id => { entered(); await new Promise<void>(resolve => { release = resolve }); return original(id) })
    const pending = provider(host).deliver(bMember, pointer)
    await resolving
    host.archived.push('session-b')
    release()
    await expect(pending).rejects.toMatchObject({ code: 'COLLAB_SESSION_UNAVAILABLE' })
    expect(host.followups).toHaveLength(0); expect(host.counts.resolveAgent).toBe(1)
  }))
  it('cold-06：排除名单变更经重启生效且不晚发', () => tempRoot('collab-admit-', async root => {
    let host = hostContext(root)
    host.session('session-a', { live: true }); host.session('session-b')
    let release!: () => void, entered!: () => void
    const resolving = new Promise<void>(resolve => { entered = resolve })
    const original = host.defaultResolver()
    host.setResolver(async id => { entered(); await new Promise<void>(resolve => { release = resolve }); return original(id) })
    await start(host); let op = ops(host)
    await op.create('session-a', 's', 'a'); await op.invite('session-a', 's', 'b', 'session-b')
    await resolving
    // Operator edits denySessionIds, dsh build, dsh restart: the old instance stops first.
    await host.stop()
    release(); await settle()
    expect(host.followups).toHaveLength(0)
    const old = (await records(host, 's')).flatMap(r => r.events)
    expect(old.some((e: any) => e.type === 'dispatch/completed')).toBe(false)
    const fresh = hostContext(root)
    fresh.session('session-a', { live: true }); fresh.session('session-b', { live: true })
    try {
      await start(fresh, { denySessionIds: ['session-b'] }); op = ops(fresh)
      const state = await op.overview('session-a', 's')
      expect(state.pendingDeliveries.map((d: any) => d.member)).toEqual(['b'])
      await settle()
      expect(fresh.counts.resolveAgent).toBe(0); expect(fresh.followups).toHaveLength(0)
      expect(await codeOf(op.join('session-b', 's'))).toBe('COLLAB_CALLER_UNAVAILABLE')
      host = fresh
    } finally { await fresh.stop() }
  }))
  it('cold-07：关闭时未结束恢复不晚发', () => world(async host => {
    host.session('session-b')
    let release!: () => void, entered!: () => void
    const resolving = new Promise<void>(resolve => { entered = resolve })
    const original = host.defaultResolver()
    host.setResolver(async id => { entered(); await new Promise<void>(resolve => { release = resolve }); return original(id) })
    const p = provider(host)
    const pending = p.deliver(bMember, pointer)
    await resolving
    p.close(); release()
    await expect(pending).rejects.toMatchObject({ code: 'COLLAB_SERVICE_CLOSING' })
    expect(host.followups).toHaveLength(0)
  }))
  it('wake-04：邀请指针不能读取空间', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b', { live: true })
    await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a'); await op.invite('session-a', 's', 'b', 'session-b'); await settle()
    const pointer = host.followups.find(f => f.id === 'session-b')!.message.content.map((c: any) => c.text).join('')
    expect(pointer).toContain('"invited":true')
    expect(await op.overview('session-b', 's')).toEqual({ error: { code: 'COLLAB_MEMBER_INACTIVE' } })
    expect(await call(host, 'session-b', 'collab_read', { view: 'since', spaceId: 's', sinceSeq: 0 })).toEqual({ error: { code: 'COLLAB_MEMBER_INACTIVE' } })
    expect((await op.overview('session-a', 's')).members.b.status).toBe('invited')
    const events = (await records(host, 's')).flatMap(r => r.events).map((e: any) => e.type)
    expect(events.filter((t: string) => t === 'member/joined')).toHaveLength(1)
  }))
  it('wake-02：空闲目标收到带来源指针', () => world(async host => {
    host.session('session-b', { live: true })
    await provider(host).deliver(bMember, pointer)
    const [received] = host.followups
    expect(received!.message.source.kind).toBe('plugin:dsh-collab')
    const text = received!.message.content.map((c: any) => c.text).join('')
    expect(text).toContain('collab_status')
    expect(text).toContain(JSON.stringify({ spaceId: 's', toSeq: 2, counts: { message: 0, item: 0, decision: 0, member: 1 }, from: 'a', invited: true }))
    expect(JSON.stringify(received!.message)).not.toMatch(/SECRET_TITLE|SECRET_BODY/)
  }))
})
