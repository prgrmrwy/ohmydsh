import { describe, expect, it, vi } from 'vitest'
import { listCollaborators } from '../src/host/collaboration/collaborators.js'
import { inquiryTargetReference, acceptInquiryFromCaller } from '../src/host/inquiry/ask.js'
import { createInquiry } from '../src/host/inquiry/ledger.js'
import { buildLocusRecord, type LocusRecord } from '../src/host/locus/aggregate.js'

function locus(id: string, child: string, overrides: Partial<Parameters<typeof buildLocusRecord>[0]> = {}): LocusRecord {
  return buildLocusRecord({
    id, generation: 1, parentSessionId: 'main', childSessionId: child,
    endpoint: { chatId: `chat-${id}` }, workspaceId: 'ws', source: 'explicit', state: 'active', ...overrides,
  })
}

function fixture(rows: LocusRecord[] = [locus('a', 'child-a'), locus('b', 'child-b')]) {
  const archived = new Set<string>()
  const identities = new Map<string, { id: string; parentSessionId?: string }>([
    ['main', { id: 'main' }],
    ...rows.map(row => [row.childSessionId!, { id: row.childSessionId!, parentSessionId: row.parentSessionId }] as const),
  ])
  const describe = vi.fn((sessionId: string) => ({ title: `title ${sessionId}`, availability: 'available' as const }))
  const ports = {
    loci: {
      findByChildSessionId: (id: string) => rows.filter(r => r.childSessionId === id),
      getLocusByChild: (id: string) => rows.find(r => r.childSessionId === id),
      listLociByParent: (id: string) => rows.filter(r => r.parentSessionId === id),
      getCurrentLocus: (endpoint: { chatId: string; threadId?: string }) =>
        rows.find(r => r.endpoint.chatId === endpoint.chatId && r.endpoint.threadId === endpoint.threadId),
    },
    inspect: async (id: string) => identities.get(id),
    isArchived: (id: string) => archived.has(id),
    hasPublicContext: (id: string) => id === 'main',
  }
  return { ports, archived, identities, describe, deps: { ports, describe } }
}

const denied = { code: 'COLLABORATION_UNAVAILABLE' }
const call = (id: unknown, f: ReturnType<typeof fixture>) =>
  listCollaborators({ agent: { id } }, f.deps)

