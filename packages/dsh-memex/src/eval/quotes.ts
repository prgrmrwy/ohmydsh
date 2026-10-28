export interface EvidenceText { id: string; text: string }
export interface EvidenceQuote { source: string; quote: string }
/** Provenance check only: exact occurrence is not semantic support for a verdict. */
export function checkQuotes(quotes: readonly EvidenceQuote[], evidence: readonly EvidenceText[]): boolean {
  const sources = new Map(evidence.map(item => [item.id, item.text]))
  if (sources.size !== evidence.length || quotes.length === 0) return false
  return quotes.every(item => item.quote.trim().length > 0 && sources.get(item.source)?.includes(item.quote) === true)
}
