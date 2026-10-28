import type { FixedRound } from './round.js'
import { summarizeCondition, type ConditionJudgements, type LayerStatus } from './scoring.js'
export type ItemJudgements = Pick<ConditionJudgements, 'R' | 'K' | 'A' | 'W' | 'endpoint'>
export interface Counts { denominator: number; pass: number; fail: number; unknown: number }
function count(values: LayerStatus[]): Counts {
  return { denominator: values.length, pass: values.filter(v => v === 'pass').length, fail: values.filter(v => v === 'fail').length, unknown: values.filter(v => v === 'unknown').length }
}
export function summarizePlan(plan: FixedRound, outcomes: Record<string, ItemJudgements>) {
  const ids = new Set(plan.items.map(item => item.id))
  if (Object.keys(outcomes).some(id => !ids.has(id))) throw new Error('Outcome outside frozen plan')
  const items = plan.items.map(item => ({ id: item.id, ...summarizeCondition({
    ...(outcomes[item.id] ?? { R: [], K: [], A: [], W: [], endpoint: [] }), kind: item.kind, condition: item.condition, writebackApplicable: item.writebackApplicable,
  }) }))
  return {
    items, endpoint: count(items.map(item => item.endpoint)),
    writeback: count(items.filter((_, i) => plan.items[i]!.writebackApplicable).map(item => item.layers.W)),
    actionFunnel: count(items.filter(item => item.funnel.A).map(item => item.layers.A)),
    knowFunnel: count(items.filter(item => item.funnel.K).map(item => item.layers.K)),
  }
}
