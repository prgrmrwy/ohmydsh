export type Verdict = 'yes' | 'no' | 'unknown'
export type LayerStatus = 'pass' | 'fail' | 'unknown' | 'not-applicable'
export interface ConditionJudgements { writebackApplicable?: boolean; kind: 'Know' | 'Act'; condition: 'mem' | 'nomem'; R: Verdict[]; K: Verdict[]; A: Verdict[]; W: Verdict[]; endpoint: Verdict[] }
export function aggregateLayer(values: readonly Verdict[]): LayerStatus {
  if (!values.length) return 'not-applicable'
  if (values.includes('no')) return 'fail'
  if (values.includes('unknown')) return 'unknown'
  return 'pass'
}
export function summarizeCondition(input: ConditionJudgements): { layers: Record<'R' | 'K' | 'A' | 'W', LayerStatus>; funnel: { K: boolean; A: boolean }; endpoint: LayerStatus } {
  const required = (values: Verdict[]): LayerStatus => values.length ? aggregateLayer(values) : 'unknown'
  const R = input.condition === 'mem' ? required(input.R) : 'not-applicable'
  return {
    layers: { R, K: input.kind === 'Know' ? required(input.K) : 'not-applicable', A: input.kind === 'Act' ? required(input.A) : 'not-applicable', W: input.writebackApplicable === false ? 'not-applicable' : input.writebackApplicable === true ? required(input.W) : aggregateLayer(input.W) },
    funnel: { K: input.kind === 'Know' && (input.condition === 'nomem' || R === 'pass'), A: input.kind === 'Act' && (input.condition === 'nomem' || R === 'pass') },
    endpoint: required(input.endpoint),
  }
}
