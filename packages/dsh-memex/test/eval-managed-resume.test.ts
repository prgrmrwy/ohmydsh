import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { freezeInput } from '../src/eval/freeze.js'

const f = vi.hoisted(() => ({ calls: [] as string[], failItem: 'act-mem', failAt: 'execute', healthy: true, settleFails: false, retireFails: false, judgeFails: false, collision: false, attempts: [] as any[], owners: new Set<string>(), next: 0 }))
const items = [{ id: 'know-mem', question: 'know', condition: 'mem' }, { id: 'act-mem', question: 'act', condition: 'mem' }, { id: 'act-nomem', question: 'act', condition: 'nomem' }]
vi.mock('../src/eval/round.js', () => ({ loadFixedRound: () => ({ id: 'round', tested: {}, items: [{ id: 'know-mem', question: 'know', condition: 'mem' }, { id: 'act-mem', question: 'act', condition: 'mem' }, { id: 'act-nomem', question: 'act', condition: 'nomem' }] }) }))
vi.mock('../src/eval/prepare-item.js', async importOriginal => ({ ...await importOriginal<any>(), prepareFixedItem: (root: string, round: string, item: string, home: string, ledger: any) => {
  f.calls.push(`prepare:${item}`)
  const directory = join(root, round, item); mkdirSync(directory)
  const session = ledger.reserve(round, item.split('-')[0], item.endsWith('nomem') ? 'nomem' : 'mem')
  const attempt = { cwd: join(home, '.dsh-memex-eval-runs', 'mem', `eval-${String(++f.next).padStart(8, '0')}-0000-0000-0000-000000000000`, 'repo'), home: join(home, '.dsh-memex', `eval-${f.next}`) }
  mkdirSync(attempt.cwd, { recursive: true }); mkdirSync(attempt.home, { recursive: true })
  freezeInput(join(directory, 'attempt'), { session, attempt })
  f.attempts.push({ item, session, attempt }); return { session, attempt }
} }))
vi.mock('../src/eval/runtime-tracking.js', () => ({ startHostEvalTracking: () => { f.calls.push('subscribe'); return { owners: f.owners, healthy: () => f.healthy, settleJobs: async () => { f.calls.push('jobs'); if (f.settleFails) throw new Error('raw-job: release unproven') } } } }))
vi.mock('../src/eval/registered-judge.js', () => ({ createRegisteredRoundJudge: async (_ctx: unknown, root: string, round: string, _cwd: string, ledger: any) => {
  f.calls.push('judge-parent'); const id = ledger.reserve(round, 'judge', 'nomem'); ledger.recordCreated(id); f.owners.add(id)
  return { judge: async (_plan: unknown, item: any) => { f.calls.push(`judge:${item.id}`); mkdirSync(join(root, round, item.id, 'judge-protocols')); if (item.id === f.failItem && f.failAt === 'judge') throw new Error('judge failed'); return { item: item.id, verdict: 'unknown' } }, dispose: async () => { f.calls.push('dispose-judge') } }
} }))
vi.mock('../src/eval/tested-budget.js', () => ({ testedLimits: {}, installTestedBudget: (_ctx: unknown, _ledger: unknown, _root: unknown, signal: AbortSignal) => ({ signal, dispose() {} }) }))
vi.mock('../src/eval/controller.js', () => ({ controllerExecutionPort: () => ({}) }))
vi.mock('../src/eval/prepared-execution.js', () => ({ executePreparedItem: async (_round: unknown, item: string, session: string, _attempt: unknown, ledger: any) => {
  f.calls.push(`execute:${item}`); ledger.recordCreated(session); f.owners.add(session)
  if (item === f.failItem && (f.failAt === 'execute' || f.failAt === 'uncertain')) {
    if (f.failAt === 'uncertain') writeFileSync(join(ledger.directory, item, `prompt-${'a'.repeat(64)}.json`), '{}')
    throw new Error('ordinary execution error')
  }
} }))
vi.mock('../src/eval/host-retirer.js', () => ({ createHostRetirer: () => async (id: string) => { f.calls.push(`retire:${id}`); if (f.retireFails) throw new Error(`release unproven: ${id}`) } }))
vi.mock('../src/eval/judge-parent.js', () => ({ requirePristineJudgeParent: () => { f.calls.push('pristine-judge'); if (f.judgeFails) throw new Error('Judge parent contaminated') } }))
vi.mock('../src/eval/runtime-services.js', () => ({ settleHostOneShots: async () => { f.calls.push('judge-descendants') } }))
vi.mock('../src/eval/host-reader.js', () => ({ createHostEvidenceReader: () => ({}) }))
vi.mock('../src/eval/collection.js', () => ({ collectItemEvidence: async (directory: string) => { const item = directory.split('/').at(-1)!; f.calls.push(`collect:${item}`); if (item === f.failItem && f.failAt === 'collect') throw new Error('ordinary collection error') } }))
vi.mock('node:crypto', async importOriginal => ({ ...await importOriginal<any>(), randomUUID: () => f.collision ? 'history-collision' : `00000000-0000-0000-0000-${String(++f.next).padStart(12, '0')}` }))
import { createManagedRoundExecution } from '../src/eval/managed-round.js'

