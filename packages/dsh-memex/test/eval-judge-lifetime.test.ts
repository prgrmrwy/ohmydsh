import { expect, it, vi } from 'vitest'
import { runBoundedJudge } from '../src/eval/judge-lifetime.js'

it('awaits disposal before returning successful output', async () => {
  const calls: string[] = []
  const result = await runBoundedJudge(new AbortController().signal, 1000, async () => ({ result: Promise.resolve('answer'), dispose: async () => { calls.push('disposed') } }))
  expect(result).toBe('answer'); expect(calls).toEqual(['disposed'])
})

it('does not publish success while the owned disposer is still pending', async () => {
  let release!: () => void, entered!: () => void
  const disposing = new Promise<void>(resolve => { entered = resolve })
  const cleanup = new Promise<void>(resolve => { release = resolve })
  let published = false
  const result = runBoundedJudge(new AbortController().signal, 1000, async () => ({
    result: Promise.resolve('answer'), dispose: async () => { entered(); await cleanup },
  })).then(value => { published = true; return value })
  await disposing
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(published).toBe(false)
  release()
  expect(await result).toBe('answer')
})

it('aborts on carrier disconnect and still awaits the owned run disposer', async () => {
  const carrier = new AbortController()
  let disposed = false
  const result = runBoundedJudge(carrier.signal, 1000, async signal => ({
    result: new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
    dispose: async () => { disposed = true },
  }))
  await Promise.resolve()
  carrier.abort()
  await expect(result).rejects.toThrow(/abort/)
  expect(disposed).toBe(true)
})

it('timeout cancels startup even before a run is published', async () => {
  vi.useFakeTimers()
  let observed = false
  try {
    const result = runBoundedJudge(new AbortController().signal, 50, signal => new Promise((_, reject) => {
      signal.addEventListener('abort', () => { observed = true; reject(new Error('startup aborted')) }, { once: true })
    }))
    const observedResult = result.then(() => ({ error: undefined }), error => ({ error }))
    await vi.advanceTimersByTimeAsync(50)
    expect((await observedResult).error).toBeInstanceOf(Error)
    expect(String((await observedResult).error)).toMatch(/abort/)
    expect(observed).toBe(true)
  } finally { vi.useRealTimers() }
})

it('disposal failure is fatal, not an unknown scoring result', async () => {
  await expect(runBoundedJudge(new AbortController().signal, 1000, async () => ({ result: Promise.resolve('answer'), dispose: async () => { throw new Error('dispose failed') } }))).rejects.toThrow(/cleanup.*dispose failed/)
})
