export { sessionHash as sessionIdentityHash } from '../telemetry/snapshot.js'
import { sessionHash as sessionIdentityHash } from '../telemetry/snapshot.js'
export function evalFilter(registry: string): { warning: boolean; exclude(session: { sessionId?: string; sessionHash?: string; scope?: string; cwd?: string }): boolean } {
  const hashes = new Set<string>()
  let warning = false
  for (const line of registry.split('\n').filter(line => line.trim())) {
    try {
      const row = JSON.parse(line) as { round?: unknown; role?: unknown; sessionHash?: unknown }
      if (!row || typeof row.round !== 'string' || !['reserved', 'created', 'child'].includes(row.role as string)
        || typeof row.sessionHash !== 'string' || !/^[a-f0-9]{16}$/.test(row.sessionHash)) throw new Error('Invalid registry row')
      hashes.add(row.sessionHash)
    } catch { warning = true }
  }
  return { warning, exclude: session => {
    if (session.sessionHash && hashes.has(session.sessionHash)) return true
    if (session.scope?.startsWith('eval-')) return true
    if (session.sessionId && hashes.has(sessionIdentityHash(session.sessionId))) return true
    return typeof session.cwd === 'string' && /(?:^|\/)\.dsh-memex-eval-runs\/(?:mem|nomem)\/eval-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/repo\/?$/.test(session.cwd)
  } }
}
