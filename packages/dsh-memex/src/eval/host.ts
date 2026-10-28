import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { registerFixedRound, loadFixedRound, type FixedRound, type RoundItem } from './round.js'
import { DefaultModelNotice } from './default-model.js'
import { durableWrite, readRegular } from './freeze.js'

export interface EvalBridgeOptions {
  root: string; currentDefault(): unknown;
  judge(round: FixedRound, item: RoundItem, signal: AbortSignal): Promise<unknown>;
  cancel(id: string): Promise<void>;
}
function fields(payload: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !allowed.includes(key))) throw new Error('Invalid eval request fields')
  return payload as Record<string, unknown>
}
function identity(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw new Error('Invalid request identity')
  return value
}

/** Transport-independent dispatch; only the authenticated Connection handler may expose it. */
export function createEvalBridge(options: EvalBridgeOptions): { dispatch(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> } {
  const active = new Map<string, { round: string; item: string; abort: AbortController; result: Promise<unknown> }>()
  return {
    async dispatch(endpoint, payload, signal): Promise<unknown> {
      if (signal.aborted) throw new Error('Eval request aborted')
      if (endpoint === 'eval/registerRound') {
        let rounds: string[] = []
        try { rounds = readdirSync(options.root).filter(name => /^round-[a-f0-9-]{36}$/.test(name)) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        const pending = rounds.sort().filter(id => new DefaultModelNotice(join(options.root, id)).pending())
        if (pending.length) {
          const current = options.currentDefault()
          throw new Error(`Pending default-model review blocks a new round: ${pending.map(id => `${id}: ${new DefaultModelNotice(join(options.root, id)).describe(current)}`).join(' | ')}`)
        }
        const round = registerFixedRound(options.root, payload)
        new DefaultModelNotice(join(options.root, round.id)).begin(options.currentDefault())
        return round
      }
      if (endpoint === 'eval/readDefaultModel') { fields(payload, []); return options.currentDefault() }
      if (!['eval/judgeItem', 'eval/status', 'eval/cancelRound'].includes(endpoint)) throw new Error('Unknown eval endpoint')
      const input = fields(payload, endpoint === 'eval/judgeItem' ? ['round', 'item', 'requestId'] : ['round'])
      const round = loadFixedRound(options.root, identity(input.round))
      const cancelled = join(options.root, round.id, 'cancel-requested')
      const unhealthy = join(options.root, round.id, 'unhealthy')
      const uncertainRequests = readdirSync(join(options.root, round.id)).flatMap(name => {
        if (/^judge-.*\.json$/.test(name)) throw new Error('Legacy judge artifacts require manual inspection; automatic recovery refused')
        const match = /^request-([A-Za-z0-9-]{1,100})\.json$/.exec(name)
        if (!match) return []
        const request = match[1]!
        const record = JSON.parse(readRegular(join(options.root, round.id, name)).toString()) as { requestId?: unknown; item?: unknown } | null
        if (!record || typeof record !== 'object' || record.requestId !== request || !round.items.some(item => item.id === record.item)) {
          throw new Error('Invalid or unattributed judge request artifact; inspect private ledger')
        }
        return !active.has(`${round.id}:${request}`) && !existsSync(join(options.root, round.id, `result-${request}.json`)) ? [request] : []
      }).sort()
      const failed = () => existsSync(unhealthy) || uncertainRequests.length > 0
      if (endpoint === 'eval/cancelRound') {
        if (!existsSync(cancelled)) durableWrite(cancelled, 'Round cancellation requested\n')
        const running = [...active.values()].filter(work => work.round === round.id)
        for (const work of running) work.abort.abort()
        const outcomes = await Promise.allSettled(running.map(work => work.result))
        const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : [])
        try { await options.cancel(round.id) } catch (error) { failures.push(error) }
        if (failed()) failures.push(new Error('Persisted round failure requires inspection'))
        if (failures.length) throw new AggregateError(failures, 'Round cancellation release unproven; preserve scene and inspect resource ledger')
        return { cancelled: true }
      }
      if (endpoint === 'eval/judgeItem' && existsSync(cancelled)) throw new Error('Round cancelled; no new judge work admitted')
      if (endpoint === 'eval/status') return { id: round.id, unhealthy: failed(), uncertainRequests, defaultModelNotice: new DefaultModelNotice(join(options.root, round.id)).describe(options.currentDefault()) }
      if (failed()) throw new Error('Round unhealthy; prior outcome uncertain; inspect resource ledger before any further scoring')
      const item = round.items.find(item => item.id === identity(input.item))
      if (!item) throw new Error('Item outside frozen plan')
      const requestId = identity(input.requestId)
      const key = `${round.id}:${requestId}`
      const inFlight = active.get(key)
      if (inFlight) {
        if (inFlight.item !== item.id) throw new Error('Request identity reused for another item')
        return inFlight.result
      }
      const started = join(options.root, round.id, `request-${requestId}.json`)
      const finished = join(options.root, round.id, `result-${requestId}.json`)
      if (existsSync(started)) {
        const saved = JSON.parse(readFileSync(started, 'utf8')) as { item: string }
        if (saved.item !== item.id) throw new Error('Request identity reused for another item')
        if (!existsSync(finished)) throw new Error('Judge request outcome uncertain; inspect resource ledger before proceeding')
        return JSON.parse(readFileSync(finished, 'utf8')) as unknown
      }
      const itemClaim = join(options.root, round.id, `item-${item.id}-request.json`)
      if (existsSync(itemClaim)) {
        const claim = JSON.parse(readFileSync(itemClaim, 'utf8')) as { requestId: string }
        if (claim.requestId !== requestId) throw new Error('Frozen item already attempted; no automatic judge retry')
      } else durableWrite(itemClaim, JSON.stringify({ requestId }) + '\n')
      durableWrite(started, JSON.stringify({ item: item.id, requestId }) + '\n')
      const abort = new AbortController()
      const disconnect = () => abort.abort(signal.reason)
      signal.addEventListener('abort', disconnect, { once: true })
      if (signal.aborted) disconnect()
      const result = Promise.resolve().then(async () => {
        if (abort.signal.aborted) throw new Error('Eval request aborted')
        const result = await options.judge(round, item, abort.signal)
        durableWrite(finished, JSON.stringify(result) + '\n')
        return result
      })
      active.set(key, { round: round.id, item: item.id, abort, result })
      try { return await result }
      catch (error) {
        try { if (!existsSync(unhealthy)) durableWrite(unhealthy, 'Uncertain judge outcome; inspect private ledger. No automatic retry.\n') }
        catch (persistenceError) { throw new AggregateError([error, persistenceError], 'Judge failed and failure persistence unavailable; preserve scene') }
        throw error
      }
      finally { signal.removeEventListener('abort', disconnect); active.delete(key) }
    },
  }
}
