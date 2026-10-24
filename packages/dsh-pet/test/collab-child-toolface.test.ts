/**
 * `pet-locus-collaboration` requirement "关联具备双向发现且不过度披露" —
 * the two current scenarios that had no test named after them
 * (`pet-locus-collab-integration` test-plan Coverage Notes, tasks 5.3).
 *
 * Both assert TODAY's behavior against the real durable `LocusRepository`
 * (real Pet domain, only the medium substituted) and the real caller-bound
 * `pet_context` path a child actually reaches. They are the regression net
 * the collab migration must keep green.
 */
import { describe, expect, it } from 'vitest'
import { executePetContext, type PetLocusContextResult } from '../src/host/context-tool.js'
import { asLocusContextRepository } from '../src/host/locus/context-repository.js'
import { LocusRepository } from '../src/host/locus/persistence.js'
import { emptyMedium, openPetHarness, type PetHarness } from './harness.js'

const PARENT = 'session-main-toolface'
const ALPHA = { chatId: 'oc-toolface-alpha' } as const
const BETA = { chatId: 'oc-toolface-beta' } as const

/** Two entries under ONE main session — siblings, each with its own child. */
async function twoEntries(harness: PetHarness): Promise<LocusRepository> {
  const repository = new LocusRepository(harness.domain)
  for (const [id, endpoint, child] of [
    ['locus-alpha', ALPHA, 'child-alpha'],
    ['locus-beta', BETA, 'child-beta'],
  ] as const) {
    await repository.putLocus({
      id,
      generation: 1,
      endpoint,
      parentSessionId: PARENT,
      childSessionId: child,
      workspaceId: 'ws-toolface',
      source: 'auto',
      state: 'active',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
      busy: false,
      createdAt: 1,
      updatedAt: 1,
    })
  }
  return repository
}

describe('pet-locus-collaboration: 关联具备双向发现且不过度披露', () => {
  it('toolface-01 双向核对: the main-session view and the entry view point at the same locus and the same main/child sessions', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoEntries(harness)

      // Direction 1: the owner looks at the collaboration entries of the main session.
      const fromMain = repository.listByParentSession(PARENT)
      expect(fromMain.map(record => record.id).sort()).toEqual(['locus-alpha', 'locus-beta'])

      // Direction 2: from each entry, open its session.
      for (const endpoint of [ALPHA, BETA]) {
        const fromEntry = repository.getCurrentLocus(endpoint)
        expect(fromEntry).toBeDefined()
        const listed = fromMain.find(record => record.id === fromEntry!.id)
        expect(listed).toBeDefined()
        expect(fromEntry!.parentSessionId).toBe(PARENT)
        expect(listed!.parentSessionId).toBe(fromEntry!.parentSessionId)
        expect(listed!.childSessionId).toBe(fromEntry!.childSessionId)
        expect(listed!.generation).toBe(fromEntry!.generation)
        // And the child the entry opens resolves back to the same locus.
        expect(repository.findByChildSessionId(fromEntry!.childSessionId!).map(record => record.id))
          .toEqual([fromEntry!.id])
      }
    } finally {
      await harness.close()
    }
  })

  it('toolface-02 子会话反查: a child querying its own association gets only its own locus, never an enumeration of its siblings', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoEntries(harness)
      const locusRepository = asLocusContextRepository(repository)

      // The child's real query path: caller-bound `pet_context`, no selector.
      const result = executePetContext(
        harness.repository,
        { agent: { id: 'child-alpha' } },
        { locusRepository },
      )

      expect(result.scope).toBe('locus')
      const own = result as PetLocusContextResult
      expect(own.locus.locusId).toBe('locus-alpha')
      expect(own.child.sessionId).toBe('child-alpha')
      expect(own.main.sessionId).toBe(PARENT)
      expect(own.endpoint.chatId).toBe(ALPHA.chatId)
      // Sharing a parent grants nothing: no sibling locus, child or entry appears.
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('locus-beta')
      expect(serialized).not.toContain('child-beta')
      expect(serialized).not.toContain(BETA.chatId)
    } finally {
      await harness.close()
    }
  })
})
