import { describe, expect, it, vi } from 'vitest'
import { buildLocusRecord, type LocusRecord } from '../src/host/locus/aggregate.js'
import { LocusRepository as DurableLocusRepository, childIndexKey } from '../src/host/locus/persistence.js'
import { emptyMedium, openPetHarness } from './harness.js'
import { createCollaborationHostIdentity } from '../src/host/collaboration/host-identity.js'
import {
  resolveCollaborationCaller,
  type CollaborationCallerPorts,
  type CollaborationSessionIdentity,
} from '../src/host/collaboration/caller.js'

function row(id = 'a', parent = 'main', child = `child-${id}`): LocusRecord {
  return buildLocusRecord({
    id, generation: 1, parentSessionId: parent, childSessionId: child,
    endpoint: { chatId: `chat-${id}` }, workspaceId: 'workspace', source: 'explicit', state: 'active',
  })
}

function fixture(initial: LocusRecord[] = [row(), row('b')]) {
  let rows = initial
  const archived = new Set<string>()
  const publicParents = new Set<string>()
  const identities = new Map<string, CollaborationSessionIdentity>([
    ['main', { id: 'main' }], ['other', { id: 'other' }],
    ['child-a', { id: 'child-a', parentSessionId: 'main' }],
    ['child-b', { id: 'child-b', parentSessionId: 'main' }],
  ])
  const inspect = vi.fn(async (id: string) => identities.get(id))
  const ports: CollaborationCallerPorts = {
    loci: {
      findByChildSessionId: id => rows.filter(r => r.childSessionId === id),
      getLocusByChild: id => rows.find(r => r.childSessionId === id),
      listLociByParent: id => rows.filter(r => r.parentSessionId === id),
      getCurrentLocus: endpoint => rows.find(r => r.endpoint.chatId === endpoint.chatId && r.endpoint.threadId === endpoint.threadId),
    },
    inspect,
    isArchived: id => archived.has(id),
    hasPublicContext: id => publicParents.has(id),
  }
  return { ports, inspect, identities, archived, publicParents, setRows(next: LocusRecord[]) { rows = next } }
}

const rejection = { code: 'COLLABORATION_UNAVAILABLE', message: 'No current collaboration scope is available for this caller.' }

