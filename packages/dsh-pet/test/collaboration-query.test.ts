import { describe, expect, it, vi } from 'vitest'
import { queryCollaborationContext } from '../src/host/collaboration/query.js'
import { buildLocusRecord } from '../src/host/locus/aggregate.js'
import { createEmptyCollaborationContext, updateCollaborationContext, COLLABORATION_CONTEXT_SHARING_SCOPE } from '../src/host/collaboration/context.js'

function fixture() {
  const row = buildLocusRecord({ id: 'locus', generation: 1, parentSessionId: 'main', childSessionId: 'child', endpoint: { chatId: 'chat' }, workspaceId: 'ws', source: 'explicit', state: 'active' })
  let active = true
  let stored = createEmptyCollaborationContext({ parentSessionId: 'main' }) as ReturnType<typeof createEmptyCollaborationContext> | ReturnType<typeof updateCollaborationContext> | undefined
  const get = vi.fn((id: string) => id === 'main' ? stored : undefined)
  const inspect = vi.fn(async (id: string) => ({ id, ...(id === 'child' ? { parentSessionId: 'main' } : {}) }))
  const ports = {
    loci: {
      findByChildSessionId: (id: string) => id === 'child' ? [{ ...row, state: active ? 'active' as const : 'retired' as const }] : [],
      getLocusByChild: (id: string) => id === 'child' && active ? row : undefined,
      listLociByParent: (id: string) => id === 'main' && active ? [row] : [],
      getCurrentLocus: () => active ? row : undefined,
    },
    inspect, isArchived: () => false, hasPublicContext: (id: string) => get(id) !== undefined,
  }
  return { ports, store: { get }, inspect, retire() { active = false }, clear() { stored = undefined }, update() {
    stored = updateCollaborationContext(stored, { expectedRevision: 0, workDescription: 'latest', resourceReferences: ['ref'], commonConstraints: [], sources: ['noted by a peer'] }, { parentSessionId: 'main', authoredBy: 'child', authoredAt: 1, authorLocus: { kind: 'child' as const, locusId: 'locus', generation: 1 }, sharingScope: COLLABORATION_CONTEXT_SHARING_SCOPE })
  } }
}

describe('caller-bound current public query', () => {
  it('returns the same current revision for root and child, without local fallback or audit', async () => {
    const f = fixture()
    const main = await queryCollaborationContext({ agent: { id: 'main' } }, f)
    const child = await queryCollaborationContext({ agent: { id: 'child' } }, f)
    expect(child).toEqual(main)
    expect(main).toMatchObject({ parentSessionId: 'main', revision: 0, status: 'unknown' })
    expect(main).not.toHaveProperty('history')
  })

  it('reads the latest single snapshot after cold identity await, not before it', async () => {
    const f = fixture()
    let updated = false
    f.inspect.mockImplementation(async id => {
      if (!updated) { f.update(); updated = true }
      return { id, ...(id === 'child' ? { parentSessionId: 'main' } : {}) }
    })
    expect(await queryCollaborationContext({ agent: { id: 'child' } }, f)).toMatchObject({ revision: 1, workDescription: 'latest' })
  })

  it('retired child cannot read retained record; root continues with no children', async () => {
    const f = fixture()
    f.retire()
    await expect(queryCollaborationContext({ agent: { id: 'child' } }, f)).rejects.toMatchObject({ code: 'COLLABORATION_UNAVAILABLE' })
    expect(await queryCollaborationContext({ agent: { id: 'main' } }, f)).toMatchObject({ revision: 0 })
  })

  it.each([undefined, {}, { agent: { id: 123 } }, { agent: { id: 'foreign' } }])('rejects unproven execution %j', async execution => {
    await expect(queryCollaborationContext(execution, fixture())).rejects.toMatchObject({ code: 'COLLABORATION_UNAVAILABLE' })
  })

  it('does not synthesize or initialize a missing shared record', async () => {
    const f = fixture()
    f.clear()
    await expect(queryCollaborationContext({ agent: { id: 'child' } }, f)).rejects.toMatchObject({ code: 'COLLABORATION_UNAVAILABLE' })
  })

  it('refuses corrupt wrong-parent record rather than exposing it', async () => {
    const f = fixture()
    f.store.get.mockImplementation(() => createEmptyCollaborationContext({ parentSessionId: 'foreign' }))
    await expect(queryCollaborationContext({ agent: { id: 'child' } }, f)).rejects.toMatchObject({ code: 'COLLABORATION_UNAVAILABLE' })
  })
})
