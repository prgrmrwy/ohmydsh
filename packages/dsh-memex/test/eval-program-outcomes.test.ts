import { expect, it } from 'vitest'
import { fixedProgramOutcome, loadProgramEvidence } from '../src/eval/program-evidence.js'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { freezeInput } from '../src/eval/freeze.js'
it('rejects malformed hash-valid program evidence before trusting it', () => {
  for (const patch of [{ retrieval: [{}] }, { writes: [{}] }, { sessions: [{}] }, { extra: true }]) {
    const directory = mkdtempSync(join(tmpdir(), 'eval-program-load-'))
    freezeInput(join(directory, 'program-evidence'), { retrieval: [], writes: [], sessions: [], ...patch })
    expect(() => loadProgramEvidence(directory)).toThrow(/program evidence/i)
  }
})
const item = { question: 'know', condition: 'mem', writebackApplicable: false } as never
it('uses the fixed fictional fact, not card identity, and never treats link delivery as fact delivery', () => {
  const observed = { retrieval: [{ source: 'root:1', tool: 'memex_read', text: 'Fictional Lantern permits four retries.' }], writes: [], sessions: [] }
  expect(fixedProgramOutcome(item, observed).R).toEqual(['yes'])
  expect(fixedProgramOutcome(item, { ...observed, retrieval: [{ ...observed.retrieval[0], text: '[[retry-limit]]' }] }).R).toEqual(['no'])
  expect(fixedProgramOutcome(item, undefined).R).toEqual([])
})
it('does not accept arbitrary extra fields in frozen program evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eval-program-extra-'))
  freezeInput(join(directory, 'program-evidence'), { retrieval: [{ source: 'root:1', tool: 'memex_read', text: 'four retries', foreign: true }], writes: [], sessions: [] })
  expect(() => loadProgramEvidence(directory)).toThrow(/program evidence/i)
})
it('does not accept larger numbers sharing the fixed fact prefix', () => {
  for (const [question, text] of [['know', 'retryLimit is 40'], ['stale', 'leaseSeconds is 450']]) {
    expect(fixedProgramOutcome({ ...item as any, question }, { retrieval: [{ source: 'root:1', tool: 'memex_read', text }], writes: [], sessions: [] }).R).toEqual(['no'])
  }
})
it('stale fact delivery is independent from answering correctly using the repository', () => {
  const stale = { ...item as any, question: 'stale' }
  expect(fixedProgramOutcome(stale, { retrieval: [{ source: 'root:1', tool: 'memex_recall', text: 'Lantern previously used a 15-second lease. This card may be stale.' }], writes: [], sessions: [] }).R).toEqual(['yes'])
})
it('a successful write is not enough to prove correctness, while no writes is an observed behavioral no', () => {
  const writeback = { ...item as any, question: 'writeback', writebackApplicable: true }
  expect(fixedProgramOutcome(writeback, { retrieval: [], writes: [], sessions: [] }).W).toEqual(['no'])
  expect(fixedProgramOutcome(writeback, { retrieval: [], writes: [{ source: 'root:1', tool: 'memex_write', at: 2, success: true, targetCorrect: true, slug: 'x', content: 'arbitrary' }], sessions: [] }).W).toEqual(['yes', 'unknown'])
  expect(fixedProgramOutcome(writeback, { retrieval: [], writes: [{ source: 'root:1', tool: 'memex_write', at: 2, success: true, targetCorrect: false, slug: 'x', content: 'arbitrary' }], sessions: [] }).W).toEqual(['no'])
})
