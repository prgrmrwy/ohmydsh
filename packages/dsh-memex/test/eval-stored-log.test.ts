import { expect, it } from 'vitest'
import { decodeStoredEvidence } from '../src/eval/evidence-log.js'
const header = { type: 'session', id: 'reserved', version: 4, createdAt: 1, isSeeded: false, delegationDepth: 0 }
const encode = (rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n')
it('reads the official physical header separately from zero-based events', () => {
  expect(decodeStoredEvidence(encode([header, { type: 'session/end-seed', seq: 0, time: 1, data: {} }]), 'jsonl', 'reserved')).toMatchObject({ header: { id: 'reserved', version: 4 }, inheritedEventCount: 0, events: [{ seq: 0 }] })
})
it('uses the last tagged inherited cut, not an earlier ancestor cut', () => {
  const rows = [header, ...[0, 1, 2].map(seq => ({ type: 'session/end-seed', seq, time: 1, data: { inherited: true } }))]
  expect(decodeStoredEvidence(encode([{ ...header, isSeeded: true }, ...rows.slice(1)]), 'jsonl', 'reserved').inheritedEventCount).toBe(2)
})
it('refuses malformed or unknown required events rather than trusting sequence alone', () => {
  for (const event of [{ type: 'unknown-required', seq: 0, time: 1, data: {} }, { type: 'assistant/message', seq: 0, time: 1, data: {} }]) expect(() => decodeStoredEvidence(encode([header, event]), 'jsonl', 'reserved')).toThrow()
})

it('refuses retired policy header fields rather than silently importing them', () => {
  for (const policy of [{ sandboxMode: 'danger-full-access' }, { approvalPolicy: 'never' }]) expect(() => decodeStoredEvidence(encode([{ ...header, ...policy }]), 'jsonl', 'reserved')).toThrow(/retired/)
})

it('matches the official current physical header whitelist and scalar constraints', () => {
  for (const extra of [{ cwd: 'relative' }, { createdAt: -1 }, { delegationDepth: 0.5 }, { origin: 'external' }, { parentSession: 42 }, { extra: 'unknown' }]) {
    expect(() => decodeStoredEvidence(encode([{ ...header, ...extra }]), 'jsonl', 'reserved')).toThrow()
  }
})

it('refuses wrong identities, unsupported formats and missing inherited cuts', () => {
  for (const value of [{ ...header, id: 'daily' }, { ...header, version: 3 }, { ...header, isSeeded: true }]) expect(() => decodeStoredEvidence(encode([value]), 'jsonl', 'reserved')).toThrow()
})
