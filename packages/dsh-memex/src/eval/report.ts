import type { FixedRound } from './round.js'
import { summarizePlan, type ItemJudgements, type Counts } from './plan-scoring.js'
import type { ExecutionAudit } from './audit.js'
import type { EvidenceSelection } from './selection.js'
import type { BoundaryHit } from './boundary.js'
export interface ReportDiagnostics { contaminated?: Record<string, readonly BoundaryHit[]>; selections?: Record<string, EvidenceSelection['coverage']>; defaultModelNotice?: string; executions?: Record<string, ExecutionAudit>; judges?: { calls: number; inputTokens: number; outputTokens: number } }
export function renderSelftestReport(plan: FixedRound, judged: Record<string, ItemJudgements>, diagnostics?: ReportDiagnostics): { markdown: string; exitCode: number } {
  const ids = new Set(plan.items.map(item => item.id))
  for (const id of [...Object.keys(diagnostics?.executions ?? {}), ...Object.keys(diagnostics?.selections ?? {}), ...Object.keys(diagnostics?.contaminated ?? {})]) if (!ids.has(id)) throw new Error('Diagnostic item outside frozen plan')
  const polluted = new Set(Object.entries(diagnostics?.contaminated ?? {}).filter(([, hits]) => hits.length).map(([id]) => id))
  // contaminated items never enter judgement: their semantic results are dropped and stay unknown
  const outcomes = Object.fromEntries(Object.entries(judged).filter(([id]) => !polluted.has(id)))
  const result = summarizePlan(plan, outcomes)
  const contamination = polluted.size ? [
    '## 环境污染（事后检测，不是预防）', '',
    '以下条件的成功工具调用访问了已知真实库、套件答案或其他条件的路径；该项停止，不进入判定。此防线只能事后检测已知路径，不能发现全部隐蔽访问。', '',
    '| 条件 | 状态 | 工具 | 路径类别 |', '| --- | --- | --- | --- |',
    ...[...polluted].sort().flatMap(id => (diagnostics!.contaminated![id] ?? []).map(hit => `| ${id} | 环境污染 | ${hit.tool} | ${hit.kind} |`)), '',
  ] : []
  const rawCosts = diagnostics ? [
    '## 原始成本（递归后代，seed 去重）', '',
    '非 valid 行的数值仅为已观测小计，不是完整成本；缺失或溢出的用量不能当零。', '',
    '| 条件 | 审计 | 会话数 | 输入合计 | 未缓存输入 | cache read | cache write | 输出 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...plan.items.map(item => {
      const audit = diagnostics.executions?.[item.id], c = audit?.tokenCategories
      return `| ${item.id} | ${audit?.status ?? 'unknown'} | ${audit?.sessions.length ?? 'unknown'} | ${audit?.inputTokens ?? 'unknown'} | ${c?.uncachedInput ?? 'unknown'} | ${c?.cacheRead ?? 'unknown'} | ${c?.cacheWrite ?? 'unknown'} | ${audit?.outputTokens ?? 'unknown'} |`
    }), '',
    '## 自发后代（预算外，软监测上限而非硬屏障）', '',
    '计划预算只覆盖固定会话与裁判请求；被测会话自发创建的后代数量与成本无法预先限定，此处只做事后统计。', '',
    '| 条件 | 自发后代会话数 |', '| --- | ---: |',
    ...plan.items.map(item => {
      const audit = diagnostics.executions?.[item.id]
      return `| ${item.id} | ${audit ? Math.max(0, audit.sessions.length - 1) : 'unknown'} |`
    }), '',
    '## 实际请求路线（事后审计，请求已发出；不是预防）', '',
    '| 条件 | 会话 | 路线 | 请求数 |', '| --- | --- | --- | ---: |',
    ...plan.items.flatMap(item => (diagnostics.executions?.[item.id]?.observedRoutes ?? []).map(route =>
      `| ${item.id} | ${route.session} | ${route.provider}/${route.model}${route.effort ? `@${route.effort}` : ''} | ${route.requests} |`)), '',
    diagnostics.judges ? `裁判：${diagnostics.judges.calls} 次；输入 ${diagnostics.judges.inputTokens}；输出 ${diagnostics.judges.outputTokens}（独立列示，不合并进被测成本）` : '裁判成本：unknown（未提供完整独立调用证据）。', '',
  ] : []
  const count = (label: string, c: Counts) => `| ${label} | ${c.denominator} | ${c.pass} | ${c.fail} | ${c.unknown} |`
  const incomplete = polluted.size > 0 || result.items.some(item => item.endpoint === 'unknown' || Object.values(item.layers).includes('unknown'))
    || (diagnostics !== undefined && plan.items.some(item => diagnostics.executions?.[item.id]?.status !== 'valid'))
  const lines = [
    '# Memex 固定虚构自检', '', `Round: ${plan.id} (${plan.version})`, '',
    '仅检查链路；裁判未校准，不代表 Memex 效果。不计算收益、区间或显著性。引文匹配只校验出处，不证明语义。', '',
    '测试根会话已归档并静止，未销毁；会话历史保留，日常会话不受影响。', '',
    '宿主可达限制：被测普通会话不是安全沙箱，可读宿主上的真实文件或题目答案；越界访问与请求路线只做事后审计，发现即判为污染并停止，已发出的请求无法追回。', '',
    '| 范围 | 分母 | pass | fail | unknown |', '| --- | ---: | ---: | ---: | ---: |',
    count('全部计划端到端', result.endpoint), count('独立写回', result.writeback), count('Know 条件漏斗', result.knowFunnel), count('Act 条件漏斗', result.actionFunnel), '',
    '| 条件 | R | K | A | W | 端点 |', '| --- | --- | --- | --- | --- | --- |',
    ...result.items.map(item => `| ${item.id} | ${item.layers.R} | ${item.layers.K} | ${item.layers.A} | ${item.layers.W} | ${item.endpoint} |`), '',
    '## 配对观察（仅描述本次，不是改善或收益）', '',
    '| 题目 | 本次观测 |', '| --- | --- |',
    ...[...new Set(plan.items.map(item => item.question))].map(question => {
      const pair = ['mem', 'nomem'].map(condition => {
        const item = plan.items.find(entry => entry.question === question && entry.condition === condition)
        const summary = result.items.find(entry => entry.id === item?.id)
        const audit = item && diagnostics?.executions?.[item.id]
        return summary && summary.endpoint !== 'unknown' && audit?.status === 'valid' ? `${summary.endpoint}:${audit.inputTokens}:${audit.outputTokens}` : undefined
      })
      return `| ${question} | ${pair.includes(undefined) ? 'unknown' : pair[0] === pair[1] ? '本次观测相同' : '本次观测不同'} |`
    }), '',
    incomplete ? '状态：未完成（unknown/缺证不得当作通过）。' : '状态：语义判据已收齐；fail 是观察结果，不是链路缺证。', '',
    ...contamination,
    ...rawCosts,
    '## 覆盖范围', '', '选段范围仅可见 assistant 答案事件，不代表完整日志覆盖；冻结或裁判返回不等于独立核验的实际实收，更不代表人工复核。', '',
    '| 条件 | 可选事件 | 已选 | 遗漏 | 裁判实收 | 人工复核覆盖 |', '| --- | ---: | ---: | ---: | --- | --- |',
    ...plan.items.map(item => {
      const c = diagnostics?.selections?.[item.id]
      return `| ${item.id} | ${c?.available ?? 'unknown'} | ${c?.selected ?? 'unknown'} | ${c?.omitted.length ?? 'unknown'} | unknown | unknown |`
    }), '',
    '## 默认模型待确认', '', diagnostics?.defaultModelNotice || 'unknown（未提供运行前/当前默认值及人工确认记录）。工具不会自动写回。', '',
    '采集范围、实际裁判实收、人工复核覆盖及默认模型确认均需各自证据；本摘要不推断未提供的项目已完成。', '',
  ]
  return { markdown: lines.join('\n'), exitCode: incomplete ? 1 : 0 }
}
