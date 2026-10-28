import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { DefaultModelNotice } from './default-model.js'
import { EvalLedger } from './ledger.js'
import { loadFixedRound } from './round.js'
import { loadOfflineOutcomes } from './offline-outcomes.js'
import { loadProgramEvidence } from './program-evidence.js'
import { loadSelection } from './selection.js'
import { readFrozenInput } from './freeze.js'
import type { ExecutionAudit } from './audit.js'
import { renderSelftestReport, type ReportDiagnostics } from './report.js'

function directoryPresent(path: string): boolean {
  try {
    const stat = lstatSync(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid frozen audit directory')
    return true
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
function checkedAudit(value: unknown): ExecutionAudit {
  const fail = () => { throw new Error('Invalid frozen execution audit') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const audit = value as Record<string, unknown>
  if (Object.keys(audit).some(key => !['status', 'inputTokens', 'outputTokens', 'sessions', 'tokenCategories', 'toolCalls', 'observedRoutes'].includes(key))
    || !['valid', 'configuration-mismatch', 'evidence-missing'].includes(audit.status as string)
    || ![audit.inputTokens, audit.outputTokens].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
    || !Array.isArray(audit.sessions) || audit.sessions.some(id => typeof id !== 'string' || !id.trim()) || new Set(audit.sessions).size !== audit.sessions.length) return fail()
  if (audit.status === 'valid' && !audit.sessions.length) return fail()
  if (audit.toolCalls !== undefined && (typeof audit.toolCalls !== 'number' || !Number.isSafeInteger(audit.toolCalls) || audit.toolCalls < 0)) return fail()
  if (audit.observedRoutes !== undefined) {
    if (!Array.isArray(audit.observedRoutes)) return fail()
    const seen = new Set<string>()
    for (const value of audit.observedRoutes) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
      const route = value as Record<string, unknown>
      if (Object.keys(route).some(key => !['session', 'provider', 'model', 'effort', 'requests'].includes(key))
        || typeof route.session !== 'string' || !audit.sessions.includes(route.session)
        || typeof route.provider !== 'string' || !route.provider.trim() || typeof route.model !== 'string' || !route.model.trim()
        || (route.effort !== undefined && (typeof route.effort !== 'string' || !route.effort.trim()))
        || typeof route.requests !== 'number' || !Number.isSafeInteger(route.requests) || route.requests <= 0) return fail()
      const key = JSON.stringify([route.session, route.provider, route.model, route.effort])
      if (seen.has(key)) return fail()
      seen.add(key)
    }
  }
  if (audit.tokenCategories !== undefined) {
    const c = audit.tokenCategories as Record<string, unknown>
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).length !== 3 || !['uncachedInput', 'cacheRead', 'cacheWrite'].every(key => typeof c[key] === 'number' && Number.isSafeInteger(c[key]) && (c[key] as number) >= 0)
      || (c.uncachedInput as number) + (c.cacheRead as number) + (c.cacheWrite as number) !== audit.inputTokens) return fail()
  }
  return audit as unknown as ExecutionAudit
}

function checkedBoundaryHits(value: unknown): NonNullable<ReportDiagnostics['contaminated']>[string] {
  const fail = () => { throw new Error('Invalid frozen boundary diagnostics') }
  if (!Array.isArray(value)) return fail()
  for (const hit of value) {
    if (!hit || typeof hit !== 'object' || Array.isArray(hit)
      || Object.keys(hit).length !== 4 || Object.keys(hit).some(key => !['seq', 'tool', 'path', 'kind'].includes(key))
      || !Number.isSafeInteger(hit.seq) || hit.seq < 0
      || typeof hit.tool !== 'string' || !hit.tool.trim() || typeof hit.path !== 'string' || !hit.path.trim()
      || !['real-library', 'suite-answer', 'other-condition'].includes(hit.kind)) return fail()
  }
  return value
}

/** Reads fixed selftest artifacts only; no Host/model access, writes, repair or resume. */
export function buildOfflineReport(root: string, roundId: string): { markdown: string; exitCode: number } {
  const plan = loadFixedRound(root, roundId, 'report')
  const outcomes = loadOfflineOutcomes(root, roundId)
  const selections: NonNullable<ReportDiagnostics['selections']> = {}
  const executions: NonNullable<ReportDiagnostics['executions']> = {}
  const contaminated: NonNullable<ReportDiagnostics['contaminated']> = {}
  const programs: NonNullable<ReportDiagnostics['programs']> = {}
  for (const item of plan.items) {
    const program = loadProgramEvidence(join(root, roundId, item.id))
    if (program) programs[item.id] = program
    const boundaryDirectory = join(root, roundId, item.id, 'boundary-hits')
    if (directoryPresent(boundaryDirectory)) contaminated[item.id] = checkedBoundaryHits(readFrozenInput(boundaryDirectory))
    const auditDirectory = join(root, roundId, item.id, 'execution-audit')
    if (directoryPresent(auditDirectory)) {
      const audit = checkedAudit(readFrozenInput(auditDirectory))
      const attempt = readFrozenInput(join(root, roundId, item.id, 'attempt')) as { session?: unknown }
      const entries = new EvalLedger(join(root, roundId)).read()
      if (typeof attempt.session !== 'string' || !entries.some(entry => entry.kind === 'reserved' && entry.id === attempt.session && entry.round === roundId && entry.question === item.question && entry.condition === item.condition)) throw new Error('Audit root identity not reserved for fixed item')
      const ids = new Set([attempt.session])
      let changed = true
      while (changed) {
        changed = false
        for (const entry of entries) if (entry.kind === 'child' && entry.parent && ids.has(entry.parent) && !ids.has(entry.id)) { ids.add(entry.id); changed = true }
      }
      if (audit.sessions.length !== ids.size || audit.sessions.some(id => !ids.has(id))) throw new Error('Audit session lineage differs from registered descendants')
      executions[item.id] = audit
    }
    const directory = join(root, roundId, item.id, 'selection')
    let stat
    try { stat = lstatSync(directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid frozen selection directory')
    selections[item.id] = loadSelection(directory).coverage
  }
  return renderSelftestReport(plan, outcomes, { selections, executions, contaminated, programs, defaultModelNotice: new DefaultModelNotice(join(root, roundId)).describeOffline() })
}
