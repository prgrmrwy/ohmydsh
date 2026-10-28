import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { EvalLedger } from './ledger.js'

/** Install on the Host context before any reserved session can be created. */
export function registerEvalIdentities(ctx: Context, ledger: EvalLedger): { owners: ReadonlySet<string>; healthy(): boolean } {
  const owners = new Set(ledger.read().filter(e => e.kind !== 'job').map(e => e.id))
  let healthy = true
  ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    try {
      const parent = agent.session.header.parentSession
      const reserved = ledger.read().some(e => e.kind === 'reserved' && e.id === agent.id)
      if (!reserved && (parent === undefined || !owners.has(parent))) return undefined
      if (reserved) { ledger.recordCreated(agent.id); owners.add(agent.id) }
      else {
        if (!owners.has(agent.id)) ledger.recordChild(parent!, agent.id)
        owners.add(agent.id)
      }
    } catch (error) { healthy = false; throw error }
    return undefined
  })
  return { owners, healthy: () => healthy }
}
