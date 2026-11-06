/**
 * `validateLocusSetForStorage` (v20) is the one rule set shared by the offline
 * migration script and the Host: a script that passes a retained set must mean
 * the Host can open it (design D1, D12).
 *
 * Rows are fed as raw JSON values (what SQLite holds), so the schema layer is
 * exercised exactly as the script and the Domain open path see it.
 */
import { describe, expect, it } from 'vitest'
import type { LocusRowV20 } from '../src/host/locus/contract-v20.js'
import { endpointKeyV20, validateLocusSetForStorage } from '../src/host/locus/locus-set-v20.js'

function row(overrides: Partial<LocusRowV20> = {}): LocusRowV20 {
  return {
    endpoint: { chatId: 'oc_a' },
    locusId: 'locus-a',
    sessionId: 'child-a',
    state: 'active',
    accessMode: 'read-only',
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
    locusMainSessionId: 'main-1',
    workspaceId: 'ws-1',
    ...overrides,
  } as LocusRowV20
}

/** What SQLite hands back: a JSON round trip, keyed by the entry key. */
function raw(records: readonly LocusRowV20[]): Map<string, unknown> {
  return new Map(records.map(record => [endpointKeyV20(record.endpoint), JSON.parse(JSON.stringify(record)) as unknown]))
}

const MAINS = new Set(['main-1'])

describe('validateLocusSetForStorage (v20)', () => {
  it('accepts a paired group row', () => {
    expect(validateLocusSetForStorage(raw([row()]), MAINS)).toEqual([])
  })

  it('names a group row whose M has no locus_mains pairing', () => {
    const violations = validateLocusSetForStorage(raw([row({ locusMainSessionId: 'main-unknown' })]), MAINS)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.code).toBe('GROUP_MAIN_UNPAIRED')
    expect(violations[0]!.key).toBe('oc_a')
  })

  it('accepts a stopped row and an invalid row that carries its reason', () => {
    const stopped = row({ endpoint: { chatId: 'oc_s' }, locusId: 'locus-s', sessionId: 'child-s', state: 'stopped', stoppedAt: 2, updatedAt: 2 } as Partial<LocusRowV20>)
    const invalid = row({ endpoint: { chatId: 'oc_i' }, locusId: 'locus-i', sessionId: 'child-i', state: 'invalid', invalidReason: 'child lost', updatedAt: 2 } as Partial<LocusRowV20>)
    expect(validateLocusSetForStorage(raw([stopped, invalid]), MAINS)).toEqual([])
  })

  it('names a topic row whose chat has no group row', () => {
    const { locusMainSessionId: _main, workspaceId: _ws, ...topicBase } = row({ endpoint: { chatId: 'oc_a', threadId: 'omt_1' }, locusId: 'locus-t', sessionId: 'child-t' } as Partial<LocusRowV20>)
    const topic = topicBase as unknown as LocusRowV20
    const violations = validateLocusSetForStorage(raw([topic]), MAINS)
    expect(violations.map(violation => violation.code)).toContain('TOPIC_WITHOUT_GROUP')
  })

  it('rejects a row stored under a key that is not its endpoint key', () => {
    const set = new Map<string, unknown>([['other-key', JSON.parse(JSON.stringify(row())) as unknown]])
    const violations = validateLocusSetForStorage(set, MAINS)
    expect(violations.map(violation => violation.code)).toContain('KEY_MISMATCH')
    expect(violations.map(violation => violation.key)).toContain('other-key')
  })

  it('does not throw on an unreadable row: it reports it', () => {
    const set = new Map<string, unknown>([['bad', { id: 'bad' }], ['nope', 'not an object']])
    const violations = validateLocusSetForStorage(set, MAINS)
    expect(violations.map(violation => violation.code)).toEqual(['ROW_INVALID', 'ROW_INVALID'])
    expect(violations.map(violation => violation.key)).toEqual(['bad', 'nope'])
  })
})
