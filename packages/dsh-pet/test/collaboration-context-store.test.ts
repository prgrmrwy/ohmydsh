import { describe, expect, it } from 'vitest'
import { CollaborationContextStore, contextRevisionKey } from '../src/host/collaboration/context-store.js'
import { COLLABORATION_CONTEXT_SHARING_SCOPE } from '../src/host/collaboration/context.js'
import { emptyMedium, openPetHarness } from './harness.js'

const input = () => ({ expectedRevision: 0, workDescription: 'project', resourceReferences: ['ref'], commonConstraints: ['read'], sources: ['noted while implementing'] })
// Host-derived in-scope author facts; membership is proven by the caller resolver.
const author = (parentSessionId = 'main') => ({ parentSessionId, authoredBy: 'child-a', authoredAt: 123, authorLocus: { kind: 'child' as const, locusId: 'locus-a', generation: 1 }, sharingScope: COLLABORATION_CONTEXT_SHARING_SCOPE })
const atomic = process.env.DSH_PET_TEST_ATOMIC_DOMAIN === '1'

describe('public context store capability boundary', () => {
  it('refuses writes without actual atomic Domain support; reads never initialize rows', async () => {
    const h = await openPetHarness(emptyMedium(), { noTransaction: true })
    try {
      const store = new CollaborationContextStore(h.domain)
      expect(store.get('main')).toBeUndefined()
      expect(store.has('main')).toBe(false)
      await expect(store.ensure('main')).rejects.toMatchObject({ code: 'TRANSACTION_UNAVAILABLE' })
      expect(store.get('main')).toBeUndefined()
    } finally { await h.close() }
  })
})

describe.skipIf(!atomic)('public context store with real reviewed atomic Domain (opt-in config)', () => {
  it('ensures exactly one unknown revision across concurrent store instances and reopen', async () => {
    const medium = emptyMedium()
    const h = await openPetHarness(medium)
    try {
      const stores = [new CollaborationContextStore(h.domain), new CollaborationContextStore(h.domain)]
      const values = await Promise.all(Array.from({ length: 10 }, (_, i) => stores[i % 2]!.ensure('main')))
      expect(values.every(v => v.revision === 0 && v.status === 'unknown')).toBe(true)
      expect([...h.domain.table('collaboration_context_revisions').entries()]).toHaveLength(1)
    } finally { await h.close() }
    const reopened = await openPetHarness(medium)
    try {
      const store = new CollaborationContextStore(reopened.domain)
      expect(store.get('main')).toMatchObject({ revision: 0, status: 'unknown' })
      expect(store.audit('main')).toHaveLength(1)
    } finally { await reopened.close() }
  })

  it('serializes CAS inside the real domain transaction, not one repository instance lock', async () => {
    const h = await openPetHarness()
    try {
      const a = new CollaborationContextStore(h.domain)
      const b = new CollaborationContextStore(h.domain)
      await a.ensure('main')
      const results = await Promise.allSettled([a.update('main', input(), author()), b.update('main', input(), author())])
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'REVISION_CONFLICT' } })
      expect(a.get('main')?.revision).toBe(1)
      expect(a.audit('main').map(r => r.revision)).toEqual([0, 1])
    } finally { await h.close() }
  })

  it('current and audit remain unchanged on atomic write failure and after reopen', async () => {
    const medium = emptyMedium()
    const faults: { failWrites?: Error } = {}
    const h = await openPetHarness(medium, faults)
    try {
      const store = new CollaborationContextStore(h.domain)
      await store.ensure('main')
      faults.failWrites = new Error('fault')
      await expect(store.update('main', input(), author())).rejects.toThrow()
      expect(store.get('main')?.revision).toBe(0)
      expect(store.audit('main')).toHaveLength(1)
    } finally { await h.close() }
    const reopened = await openPetHarness(medium)
    try {
      expect(new CollaborationContextStore(reopened.domain).get('main')?.revision).toBe(0)
      expect([...reopened.domain.table('collaboration_context_revisions').entries()]).toHaveLength(1)
    } finally { await reopened.close() }
  })

  it('rolls back both staged rows when the medium fails on the second batch write', async () => {
    const medium = emptyMedium()
    const faults: { failWrites?: Error } = {}
    const h = await openPetHarness(medium, faults)
    try {
      const store = new CollaborationContextStore(h.domain)
      await store.ensure('main')
      const bytes = JSON.stringify(medium)
      let checks = 0
      Object.defineProperty(faults, 'failWrites', { get() { return ++checks >= 2 ? new Error('second-write') : undefined } })
      await expect(store.update('main', input(), author())).rejects.toThrow('second-write')
      expect(JSON.stringify(medium)).toBe(bytes)
      expect(store.get('main')?.revision).toBe(0)
      expect(store.audit('main')).toHaveLength(1)
    } finally { await h.close() }
  })

  it('preserves audit on withdrawal, isolates parents and detaches input before queued write', async () => {
    const h = await openPetHarness()
    try {
      const store = new CollaborationContextStore(h.domain)
      await store.ensure('main')
      await store.ensure('other')
      const replacement = input()
      const fact = author()
      const pending = store.update('main', replacement, fact)
      replacement.resourceReferences.push('late-mutated')
      fact.authoredBy = 'late-author'
      const first = await pending
      expect(first.resourceReferences).toEqual(['ref'])
      expect(first.authoredBy).toBe('child-a')
      expect(first.authoredByLocus).toEqual({ kind: 'child', locusId: 'locus-a', generation: 1 })
      await store.update('main', { ...input(), expectedRevision: 1, workDescription: '', resourceReferences: [], commonConstraints: [] }, author())
      expect(store.get('main')?.resourceReferences).toEqual([])
      expect(store.audit('main')[1]?.resourceReferences).toEqual(['ref'])
      expect(store.get('other')?.revision).toBe(0)
      await expect(store.update('main', { ...input(), expectedRevision: 2 }, author('other'))).rejects.toMatchObject({ code: 'PARENT_MISMATCH' })
      await expect(store.update('missing', input(), author('missing'))).rejects.toMatchObject({ code: 'CONTEXT_NOT_FOUND' })
    } finally { await h.close() }
  })

  it('rejects mismatched key records and never overwrites preexisting audit revision', async () => {
    const h = await openPetHarness()
    try {
      const store = new CollaborationContextStore(h.domain)
      const original = await store.ensure('main')
      await h.domain.table('collaboration_contexts').put('other', original)
      expect(() => store.get('other')).toThrow()
      await h.domain.table('collaboration_context_revisions').put(contextRevisionKey('main', 1), original)
      await expect(store.update('main', input(), author())).rejects.toMatchObject({ code: 'CONTEXT_CORRUPT' })
      expect(store.get('main')?.revision).toBe(0)
      await h.domain.table('collaboration_contexts').delete('main')
      await expect(store.ensure('main')).rejects.toMatchObject({ code: 'CONTEXT_CORRUPT' })
    } finally { await h.close() }
  })
})
