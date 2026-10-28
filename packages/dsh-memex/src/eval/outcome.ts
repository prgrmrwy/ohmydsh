import type { RoundItem } from './round.js'
import type { ItemJudgements } from './plan-scoring.js'
import type { Verdict } from './scoring.js'

/** Internal checked-result projection; R and W require separate programmatic evidence. */
export function semanticOutcome(item: RoundItem, raw: unknown): ItemJudgements {
  const verdict = (value: unknown): Verdict => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown'
    const result = value as Record<string, unknown>
    if (typeof result.reason !== 'string' || !result.reason.trim()) return 'unknown'
    if (result.provenance !== 'checked' || !['yes', 'no'].includes(result.verdict as string)) return 'unknown'
    return result.verdict as Verdict
  }
  const semantic: Verdict[] = Array.isArray(raw) && raw.length === 2 ? raw.map(verdict) : ['unknown', 'unknown']
  if (item.kind !== 'Know' && item.kind !== 'Act') throw new Error('Invalid fixed item kind')
  return { R: [], K: item.kind === 'Know' ? [...semantic] : [], A: item.kind === 'Act' ? [...semantic] : [], W: [], endpoint: [...semantic] }
}
