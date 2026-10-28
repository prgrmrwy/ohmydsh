import { expect, it } from 'vitest'
import { requireSameHostResume } from '../src/eval/resume.js'
it('cross-Host recovery or live resources cannot be authorized by readable budget or terminal labels', async () => {
  for (const state of [
    { frozenGeneration: 'old', generation: 'new', healthy: true, pending: 0 },
    { frozenGeneration: 'same', generation: 'same', healthy: false, pending: 0 },
    { frozenGeneration: 'same', generation: 'same', healthy: true, pending: 1 },
  ]) {
    let checked = false
    await expect(requireSameHostResume(state, async () => { checked = true })).rejects.toThrow()
    expect(checked).toBe(false)
  }
})
it('requires fresh release proof even on the same healthy Host with an empty queue', async () => {
  let calls = 0
  await expect(requireSameHostResume({ frozenGeneration: 'same', generation: 'same', healthy: true, pending: 0 }, async () => { calls++; throw new Error('release missing') })).rejects.toThrow('release missing')
  expect(calls).toBe(1)
})
