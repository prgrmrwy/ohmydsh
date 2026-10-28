import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvalLedger } from './ledger.js'
import type { ModelRoute } from './round.js'
import type { ExecutionAudit } from './audit.js'
import type { EvidenceSelection } from './selection.js'
export interface CollectedSession { id: string; parent?: string; inheritedEventCount: number; events: readonly SessionEvent[] }
import { auditExecution } from './audit.js'
import { auditSessionEvents } from './event-audit.js'
import { assistantEvidence, toolResultEvidence } from './evidence-text.js'
import { detectBoundaryAccess } from './boundary.js'
import { freezeSelection } from './selection.js'
import { freezeInput } from './freeze.js'
import { join } from 'node:path'
import { programEvidence } from './program-evidence.js'

export async function collectItemEvidence(directory: string, ledger: EvalLedger, root: string, route: ModelRoute, read: (id: string) => Promise<CollectedSession>, boundary?: Parameters<typeof detectBoundaryAccess>[1], naturalPrompts: readonly string[] = []): Promise<{ audit: ExecutionAudit; selection: EvidenceSelection }> {
  const entries = ledger.read()
  if (!entries.some(entry => entry.kind === 'reserved' && entry.id === root)) throw new Error('Unregistered evidence root identity')
  const parents = new Map<string, string>(), ids = new Set([root])
  let changed = true
  while (changed) {
    changed = false
    for (const entry of entries) if (entry.kind === 'child' && entry.parent && ids.has(entry.parent)) {
      if (parents.has(entry.id) && parents.get(entry.id) !== entry.parent) throw new Error('Conflicting evidence lineage')
      parents.set(entry.id, entry.parent)
      if (!ids.has(entry.id)) { ids.add(entry.id); changed = true }
    }
  }
  const sessions: CollectedSession[] = []
  for (const id of ids) {
    const actual = await read(id)
    if (actual.id !== id || (id !== root && actual.parent !== parents.get(id))) throw new Error('Stored evidence identity mismatch')
    sessions.push(actual)
  }
  if (JSON.stringify(ledger.read()) !== JSON.stringify(entries)) throw new Error('Resource identity ledger changed during collection; release proof must be rechecked')
  const audit = auditExecution(root, route, sessions.map(session => ({ id: session.id, ...(session.parent ? { parent: session.parent } : {}), events: auditSessionEvents(session.events, session.inheritedEventCount) })))
  freezeInput(join(directory, 'execution-audit'), audit)
  freezeInput(join(directory, 'collected-tool-results'), sessions.flatMap(session => toolResultEvidence(session.id, session.events, session.inheritedEventCount)))
  if (boundary) {
    const own = { ...boundary.own, scope: boundary.own.home.split(/[\\/]/).at(-1)! }
    const observations = sessions.map(session => programEvidence(session.id, session.events, session.inheritedEventCount, own, session.id === root ? naturalPrompts : []))
    freezeInput(join(directory, 'program-evidence'), {
      retrieval: observations.flatMap(value => value.retrieval), writes: observations.flatMap(value => value.writes),
      sessions: observations.map((value, index) => ({ session: sessions[index]!.id, writeback: value.writeback })),
    })
    const hits = sessions.flatMap(session => detectBoundaryAccess(session.events.filter(event => event.seq >= session.inheritedEventCount), boundary))
    freezeInput(join(directory, 'boundary-hits'), hits)
    if (hits.length) throw new Error(`环境污染：检测到 ${hits.length} 次已知越界访问，该题停止且不进入判定（事后检测）`)
  }
  if (audit.status !== 'valid') throw new Error(`Execution evidence not scoreable: ${audit.status}`)
  const evidence = sessions.flatMap(session => assistantEvidence(session.id, session.events, session.inheritedEventCount))
  const selection = freezeSelection(join(directory, 'selection'), evidence, evidence.map(item => item.id))
  return { audit, selection }
}
