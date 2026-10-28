import type { Context } from '@deepseek-ai/cordis'
import type { HostItemInput } from './host-item.js'
export type HostRoundInput = Omit<HostItemInput, 'item' | 'session' | 'attempt'> & { home: string }
import { loadFixedRound } from './round.js'
import { prepareFixedItem } from './prepare-item.js'
import { runHostItem } from './host-item.js'
import { join } from 'node:path'
import { durableWrite } from './freeze.js'

export async function runHostRound(ctx: Context, input: HostRoundInput, signal: AbortSignal): Promise<Record<string, unknown>> {
  const round = loadFixedRound(input.root, input.round)
  const results: Record<string, unknown> = {}
  for (const item of round.items) {
    if (signal.aborted) throw new Error('Host round aborted; no next condition admitted')
    if (!input.tracking.healthy()) throw new Error('Host round tracking unhealthy; preserve scene')
    const prepared = prepareFixedItem(input.root, input.round, item.id, input.home, input.ledger)
    const result = await runHostItem(ctx, { ...input, item: item.id, ...prepared }, signal)
    durableWrite(join(input.root, input.round, item.id, 'outcome.json'), JSON.stringify(result) + '\n')
    results[item.id] = result
  }
  return results
}
