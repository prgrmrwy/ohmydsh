export type Unknown = 'unknown'
export type QuestionType = 'single-hop' | 'multi-hop'
export interface RetrievalQuestion {
  readonly id: string
  readonly query: string
  readonly targets: readonly string[]
  readonly type: QuestionType
  readonly topic: string
  readonly origin: string
  readonly set: 'dev' | 'holdout'
}
export interface RetrievalObservation {
  readonly id: string
  readonly slugs: readonly string[]
  readonly status: 'ok' | 'empty' | 'error'
  readonly error: string | null
  readonly elapsedMs: number | Unknown
  readonly returnedChars: number | Unknown
}
export interface IntegrityResult { readonly valid: boolean; readonly differences: readonly string[] }
export interface CostObservations {
  readonly kernelInstallationBytes: number | Unknown
  readonly snapshotBytes: number | Unknown
  readonly quantileVersion: string
  readonly characterCountVersion: string
}
export interface ReportInput {
  readonly questions: readonly RetrievalQuestion[]
  readonly observations: readonly RetrievalObservation[]
  readonly distractors: readonly { readonly slug: string; readonly sha256: string }[]
  readonly integrity: { readonly before: IntegrityResult; readonly after: IntegrityResult }
  readonly status: 'ok' | 'incomplete' | 'invalid'
  readonly costs: CostObservations
}
export function computeRetrievalReport(input: ReportInput) {
  const status = input.status === 'invalid' || !input.integrity.before.valid || !input.integrity.after.valid ? 'invalid'
    : input.status === 'incomplete' || input.observations.some(o => o.status === 'error') ? 'incomplete' : 'ok'
  const byId = new Map(input.observations.map(o => [o.id, o]))
  if (byId.size !== input.observations.length || byId.size !== input.questions.length) throw new Error('Observation/question count mismatch')
  const distractors = new Set(input.distractors.map(d => d.slug))
  const questions = input.questions.map(question => {
    const observation = byId.get(question.id)
    if (!observation) throw new Error(`Missing observation: ${question.id}`)
    const slugs = observation.status === 'ok' ? observation.slugs.slice(0, 10) : []
    const index = slugs.findIndex(slug => question.targets.includes(slug))
    const misselected = slugs.length > 0 && !question.targets.includes(slugs[0]!)
    return { ...observation, type: question.type, rank: index < 0 ? 0 : index + 1, misselected, distractorFirst: misselected && distractors.has(slugs[0]!) }
  })
  function summarize(rows: typeof questions) {
    const count = rows.length
    const rate = (value: number): number | Unknown => status === 'invalid' || !count ? 'unknown' : value / count
    const emptyCount = rows.filter(o => o.status === 'empty').length
    return {
      count, top1: rate(rows.filter(o => o.rank === 1).length), top3: rate(rows.filter(o => o.rank > 0 && o.rank <= 3).length),
      top10: rate(rows.filter(o => o.rank > 0).length), mrr: rate(rows.reduce((sum, o) => sum + (o.rank ? 1 / o.rank : 0), 0)),
      emptyCount, emptyRate: rate(emptyCount), misselectionRate: rate(rows.filter(o => o.misselected).length),
      distractorFirstCount: rows.filter(o => o.distractorFirst).length, note: count < 30 ? '样本不足，只看趋势' : null,
    }
  }
  const times = questions.map(o => o.elapsedMs).filter((n): n is number => typeof n === 'number').sort((a, b) => a - b)
  const chars = questions.map(o => o.returnedChars).filter((n): n is number => typeof n === 'number').sort((a, b) => a - b)
  const quantile = (p: number): number | Unknown => times.length < 2 ? 'unknown' : times[Math.ceil(p * times.length) - 1]!
  const middle = Math.floor(chars.length / 2)
  const costs = {
    p50Ms: quantile(0.5), p95Ms: quantile(0.95),
    returnedCharsMedian: chars.length ? chars.length % 2 ? chars[middle]! : (chars[middle - 1]! + chars[middle]!) / 2 : 'unknown' as Unknown,
    returnedCharsCount: chars.length, kernelInstallationBytes: input.costs.kernelInstallationBytes, snapshotBytes: input.costs.snapshotBytes, extraRanking: false,
  }
  return {
    status, validBaseline: status === 'ok', integrity: input.integrity,
    overall: summarize(questions), byType: { 'single-hop': summarize(questions.filter(q => q.type === 'single-hop')), 'multi-hop': summarize(questions.filter(q => q.type === 'multi-hop')) },
    questions, errors: questions.filter(q => q.status === 'error').map(q => ({ id: q.id, error: q.error })), costs,
  }
}

export function renderRetrievalReport(report: ReturnType<typeof computeRetrievalReport>): string {
  const cost = report.costs
  const rows = [['整体', report.overall], ['single-hop', report.byType['single-hop']], ['multi-hop', report.byType['multi-hop']]] as const
  const table = rows.map(([label, row]) => `| ${label} | ${row.count} | ${row.top1} | ${row.top3} | ${row.top10} | ${row.mrr} | ${row.emptyRate} | ${row.misselectionRate} | ${row.distractorFirstCount} | ${cost.p50Ms} | ${cost.p95Ms} | ${cost.returnedCharsMedian} | ${cost.returnedCharsCount} | ${cost.kernelInstallationBytes} | ${cost.snapshotBytes} | 否 | ${row.note ?? ''} |`)
  return [
    `状态：${report.status}；有效基线：${report.validBaseline ? '是' : '否'}`, '',
    '指标基于排除元卡后的快照。返回文本字符数（chars-v1）包含解析后保留的附加行；耗时包含每题内核进程启动。成本列均为本轮整体观测；p50/p95 使用最近秩（nearest-rank-v1），字符数中位数在偶数题时取中间两项平均。', '',
    '| 集合 | 题数 | 首位 | 前三 | 前十 | MRR | 空结果率 | 误选率 | 首位干扰卡 | p50 ms | p95 ms | 字符数中位数 | 字符数参与题数 | 安装大小 bytes | 快照大小 bytes | 额外排序 | 备注 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...table, '',
    ...report.errors.map(q => `错误题：${q.id} (${q.error})`),
    ...[...new Set([...report.integrity.before.differences, ...report.integrity.after.differences])].map(path => `完整性差异：${path}`), '',
  ].join('\n')
}