let input: any
let roots: Map<string, object>
let disposeExecution: (() => void) | undefined
const ctx = { effect: (setup: () => () => void) => { disposeExecution = setup() }, get: (name: string) => name === 'agents' ? { get: (id: string) => { if (!roots.has(id)) roots.set(id, {}); return roots.get(id) } } : undefined } as any
const signal = () => new AbortController().signal
beforeEach(() => {
  Object.assign(f, { calls: [], failItem: 'act-mem', failAt: 'execute', healthy: true, settleFails: false, retireFails: false, judgeFails: false, collision: false, attempts: [], owners: new Set(), next: 0 })
  roots = new Map()
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'eval-managed-resume-'))
  input = { root: join(home, 'rounds'), round: 'round', home, generation: 'same-host', judgeCwd: join(home, 'judge'), timeoutMs: 1000, registryFile: join(home, 'state', 'registry'), scopes: {}, controller: {}, routing: async () => {}, backend: {} }
  mkdirSync(join(input.root, input.round), { recursive: true })
})

it.each(['execute', 'collect'])('resumes a retired %s failure with fresh paths, skips completed unknown outcomes and preserves all old evidence', async failAt => {
  f.failAt = failAt
  const execution = createManagedRoundExecution(ctx)
  await expect(execution.run(input, signal())).rejects.toThrow(/ordinary/)
  const old = f.attempts[1], successfulBytes = readFileSync(join(input.root, 'round', 'know-mem', 'outcome.json'), 'utf8')
  writeFileSync(join(input.root, 'round', 'act-mem', 'original-evidence'), 'old evidence')
  const ledgerBefore = readFileSync(join(input.root, 'round', 'ledger.ndjson'), 'utf8'), registryBefore = readFileSync(input.registryFile, 'utf8')
  f.calls.length = 0; f.failItem = ''
  const outcomes = await execution.resume(input, signal())
  expect(Object.keys(outcomes)).toEqual(items.map(item => item.id))
  expect(f.calls.filter(call => call === 'subscribe' || call === 'judge-parent' || call.includes('know-mem'))).toEqual([])
  const fresh = f.attempts[2]
  expect(fresh.session).not.toBe(old.session); expect(fresh.attempt.cwd).not.toBe(old.attempt.cwd); expect(fresh.attempt.home).not.toBe(old.attempt.home)
  expect(existsSync(old.attempt.cwd)).toBe(true); expect(existsSync(old.attempt.home)).toBe(true)
  const history = join(input.root, 'round', 'history'); const batch = readdirSync(history)
  expect(batch).toHaveLength(1)
  expect(readFileSync(join(history, batch[0]!, 'act-mem', 'original-evidence'), 'utf8')).toBe('old evidence')
  expect(readFileSync(join(input.root, 'round', 'know-mem', 'outcome.json'), 'utf8')).toBe(successfulBytes)
  expect(readFileSync(join(input.root, 'round', 'ledger.ndjson'), 'utf8').startsWith(ledgerBefore)).toBe(true)
  expect(readFileSync(input.registryFile, 'utf8').startsWith(registryBefore)).toBe(true)
  const prepare = f.calls.indexOf('prepare:act-mem')
  for (const attempt of [f.attempts[0], old]) expect(f.calls.indexOf(`retire:${attempt.session}`)).toBeLessThan(prepare)
  expect(f.calls.indexOf('jobs')).toBeLessThan(prepare)
  expect(f.calls.indexOf('pristine-judge')).toBeLessThan(prepare)
  expect(f.calls.indexOf('judge-descendants')).toBeLessThan(prepare)
  expect(f.calls.slice(-3)).toEqual(['jobs', 'dispose-judge', 'jobs'])
})

