import { describe, expect, it } from 'vitest'
import {
  COLLABORATION_CONTEXT_LIMITS as limits,
  COLLABORATION_CONTEXT_SHARING_SCOPE as sharingScope,
  CollaborationContextError,
  createEmptyCollaborationContext,
  updateCollaborationContext,
} from '../src/host/collaboration/context.js'

const parentSessionId = 'session-parent'
const empty = () => createEmptyCollaborationContext({ parentSessionId })
const replacement = () => ({
  expectedRevision: 0,
  workDescription: 'Shared project description',
  resourceReferences: ['docs/design.md', 'https://example.test/wiki/project'],
  commonConstraints: ['Ask before changing the release scope'],
  sources: ['Derived while implementing the release scope change'],
})
// Host-derived author facts. Scope membership is proven by the caller resolver
// BEFORE this module runs; this shape is provenance, never an authorization.
const author = () => ({
  parentSessionId,
  authoredBy: 'session-child-a',
  authoredAt: 1_800_000_000_000,
  authorLocus: { kind: 'child' as const, locusId: 'locus-a', generation: 2 },
  sharingScope,
})
const mainAuthor = () => ({
  parentSessionId,
  authoredBy: parentSessionId,
  authoredAt: 1_800_000_000_000,
  authorLocus: { kind: 'parent' as const },
  sharingScope,
})
function rejects(run: () => unknown, code = 'INVALID_CONTEXT_INPUT') {
  expect(run).toThrow(CollaborationContextError)
  expect(run).toThrow(expect.objectContaining({ code }))
}

