import { expect, it } from 'vitest'
import { requireOneShotRelease } from '../src/eval/descendants.js'

it('accepts fully observed one-shot descendants only after their lawful owner released live agents', async () => {
  let checkedJobs = 0
  await requireOneShotRelease({
    list: async () => [{ kind: 'child', id: 'child', mode: 'one-shot' }],
    live: () => false,
    known: new Set(['root', 'child']),
    settleJobs: async () => { checkedJobs++ },
  })
  expect(checkedJobs).toBe(1)
})

it('rejects a still-live one-shot instead of borrowing its disposer', async () => {
  await expect(requireOneShotRelease({
    list: async () => [{ kind: 'child', id: 'child', mode: 'one-shot' }], live: () => true,
    known: new Set(['child']), settleJobs: async () => {},
  })).rejects.toThrow(/child/)
})

it('refuses catalog diagnostics, unobserved descendants or missing release evidence', async () => {
  for (const rows of [[{ kind: 'diagnostic', id: 'broken', reason: 'unavailable' }], [{ kind: 'child', id: 'unseen', mode: 'one-shot' }]]) {
    await expect(requireOneShotRelease({ list: async () => rows, live: () => false, known: new Set(), settleJobs: async () => {} })).rejects.toThrow()
  }
  await expect(requireOneShotRelease({ list: async () => [], live: () => false, known: new Set(), settleJobs: async () => { throw new Error('job unproven') } })).rejects.toThrow('job unproven')
})
