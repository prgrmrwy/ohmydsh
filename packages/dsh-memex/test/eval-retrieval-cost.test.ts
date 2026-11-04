import { describe, expect, it } from 'vitest'
import { computeRetrievalReport, renderRetrievalReport, type ReportInput } from '../src/eval/retrieval/metrics.js'

function fixture(count: number): ReportInput {
  return {
    questions: Array.from({ length: count }, (_, i) => ({ id: String(i), query: 'fixture', targets: ['A'], type: 'single-hop', topic: String(i), origin: 'fixture', set: 'dev' })),
    observations: Array.from({ length: count }, (_, i) => ({ id: String(i), slugs: ['A'], status: 'ok', error: null, elapsedMs: [50, 10, 40, 20, 30][i]!, returnedChars: [8, 2, 6, 4, 10][i]! })),
    distractors: [], integrity: { before: { valid: true, differences: [] }, after: { valid: true, differences: [] } }, status: 'ok',
    costs: { kernelInstallationBytes: 123456, snapshotBytes: 789, quantileVersion: 'nearest-rank-v1', characterCountVersion: 'chars-v1' },
  }
}

describe('成本与指标同表报告', () => {
  it('成本列存在且不影响状态', () => {
    const data = fixture(5)
    const report = computeRetrievalReport(data)
    expect(report.status).toBe('ok')
    expect(report.costs).toEqual({ p50Ms: 30, p95Ms: 50, returnedCharsMedian: 6, returnedCharsCount: 5, kernelInstallationBytes: 123456, snapshotBytes: 789, extraRanking: false })
    const markdown = renderRetrievalReport(report)
    const headers = markdown.split('\n').find(line => line.startsWith('| 集合 |'))!
    expect(headers).toContain('首位')
    for (const heading of ['p50', 'p95', '字符数中位数', '安装大小', '快照大小']) expect(headers).toContain(heading)
    expect(markdown).toContain('返回文本字符数（chars-v1）')
    expect(markdown).not.toMatch(/pass|fail|warning|token/i)
    const expensive = computeRetrievalReport({ ...data, costs: { ...data.costs, kernelInstallationBytes: 1e15, snapshotBytes: 'unknown' }, observations: data.observations.map(o => ({ ...o, elapsedMs: 1e12 })) })
    expect(expensive.status).toBe('ok')
    expect(expensive.costs.snapshotBytes).toBe('unknown')
    expect(computeRetrievalReport(fixture(4)).costs.returnedCharsMedian).toBe(5)
  })

  it('单题套件的分位数为 unknown', () => {
    const report = computeRetrievalReport(fixture(1))
    expect(report.costs).toMatchObject({ p50Ms: 'unknown', p95Ms: 'unknown' })
    expect(report.status).toBe('ok')
    const unknown = computeRetrievalReport({ ...fixture(1), observations: [{ ...fixture(1).observations[0]!, returnedChars: 'unknown', elapsedMs: 'unknown' }] })
    expect(unknown.costs).toMatchObject({ returnedCharsMedian: 'unknown', returnedCharsCount: 0 })
  })
})
