import { describe, expect, it, vi } from 'vitest'
import { createCollaborationHostIdentity } from '../src/host/collaboration/host-identity.js'

function fixture() {
  const events = [{ type: 'assistant/message', data: { secret: 'must not inspect transcript' } }]
  const inspect = vi.fn(async (_id: string): Promise<unknown> => ({
    meta: { id: 'child', parentSession: 'main' },
    get events() { throw new Error(`do not read events ${events.length}`) },
  }))
  const archive: string[] = []
  const workspaceRegistry = { get archivedSessionIds() { return archive } }
  return { inspect, archive, identity: createCollaborationHostIdentity({ sessionController: { inspect }, workspaceRegistry }) }
}

describe('production-shaped collaboration cold identity adapter', () => {
  it('reads only cold meta and never needs a live Agent, workspace list or transcript', async () => {
    const f = fixture()
    expect(await f.identity.inspect('child')).toEqual({ id: 'child', parentSessionId: 'main' })
    expect(f.inspect).toHaveBeenCalledExactlyOnceWith('child')
  })

  it('accepts an exact root meta and strips unneeded fields', async () => {
    const f = fixture()
    f.inspect.mockResolvedValue({ meta: { id: 'main', path: '/private/log', origin: 'user' }, events: [] })
    const result = await f.identity.inspect('main')
    expect(result).toEqual({ id: 'main' })
    expect(Object.isFrozen(result)).toBe(true)
  })

  it.each([
    undefined, null, {}, { header: { id: 'child', parentSession: 'main' } },
    { meta: { id: 'other' } }, { meta: { id: 'child', parentSession: null } },
    { meta: { id: 'child', parentSession: '' } }, { meta: { id: 'child', parentSession: ' main' } },
    { meta: { id: 'child', parentSession: 'child' } },
  ])('does not guess identity from malformed inspection %j', async value => {
    const f = fixture()
    f.inspect.mockResolvedValue(value)
    expect(await f.identity.inspect('child')).toBeUndefined()
  })

  it('does not read missing/corrupt storage through a live fallback', async () => {
    const f = fixture()
    f.inspect.mockRejectedValue(new Error('unreadable secret session path'))
    expect(await f.identity.inspect('child')).toBeUndefined()
  })

  it('does not accept archived identities even when cold meta is readable', async () => {
    const f = fixture()
    f.archive.push('child')
    expect(f.identity.isArchived('child')).toBe(true)
    expect(await f.identity.inspect('child')).toBeUndefined()
    expect(f.inspect).not.toHaveBeenCalled()
  })

  it('rechecks archive after the asynchronous cold read', async () => {
    const f = fixture()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    f.inspect.mockImplementation(async () => {
      entered.resolve()
      await release.promise
      return { meta: { id: 'child', parentSession: 'main' } }
    })
    const pending = f.identity.inspect('child')
    await entered.promise
    f.archive.push('child')
    release.resolve()
    expect(await pending).toBeUndefined()
  })

  it('fails closed when required Host capabilities are absent', async () => {
    const identity = createCollaborationHostIdentity({})
    expect(identity.isArchived('main')).toBe(true)
    expect(await identity.inspect('main')).toBeUndefined()
  })

  it('treats unavailable or malformed archive projection as unproven, not empty', async () => {
    const inspect = vi.fn(async () => ({ meta: { id: 'main' } }))
    const identity = createCollaborationHostIdentity({
      sessionController: { inspect },
      workspaceRegistry: { get archivedSessionIds(): never { throw new Error('offline') } },
    })
    expect(identity.isArchived('main')).toBe(true)
    expect(await identity.inspect('main')).toBeUndefined()
    expect(inspect).not.toHaveBeenCalled()
  })

  it.each(['', ' main', 'main ', '\n'])('rejects noncanonical caller %j before touching storage', async id => {
    const f = fixture()
    expect(await f.identity.inspect(id)).toBeUndefined()
    expect(f.inspect).not.toHaveBeenCalled()
  })
})
