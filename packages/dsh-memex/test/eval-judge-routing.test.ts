import { expect, it, vi } from 'vitest'
vi.mock('../src/eval/judge-boundary.js', () => ({ installJudgeBoundary: () => ({ checked: () => 1, dispose() {} }) }))
import { runHostJudge } from '../src/eval/judge-runner.js'

it.each(['missing', 'ack', 'readback'])('refuses %s routing proof before spawning or claiming judge budget', async failure => {
  const start = vi.fn(), claim = vi.fn(), calls: string[] = []
  const parent = { id: 'judge-parent', session: { snapshotEvents: () => [] }, inbox: { nextTurn: [], nextStep: [] } }
  const ctx = { get: (name: string) => name === 'subagents' ? { start } : failure === 'missing' ? undefined : { call: async (op: string) => { calls.push(op); return { mode: (failure === 'ack' && op === 'setMode') || (failure === 'readback' && op === 'state') ? 'AUTO' : 'MANUAL' } } },
    plugin: (plugin: any) => { plugin.apply({}); return { then: (resolve: (value: unknown) => void) => resolve(undefined), dispose: async () => {} } } }
  await expect(runHostJudge(ctx as never, parent as never, { provider: 'p', model: 'm', prompt: 'fixed', schema: {} }, new AbortController().signal, 100, { claim })).rejects.toThrow(/routing service unavailable|MANUAL readback mismatch/)
  expect(start).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled()
  expect(calls).toEqual(failure === 'missing' ? [] : ['setMode', 'state'])
})
