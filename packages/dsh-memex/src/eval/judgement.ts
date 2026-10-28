import { checkQuotes, type EvidenceText } from './quotes.js'
import type { Verdict } from './scoring.js'
export interface CheckedJudgement { verdict: Verdict; provenance: 'checked' | 'invalid' | 'not-required'; reason: string }
export function readItemJudgement(value: unknown, answers: readonly EvidenceText[]): CheckedJudgement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return readJudgement(value, answers)
  const { writeback: _writeback, ...answer } = value as Record<string, unknown>
  return readJudgement(answer, answers)
}
export function readJudgement(value: unknown, evidence: readonly EvidenceText[]): CheckedJudgement {
  const invalid = (): CheckedJudgement => ({ verdict: 'unknown', provenance: 'invalid', reason: 'Invalid judgement shape or quote provenance; inspect raw response' })
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => !['verdict', 'quotes', 'reason'].includes(key))
    || !['yes', 'no', 'unknown'].includes(item.verdict as string) || typeof item.reason !== 'string' || !item.reason.trim() || !Array.isArray(item.quotes)) return invalid()
  const quotes: { source: string; quote: string }[] = []
  for (const quote of item.quotes) {
    if (!quote || typeof quote !== 'object' || Array.isArray(quote) || Object.keys(quote).some(key => !['source', 'quote'].includes(key))
      || typeof quote.source !== 'string' || typeof quote.quote !== 'string') return invalid()
    quotes.push({ source: quote.source, quote: quote.quote })
  }
  if (item.verdict === 'unknown' && quotes.length === 0) return { verdict: 'unknown', provenance: 'not-required', reason: item.reason }
  if (quotes.some(quote => !quote.quote.trim())) return { verdict: 'unknown', provenance: 'invalid', reason: '空引文：引文为空或仅含空白，无法核对出处' }
  if (!checkQuotes(quotes, evidence)) return invalid()
  return { verdict: item.verdict as Verdict, provenance: 'checked', reason: item.reason }
}
