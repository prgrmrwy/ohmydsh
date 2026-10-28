import { expect, it } from 'vitest'
import { runFixedItem } from '../src/eval/item-runner.js'
import type { RoundItem } from '../src/eval/round.js'
const item = { id: 'know-mem', prompt: 'fictional', kind: 'Know', condition: 'mem', writebackApplicable: false } as RoundItem
it('executes then proves retirement before collecting or scoring', async () => {
  const calls: string[] = []
  const result = await runFixedItem(item, {
    execute: async () => { calls.push('execute') }, retire: async () => { calls.push('retire') },
    collect: async () => { calls.push('collect') }, score: async () => { calls.push('score'); return ['result'] },
  }, new AbortController().signal)
  expect(calls).toEqual(['execute', 'retire', 'collect', 'score'])
  expect(result).toEqual(['result'])
})
it('preserves the scene on failed release and never reads or judges uncertain evidence', async () => {
  const calls: string[] = []
  await expect(runFixedItem(item, {
    execute: async () => { calls.push('execute') }, retire: async () => { calls.push('retire'); throw new Error('release unproven') },
    collect: async () => { calls.push('collect') }, score: async () => { calls.push('score') },
  }, new AbortController().signal)).rejects.toThrow('release unproven')
  expect(calls).toEqual(['execute', 'retire'])
})
it('a pre-aborted request creates nothing; cancellation during execution still retires', async () => {
  for (const pre of [true, false]) {
    const abort = new AbortController(), calls: string[] = []
    if (pre) abort.abort()
    await expect(runFixedItem(item, {
      execute: async () => { calls.push('execute'); abort.abort() }, retire: async () => { calls.push('retire') },
      collect: async () => { calls.push('collect') }, score: async () => { calls.push('score') },
    }, abort.signal)).rejects.toThrow(/aborted/)
    expect(calls).toEqual(pre ? [] : ['execute', 'retire'])
  }
})
it('preserves both failures when execution and retirement fail', async () => {
  const execution = new Error('execution'), release = new Error('release')
  let caught: unknown
  try { await runFixedItem(item, {
    execute: async () => { throw execution }, retire: async () => { throw release }, collect: async () => {}, score: async () => {},
  }, new AbortController().signal) } catch (error) { caught = error }
  expect(caught).toBeInstanceOf(AggregateError)
  expect((caught as AggregateError).errors).toEqual([execution, release])
})

it('execution failure still invokes retirement, but never collects or retries', async () => {
  const calls: string[] = []
  await expect(runFixedItem(item, {
    execute: async () => { throw new Error('execution failed') }, retire: async () => { calls.push('retire') },
    collect: async () => { calls.push('collect') }, score: async () => { calls.push('score') },
  }, new AbortController().signal)).rejects.toThrow('execution failed')
  expect(calls).toEqual(['retire'])
})
