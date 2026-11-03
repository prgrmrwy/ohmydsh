import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { runKernel } from '../../run/kernel.js'
import { resolveMemexInstallation } from '../../run/installation.js'
import { parseSearch } from '../../run/parse.js'
import { KernelError, type KernelResult, type KernelRunOptions } from '../../run/types.js'
import { searchArgs } from '../../tools/search-args.js'
import { readRegular } from '../freeze.js'
import { createRunDirectory, assertUniqueSlugs } from './fs-boundary.js'
import { freezeRetrieval, returnedCharacters, writeRetrievalReport, type FrozenRetrieval } from './freeze.js'
import { loadGoldset } from './goldset.js'
import type { RetrievalObservation, RetrievalQuestion, Unknown } from './metrics.js'
import { assertDeclaredHash, materializeSnapshot, prepareSnapshot, verifySnapshot } from './snapshot.js'

export type RetrievalRunner = (args: readonly string[], options: KernelRunOptions) => Promise<KernelResult>
export interface RunRetrievalOptions {
  readonly home: string
  readonly library: string
  readonly goldset: string
  readonly set?: 'dev' | 'holdout'
  readonly backend?: string
  readonly expectedHash?: string
  readonly excludeCategories?: readonly string[]
  readonly excludePrefixes?: readonly string[]
  readonly distractors?: readonly { slug: string; content: string }[]
  readonly runner?: RetrievalRunner
  readonly runId?: string
}
export async function retrieveQuestion(question: RetrievalQuestion, options: { snapshotRoot: string; limit?: number; runner?: RetrievalRunner }): Promise<RetrievalObservation> {
  const started = performance.now()
  try {
    const result = await (options.runner ?? runKernel)(searchArgs({ query: question.query, limit: options.limit ?? 10 }), { home: options.snapshotRoot })
    if (!result.ok) throw new KernelError('failed', `Kernel exited with ${result.exitCode}`)
    const hits = parseSearch(result.stdout)
    return { id: question.id, slugs: hits.map(hit => hit.slug), status: hits.length ? 'ok' : 'empty', error: null, elapsedMs: performance.now() - started, returnedChars: returnedCharacters(hits) }
  } catch (error) {
    return { id: question.id, slugs: [], status: 'error', error: error instanceof KernelError ? error.code : 'failed', elapsedMs: performance.now() - started, returnedChars: 'unknown' }
  }
}

function directoryBytes(path: string): number {
  const stat = lstatSync(path)
  if (stat.isFile()) return stat.size
  if (!stat.isDirectory()) return 0
  return readdirSync(path).reduce((sum, name) => sum + directoryBytes(join(path, name)), 0)
}

export async function runRetrieval(options: RunRetrievalOptions) {
  if (options.backend !== undefined && options.backend !== 'lexical') throw new TypeError('This version only supports lexical')
  const prepared = prepareSnapshot({ sourceRoot: options.library,
    ...(options.distractors ? { distractors: options.distractors } : {}),
    ...(options.excludeCategories ? { excludeCategories: options.excludeCategories } : {}),
    ...(options.excludePrefixes ? { excludePrefixes: options.excludePrefixes } : {}),
  })
  const gold = loadGoldset({ path: options.goldset, content: readRegular(options.goldset), snapshotSlugs: prepared.slugs, ...(options.set ? { set: options.set } : {}) })
  assertUniqueSlugs([], prepared.distractors.map(d => d.slug), gold.allTargetSlugs)
  assertDeclaredHash(options.expectedHash, prepared.manifestHash)
  const directories = createRunDirectory({ home: options.home, libraryRoot: options.library, runId: options.runId ?? randomUUID() })
  materializeSnapshot(directories.snapshotDir, prepared)
  const before = verifySnapshot(directories.snapshotDir, prepared.manifest)
  const observations: RetrievalObservation[] = []
  for (const question of gold.questions) observations.push(before.valid
    ? await retrieveQuestion(question, { snapshotRoot: directories.snapshotDir, ...(options.runner ? { runner: options.runner } : {}) })
    : { id: question.id, slugs: [], status: 'error', error: 'integrity', elapsedMs: 'unknown', returnedChars: 'unknown' })
  const after = verifySnapshot(directories.snapshotDir, prepared.manifest)
  const status = !before.valid || !after.valid ? 'invalid' : observations.some(o => o.status === 'error') ? 'incomplete' : 'ok'
  let kernelVersion = 'unknown'
  let kernelInstallationBytes: number | Unknown = 'unknown'
  if (!options.runner) {
    try {
      const installation = resolveMemexInstallation()
      kernelVersion = installation.version
      kernelInstallationBytes = directoryBytes(installation.root)
    } catch { /* Unavailable installation observations remain unknown. */ }
  }
  const frozen: FrozenRetrieval = {
    version: 'retrieval-v1', kernelVersion,
    config: prepared.nestedSlugs === undefined ? {} : { nestedSlugs: prepared.nestedSlugs }, queryPreprocessingVersion: 'han-bigram-v1', limit: 10,
    exclusions: { categories: [...new Set(['handoff', 'eval', ...(options.excludeCategories ?? [])])], prefixes: [...new Set(['probe-', 'handoff-', 'memex-retrieval-probe-', ...(options.excludePrefixes ?? [])])], slugs: prepared.excludedSlugs },
    questions: gold.questions, observations, distractors: prepared.distractors, manifest: prepared.manifest, manifestHash: prepared.manifestHash,
    integrity: { before, after }, status,
    costs: { kernelInstallationBytes, snapshotBytes: [...prepared.files.values()].reduce((sum, bytes) => sum + bytes.length, 0), quantileVersion: 'nearest-rank-v1', characterCountVersion: 'chars-v1' },
  }
  freezeRetrieval(directories.runDir, frozen)
  mkdirSync(directories.reportDir, { mode: 0o700 })
  return { ...directories, frozen, ...writeRetrievalReport(directories.reportDir, frozen) }
}

export function assertRecomputeDirectory(home: string, runDir: string): string {
  const base = resolve(home)
  const root = join(base, '.dsh-memex-eval', 'retrieval')
  const target = resolve(runDir)
  const name = relative(root, target)
  if (!name || name.includes(sep) || name === '..' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) throw new Error('Recompute requires a run directory directly under ~/.dsh-memex-eval/retrieval')
  const report = join(target, 'report')
  for (const path of [base, join(base, '.dsh-memex-eval'), root, target, report]) {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe recompute directory (symlink or not a directory): ${path}`)
  }
  let cursor = realpathSync(target)
  while (true) {
    try { if (lstatSync(join(cursor, 'cards')).isDirectory()) throw new Error(`Recompute directory is inside a memory library: ${cursor}`) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return report
}
