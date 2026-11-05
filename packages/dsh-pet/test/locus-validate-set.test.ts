/**
 * `validateLocusSetForStorage` is the one rule set shared by the offline
 * migration script and the Host: a script that passes a retained set must mean
 * the Host can open it (change pet-locus-purge-previous-model D3.3).
 *
 * Rows are fed as raw JSON values (what SQLite holds), so the schema layer is
 * exercised exactly as the script and the Domain open path see it.
 */
import { describe, expect, it } from 'vitest'
import { buildLocusRecord, type LocusRecord } from '../src/host/locus/aggregate.js'
import { validateLocusSetForStorage } from '../src/host/locus/persistence.js'

function row(overrides: Partial<Parameters<typeof buildLocusRecord>[0]> = {}): LocusRecord {
  return buildLocusRecord({
    id: 'locus-a',
    endpoint: { chatId: 'oc_a' },
    parentSessionId: 'main-1',
    childSessionId: 'child-a',
    childComposition: 'tier3',
    workspaceId: 'ws-1',
    source: 'auto',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  })
}

/** What SQLite hands back: a JSON round trip, never a frozen typed record. */
function raw(records: readonly LocusRecord[]): Map<string, unknown> {
  return new Map(records.map(record => [record.id, JSON.parse(JSON.stringify(record)) as unknown]))
}

const MAINS = new Set(['main-1'])

describe('validateLocusSetForStorage', () => {
  it('accepts a paired tier3 set', () => {
    expect(validateLocusSetForStorage(raw([row()]), MAINS)).toEqual([])
  })

  it('names a row whose parent session has no locus_mains record', () => {
    const violations = validateLocusSetForStorage(raw([row({ parentSessionId: 'main-unknown' })]), MAINS)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('locus-a')
    expect(violations[0]).toContain('locus_mains')
  })

  it.each(['safe-v1', 'safe-v2'])('rejects a retained %s marker and names the row', marker => {
    const set = raw([row()])
    ;(set.get('locus-a') as { childComposition: string }).childComposition = marker
    const violations = validateLocusSetForStorage(set, MAINS)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.join('\n')).toContain('locus-a')
  })

  it('rejects an active row without a marker', () => {
    const set = raw([row()])
    delete (set.get('locus-a') as { childComposition?: string }).childComposition
    const violations = validateLocusSetForStorage(set, MAINS)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.join('\n')).toContain('locus-a')
  })

  it('accepts stopped and invalid rows that never had a child', () => {
    const stopped = row({ id: 'locus-s', endpoint: { chatId: 'oc_s' }, state: 'stopped', childSessionId: undefined, childComposition: undefined, updatedAt: 2 })
    const invalid = row({ id: 'locus-i', endpoint: { chatId: 'oc_i' }, state: 'invalid', childSessionId: undefined, childComposition: undefined, updatedAt: 2 })
    expect(validateLocusSetForStorage(raw([stopped, invalid]), MAINS)).toEqual([])
  })

  it('rejects a generation gap that deleting a middle generation would leave', () => {
    const g1 = row({ id: 'g1', generation: 1, state: 'invalid', childSessionId: undefined, childComposition: undefined, updatedAt: 2 })
    const g3 = row({ id: 'g3', generation: 3, state: 'not-created', childSessionId: undefined, childComposition: undefined, replacesLocusId: 'g2' })
    const violations = validateLocusSetForStorage(raw([g1, g3]), MAINS)
    expect(violations.join('\n')).toMatch(/contiguously/)
    expect(violations.join('\n')).toContain('oc_a')
  })

  it('rejects a topic whose parentLocusId points at a missing row', () => {
    const topic = row({ id: 'topic-1', endpoint: { chatId: 'oc_a', threadId: 'omt_1' }, parentLocusId: 'locus-gone', childSessionId: 'child-t' })
    const violations = validateLocusSetForStorage(raw([topic]), MAINS)
    expect(violations.join('\n')).toContain('locus-gone')
  })

  it('accepts a deleted history prefix: generations 2 and 3 remain, replacesLocusId may dangle', () => {
    const g2 = row({ id: 'g2', generation: 2, state: 'invalid', childSessionId: undefined, childComposition: undefined, replacesLocusId: 'g1-deleted', updatedAt: 2 })
    const g3 = row({ id: 'g3', generation: 3, state: 'not-created', childSessionId: undefined, childComposition: undefined, replacesLocusId: 'g2', updatedAt: 3 })
    expect(validateLocusSetForStorage(raw([g2, g3]), MAINS)).toEqual([])
  })

  it('rejects a row stored under a key that is not its id', () => {
    const set = new Map<string, unknown>([['other-key', JSON.parse(JSON.stringify(row())) as unknown]])
    expect(validateLocusSetForStorage(set, MAINS).join('\n')).toContain('other-key')
  })

  it('does not throw on an unreadable row: it reports it', () => {
    const set = new Map<string, unknown>([['bad', { id: 'bad' }], ['nope', 'not an object']])
    const violations = validateLocusSetForStorage(set, MAINS)
    expect(violations.join('\n')).toContain('bad')
    expect(violations.join('\n')).toContain('nope')
  })
})
