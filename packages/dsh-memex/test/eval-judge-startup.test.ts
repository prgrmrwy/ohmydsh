import { expect, it } from 'vitest'
import { runHostJudge } from '../src/eval/judge-runner.js'

it('a synchronous plugin activation failure releases the parent busy lock', async () => {
  const parent = { session: { snapshotEvents: () => [] }, inbox: { nextTurn: [], nextStep: [] } }
  let attempts = 0
  const ctx = { get: () => ({}), plugin: () => { attempts++; throw new Error('activation failed') } }
  const protocol = { provider: 'mock', model: 'judge', prompt: 'fixed', schema: {} }
  for (let i = 0; i < 2; i++) await expect(runHostJudge(ctx as never, parent as never, protocol, new AbortController().signal, 100)).rejects.toThrow('activation failed')
  expect(attempts).toBe(2)
})
