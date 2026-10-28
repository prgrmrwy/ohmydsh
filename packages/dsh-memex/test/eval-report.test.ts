import { expect, it } from 'vitest'
import { renderSelftestReport } from '../src/eval/report.js'
import type { FixedRound } from '../src/eval/round.js'
const plan = { id: 'round-fictional', version: 'selftest-v1', items: [{ id: 'know-mem', question: 'know', kind: 'Know', condition: 'mem', writebackApplicable: false }, { id: 'know-nomem', question: 'know', kind: 'Know', condition: 'nomem', writebackApplicable: false }] } as FixedRound
it('EVAL-045: 配对相同保留控制', () => {
  const same = { R: [], K: ['yes' as const, 'yes' as const], A: [], W: [], endpoint: ['yes' as const, 'yes' as const] }
  const audit = { status: 'valid' as const, inputTokens: 10, outputTokens: 2, sessions: ['s'] }
  const report = renderSelftestReport(plan, { 'know-mem': { ...same, R: ['yes'] }, 'know-nomem': same }, { executions: { 'know-mem': audit, 'know-nomem': { ...audit, sessions: ['n'] } } })
  expect(report.markdown).toContain('| know-mem |')
  expect(report.markdown).toContain('| know-nomem |')
  expect(report.markdown).toContain('| know | 本次观测相同 |')
})

it('a pair with missing cost evidence is unknown, never reported as the same observation', () => {
  const same = { R: [], K: ['yes' as const, 'yes' as const], A: [], W: [], endpoint: ['yes' as const, 'yes' as const] }
  const report = renderSelftestReport(plan, { 'know-mem': { ...same, R: ['yes'] }, 'know-nomem': same }, { executions: { 'know-mem': { status: 'valid', inputTokens: 1, outputTokens: 1, sessions: ['s'] } } })
  expect(report.markdown).toContain('| know | unknown |')
  expect(report.markdown).not.toContain('本次观测相同')
})

it('EVAL-046: 全部语义 unknown', () => {
  const report = renderSelftestReport(plan, {})
  expect(report.exitCode).not.toBe(0)
  expect(report.markdown).toContain('未完成')
  for (const forbidden of ['区间', '有效率', '净节省', '总分', '已达']) {
    expect(report.markdown.replace(/不计算收益、区间或显著性/g, '')).not.toContain(forbidden)
  }
})

it('renders deterministic all-plan counts and declares uncalibrated diagnostic limits', () => {
  const data = { 'know-mem': { R: ['no' as const], K: ['yes' as const], A: [], W: [], endpoint: ['yes' as const] } }
  const first = renderSelftestReport(plan, data)
  expect(first).toEqual(renderSelftestReport(plan, data))
  expect(first.markdown).toContain('know-nomem')
  expect(first.markdown).toContain('2 | 1 | 0 | 1')
  expect(first.markdown).toContain('不代表 Memex 效果')
  expect(first.markdown).toContain('未校准')
  expect(first.exitCode).toBe(1)
})
it('reports recursive tested token categories separately from judge cost without claiming unprovided coverage', () => {
  const report = renderSelftestReport(plan, {}, {
    executions: { 'know-mem': { status: 'valid', inputTokens: 15, outputTokens: 2, sessions: ['root', 'child'], tokenCategories: { uncachedInput: 2, cacheRead: 10, cacheWrite: 3 } } },
    judges: { inputTokens: 7, outputTokens: 1, calls: 2 },
  })
  expect(report.markdown).toContain('| know-mem | valid | 2 | 15 | 2 | 10 | 3 | 2 |')
  expect(report.markdown).toContain('| know-nomem | unknown | unknown | unknown | unknown | unknown | unknown | unknown |')
  expect(report.markdown).toContain('裁判：2 次；输入 7；输出 1（独立列示，不合并进被测成本）')
  expect(report.markdown).toContain('人工复核覆盖')
  expect(report.exitCode).toBe(1)
})
it('refuses unplanned diagnostic rows instead of silently assigning their costs to the plan', () => {
  expect(() => renderSelftestReport(plan, {}, { executions: { daily: { status: 'valid', inputTokens: 100, outputTokens: 1, sessions: ['daily'] } } })).toThrow(/outside/)
})

it('configuration contamination makes an otherwise complete semantic report nonzero', () => {
  const yes = { R: ['yes' as const], K: ['yes' as const], A: [], W: [], endpoint: ['yes' as const] }
  const result = renderSelftestReport(plan, { 'know-mem': yes, 'know-nomem': yes }, { executions: { 'know-mem': { status: 'configuration-mismatch', inputTokens: 1, outputTokens: 1, sessions: ['root'] } } })
  expect(result.exitCode).toBe(1)
})
it('discloses selected visible-answer coverage without inventing judge or human consumption', () => {
  const report = renderSelftestReport(plan, {}, { selections: { 'know-mem': { available: 3, selected: 2, omitted: ['root:3'], full: false } }, defaultModelNotice: '请手动检查默认值；工具不会自动写回。' })
  expect(report.markdown).toContain('| know-mem | 3 | 2 | 1 | unknown | unknown |')
  expect(report.markdown).toContain('仅可见 assistant 答案事件，不代表完整日志覆盖')
  expect(report.markdown).toContain('请手动检查默认值；工具不会自动写回。')
})

it('labels incomplete usage sums as observed subtotals instead of claiming complete costs', () => {
  const report = renderSelftestReport(plan, {}, { executions: { 'know-mem': { status: 'evidence-missing', inputTokens: 4, outputTokens: 2, sessions: ['root'] } } })
  expect(report.markdown).toContain('非 valid 行的数值仅为已观测小计，不是完整成本；缺失或溢出的用量不能当零。')
})

it('all unknown results mean incomplete with nonzero exit', () => {
  const result = renderSelftestReport(plan, {})
  expect(result.exitCode).toBe(1)
  expect(result.markdown).toContain('unknown')
})
