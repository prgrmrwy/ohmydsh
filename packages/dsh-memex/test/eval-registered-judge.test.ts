import { expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../src/eval/host-judge.js', () => ({ createRoundJudge: mock.create }))
import { createRegisteredRoundJudge } from '../src/eval/registered-judge.js'
it('reserves the parent before creation and fixes the preset internally', async () => {
  const calls: string[] = []
  const owners = new Set<string>()
  const ledger = { reserve: (round: string, question: string, condition: string) => { calls.push(`${round}/${question}/${condition}`); return 'session-parent' } }
  mock.create.mockImplementation(async (_ctx, _root, _round, parent) => {
    expect(calls).toEqual(['round/judge/nomem'])
    expect(parent).toEqual({ id: 'session-parent', cwd: '/judge', preset: 'memex-eval-judge' })
    owners.add(parent.id)
    return { judge: async () => {}, dispose: async () => {} }
  })
  await createRegisteredRoundJudge({} as never, '/rounds', 'round', '/judge', ledger as never, { owners, healthy: () => true }, {} as never, 1000)
})
it('unhealthy tracking refuses any new parent reservation or creation', async () => {
  mock.create.mockClear()
  const reserve = vi.fn()
  await expect(createRegisteredRoundJudge({} as never, '/rounds', 'round', '/judge', { reserve } as never, { owners: new Set(), healthy: () => false }, {} as never, 1000)).rejects.toThrow(/unhealthy/)
  expect(reserve).not.toHaveBeenCalled()
  expect(mock.create).not.toHaveBeenCalled()
})
