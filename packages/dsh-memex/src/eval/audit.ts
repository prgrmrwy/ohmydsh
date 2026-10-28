import type { ModelRoute } from './round.js'
export interface TokenCategories { uncachedInput: number; cacheRead: number; cacheWrite: number }
export interface ObservedRoute { session: string; provider: string; model: string; effort?: string; requests: number }
export interface AuditEvent { toolCalls?: number; tokenCategories?: TokenCategories; type: 'request'; seq: number; originSession?: string; originSeq?: number; route?: ModelRoute; inputTokens?: number; outputTokens?: number }
export interface AuditSession { id: string; parent?: string; missing?: boolean; events: AuditEvent[] }
export interface ExecutionAudit { toolCalls?: number; observedRoutes?: ObservedRoute[]; tokenCategories?: TokenCategories; status: 'valid' | 'configuration-mismatch' | 'evidence-missing'; inputTokens: number; outputTokens: number; sessions: string[] }
export function auditExecution(root: string, route: ModelRoute, sessions: readonly AuditSession[]): ExecutionAudit {
  const included = new Set([root])
  let changed = true
  while (changed) {
    changed = false
    for (const session of sessions) if (session.parent && included.has(session.parent) && !included.has(session.id)) { included.add(session.id); changed = true }
  }
  const evidence = sessions.filter(session => included.has(session.id))
  let missing = !evidence.some(session => session.id === root), mismatch = false, inputTokens = 0, outputTokens = 0
  const tokenCategories = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0 }
  let categoriesKnown = true, toolCalls = 0, toolCallsKnown = true
  const routes = new Map<string, ObservedRoute>()
  const seen = new Map<string, string>()
  for (const session of evidence) {
    if (session.missing || !session.events.length) missing = true
    for (const event of session.events) {
      const key = JSON.stringify([event.originSession ?? session.id, event.originSeq ?? event.seq])
      const fingerprint = JSON.stringify([event.route, event.inputTokens, event.outputTokens, event.tokenCategories, event.toolCalls])
      if (seen.has(key)) {
        if (seen.get(key) !== fingerprint) missing = true
        continue
      }
      seen.set(key, fingerprint)
      if (typeof event.toolCalls !== 'number' || !Number.isSafeInteger(event.toolCalls) || event.toolCalls < 0) toolCallsKnown = false
      else toolCalls += event.toolCalls
      if (event.route) {
        const routeKey = JSON.stringify([session.id, event.route.provider, event.route.model, event.route.effort])
        const observed = routes.get(routeKey) ?? { session: session.id, provider: event.route.provider, model: event.route.model, ...(event.route.effort === undefined ? {} : { effort: event.route.effort }), requests: 0 }
        observed.requests += 1
        routes.set(routeKey, observed)
      }
      const categories = event.tokenCategories
      if (!categories || ![categories.uncachedInput, categories.cacheRead, categories.cacheWrite].every(n => Number.isSafeInteger(n) && n >= 0)
        || categories.uncachedInput + categories.cacheRead + categories.cacheWrite !== event.inputTokens) categoriesKnown = false
      else {
        tokenCategories.uncachedInput += categories.uncachedInput
        tokenCategories.cacheRead += categories.cacheRead
        tokenCategories.cacheWrite += categories.cacheWrite
      }
      if (!event.route) missing = true
      else if (event.route.provider !== route.provider || event.route.model !== route.model || event.route.effort !== route.effort) mismatch = true
      if (event.inputTokens === undefined || event.outputTokens === undefined) missing = true
      else {
        if (!Number.isSafeInteger(event.inputTokens) || event.inputTokens < 0 || !Number.isSafeInteger(event.outputTokens) || event.outputTokens < 0) missing = true
        else {
          const input = inputTokens + event.inputTokens, output = outputTokens + event.outputTokens
          if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output)) { missing = true; categoriesKnown = false }
          else { inputTokens = input; outputTokens = output }
        }
      }
    }
  }
  const observedRoutes = [...routes.values()].sort((a, b) => a.session.localeCompare(b.session) || a.model.localeCompare(b.model))
  return { observedRoutes, ...(toolCallsKnown && Number.isSafeInteger(toolCalls) ? { toolCalls } : {}), ...(categoriesKnown && seen.size && Object.values(tokenCategories).every(Number.isSafeInteger) ? { tokenCategories } : {}), status: mismatch ? 'configuration-mismatch' : missing ? 'evidence-missing' : 'valid', inputTokens, outputTokens, sessions: evidence.map(session => session.id) }
}
