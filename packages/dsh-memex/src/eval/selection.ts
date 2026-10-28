import { createHash } from 'node:crypto'
import { freezeInput, readFrozenInput } from './freeze.js'
import type { EvidenceText } from './quotes.js'
export interface EvidenceSelection { version: 'selection-v1'; evidence: (EvidenceText & { sha256: string })[]; coverage: { available: number; selected: number; omitted: string[]; full: boolean } }
export function freezeSelection(directory: string, evidence: readonly EvidenceText[], ids: readonly string[]): EvidenceSelection {
  const byId = new Map(evidence.map(item => [item.id, item]))
  if (byId.size !== evidence.length || new Set(ids).size !== ids.length || !ids.length) throw new Error('Invalid selection identities')
  const selected = ids.map(id => {
    const item = byId.get(id)
    if (!item || !item.text.trim()) throw new Error('Invalid selection source')
    return { id: item.id, text: item.text, sha256: createHash('sha256').update(item.text).digest('hex') }
  })
  const included = new Set(ids), omitted = evidence.filter(item => !included.has(item.id)).map(item => item.id)
  const selection: EvidenceSelection = { version: 'selection-v1', evidence: selected, coverage: { available: evidence.length, selected: selected.length, omitted, full: omitted.length === 0 } }
  freezeInput(directory, selection)
  return selection
}
function fields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid frozen selection fields')
  return value as Record<string, unknown>
}
export function loadSelection(directory: string): EvidenceSelection {
  const selection = fields(readFrozenInput(directory), ['version', 'evidence', 'coverage'])
  if (selection.version !== 'selection-v1' || !Array.isArray(selection.evidence) || !selection.evidence.length) throw new Error('Frozen selection mismatch')
  const ids = new Set<string>()
  for (const raw of selection.evidence) {
    const item = fields(raw, ['id', 'text', 'sha256'])
    if (typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id) || typeof item.text !== 'string' || !item.text.trim()
      || createHash('sha256').update(item.text).digest('hex') !== item.sha256) throw new Error('Invalid frozen evidence')
    ids.add(item.id)
  }
  const coverage = fields(selection.coverage, ['available', 'selected', 'omitted', 'full'])
  if (!Array.isArray(coverage.omitted) || coverage.omitted.some(id => typeof id !== 'string' || !id.trim() || ids.has(id))
    || new Set(coverage.omitted).size !== coverage.omitted.length || coverage.selected !== ids.size
    || coverage.available !== ids.size + coverage.omitted.length || coverage.full !== (coverage.omitted.length === 0)) throw new Error('Frozen coverage mismatch')
  return selection as unknown as EvidenceSelection
}
