import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { installTestedBudget } from '../src/eval/tested-budget.js'
async function pluginContext(ctx: Context): Promise<Context> {
  let owner!: Context
  await ctx.plugin({ name: 'tested-budget-owner', apply(child: Context) { owner = child } })
  expect(() => owner.agents).toThrow(/without inject/)
  expect(owner.get('agents')).toBeDefined()
  return owner
}
it('observes exact registered root and recursive descendants, stops over the soft request bound and fences late admission after abort', async () => {
  const ctx = new Context(), cancel = vi.fn()
  await ctx.plugin({ name: 'budget-agent-service', apply(provider: Context) { provider.provide('agents', { get: () => ({ cancel }) } as never) } })
  const ledger = { read: () => [{ kind: 'child', parent: 'root', id: 'child' }] }
  const carrier = new AbortController()
  const budget = installTestedBudget(await pluginContext(ctx), ledger as never, 'root', carrier.signal, { maxRequestsPerCondition: 2, maxDurationMsPerCondition: 10000 })
  const request = async (id: string) => ctx.waterfall('llm/stream', { sessionId: id } as never, () => Promise.resolve('delivered') as never)
  try {
    await request('daily'); expect(budget.signal.aborted).toBe(false)
    await request('root'); await request('child')
    await expect(request('child')).rejects.toThrow(/budget/)
    expect(budget.signal.aborted).toBe(true)
    await expect(request('root')).rejects.toThrow(/budget/)
    expect(cancel).toHaveBeenCalledTimes(2)
  } finally { budget.dispose(); await ctx.fiber.dispose() }
})
it('observes wall clock even without any further model request', async () => {
  vi.useFakeTimers()
  const ctx = new Context()
  await ctx.plugin({ name: 'budget-agent-service', apply(provider: Context) { provider.provide('agents', { get: () => ({ cancel() {} }) } as never) } })
  const budget = installTestedBudget(await pluginContext(ctx), { read: () => [] } as never, 'root', new AbortController().signal, { maxRequestsPerCondition: 2, maxDurationMsPerCondition: 50 })
  try { await vi.advanceTimersByTimeAsync(51); expect(budget.signal.aborted).toBe(true) }
  finally { budget.dispose(); await ctx.fiber.dispose(); vi.useRealTimers() }
})
