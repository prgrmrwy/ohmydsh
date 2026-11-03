import { describe, expect, it } from 'vitest'
import { computeRetrievalReport, type ReportInput, type RetrievalQuestion } from '../src/eval/retrieval/metrics.js'

function input(targets: string[][], slugs: string[][]): ReportInput {
  return {
    questions: targets.map((target, index) => ({ id: String(index), query: 'fixture', targets: target, type: 'single-hop', topic: String(index), origin: 'fixture', set: 'dev' })),
    observations: slugs.map((value, index) => ({ id: String(index), slugs: value, status: value.length ? 'ok' : 'empty', error: null, elapsedMs: index + 1, returnedChars: 0 })),
    distractors: [{ slug: 'D', sha256: 'fixture' }], integrity: { before: { valid: true, differences: [] }, after: { valid: true, differences: [] } },
    status: 'ok', costs: { kernelInstallationBytes: 'unknown', snapshotBytes: 123, quantileVersion: 'nearest-rank-v1', characterCountVersion: 'chars-v1' },
  }
}

describe('指标定义', () => {
  it('已知返回列表得到预期指标', () => {
    const data = input([['A'], ['B'], ['Z'], ['C']], [['A'], ['X', 'B'], ['D'], ['C']])
    const report = computeRetrievalReport(data)
    expect(report.overall).toMatchObject({ count: 4, top1: 0.5, top3: 0.75, top10: 0.75, mrr: 0.625, emptyRate: 0, misselectionRate: 0.5, distractorFirstCount: 1, note: '样本不足，只看趋势' })
    expect(report.byType['single-hop']).toEqual(report.overall)
    expect(report.byType['multi-hop'].count).toBe(0)
    const cutoff = input([['target']], [[...Array.from({ length: 10 }, (_, i) => `x${i}`), 'target']])
    expect(computeRetrievalReport(cutoff).questions[0].rank).toBe(0)
    const thirty = input(Array.from({ length: 30 }, () => ['A']), Array.from({ length: 30 }, () => ['A']))
    expect(computeRetrievalReport(thirty).overall.note).toBeNull()
    const mixed = { ...data, questions: data.questions.map((q, i) => ({ ...q, type: i === 1 ? 'multi-hop' : 'single-hop' })) as RetrievalQuestion[] }
    expect(computeRetrievalReport(mixed).byType['multi-hop']).toMatchObject({ count: 1, top1: 0, mrr: 0.5 })
  })

  it('多个可接受目标任一命中', () => {
    const first = computeRetrievalReport(input([['E', 'F']], [['F', 'E']]))
    const reordered = computeRetrievalReport(input([['F', 'E']], [['F', 'E']]))
    expect(first.questions[0].rank).toBe(1)
    expect(first.overall.misselectionRate).toBe(0)
    expect(reordered).toEqual(first)
  })

  it('空结果不计入误选', () => {
    const report = computeRetrievalReport(input([['A']], [[]]))
    expect(report.questions[0].rank).toBe(0)
    expect(report.overall).toMatchObject({ emptyRate: 1, misselectionRate: 0, distractorFirstCount: 0 })
  })
})