describe('caller-bound collaborator roster', () => {
  it('lists a main session own current children with relationship and reachability', async () => {
    const f = fixture()
    const result = await call('main', f)
    expect(result).toEqual({
      self: { sessionId: 'main', relation: 'self-parent' },
      members: [
        { sessionId: 'child-a', locusId: 'a', generation: 1, target: 'child:a:1:child-a', relation: 'child', title: 'title child-a', reachability: 'available' },
        { sessionId: 'child-b', locusId: 'b', generation: 1, target: 'child:b:1:child-b', relation: 'child', title: 'title child-b', reachability: 'available' },
      ],
    })
    expect(Object.isFrozen(result.members)).toBe(true)
  })

  it.each(['main', 'child-a'])('publishes canonical targets accepted verbatim for every member seen by %s', async callerId => {
    const f = fixture()
    const roster = await call(callerId, f)
    const accept = vi.fn(async (request: unknown, facts: unknown) => createInquiry(request, {
      ...(facts as Record<string, unknown>), parent: null, rootInquiryCount: 0, pendingCount: 0,
    }))
    let nextId = 0
    for (const member of roster.members) {
      const scope = member.relation === 'parent'
        ? { kind: 'main', sessionId: member.sessionId }
        : { kind: 'child', sessionId: member.sessionId, locusId: member.locusId, generation: member.generation }
      expect(member.target).toBe(inquiryTargetReference(scope))
      const result = await acceptInquiryFromCaller(
        { agent: { id: callerId } },
        { target: member.target, question: 'Which evidence do you have?', purpose: 'Validate a scoped implementation' },
        {
          ports: f.ports, store: { accept },
          origin: () => ({ origin: { kind: 'local' }, audience: { kind: 'local-session', sessionId: callerId } }),
          now: () => 1, newInquiryId: () => `inquiry-${++nextId}`,
        },
      )
      expect(result).toMatchObject({ status: 'accepted', answered: false, target: member.target })
      expect((await accept.mock.results.at(-1)!.value).target).toEqual(scope)
    }
    expect(accept).toHaveBeenCalledTimes(roster.members.length)
  })

  it.each(['rebuilt', 'retired', 'archived', 'foreign'] as const)('refuses a previously listed target after it becomes %s', async change => {
    const rows = [locus('a', 'child-a'), locus('b', 'child-b')]
    const f = fixture(rows)
    const member = (await call('child-a', f)).members.find(m => m.sessionId === 'child-b')!
    expect(typeof member.target).toBe('string')
    if (change === 'rebuilt') rows[1] = locus('b', 'child-b', { generation: 2 })
    if (change === 'retired') rows[1] = locus('b', 'child-b', { state: 'retired' })
    if (change === 'archived') f.archived.add('child-b')
    if (change === 'foreign') {
      rows[1] = locus('b', 'child-b', { parentSessionId: 'other' })
      f.identities.set('child-b', { id: 'child-b', parentSessionId: 'other' })
      f.identities.set('other', { id: 'other' })
    }
    const accept = vi.fn(async () => { throw new Error('must not commit') })
    await expect(acceptInquiryFromCaller(
      { agent: { id: 'child-a' } },
      { target: member.target, question: 'Evidence?', purpose: 'Validate work' },
      {
        ports: f.ports, store: { accept },
        origin: () => ({ origin: { kind: 'local' }, audience: { kind: 'local-session', sessionId: 'child-a' } }),
        now: () => 1, newInquiryId: () => 'inquiry-1',
      },
    )).rejects.toMatchObject({ code: 'INQUIRY_REFUSED' })
    expect(accept).not.toHaveBeenCalled()
  })

  it('gives a child its parent and siblings, excluding itself', async () => {
    const f = fixture()
    const result = await call('child-a', f)
    expect(result.self).toEqual({ sessionId: 'child-a', locusId: 'a', generation: 1, relation: 'self-child' })
    expect(result.members.map(m => [m.sessionId, m.target, m.relation])).toEqual([
      ['main', 'main:main', 'parent'], ['child-b', 'child:b:1:child-b', 'sibling'],
    ])
  })

  it('never exposes endpoints, workspaces, permissions or owner management data', async () => {
    const f = fixture()
    const serialized = JSON.stringify(await call('child-a', f))
    expect(serialized).not.toMatch(/chat-|ws|permission|contextAnchor|busy|revision|endpoint/)
  })

  it('omits retired and archived members but keeps the caller usable', async () => {
    const f = fixture([locus('a', 'child-a'), locus('b', 'child-b'), locus('c', 'child-c', { state: 'retired' })])
    f.archived.add('child-b')
    const result = await call('child-a', f)
    expect(result.members.map(m => m.sessionId)).toEqual(['main'])
  })

  it('keeps a durable member that is merely not loaded, marked as needing restore', async () => {
    const f = fixture()
    f.describe.mockImplementation(sessionId => sessionId === 'child-b'
      ? { title: undefined as unknown as string, availability: 'unloaded' as never }
      : { title: `title ${sessionId}`, availability: 'available' as const })
    const result = await call('main', f)
    expect(result.members.find(m => m.sessionId === 'child-b')).toMatchObject({ reachability: 'needs-restore' })
  })

  it('reports unknown rather than claiming reachability when description fails', async () => {
    const f = fixture()
    f.describe.mockImplementation(() => { throw new Error('SECRET path') })
    const result = await call('main', f)
    expect(result.members.every(m => m.reachability === 'unknown' && m.title === undefined)).toBe(true)
  })

  it.each([undefined, 'stranger', 'child-x', 123])('fails closed for unproven caller %j', async id => {
    await expect(call(id, fixture())).rejects.toMatchObject(denied)
  })

  it('scopes two children of different parents into separate directories', async () => {
    // A different main session owning its own entry; a topic locus would also
    // need its chat-level parent locus, which is a separate invariant.
    const foreign = locus('f', 'child-f', { parentSessionId: 'other', endpoint: { chatId: 'chat-foreign' } })
    const f = fixture([locus('a', 'child-a'), foreign])
    f.identities.set('other', { id: 'other' })
    expect((await call('child-a', f)).members.map(m => m.sessionId)).toEqual(['main'])
  })

  it('returns an empty member list for a main session whose children all left', async () => {
    const f = fixture([])
    expect(await call('main', f)).toEqual({ self: { sessionId: 'main', relation: 'self-parent' }, members: [] })
  })
})
