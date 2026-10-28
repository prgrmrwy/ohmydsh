import { expect, it } from 'vitest'
import { zstdCompressSync } from 'node:zlib'
import { toolResultEvidence } from '../src/eval/evidence-text.js'
import { decodeStoredEvidence } from '../src/eval/evidence-log.js'
import { freezeSelection } from '../src/eval/selection.js'
import { renderSelftestReport } from '../src/eval/report.js'
import { readJudgement } from '../src/eval/judgement.js'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FixedRound } from '../src/eval/round.js'

it('EVAL-035: 成功结果保留全文', () => {
  const card = 'retryLimit is 4.\n' + 'x'.repeat(200_000) + '\nend-of-card'
  const events = [
    { type: 'assistant/message', seq: 0, data: { message: { content: [{ type: 'tool-call', id: 'c1', name: 'memex_read', arguments: '{}' }] } } },
    { type: 'tool/result', seq: 1, data: { message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: card }] } } },
  ]
  const collected = toolResultEvidence('root', events as never, 0)
  expect(collected).toEqual([{ id: 'root:1', tool: 'memex_read', text: card }])
  expect(Buffer.byteLength(collected[0]!.text)).toBe(Buffer.byteLength(card))
  // the judge receives only a selected excerpt; coverage must not claim full semantic verification
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-evidence-'))
  const selection = freezeSelection(join(directory, 'selection'), [{ id: 'root:1', text: card }, { id: 'root:2', text: 'answer' }], ['root:2'])
  const plan = { id: 'round-x', version: 'selftest-v1', items: [{ id: 'know-mem', question: 'know', kind: 'Know', condition: 'mem', writebackApplicable: false }] } as FixedRound
  const report = renderSelftestReport(plan, {}, { selections: { 'know-mem': selection.coverage } })
  expect(report.markdown).not.toMatch(/全文语义已验证|全文已阅读/)
  expect(report.markdown).toContain('不代表完整日志覆盖')
})

it('failed, inherited or unmatched tool results are never collected as successful evidence', () => {
  const events = [
    { type: 'assistant/message', seq: 0, data: { message: { content: [{ type: 'tool-call', id: 'seed', name: 'memex_read', arguments: '{}' }] } } },
    { type: 'tool/result', seq: 1, data: { message: { role: 'tool', toolCallId: 'seed', content: [{ type: 'text', text: 'inherited' }] } } },
    { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'tool-call', id: 'c1', name: 'memex_read', arguments: '{}' }] } } },
    { type: 'tool/result', seq: 3, data: { message: { role: 'tool', toolCallId: 'c1', isError: true, content: [{ type: 'text', text: 'failed' }] } } },
    { type: 'tool/result', seq: 4, data: { message: { role: 'tool', toolCallId: 'unknown', content: [{ type: 'text', text: 'orphan' }] } } },
  ]
  expect(toolResultEvidence('root', events as never, 2)).toEqual([])
})

it('EVAL-036: 日志损坏不判失败', () => {
  const rows = [{ type: 'session', id: 'root', version: 4, createdAt: 1, isSeeded: false, delegationDepth: 0 }, { type: 'session/end-seed', seq: 0, time: 1, data: {} }]
  const good = Buffer.concat(rows.map(row => zstdCompressSync(JSON.stringify(row) + '\n')))
  const corrupt = Buffer.concat([good.subarray(0, good.length - 3)])
  expect(() => decodeStoredEvidence(corrupt, 'zstd', 'root')).toThrow()
  // evidence missing is reported as incomplete, never as a behavioral fail
  const plan = { id: 'round-x', version: 'selftest-v1', items: [{ id: 'know-mem', question: 'know', kind: 'Know', condition: 'mem', writebackApplicable: false }] } as FixedRound
  const report = renderSelftestReport(plan, {}, { executions: { 'know-mem': { status: 'evidence-missing', inputTokens: 0, outputTokens: 0, sessions: ['root'] } } })
  expect(report.markdown).toContain('| 全部计划端到端 | 1 | 0 | 0 | 1 |')
  expect(report.markdown).toContain('| know-mem | evidence-missing |')
  expect(report.exitCode).not.toBe(0)
})

it('EVAL-037: 非空列表含空引文', () => {
  const result = readJudgement({ verdict: 'yes', reason: 'fictional', quotes: [{ source: 'e1', quote: ' ' }] }, [{ id: 'e1', text: 'retryLimit is 4' }])
  expect(result.verdict).toBe('unknown')
  expect(result.reason).toMatch(/空引文|blank quote/i)
})
