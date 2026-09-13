import { describe, expect, it, vi } from 'vitest'
import { updateCollaborationContextForCaller } from '../src/host/collaboration/write.js'
import { buildLocusRecord } from '../src/host/locus/aggregate.js'
import { createEmptyCollaborationContext, updateCollaborationContext, COLLABORATION_CONTEXT_SHARING_SCOPE } from '../src/host/collaboration/context.js'

const replacement = (expectedRevision = 0) => ({
  expectedRevision, workDescription: 'shared work', resourceReferences: ['docs/plan.md'],
  commonConstraints: ['ask before release'], sources: ['child A investigation'],
})

function fixture() {
  const row = buildLocusRecord({ id: 'locus-a', generation: 3, parentSessionId: 'main', childSessionId: 'child', endpoint: { chatId: 'chat' }, workspaceId: 'ws', source: 'explicit', state: 'active' })
  let active = true
  let stored: unknown = createEmptyCollaborationContext({ parentSessionId: 'main' })
  const update = vi.fn(async (parentSessionId: string, input: unknown, author: unknown) => {
    const next = updateCollaborationContext(stored, input, author)
    if (parentSessionId !== 'main') throw new Error('wrong parent')
    stored = next
    return next
  })
  const ports = {
    loci: {
      findByChildSessionId: (id: string) => id === 'child' ? [{ ...row, state: active ? 'active' as const : 'retired' as const }] : [],
      getLocusByChild: (id: string) => id === 'child' && active ? row : undefined,
      listLociByParent: (id: string) => id === 'main' && active ? [row] : [],
      getCurrentLocus: () => active ? row : undefined,
    },
    inspect: vi.fn(async (id: string) => ({ id, ...(id === 'child' ? { parentSessionId: 'main' } : {}) })),
    isArchived: () => false,
    hasPublicContext: (id: string) => id === 'main' && stored !== undefined,
  }
  return { ports, store: { get: () => stored as never, update }, now: () => 1_800_000_000_000, update, retire() { active = false }, current: () => stored }
}

const denied = { code: 'COLLABORATION_UNAVAILABLE' }

describe('caller-bound shared fact updates', () => {
  it('records the writing child locus and generation, derived by the Host', async () => {
    const f = fixture()
    const record = await updateCollaborationContextForCaller({ agent: { session: { id: 'child' } } }, replacement(), f)
    expect(record).toMatchObject({
      parentSessionId: 'main', revision: 1, status: 'authored',
      workDescription: 'shared work', authoredBy: 'child', authoredAt: 1_800_000_000_000,
      authoredByLocus: { kind: 'child', locusId: 'locus-a', generation: 3 },
      sharingScope: COLLABORATION_CONTEXT_SHARING_SCOPE,
    })
  })

  it('records a main-session writer as the parent, not as a child locus', async () => {
    const f = fixture()
    const record = await updateCollaborationContextForCaller({ agent: { session: { id: 'main' } } }, replacement(), f)
    expect(record.authoredByLocus).toEqual({ kind: 'parent' })
    expect(record.authoredBy).toBe('main')
  })

  it('ignores any model-supplied parent, author, time or scope fields', async () => {
    const f = fixture()
    await expect(updateCollaborationContextForCaller({ agent: { session: { id: 'child' } } }, {
      ...replacement(), parentSessionId: 'other', authoredBy: 'owner', authoredAt: 1, sharingScope: 'everyone',
    }, f)).rejects.toMatchObject(denied)
    // The extra keys must be refused outright, never silently dropped and
    // committed as a valid revision.
    expect((f.current() as { revision: number }).revision).toBe(0)
  })

  it('propagates a revision conflict so the caller rereads instead of overwriting', async () => {
    const f = fixture()
    await updateCollaborationContextForCaller({ agent: { session: { id: 'child' } } }, replacement(), f)
    await expect(updateCollaborationContextForCaller({ agent: { session: { id: 'main' } } }, replacement(0), f))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect((f.current() as { revision: number }).revision).toBe(1)
  })

  it.each([undefined, {}, { agent: { session: { id: 'stranger' } } }])('denies unproven caller %j before writing', async execution => {
    const f = fixture()
    await expect(updateCollaborationContextForCaller(execution, replacement(), f)).rejects.toMatchObject(denied)
    expect(f.update).not.toHaveBeenCalled()
  })

  it('denies a retired child and leaves the current revision untouched', async () => {
    const f = fixture()
    f.retire()
    await expect(updateCollaborationContextForCaller({ agent: { session: { id: 'child' } } }, replacement(), f)).rejects.toMatchObject(denied)
    expect(f.update).not.toHaveBeenCalled()
    expect((f.current() as { revision: number }).revision).toBe(0)
  })

  it('does not expose storage diagnostics when the atomic write fails', async () => {
    const f = fixture()
    f.update.mockRejectedValueOnce(new Error('SECRET storage path'))
    const failure = await updateCollaborationContextForCaller({ agent: { session: { id: 'child' } } }, replacement(), f).catch((error: Error) => error)
    expect(String(failure)).not.toContain('SECRET')
    expect((f.current() as { revision: number }).revision).toBe(0)
  })
})
