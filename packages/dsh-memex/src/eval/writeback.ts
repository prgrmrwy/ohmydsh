export type WritebackEvent = { at: number; kind: 'request' | 'reminder' } | { at: number; kind: 'write'; success: boolean }
export type WritebackClass = 'proactive' | 'requested' | 'reminded' | 'not-written' | 'unknown'
export function observeWriteback(events: readonly WritebackEvent[]): { class: WritebackClass; failedWrites: number } {
  return { class: classifyWriteback(events), failedWrites: events.filter(event => event.kind === 'write' && !event.success).length }
}
export function classifyWriteback(events: readonly WritebackEvent[]): WritebackClass {
  if (events.some(event => !Number.isFinite(event.at) || event.at < 0)) return 'unknown'
  const writes = events.filter(event => event.kind === 'write' && event.success)
  if (!writes.length) return 'not-written'
  const first = Math.min(...writes.map(event => event.at))
  const instructions = events.filter(event => event.kind !== 'write')
  if (instructions.some(event => event.at === first)) return 'unknown'
  if (instructions.some(event => event.at < first && event.kind === 'request')) return 'requested'
  if (instructions.some(event => event.at < first && event.kind === 'reminder')) return 'reminded'
  return 'proactive'
}
