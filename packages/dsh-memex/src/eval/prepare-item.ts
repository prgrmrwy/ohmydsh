import type { EvalLedger } from './ledger.js'
import type { EvalAttempt } from './routing.js'
import { lstatSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { loadFixedRound } from './round.js'
import { readFrozenInput, freezeInput } from './freeze.js'
import { allocateAttempt, materializeAttempt } from './routing.js'
import { selftestManifest } from './selftest-manifest.js'

export function ensureDirectory(path: string): void {
  const absolute = resolve(path), parent = dirname(absolute)
  if (parent !== absolute) ensureDirectory(parent)
  try { mkdirSync(absolute, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const stat = lstatSync(absolute)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe preparation directory ancestor')
}

export function prepareFixedItem(root: string, roundId: string, itemId: string, home: string, ledger: EvalLedger): { session: string; attempt: EvalAttempt } {
  const round = loadFixedRound(root, roundId)
  const item = round.items.find(item => item.id === itemId)
  if (!item) throw new Error('Preparation item outside frozen plan')
  const frozen = readFrozenInput(join(root, roundId)) as { resources: Record<string, string> }
  const files = new Map<string, Buffer>()
  for (const entry of selftestManifest) {
    const encoded = frozen.resources[entry.path]
    if (typeof encoded !== 'string') throw new Error('Missing fixed preparation resource')
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.length !== entry.size || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Preparation resource mismatch')
    files.set(entry.path, bytes)
  }
  const directory = join(root, roundId, item.id)
  mkdirSync(directory, { mode: 0o700 })
  const session = ledger.reserve(roundId, item.question, item.condition)
  const attempt = allocateAttempt(home, item.condition)
  freezeInput(join(directory, 'attempt'), { session, attempt })
  ensureDirectory(dirname(attempt.cwd))
  ensureDirectory(dirname(attempt.home))
  materializeAttempt(files, attempt)
  return { session, attempt }
}