describe('pure public collaboration context values', () => {
  it('creates a deterministic parent-bound revision zero with unknown, not authored, contents', () => {
    const record = empty()
    expect(record).toEqual({
      parentSessionId, revision: 0, status: 'unknown',
      workDescription: null, resourceReferences: null, commonConstraints: null,
      sources: [], authoredBy: null, authoredAt: null, authoredByLocus: null, sharingScope: null,
    })
    expect(empty()).toEqual(record)
    expect(createEmptyCollaborationContext({ parentSessionId: 'other-parent' }).parentSessionId).toBe('other-parent')
    expect(Object.isFrozen(record)).toBe(true)
    expect(Object.isFrozen(record.sources)).toBe(true)
  })

  it('records a full next revision with child author provenance and circle scope', () => {
    const before = empty()
    const input = replacement()
    const record = updateCollaborationContext(before, input, author())
    expect(record).toEqual({
      parentSessionId, revision: 1, status: 'authored',
      workDescription: input.workDescription,
      resourceReferences: input.resourceReferences,
      commonConstraints: input.commonConstraints,
      sources: input.sources,
      authoredBy: 'session-child-a', authoredAt: 1_800_000_000_000,
      authoredByLocus: { kind: 'child', locusId: 'locus-a', generation: 2 },
      sharingScope,
    })
    expect(before).toEqual(empty())
    expect(record).not.toBe(before)
  })

  it('records a main-session author as the parent writer, with no locus identity', () => {
    const record = updateCollaborationContext(empty(), replacement(), mainAuthor())
    expect(record).toMatchObject({
      status: 'authored', authoredBy: parentSessionId, authoredByLocus: { kind: 'parent' },
    })
    expect(Object.keys(record.authoredByLocus)).toEqual(['kind'])
    // An autonomous agent write needs no human confirmation flag anywhere.
    expect(record).not.toHaveProperty('explicitConfirmation')
    expect(record).not.toHaveProperty('confirmedBy')
    expect(record).not.toHaveProperty('confirmedAt')
  })

  it('copies and deeply freezes output without freezing or retaining mutable inputs', () => {
    const input = replacement()
    const fact = author()
    const record = updateCollaborationContext(empty(), input, fact)
    input.resourceReferences.push('later.md')
    input.commonConstraints[0] = 'later constraint'
    input.sources[0] = 'later source'
    fact.authoredBy = 'later-author'
    fact.authorLocus.locusId = 'later-locus'
    fact.authorLocus.generation = 99
    expect(record.resourceReferences).toEqual(['docs/design.md', 'https://example.test/wiki/project'])
    expect(record.commonConstraints).toEqual(['Ask before changing the release scope'])
    expect(record.sources).toEqual(['Derived while implementing the release scope change'])
    expect(record.authoredBy).toBe('session-child-a')
    expect(record.authoredByLocus).toEqual({ kind: 'child', locusId: 'locus-a', generation: 2 })
    for (const value of [record, record.resourceReferences, record.commonConstraints, record.sources, record.authoredByLocus]) {
      expect(Object.isFrozen(value)).toBe(true)
    }
    expect(() => (record.resourceReferences as string[]).push('forbidden')).toThrow()
    expect(Object.isFrozen(input.authorLocus ?? fact.authorLocus)).toBe(false)
  })

  it('replaces every field and source; clear never falls back to previous values', () => {
    const r1 = updateCollaborationContext(empty(), replacement(), author())
    const r2 = updateCollaborationContext(r1, {
      expectedRevision: 1, workDescription: '', resourceReferences: [], commonConstraints: [],
      sources: ['Withdrawn after the scope changed'],
    }, { ...mainAuthor(), authoredAt: 1_800_000_000_001 })
    expect(r2).toMatchObject({
      revision: 2, status: 'authored', workDescription: '', resourceReferences: [], commonConstraints: [],
      sources: ['Withdrawn after the scope changed'], authoredByLocus: { kind: 'parent' },
    })
    expect(r1.resourceReferences).toContain('docs/design.md') // No claim to erase history.
  })

  it('distinguishes explicitly unknown fields from authored empty fields', () => {
    const record = updateCollaborationContext(empty(), {
      ...replacement(), workDescription: null, resourceReferences: null, commonConstraints: [],
    }, author())
    expect(record).toMatchObject({ status: 'authored', workDescription: null, resourceReferences: null, commonConstraints: [] })
  })

  it('preserves literal text and order without extracting, normalizing, merging or downloading', () => {
    const record = updateCollaborationContext(empty(), {
      ...replacement(), workDescription: '  release\nbrief  ',
      resourceReferences: ['unresolved:reference', 'unresolved:reference'],
      commonConstraints: ['Do not write', 'Write when requested'],
    }, author())
    expect(record.workDescription).toBe('  release\nbrief  ')
    expect(record.resourceReferences).toEqual(['unresolved:reference', 'unresolved:reference'])
    expect(record.commonConstraints).toEqual(['Do not write', 'Write when requested'])
  })

  it('rejects stale expected revisions without changing current state', () => {
    const r1 = updateCollaborationContext(empty(), replacement(), author())
    rejects(() => updateCollaborationContext(r1, replacement(), author()), 'REVISION_CONFLICT')
    expect(r1.revision).toBe(1)
    // Pure calculation is not a store CAS: equal snapshots yield equal candidates.
    expect(updateCollaborationContext(empty(), replacement(), author())).toEqual(r1)
  })

  it('rejects revision overflow rather than losing monotonicity', () => {
    const r1 = updateCollaborationContext(empty(), replacement(), author())
    const last = { ...r1, revision: Number.MAX_SAFE_INTEGER }
    rejects(() => updateCollaborationContext(last, { ...replacement(), expectedRevision: last.revision }, author()), 'REVISION_OVERFLOW')
    expect(last.revision).toBe(Number.MAX_SAFE_INTEGER)
    expect(updateCollaborationContext({ ...r1, revision: last.revision - 1 }, { ...replacement(), expectedRevision: last.revision - 1 }, author()).revision).toBe(last.revision)
  })

  it('binds the Host-derived author fact to this parent, without pretending to authorize writers', () => {
    rejects(() => updateCollaborationContext(empty(), replacement(), { ...author(), parentSessionId: 'foreign-parent' }), 'PARENT_MISMATCH')
    // The helper cannot distinguish a forged but well-shaped fact. The Host
    // caller resolver MUST prove current scope membership before calling this.
    expect(updateCollaborationContext(empty(), replacement(), { ...author(), authoredBy: 'resolver-derived-session' }).authoredBy).toBe('resolver-derived-session')
  })

  it.each([true, false, undefined, 'true', 1])('rejects a removed human-confirmation flag %s', explicitConfirmation => {
    rejects(() => updateCollaborationContext(empty(), replacement(), { ...author(), explicitConfirmation }))
  })
  it.each([undefined, 'workspace', 'internet-public', 'current-children-only'])('rejects missing/wrong sharing scope %s', scope => {
    rejects(() => updateCollaborationContext(empty(), replacement(), { ...author(), sharingScope: scope }))
  })
  it.each(['', ' ', ' agent', 'agent ', null, 123])('rejects invalid author identifier %s', authoredBy => {
    rejects(() => updateCollaborationContext(empty(), replacement(), { ...author(), authoredBy }))
  })
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 'now', null])('rejects invalid author time %s', authoredAt => {
    rejects(() => updateCollaborationContext(empty(), replacement(), { ...author(), authoredAt }))
  })
  it.each([
    null, undefined, 'parent', {}, [], { kind: 'owner' }, { kind: 'agent' },
    { kind: 'parent', locusId: 'locus-a' },
    { kind: 'parent', generation: 1 },
    { kind: 'child' },
    { kind: 'child', locusId: 'locus-a' },
    { kind: 'child', generation: 2 },
    { kind: 'child', locusId: '', generation: 2 },
    { kind: 'child', locusId: ' locus-a', generation: 2 },
    { kind: 'child', locusId: 'locus-a', generation: 0 },
    { kind: 'child', locusId: 'locus-a', generation: -1 },
    { kind: 'child', locusId: 'locus-a', generation: 1.5 },
    { kind: 'child', locusId: 'locus-a', generation: '2' },
    { kind: 'child', locusId: 'locus-a', generation: 2, extra: true },
  ])('rejects malformed author locus %j', authorLocus => {
    rejects(() => updateCollaborationContext(empty(), replacement(), { ...author(), authorLocus }))
  })
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0', undefined])('rejects invalid expected revision %s', expectedRevision => {
    rejects(() => updateCollaborationContext(empty(), { ...replacement(), expectedRevision }, author()))
  })
  it.each(['workDescription', 'resourceReferences', 'commonConstraints', 'sources'])('requires full replacement field %s', field => {
    const input: Record<string, unknown> = replacement()
    delete input[field]
    rejects(() => updateCollaborationContext(empty(), input, author()))
  })
  it.each(['parentSessionId', 'authoredBy', 'authoredAt', 'authorLocus', 'sharingScope'])('requires author fact field %s', field => {
    const fact: Record<string, unknown> = author()
    delete fact[field]
    rejects(() => updateCollaborationContext(empty(), replacement(), fact))
  })
  it.each([
    { workDescription: 1 }, { resourceReferences: 'file.md' }, { resourceReferences: [''] },
    { commonConstraints: [null] }, { sources: [] }, { sources: [' '] }, { sources: [123] },
  ])('rejects malformed fields %j', patch => {
    rejects(() => updateCollaborationContext(empty(), { ...replacement(), ...patch }, author()))
  })

  it('accepts exact limits and rejects each oversized field without truncation', () => {
    const bounded = {
      expectedRevision: 0, workDescription: 'w'.repeat(limits.workDescriptionLength),
      resourceReferences: Array(limits.resourceReferences).fill('r'.repeat(limits.referenceLength)),
      commonConstraints: Array(limits.commonConstraints).fill('c'.repeat(limits.constraintLength)),
      sources: Array(limits.sources).fill('s'.repeat(limits.sourceLength)),
    }
    const record = updateCollaborationContext(empty(), bounded, author())
    expect(record.workDescription).toHaveLength(limits.workDescriptionLength)
    for (const patch of [
      { workDescription: `${bounded.workDescription}x` },
      { resourceReferences: [...bounded.resourceReferences, 'x'] },
      { resourceReferences: ['r'.repeat(limits.referenceLength + 1)] },
      { commonConstraints: [...bounded.commonConstraints, 'x'] },
      { commonConstraints: ['c'.repeat(limits.constraintLength + 1)] },
      { sources: [...bounded.sources, 'x'] },
      { sources: ['s'.repeat(limits.sourceLength + 1)] },
    ]) rejects(() => updateCollaborationContext(empty(), { ...bounded, ...patch }, author()))
    expect(createEmptyCollaborationContext({ parentSessionId: 'p'.repeat(limits.identifierLength) }).parentSessionId).toHaveLength(limits.identifierLength)
    rejects(() => createEmptyCollaborationContext({ parentSessionId: 'p'.repeat(limits.identifierLength + 1) }))
    rejects(() => updateCollaborationContext(empty(), replacement(), { ...author(), authoredBy: 'a'.repeat(limits.identifierLength + 1) }))
    rejects(() => updateCollaborationContext(empty(), replacement(), {
      ...author(), authorLocus: { kind: 'child', locusId: 'l'.repeat(limits.identifierLength + 1), generation: 2 },
    }))
  })

  it('rejects unknown runtime keys at every object boundary instead of silently stripping', () => {
    const extra = { executionRoot: '/not-an-authority' }
    rejects(() => createEmptyCollaborationContext({ parentSessionId, ...extra }))
    rejects(() => updateCollaborationContext({ ...empty(), ...extra }, replacement(), author()))
    rejects(() => updateCollaborationContext(empty(), { ...replacement(), ...extra }, author()))
    rejects(() => updateCollaborationContext(empty(), replacement(), { ...author(), ...extra }))
    rejects(() => updateCollaborationContext(empty(), replacement(), { ...author(), authorLocus: { ...author().authorLocus, ...extra } }))
    rejects(() => updateCollaborationContext(empty(), Object.defineProperty(replacement(), 'history', { value: 'hidden' }), author()))
    rejects(() => updateCollaborationContext(empty(), { ...replacement(), [Symbol('history')]: 'hidden' }, author()))
  })

  it.each([null, undefined, [], 'parent', {}, { parentSessionId: ' ' }, { parentSessionId: ' parent' }])('rejects malformed creation input %j', input => {
    rejects(() => createEmptyCollaborationContext(input))
  })

  it('rejects accessors and sparse or decorated arrays without invoking their data getters', () => {
    let reads = 0
    const input = Object.defineProperty(replacement(), 'workDescription', {
      get() { reads++; return 'unexpected' },
    })
    rejects(() => updateCollaborationContext(empty(), input, author()))
    const references = ['reference']
    Object.defineProperty(references, '0', { get() { reads++; return 'unexpected' } })
    rejects(() => updateCollaborationContext(empty(), { ...replacement(), resourceReferences: references }, author()))
    const locus = Object.defineProperty({ kind: 'child', generation: 2 }, 'locusId', {
      enumerable: true, get() { reads++; return 'unexpected' },
    })
    rejects(() => updateCollaborationContext(empty(), replacement(), { ...author(), authorLocus: locus }))
    expect(reads).toBe(0)
    for (const values of [Array(1), Object.assign(['reference'], { extra: true })]) {
      rejects(() => updateCollaborationContext(empty(), { ...replacement(), resourceReferences: values }, author()))
    }
  })

  it('rejects malformed current records instead of upgrading corruption to an authored revision', () => {
    for (const patch of [
      { revision: -1 }, { revision: 1 }, { status: 'authored' }, { status: 'confirmed' },
      { authoredBy: 'session-child-a' }, { authoredAt: 1 }, { authoredByLocus: { kind: 'parent' } },
      { workDescription: 'unauthored hidden value' }, { sources: ['unauthored'] },
    ]) rejects(() => updateCollaborationContext({ ...empty(), ...patch }, replacement(), author()))
    const authored = updateCollaborationContext(empty(), replacement(), author())
    for (const patch of [
      { authoredByLocus: null }, { authoredByLocus: { kind: 'owner' } }, { authoredBy: null },
      { authoredAt: null }, { sharingScope: null }, { status: 'unknown' },
    ]) {
      rejects(() => updateCollaborationContext({ ...authored, ...patch }, { ...replacement(), expectedRevision: 1 }, author()))
    }
    rejects(() => updateCollaborationContext(null, replacement(), author()))
    rejects(() => updateCollaborationContext(empty(), null, author()))
    rejects(() => updateCollaborationContext(empty(), replacement(), null))
  })
})
