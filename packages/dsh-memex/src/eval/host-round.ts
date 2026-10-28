import type { Context } from '@deepseek-ai/cordis'
import type { HostItemInput } from './host-item.js'
export type HostRoundInput = Omit<HostItemInput, 'item' | 'session' | 'attempt' | 'lifecycle'> & { home: string }
import { SessionId } from '@deepseek-ai/dsh-session'
import { loadFixedRound } from './round.js'
import { prepareFixedItem } from './prepare-item.js'
import { runHostItem } from './host-item.js'
import { dirname, join, resolve } from 'node:path'
import { durableWrite, readFrozenInput, readRegular } from './freeze.js'
import { lstatSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

interface OwnedAttempt {
  item: string; session: string; attempt: HostItemInput['attempt']; directory: string;
  retired: boolean; stage?: 'execute' | 'retired' | 'collect' | 'score'; root?: unknown;
  outcome?: string; retryable: boolean
}
/** Capability held only by the live managed execution; never reconstructed from disk. */
export interface HostRoundState { attempts: OwnedAttempt[]; results: Record<string, unknown> }

function directoryOnly(path: string): void {
  const absolute = resolve(path), parent = dirname(absolute)
  if (parent !== absolute) directoryOnly(parent)
  const stat = lstatSync(absolute)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe resume directory or history symlink')
}
function present(path: string): boolean {
  try { lstatSync(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
function noUncertainSubmission(directory: string): void {
  for (const name of readdirSync(directory)) {
    if (/^prompt-[a-f0-9]{64}\.json$/.test(name)) {
      readRegular(join(directory, name))
      if (!present(join(directory, `${name.slice(0, -5)}-accepted`))) throw new Error('Unknown prompt submission; explicit resume refused')
      readRegular(join(directory, `${name.slice(0, -5)}-accepted`))
    }
  }
}

/** Validate the entire retained scene before any old item is moved or new identity allocated. */
export function validateHostRoundResume(ctx: Context, input: HostRoundInput, state: HostRoundState): void {
  const round = loadFixedRound(input.root, input.round)
  const directory = resolve(input.root, input.round)
  directoryOnly(directory)
  for (const entry of input.ledger.read()) {
    if (entry.kind === 'reserved' && entry.question !== 'judge' && !state.attempts.some(attempt => attempt.session === entry.id)) throw new Error(`Unowned reserved root; release unproven: ${entry.id}`)
  }
  for (const owned of state.attempts) {
    directoryOnly(owned.directory)
    directoryOnly(join(owned.directory, 'attempt'))
    const frozen = readFrozenInput(join(owned.directory, 'attempt'))
    if (JSON.stringify(frozen) !== JSON.stringify({ session: owned.session, attempt: owned.attempt })) throw new Error(`Attempt identity mismatch: ${owned.session}`)
    if (!input.ledger.read().some(entry => entry.kind === 'reserved' && entry.id === owned.session)) throw new Error(`Missing retained root identity: ${owned.session}`)
    if (!owned.retired || !owned.root || ctx.get('agents')?.get(SessionId(owned.session)) !== owned.root) throw new Error(`Root release or exact live identity unproven: ${owned.session}`)
    if (owned.outcome !== undefined) {
      if (readRegular(join(owned.directory, 'outcome.json')).toString() !== owned.outcome) throw new Error('Completed outcome changed; resume refused')
    } else {
      if (!owned.retryable || owned.stage === 'score' || present(join(owned.directory, 'judge-protocols'))) throw new Error('Judge started or ordinary retired failure unproven; resume refused')
      if (present(join(owned.directory, 'outcome.json'))) throw new Error('Unknown outcome submission; resume refused')
      noUncertainSubmission(owned.directory)
    }
  }
  for (const item of round.items) {
    if (present(join(directory, item.id)) && !state.attempts.some(owned => owned.directory === join(directory, item.id))) throw new Error('Unowned item directory; resume evidence missing')
  }
}

/** Called only after managed execution has re-proven every old root, job and descendant. */
export function archiveHostRoundAttempts(input: HostRoundInput, state: HostRoundState): void {
  const directory = resolve(input.root, input.round), history = join(directory, 'history')
  const pending = state.attempts.filter(owned => owned.outcome === undefined && owned.directory === join(directory, owned.item))
  if (!pending.length) return
  directoryOnly(directory)
  if (!present(history)) mkdirSync(history, { mode: 0o700 })
  directoryOnly(history)
  const batch = join(history, randomUUID())
  // Exclusive batch creation means neither a collision nor a symlink can be overwritten.
  mkdirSync(batch, { mode: 0o700 }); directoryOnly(batch)
  for (const owned of pending) {
    const source = resolve(owned.directory), target = resolve(batch, owned.item)
    if (source !== join(directory, owned.item) || dirname(target) !== batch || present(target)) throw new Error('Unsafe history move or collision')
    directoryOnly(source)
    renameSync(source, target)
    owned.directory = target
  }
}

export async function runHostRound(ctx: Context, input: HostRoundInput, signal: AbortSignal, state?: HostRoundState): Promise<Record<string, unknown>> {
  const round = loadFixedRound(input.root, input.round)
  const results: Record<string, unknown> = state?.results ?? {}
  for (const item of round.items) {
    if (signal.aborted) throw new Error('Host round aborted; no next condition admitted')
    if (!input.tracking.healthy()) throw new Error('Host round tracking unhealthy; preserve scene')
    if (Object.hasOwn(results, item.id)) continue
    const prepared = prepareFixedItem(input.root, input.round, item.id, input.home, input.ledger)
    const directory = resolve(input.root, input.round, item.id)
    const owned: OwnedAttempt = { item: item.id, ...prepared, directory, retired: false, retryable: false }
    state?.attempts.push(owned)
    try {
      const result = await runHostItem(ctx, { ...input, item: item.id, ...prepared, ...(state ? { lifecycle: (stage: NonNullable<OwnedAttempt['stage']>) => {
        owned.stage = stage
        if (stage === 'retired') { owned.retired = true; owned.root = ctx.get('agents')?.get(SessionId(owned.session)) }
      } } : {}) }, signal)
      const bytes = JSON.stringify(result) + '\n'
      durableWrite(join(directory, 'outcome.json'), bytes)
      owned.outcome = bytes
      results[item.id] = result
    } catch (error) {
      owned.retryable = !signal.aborted && owned.retired && (owned.stage === 'retired' || owned.stage === 'collect')
      if (owned.retryable) {
        try {
          noUncertainSubmission(directory)
          if (present(join(directory, 'judge-protocols'))) owned.retryable = false
        } catch { owned.retryable = false }
      }
      throw error
    }
  }
  return results
}
