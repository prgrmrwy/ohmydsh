import type { Context } from '@deepseek-ai/cordis'
import type { EvalLedger } from './ledger.js'
/** Soft observations, not a sandbox or an exact-step spending guarantee. */
export const testedLimits = { maxRequestsPerCondition: 128, maxDurationMsPerCondition: 120_000 } as const
export function installTestedBudget(ctx: Context, ledger: EvalLedger, root: string, carrier: AbortSignal, limits: { maxRequestsPerCondition: number; maxDurationMsPerCondition: number } = testedLimits): { signal: AbortSignal; dispose(): void } {
  const abort = new AbortController()
  const owned = () => {
    const ids = new Set([root]); let changed = true
    while (changed) { changed = false; for (const e of ledger.read()) if (e.kind === 'child' && e.parent && ids.has(e.parent) && !ids.has(e.id)) { ids.add(e.id); changed = true } }
    return ids
  }
  const stop = () => {
    abort.abort(new Error('Tested condition cancelled or soft budget exceeded'))
    for (const id of owned()) ctx.get('agents')?.get(id as never)?.cancel({ kind: 'user' })
  }
  carrier.addEventListener('abort', stop, { once: true })
  if (carrier.aborted) stop()
  let requests = 0
  const timer = setTimeout(stop, limits.maxDurationMsPerCondition)
  const detach = ctx.on('llm/stream', (request, next) => {
    if (!request.sessionId || !owned().has(request.sessionId)) return next()
    if (abort.signal.aborted) throw abort.signal.reason
    if (++requests > limits.maxRequestsPerCondition) { stop(); throw abort.signal.reason }
    return next()
  })
  return { signal: abort.signal, dispose() { clearTimeout(timer); carrier.removeEventListener('abort', stop); detach() } }
}
