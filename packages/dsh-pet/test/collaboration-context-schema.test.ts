import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  COLLABORATION_CONTEXT_SHARING_SCOPE,
  type CollaborationContextRecord,
} from '../src/host/collaboration/context.js'
import {
  PET_DOMAIN_VERSION,
  petCollaborationContextRecord,
  type PetCollaborationContextRecord,
} from '../src/host/spec.js'
import { emptyMedium, openPetHarness } from './harness.js'

// Independent literal fixtures: do not have the validator generate its oracle.
const unknownRecord = {
  parentSessionId: 'parent', revision: 0, status: 'unknown',
  workDescription: null, resourceReferences: null, commonConstraints: null,
  sources: [], authoredBy: null, authoredAt: null, authoredByLocus: null, sharingScope: null,
} as const
const authoredRecord = {
  parentSessionId: 'parent', revision: 1, status: 'authored',
  workDescription: 'Work', resourceReferences: ['docs/spec.md'], commonConstraints: ['Read only'],
  sources: ['noted during implementation'], authoredBy: 'child-a', authoredAt: 123,
  authoredByLocus: { kind: 'child', locusId: 'locus-a', generation: 2 },
  sharingScope: COLLABORATION_CONTEXT_SHARING_SCOPE,
} as const
const mainAuthoredRecord = {
  ...authoredRecord, authoredBy: 'parent', authoredByLocus: { kind: 'parent' },
} as const
const tables = ['collaboration_contexts', 'collaboration_context_revisions'] as const

describe('public context durable schema', () => {
  it('exports the exact pure discriminated union and the current additive descriptor', () => {
    expectTypeOf<PetCollaborationContextRecord>().toEqualTypeOf<CollaborationContextRecord>()
    // Public context arrived at v10 and survives every later additive bump.
    expect(PET_DOMAIN_VERSION).toBeGreaterThanOrEqual(10)
  })

  it.each([
    unknownRecord,
    authoredRecord,
    { ...authoredRecord, workDescription: '', resourceReferences: [], commonConstraints: [] },
    { ...authoredRecord, workDescription: null, resourceReferences: null, commonConstraints: null },
    { ...authoredRecord, revision: Number.MAX_SAFE_INTEGER, authoredAt: 0 },
    mainAuthoredRecord,
  ])('accepts exact unknown/authored records without inventing content', input => {
    const result = petCollaborationContextRecord.parse(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.sources)).toBe(true)
    if (result.resourceReferences) expect(Object.isFrozen(result.resourceReferences)).toBe(true)
    if (result.commonConstraints) expect(Object.isFrozen(result.commonConstraints)).toBe(true)
    if (result.authoredByLocus) expect(Object.isFrozen(result.authoredByLocus)).toBe(true)
  })

  it.each([
    null, [], {},
    { ...unknownRecord, revision: 1 },
    { ...unknownRecord, workDescription: '' },
    { ...unknownRecord, resourceReferences: [] },
    { ...unknownRecord, commonConstraints: [] },
    { ...unknownRecord, sources: ['source'] },
    { ...unknownRecord, authoredBy: 'child-a' },
    { ...unknownRecord, authoredAt: 0 },
    { ...unknownRecord, authoredByLocus: { kind: 'parent' } },
    { ...unknownRecord, sharingScope: COLLABORATION_CONTEXT_SHARING_SCOPE },
    { ...authoredRecord, revision: 0 },
    { ...authoredRecord, revision: -1 },
    { ...authoredRecord, revision: 1.5 },
    { ...authoredRecord, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...authoredRecord, authoredAt: -1 },
    { ...authoredRecord, authoredAt: Infinity },
    { ...authoredRecord, authoredBy: ' child-a' },
    { ...authoredRecord, authoredByLocus: null },
    { ...authoredRecord, authoredByLocus: { kind: 'owner' } },
    { ...authoredRecord, authoredByLocus: { kind: 'child', locusId: 'locus-a' } },
    { ...authoredRecord, authoredByLocus: { kind: 'child', locusId: 'locus-a', generation: 0 } },
    { ...authoredRecord, authoredByLocus: { kind: 'parent', locusId: 'locus-a' } },
    { ...authoredRecord, parentSessionId: '' },
    { ...authoredRecord, parentSessionId: 'x'.repeat(257) },
    { ...authoredRecord, status: 'withdrawn' },
    { ...authoredRecord, status: 'confirmed' },
    { ...authoredRecord, sharingScope: 'workspace' },
    { ...authoredRecord, sources: [] },
    { ...authoredRecord, sources: [' '] },
    { ...authoredRecord, sources: Array(33).fill('s') },
    { ...authoredRecord, workDescription: 'x'.repeat(8193) },
    { ...authoredRecord, resourceReferences: ['x'.repeat(2049)] },
    { ...authoredRecord, resourceReferences: Array(65).fill('x') },
    { ...authoredRecord, commonConstraints: Array(65).fill('x') },
    { ...authoredRecord, commonConstraints: [''] },
    { ...authoredRecord, sources: ['x'.repeat(1025)] },
    { ...authoredRecord, unexpected: 'must not strip' },
    { ...authoredRecord, commonConstraints: undefined },
  ])('rejects malformed or cross-discriminator input %# through Zod', input => {
    const result = petCollaborationContextRecord.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues).toEqual([
      { code: 'custom', message: 'Invalid public context record.', path: [] },
    ])
  })

  it('rejects accessors, hidden/symbol keys, exotic records and sparse arrays', () => {
    let reads = 0
    const accessor = { ...authoredRecord }
    Object.defineProperty(accessor, 'workDescription', { get() { reads++; return 'secret' } })
    const hidden = { ...authoredRecord }
    Object.defineProperty(hidden, 'secret', { value: true })
    const sparse = { ...authoredRecord, resourceReferences: new Array(1) }
    const exotic = Object.assign(Object.create({ inherited: true }), authoredRecord)
    for (const input of [accessor, hidden, sparse, exotic, { ...authoredRecord, [Symbol('extra')]: true }]) {
      expect(petCollaborationContextRecord.safeParse(input).success).toBe(false)
    }
    expect(reads).toBe(0)
  })

  it.each(tables)('round-trips full records in %s through the actual domain', async table => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const key = table === 'collaboration_contexts' ? 'parent' : JSON.stringify(['parent', 1])
    try {
      await first.domain.table(table).put(key, authoredRecord)
    } finally { await first.close() }
    const second = await openPetHarness(medium)
    try {
      expect(second.domain.table(table).get(key)).toEqual(authoredRecord)
      expect(second.domain.table(tables.find(other => other !== table)!).size).toBe(0)
    } finally { await second.close() }
  })

  it.each(tables)('refuses malformed persisted %s records on open', async table => {
    const medium = emptyMedium()
    medium.version = PET_DOMAIN_VERSION
    medium.tables[table] = { parent: JSON.stringify({ ...unknownRecord, revision: 1 }) }
    await expect(openPetHarness(medium)).rejects.toThrow()
  })
})
