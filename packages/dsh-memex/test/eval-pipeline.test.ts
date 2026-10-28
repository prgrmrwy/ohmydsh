import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { registerFixedRound } from '../src/eval/round.js'
import { EvalLedger } from '../src/eval/ledger.js'
import { freezeInput, readFrozenInput } from '../src/eval/freeze.js'
import { collectItemEvidence } from '../src/eval/collection.js'
import { scoreFrozenItem } from '../src/eval/score-item.js'
import { buildOfflineReport } from '../src/eval/offline-report.js'

const registration = { version: 'selftest-v1', tested: { provider: 'mock', model: 'tested' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 }
const boundary = { home: '/fictional', own: { cwd: '/fictional/.dsh-memex-eval-runs/mem/eval-a/repo', home: '/fictional/.dsh-memex/eval-a-repo' } }

function events(answer: string, foreignRead = false) {
  return [
    { type: 'request/header', seq: 0, data: { header: { config: registration.tested } } },
    { type: 'assistant/message', seq: 1, data: { message: { content: [
      { type: 'text', text: answer },
      { type: 'tool-call', id: 'read-1', name: 'read', arguments: JSON.stringify({ path: foreignRead ? '/fictional/.dsh-memex/personal/cards/private.md' : `${boundary.own.cwd}/config.json` }) },
    ] }, usage: { inputTokens: 2, outputTokens: 3 }, stream: [] } },
    { type: 'tool/result', seq: 2, data: { message: { toolCallId: 'read-1', content: [{ type: 'text', text: 'fictional configuration' }] } } },
  ] as never
}

it('collects and scores all six frozen conditions, then rebuilds a read-only report from the actual collector artifacts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'eval-pipeline-'))
  const plan = registerFixedRound(root, registration)
  const ledger = new EvalLedger(join(root, plan.id))
  let calls = 0
  for (const item of plan.items) {
    const directory = join(root, plan.id, item.id)
    const session = ledger.reserve(plan.id, item.question, item.condition)
    mkdirSync(directory)
    freezeInput(join(directory, 'attempt'), { session })
    const answer = item.requiredFacts.join('; ')
    await collectItemEvidence(directory, ledger, session, plan.tested,
      async id => ({ id, inheritedEventCount: 0, events: events(answer) }), boundary)
    expect(readFrozenInput(join(directory, 'program-evidence'))).toMatchObject({ retrieval: [], writes: [] })
    await scoreFrozenItem(directory, item, plan.judge, async protocol => {
      calls++
      const input = JSON.parse(protocol.prompt) as { evidence: { id: string; text: string }[] }
      const evidence = input.evidence[0]!
      return { verdict: 'yes', reason: 'Fixed fictional protocol response; not a calibrated semantic judge', quotes: [{ source: evidence.id, quote: evidence.text }] }
    })
  }
  expect(calls).toBe(12)
  const report = buildOfflineReport(root, plan.id)
  expect(report).toEqual(buildOfflineReport(root, plan.id))
  expect(report.markdown).toContain('| 全部计划端到端 | 6 | 4 | 2 | 0 |')
  expect(report.markdown).toContain('mock/tested')
  expect(report.markdown).toContain('## 程序观察与写回时序')
  expect(report.markdown).toContain('| writeback-mem | 0 | 0 | 0 | not-written |')
  expect(report.markdown).toContain('| know-mem | fail | pass |')
  expect(report.markdown).toContain('| writeback-mem | fail | not-applicable | pass | fail |')
  // Observed no-retrieval/no-write is a behavioral fail, not missing infrastructure evidence.
  expect(report.exitCode).toBe(0)
  // No retirement proof was supplied: artifacts must not become a claim that agents were stopped.
  expect(report.markdown).not.toContain('测试根会话已归档并静止')
})

it('carries the real collector contamination artifact into the offline report and never scores that item', async () => {
  const root = mkdtempSync(join(tmpdir(), 'eval-pipeline-contaminated-'))
  const plan = registerFixedRound(root, registration)
  const ledger = new EvalLedger(join(root, plan.id))
  const item = plan.items[0]!, directory = join(root, plan.id, item.id)
  const session = ledger.reserve(plan.id, item.question, item.condition)
  mkdirSync(directory)
  freezeInput(join(directory, 'attempt'), { session })
  await expect(collectItemEvidence(directory, ledger, session, plan.tested,
    async id => ({ id, inheritedEventCount: 0, events: events('fictional answer', true) }), boundary)).rejects.toThrow(/环境污染/)
  const report = buildOfflineReport(root, plan.id)
  expect(report.markdown).toContain('| know-mem | 环境污染 | read | real-library |')
  expect(report.markdown).toContain('事后检测')
  expect(report.exitCode).toBe(1)
})
