import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { confirmFixedSelftest, describeFixedPlan } from '../src/eval/consent.js'
import { registerFixedRound } from '../src/eval/round.js'
import { requireSameHostResume } from '../src/eval/resume.js'

const request = { version: 'selftest-v1', tested: { provider: 'mock', model: 'tested' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 }

it('EVAL-043: 配对裁判预算不漏计', async () => {
  const plan = registerFixedRound(mkdtempSync(join(realpathSync(tmpdir()), 'eval-plan-')), request)
  const counts = describeFixedPlan(plan)
  expect(counts).toEqual({ treatment: 3, control: 3, judgeParents: 1, followUps: 2, maxJudgeCalls: 12, descendantBudget: 'unknown' })
  // derived from the frozen plan, not hardcoded: every condition's criteria are counted, control included
  expect(counts.maxJudgeCalls).toBe(plan.items.reduce((sum, item) => sum + item.judgements.length, 0))
  let notice = ''
  await confirmFixedSelftest(request, async text => { notice = text; return 'no' }, async () => 'unused').catch(() => undefined)
  for (const text of ['顶层 3', '对照 3', '裁判父 1', '追问回合 2', '最多 12 次', '后代', '未知']) expect(notice).toContain(text)
})

it('the budget is a soft monitor: spontaneous descendant cost is reported as outside the plan budget, not blocked', async () => {
  const { renderSelftestReport } = await import('../src/eval/report.js')
  const plan = { id: 'round-x', version: 'selftest-v1', items: [{ id: 'know-mem', question: 'know', kind: 'Know', condition: 'mem', writebackApplicable: false }] } as never
  const audit = { status: 'valid' as const, inputTokens: 9, outputTokens: 3, sessions: ['root', 'spontaneous-child'] }
  const report = renderSelftestReport(plan, {}, { executions: { 'know-mem': audit } })
  expect(report.markdown).toContain('| know-mem | 1 |')
  expect(report.markdown).toContain('软监测上限')
})

it('EVAL-044: 活资源阻止续跑', async () => {
  let attempted = false
  const unreleased = ['job:bash-7f3a', 'session:session-1b2c']
  await expect(requireSameHostResume({ frozenGeneration: 'host', generation: 'host', healthy: true, pending: 0, unreleased }, async () => { attempted = true })).rejects.toThrow(/job:bash-7f3a[\s\S]*session:session-1b2c/)
  expect(attempted).toBe(false)
})