it('refuses missing retained handles even in the same process and generation', async () => {
  await expect(createManagedRoundExecution(ctx).run(input, signal())).rejects.toThrow(/ordinary/)
  f.calls.length = 0
  await expect(createManagedRoundExecution(ctx).resume(input, signal())).rejects.toThrow(/owned|continu|memory/i)
  expect(f.calls).toEqual([])
})
it.each(['generation', 'home', 'registryFile', 'judgeCwd'])('refuses changed trusted %s before resource work', async key => {
  const execution = createManagedRoundExecution(ctx)
  await expect(execution.run(input, signal())).rejects.toThrow(/ordinary/)
  f.calls.length = 0
  await expect(execution.resume({ ...input, [key]: `${input[key]}-different` }, signal())).rejects.toThrow(/identity|generation|match/i)
  expect(f.calls).toEqual([])
})
it.each(['release', 'jobs', 'unhealthy', 'judge', 'uncertain', 'protocol', 'outcome', 'attempt', 'ledger', 'symlink', 'collision', 'pristine', 'root', 'disposed', 'cancelled'])('refuses %s evidence without creating a new attempt', async reason => {
  if (reason === 'release') f.retireFails = true
  if (reason === 'judge') f.failAt = 'judge'
  if (reason === 'uncertain') f.failAt = 'uncertain'
  const execution = createManagedRoundExecution(ctx)
  await expect(execution.run(input, signal())).rejects.toThrow()
  if (reason === 'jobs') f.settleFails = true
  if (reason === 'unhealthy') f.healthy = false
  if (reason === 'protocol') mkdirSync(join(input.root, 'round', 'act-mem', 'judge-protocols'))
  if (reason === 'outcome') writeFileSync(join(input.root, 'round', 'know-mem', 'outcome.json'), '{}')
  if (reason === 'attempt') writeFileSync(join(input.root, 'round', 'act-mem', 'attempt', 'input.json'), '{}')
  if (reason === 'ledger') writeFileSync(join(input.root, 'round', 'ledger.ndjson'), '')
  if (reason === 'symlink') symlinkSync(input.home, join(input.root, 'round', 'history'))
  if (reason === 'collision') { f.collision = true; mkdirSync(join(input.root, 'round', 'history', 'history-collision'), { recursive: true }); writeFileSync(join(input.root, 'round', 'history', 'history-collision', 'sentinel'), 'preserved') }
  if (reason === 'pristine') f.judgeFails = true
  if (reason === 'root') roots.set(f.attempts[0].session, {})
  if (reason === 'disposed') disposeExecution?.()
  if (reason === 'cancelled') writeFileSync(join(input.root, 'round', 'cancel-requested'), 'cancelled')
  const count = f.attempts.length; f.calls.length = 0; f.failItem = ''; f.retireFails = false
  await expect(execution.resume(input, signal())).rejects.toThrow()
  expect(f.attempts).toHaveLength(count)
  expect(f.calls.some(call => call.startsWith('prepare:') || call.startsWith('judge:'))).toBe(false)
})
it('does not turn a previously unknown submission into a retry after a late accepted marker', async () => {
  f.failAt = 'uncertain'
  const execution = createManagedRoundExecution(ctx)
  await expect(execution.run(input, signal())).rejects.toThrow(/ordinary/)
  writeFileSync(join(input.root, 'round', 'act-mem', `prompt-${'a'.repeat(64)}-accepted`), 'late accepted')
  f.failItem = ''; f.calls.length = 0
  await expect(execution.resume(input, signal())).rejects.toThrow(/No proven retired ordinary failure/)
  expect(f.calls).toEqual([])
})
it('does not rebase tampered evidence or retry release proofs after a resume refusal', async () => {
  const execution = createManagedRoundExecution(ctx)
  await expect(execution.run(input, signal())).rejects.toThrow(/ordinary/)
  f.settleFails = true
  await expect(execution.resume(input, signal())).rejects.toThrow(/release unproven/)
  f.settleFails = false; f.failItem = ''; f.calls.length = 0
  await expect(execution.resume(input, signal())).rejects.toThrow(/Prior resume proof failed/)
  expect(f.calls).toEqual([])
})
it('supports another ordinary failure on the new attempt without forgetting historical roots', async () => {
  const execution = createManagedRoundExecution(ctx)
  await expect(execution.run(input, signal())).rejects.toThrow(/ordinary/)
  await expect(execution.resume(input, signal())).rejects.toThrow(/ordinary/)
  f.failItem = ''; f.calls.length = 0
  await execution.resume(input, signal())
  const prepare = f.calls.indexOf('prepare:act-mem')
  for (const attempt of f.attempts.slice(0, 3)) expect(f.calls.indexOf(`retire:${attempt.session}`)).toBeLessThan(prepare)
  expect(readdirSync(join(input.root, 'round', 'history'))).toHaveLength(2)
})
it('rejects active concurrent resume before touching files or resources', async () => {
  const execution = createManagedRoundExecution(ctx)
  const run = execution.run(input, signal())
  await expect(execution.resume(input, signal())).rejects.toThrow(/active|busy/i)
  await expect(run).rejects.toThrow(/ordinary/)
})
