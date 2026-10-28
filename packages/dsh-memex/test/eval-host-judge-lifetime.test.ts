import { expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ dispose: vi.fn(async () => {}), score: vi.fn() }))
vi.mock('../src/eval/round.js', () => ({ loadFixedRound: () => ({}) }))
vi.mock('../src/eval/judge-parent.js', () => ({ createJudgeParent: async () => ({ agent: {}, dispose: fake.dispose }) }))
vi.mock('../src/eval/host-scorer.js', () => ({ createHostScorer: () => fake.score }))
import { createRoundJudge } from '../src/eval/host-judge.js'

it('rejects concurrent scoring before freezing a second item or invoking its scorer', async () => {
  fake.dispose.mockClear(); fake.score.mockClear()
  const finish: (() => void)[] = []
  fake.score.mockImplementation(() => new Promise<void>(resolve => { finish.push(resolve) }))
  const owned = await createRoundJudge({} as never, '/fixture', 'round', { id: 'judge', cwd: '/fixture', preset: 'minimal' }, {} as never, 1000)
  const first = owned.judge({} as never, {} as never, new AbortController().signal)
  const second = owned.judge({} as never, {} as never, new AbortController().signal)
  const outcome = second.then(() => 'accepted', error => String(error))
  finish.forEach(resolve => resolve())
  await first
  expect(await outcome).toMatch(/busy/)
  expect(fake.score).toHaveBeenCalledTimes(1)
  await owned.dispose()
})

it('keeps a rejected scoring result sticky after it leaves the active map', async () => {
  fake.dispose.mockClear(); fake.score.mockRejectedValue(new Error('uncertain score'))
  const owned = await createRoundJudge({} as never, '/fixture', 'round', { id: 'judge', cwd: '/fixture', preset: 'minimal' }, {} as never, 1000)
  await expect(owned.judge({} as never, {} as never, new AbortController().signal)).rejects.toThrow('uncertain score')
  await expect(owned.judge({} as never, {} as never, new AbortController().signal)).rejects.toThrow(/unhealthy/)
  await expect(owned.dispose()).rejects.toThrow(/release unproven/)
  expect(fake.dispose).not.toHaveBeenCalled()
})

it('preserves the parent when active scoring rejects during shutdown instead of hiding uncertain child cleanup', async () => {
  fake.dispose.mockClear()
  const failure = new Error('Judge cleanup failed: fictional resource')
  fake.score.mockImplementation(async (_plan, _item, signal: AbortSignal) => {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    throw failure
  })
  const owned = await createRoundJudge({} as never, '/fixture', 'round', { id: 'judge', cwd: '/fixture', preset: 'minimal' }, {} as never, 1000)
  const work = owned.judge({} as never, {} as never, new AbortController().signal).catch(error => error)
  await expect(owned.dispose()).rejects.toThrow(/release unproven/)
  expect(await work).toBe(failure)
  expect(fake.dispose).not.toHaveBeenCalled()
  await expect(owned.dispose()).rejects.toThrow(/release unproven/)
})
