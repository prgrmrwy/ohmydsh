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
  const access = new SessionAccess(ctx, ['a', 'b', 'missing', 'derived'])
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
    const list = await f.access.discover()
    expect(list.map(x => x.id)).toEqual(['a', 'b'])
    expect(list).toEqual([{ id: 'a', cwd: '/work/a' }, { id: 'b', cwd: '/work/b' }])
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
