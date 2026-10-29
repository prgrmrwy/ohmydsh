import { mkdtempSync, realpathSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ calls: [] as string[], fail: false, settlementFails: false, settlements: 0, failSettlementAt: 0, dispose: undefined as (() => Promise<void>) | undefined }))
vi.mock('../src/eval/ledger.js', () => ({ EvalLedger: class {} }))
vi.mock('../src/eval/round.js', () => ({ loadFixedRound: () => ({}) }))
vi.mock('../src/eval/runtime-tracking.js', () => ({ startHostEvalTracking: () => { f.calls.push('subscribe'); return { healthy: () => true, settleJobs: async () => { f.calls.push('settle'); if (++f.settlements === f.failSettlementAt || f.settlementFails) throw new Error('final job release unproven') } } } }))
vi.mock('../src/eval/registered-judge.js', () => ({ createRegisteredRoundJudge: async () => { f.calls.push('judge-parent'); return { judge: async () => {}, dispose: async () => { f.calls.push('dispose-judge'); await f.dispose?.() } } } }))
vi.mock('../src/eval/host-round.js', () => ({ runHostRound: async () => { f.calls.push('run-round'); if (f.fail) throw new Error('release unproven'); return { fixed: 'result' } } }))
import { runManagedRound } from '../src/eval/managed-round.js'
const input = { root: '/rounds', round: 'round', generation: 'host', judgeCwd: '/judge', timeoutMs: 1000, registryFile: '/registry' } as any
beforeEach(() => { f.settlementFails = false; f.settlements = 0; f.failSettlementAt = 0; f.dispose = undefined; input.root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-managed-')); input.registryFile = join(input.root, 'state', 'registry'); input.judgeCwd = join(input.root, 'judge'); mkdirSync(join(input.root, input.round)) })
it('persists Host generation and refuses replay before subscribing, including across a new Host', async () => {
  f.fail = false
  await runManagedRound({} as never, input, new AbortController().signal)
  expect(JSON.parse(readFileSync(join(input.root, input.round, 'run-started.json'), 'utf8'))).toEqual({ generation: 'host' })
  f.calls.length = 0
  for (const generation of ['host', 'different-host']) {
    await expect(runManagedRound({} as never, { ...input, generation }, new AbortController().signal)).rejects.toThrow(/exist|started/)
    expect(f.calls).toEqual([])
  }
})
it('subscribes before any judge parent, runs the fixed round and only then closes the owned judge', async () => {
  f.calls.length = 0; f.fail = false
  expect(await runManagedRound({} as never, input, new AbortController().signal)).toEqual({ fixed: 'result' })
  expect(f.calls).toEqual(['subscribe', 'judge-parent', 'run-round', 'settle', 'dispose-judge', 'settle'])
})
it.each([false, true])('waits for parent disposal before final settlement or success (reject=%s)', async reject => {
  f.calls.length = 0; f.fail = false
  let release!: () => void, fail!: (error: Error) => void, entered!: () => void
  const disposing = new Promise<void>(resolve => { entered = resolve })
  const cleanup = new Promise<void>((resolve, reject) => { release = resolve; fail = reject })
  f.dispose = async () => { entered(); await cleanup }
  let published = false
  const result = runManagedRound({} as never, input, new AbortController().signal).then(value => { published = true; return value })
  const observed = result.catch(error => error)
  await disposing
  expect(published).toBe(false)
  expect(f.calls.at(-1)).toBe('dispose-judge')
  expect(f.settlements).toBe(1)
  if (reject) {
    fail(new Error('parent disposal unproven'))
    expect(await observed).toMatchObject({ message: 'parent disposal unproven' })
    expect(f.settlements).toBe(1)
  } else {
    release()
    expect(await observed).toEqual({ fixed: 'result' })
    expect(f.settlements).toBe(2)
  }
})
it('refuses success if the final post-disposal job proof fails', async () => {
  f.calls.length = 0; f.fail = false; f.failSettlementAt = 2
  await expect(runManagedRound({} as never, input, new AbortController().signal)).rejects.toThrow('final job release unproven')
  expect(f.calls).toEqual(['subscribe', 'judge-parent', 'run-round', 'settle', 'dispose-judge', 'settle'])
})
it('preserves uncertain failure scenes and never reports normal disposal after round failure', async () => {
  f.calls.length = 0; f.fail = true
  await expect(runManagedRound({} as never, input, new AbortController().signal)).rejects.toThrow('release unproven')
  expect(f.calls).toEqual(['subscribe', 'judge-parent', 'run-round'])
})
it('final job proof failure preserves judge parent and never reports normal completion', async () => {
  f.calls.length = 0; f.fail = false; f.settlementFails = true
  await expect(runManagedRound({} as never, input, new AbortController().signal)).rejects.toThrow('final job release unproven')
  expect(f.calls).toEqual(['subscribe', 'judge-parent', 'run-round', 'settle'])
})
it('missing Host generation refuses subscriptions and resource creation', async () => {
  f.calls.length = 0; f.fail = false
  await expect(runManagedRound({} as never, { ...input, generation: '' }, new AbortController().signal)).rejects.toThrow(/generation/)
  expect(f.calls).toEqual([])
})
it('a persisted cancellation refuses the managed entry before subscriptions or start markers', async () => {
  f.calls.length = 0; f.fail = false
  writeFileSync(join(input.root, input.round, 'cancel-requested'), 'cancelled')
  await expect(runManagedRound({} as never, input, new AbortController().signal)).rejects.toThrow(/cancel/)
  expect(f.calls).toEqual([])
  expect(existsSync(join(input.root, input.round, 'run-started.json'))).toBe(false)
})
it('pre-aborted carrier admits no resources', async () => {
  f.calls.length = 0
  const abort = new AbortController(); abort.abort()
  await expect(runManagedRound({} as never, input, abort.signal)).rejects.toThrow(/aborted/)
  expect(f.calls).toEqual([])
})
