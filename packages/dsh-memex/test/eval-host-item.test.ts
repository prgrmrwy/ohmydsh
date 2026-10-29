import { beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ calls: [] as string[], releaseFailure: false, healthy: true, failAt: '', item: { id: 'know-mem' } }))
vi.mock('../src/eval/round.js', () => ({ loadFixedRound: () => ({ id: 'round-fixed', items: [f.item] }) }))
vi.mock('../src/eval/freeze.js', () => ({ freezeInput: () => {} }))
vi.mock('../src/eval/tested-budget.js', () => ({ testedLimits: { maxRequestsPerCondition: 128, maxDurationMsPerCondition: 120000 }, installTestedBudget: (_ctx: unknown, _ledger: unknown, _root: unknown, signal: AbortSignal) => ({ signal, dispose() {} }) }))
vi.mock('../src/eval/controller.js', () => ({ controllerExecutionPort: () => ({}) }))
vi.mock('../src/eval/prepared-execution.js', () => ({ executePreparedItem: async () => { f.calls.push('execute'); if (f.failAt === 'execute') throw new Error('execution failed') } }))
vi.mock('../src/eval/host-retirer.js', () => ({ createHostRetirer: () => async () => { f.calls.push('retire'); if (f.failAt === 'retire') f.healthy = false; if (f.releaseFailure) throw new Error('release unproven') } }))
vi.mock('../src/eval/host-reader.js', () => ({ createHostEvidenceReader: () => { f.calls.push('reader'); return async () => ({}) } }))
vi.mock('../src/eval/collection.js', () => ({ collectItemEvidence: async () => { f.calls.push('collect'); if (f.failAt === 'collect') f.healthy = false } }))
import { runHostItem } from '../src/eval/host-item.js'
const input = { root: '/rounds', round: 'round-fixed', item: 'know-mem', session: 'session-reserved', attempt: { cwd: '/u/.dsh-memex-eval-runs/mem/eval-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/repo', home: '/u/.dsh-memex/eval-a-repo' }, ledger: {}, scopes: {}, controller: {}, routing: async () => {}, tracking: { healthy: () => f.healthy }, backend: {}, judge: async () => { f.calls.push('judge'); return 'checked' } } as any
beforeEach(() => { f.healthy = true; f.failAt = '' })
it('rejects unhealthy admission and health loss between retirement, collection and scoring', async () => {
  for (const stage of ['initial', 'retire', 'collect']) {
    f.calls.length = 0; f.releaseFailure = false; f.healthy = stage !== 'initial'; f.failAt = stage
    await expect(runHostItem({} as never, input, new AbortController().signal)).rejects.toThrow(/unhealthy/)
    expect(f.calls).toEqual(stage === 'initial' ? [] : stage === 'retire' ? ['execute', 'retire'] : ['execute', 'retire', 'reader', 'collect'])
  }
})
it('assembles frozen plan execution, retirement, registered collection, then scoring', async () => {
  f.calls.length = 0; f.releaseFailure = false
  expect(await runHostItem({} as never, input, new AbortController().signal)).toBe('checked')
  expect(f.calls).toEqual(['execute', 'retire', 'reader', 'collect', 'judge'])
})
it('release failure blocks physical log access and judging in the assembled entry', async () => {
  f.calls.length = 0; f.releaseFailure = true
  await expect(runHostItem({} as never, input, new AbortController().signal)).rejects.toThrow('release unproven')
  expect(f.calls).toEqual(['execute', 'retire'])
})
it('attributes execution failures after successful retirement to execute, and retains retirement failures separately', async () => {
  f.releaseFailure = false; f.failAt = 'execute'
  await expect(runHostItem({} as never, input, new AbortController().signal)).rejects.toMatchObject({ phase: 'execute', message: 'execution failed' })
  f.releaseFailure = true; f.failAt = ''
  await expect(runHostItem({} as never, input, new AbortController().signal)).rejects.toMatchObject({ phase: 'retire', message: 'release unproven' })
  f.releaseFailure = false; f.failAt = 'collect'
  await expect(runHostItem({} as never, input, new AbortController().signal)).rejects.toMatchObject({ phase: 'collect' })
})
it('unplanned item is refused before controller or resource access', async () => {
  f.calls.length = 0; f.releaseFailure = false
  await expect(runHostItem({} as never, { ...input, item: 'daily' }, new AbortController().signal)).rejects.toThrow(/outside/)
  expect(f.calls).toEqual([])
})