describe('caller-bound collaboration identity (no tools registered)', () => {
  it('resolves root from its current persistent children, without a live agent registry', async () => {
    const f = fixture()
    const result = await resolveCollaborationCaller('main', f.ports)
    expect(result).toEqual({ callerSessionId: 'main', parentSessionId: 'main', role: 'parent', children: [
      { sessionId: 'child-a', locusId: 'a', generation: 1 },
      { sessionId: 'child-b', locusId: 'b', generation: 1 },
    ] })
    expect(f.inspect).toHaveBeenCalledExactlyOnceWith('main')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.children[0])).toBe(true)
  })

  it('resolves child via exact reverse/forward indexes and cold lineage', async () => {
    const f = fixture()
    const result = await resolveCollaborationCaller('child-a', f.ports)
    expect(result.role).toBe('child')
    expect(result.parentSessionId).toBe('main')
    expect(result.callerLocus).toEqual({ sessionId: 'child-a', locusId: 'a', generation: 1 })
    expect(f.inspect.mock.calls.map(([id]) => id).sort()).toEqual(['child-a', 'main'])
    expect(JSON.stringify(result)).not.toMatch(/chat-|workspace|permission|contextAnchor/)
  })

  it('retains empty public context access for established root, not unrelated roots', async () => {
    const f = fixture([])
    await expect(resolveCollaborationCaller('main', f.ports)).rejects.toMatchObject(rejection)
    f.publicParents.add('main')
    expect(await resolveCollaborationCaller('main', f.ports)).toMatchObject({ role: 'parent', children: [] })
  })

  it('does not let ordinary subagents become roots via forged public records', async () => {
    const f = fixture([])
    f.publicParents.add('child-a')
    await expect(resolveCollaborationCaller('child-a', f.ports)).rejects.toMatchObject(rejection)
  })

  it.each(['retired', 'invalid', 'stopped', 'switching', 'provisioning'] as const)('rejects %s child even with a retained public record', async state => {
    const f = fixture([{ ...row(), state }])
    f.publicParents.add('child-a')
    await expect(resolveCollaborationCaller('child-a', f.ports)).rejects.toMatchObject(rejection)
  })

  it('rejects a child with multiple historical owners rather than choosing the active row', async () => {
    const f = fixture([row(), { ...row('old', 'main', 'child-a'), state: 'retired' }])
    await expect(resolveCollaborationCaller('child-a', f.ports)).rejects.toMatchObject(rejection)
  })

  it('rejects a child also used as a main session', async () => {
    const f = fixture([row(), row('nested', 'child-a', 'grandchild')])
    await expect(resolveCollaborationCaller('child-a', f.ports)).rejects.toMatchObject(rejection)
  })

  it.each(['reverse', 'endpoint', 'parent'] as const)('rejects inconsistent %s index', async kind => {
    const f = fixture()
    if (kind === 'reverse') f.ports.loci.getLocusByChild = () => undefined
    if (kind === 'endpoint') f.ports.loci.getCurrentLocus = () => ({ ...row(), generation: 2 })
    if (kind === 'parent') f.ports.loci.listLociByParent = () => []
    await expect(resolveCollaborationCaller('child-a', f.ports)).rejects.toMatchObject(rejection)
  })

  it.each(['wrong-id', 'wrong-parent', 'parent-is-child', 'missing', 'throws'] as const)('rejects cold identity %s', async kind => {
    const f = fixture()
    if (kind === 'wrong-id') f.identities.set('child-a', { id: 'someone-else', parentSessionId: 'main' })
    if (kind === 'wrong-parent') f.identities.set('child-a', { id: 'child-a', parentSessionId: 'other' })
    if (kind === 'parent-is-child') f.identities.set('main', { id: 'main', parentSessionId: 'other' })
    if (kind === 'missing') f.identities.delete('main')
    if (kind === 'throws') f.inspect.mockRejectedValue(new Error('private path /secret should not escape'))
    await expect(resolveCollaborationCaller('child-a', f.ports)).rejects.toMatchObject(rejection)
  })

  it.each(['main', 'child-a'])('rejects archived %s', async id => {
    const f = fixture()
    f.archived.add(id)
    await expect(resolveCollaborationCaller('child-a', f.ports)).rejects.toMatchObject(rejection)
  })

  it('excludes a sibling behind a switch-notice gate without blocking healthy callers', async () => {
    const f = fixture()
    const lookup = f.ports.loci.getCurrentLocus
    f.ports.loci.getCurrentLocus = endpoint => {
      const current = lookup(endpoint)
      return current?.id === 'b' ? { ...current, state: 'switching' } : current
    }
    expect((await resolveCollaborationCaller('main', f.ports)).children.map(c => c.sessionId)).toEqual(['child-a'])
    expect((await resolveCollaborationCaller('child-a', f.ports)).children).toHaveLength(1)
    await expect(resolveCollaborationCaller('child-b', f.ports)).rejects.toMatchObject(rejection)
  })

  it('does not mistake a busy/revision update during cold read for a changed identity', async () => {
    const f = fixture()
    f.inspect.mockImplementation(async id => {
      f.setRows([{ ...row(), busy: true, revision: 10, updatedAt: 10 }, row('b')])
      return f.identities.get(id)
    })
    expect((await resolveCollaborationCaller('child-a', f.ports)).parentSessionId).toBe('main')
  })

  it('rejects index changes during a cold read, never redirects caller to the new parent', async () => {
    const f = fixture()
    f.inspect.mockImplementation(async id => {
      f.setRows([row('a', 'other'), row('b')])
      return f.identities.get(id)
    })
    await expect(resolveCollaborationCaller('child-a', f.ports)).rejects.toMatchObject(rejection)
  })

  it('rejects an archive change during a cold read', async () => {
    const f = fixture()
    f.inspect.mockImplementation(async id => {
      f.archived.add('main')
      return f.identities.get(id)
    })
    await expect(resolveCollaborationCaller('child-a', f.ports)).rejects.toMatchObject(rejection)
  })

  it('only derives members from fixed parent, even when chats share a name or workspace', async () => {
    const a = row()
    const other = { ...row('foreign', 'other', 'foreign-child'), endpoint: { chatId: a.endpoint.chatId, threadId: 'foreign-topic' } }
    const f = fixture([a, other])
    const result = await resolveCollaborationCaller('main', f.ports)
    expect(result.children.map(c => c.sessionId)).toEqual(['child-a'])
  })

  it('excludes an archived sibling and refuses a missing caller cold identity', async () => {
    const f = fixture()
    f.archived.add('child-b')
    expect((await resolveCollaborationCaller('child-a', f.ports)).children.map(c => c.sessionId)).toEqual(['child-a'])
    f.identities.delete('child-a')
    await expect(resolveCollaborationCaller('child-a', f.ports)).rejects.toMatchObject(rejection)
  })

  it('refuses dangling parent reverse index consistently for main and child callers', async () => {
    const f = fixture()
    const reverse = f.ports.loci.getLocusByChild
    f.ports.loci.getLocusByChild = id => id === 'main' ? row('corrupt', 'other', 'main') : reverse(id)
    await expect(resolveCollaborationCaller('main', f.ports)).rejects.toMatchObject(rejection)
    await expect(resolveCollaborationCaller('child-a', f.ports)).rejects.toMatchObject(rejection)
  })

  it('excludes retired siblings but rejects duplicate active child identity', async () => {
    const f = fixture([row(), { ...row('b'), state: 'retired' }])
    expect((await resolveCollaborationCaller('main', f.ports)).children).toHaveLength(1)
    f.setRows([row(), row('duplicate', 'main', 'child-a')])
    await expect(resolveCollaborationCaller('main', f.ports)).rejects.toMatchObject(rejection)
  })

  it('uses the real durable repository indexes after a domain reopen and refuses corruption', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    try {
      const repository = new DurableLocusRepository(first.domain)
      await repository.putLocus(row())
      await repository.putLocus(row('b'))
    } finally { await first.close() }
    const reopened = await openPetHarness(medium)
    try {
      const repository = new DurableLocusRepository(reopened.domain)
      const f = fixture()
      const hostIdentity = createCollaborationHostIdentity({
        sessionController: {
          inspect: async id => {
            const identity = f.identities.get(id)
            if (identity === undefined) throw new Error('missing')
            return { meta: { id: identity.id, parentSession: identity.parentSessionId }, events: [] }
          },
        },
        workspaceRegistry: { archivedSessionIds: [] },
      })
      const ports = { ...f.ports, ...hostIdentity, loci: repository }
      expect((await resolveCollaborationCaller('child-a', ports)).children).toHaveLength(2)
      await reopened.domain.table('locus_indexes').delete(childIndexKey('child-a'))
      await expect(resolveCollaborationCaller('child-a', ports)).rejects.toMatchObject(rejection)
    } finally { await reopened.close() }
  })

  it.each(['', ' main', 'main ', '\n'])('does not normalize caller identity %j into another scope', async id => {
    await expect(resolveCollaborationCaller(id, fixture().ports)).rejects.toMatchObject(rejection)
  })
})
