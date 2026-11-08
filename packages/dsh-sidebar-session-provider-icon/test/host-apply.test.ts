import { Context } from '@deepseek-ai/cordis'
import Projections from '@deepseek-ai/dsh-session-projection'
import { afterEach, describe, expect, it } from 'vitest'
import * as plugin from '../src/index.js'
import { providerProjectionDefinition } from '../src/provider.js'

const contexts: Context[] = []
async function host() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Projections)
  return ctx
}
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

describe('host entry against the real projection registry', () => {
  it('declares the registry as its only dependency', () => {
    expect(plugin.inject).toEqual(['sessionProjections'])
  })

  it('awaits the asynchronous registration: apply() settles only after the key is live', async () => {
    const ctx = await host()
    const registry = ctx.sessionProjections
    expect(registry.summaryKeys().has('provider')).toBe(false)
    const started = plugin.apply(ctx)
    expect(started).toBeInstanceOf(Promise)
    await expect(started).resolves.toBeUndefined()
    expect(registry.summaryKeys().has('provider')).toBe(true)
  })

  it('releases the registration when the plugin fiber is disposed', async () => {
    const ctx = await host()
    const fiber = await ctx.plugin(plugin)
    expect(ctx.sessionProjections.summaryKeys().has('provider')).toBe(true)
    await fiber.dispose()
    expect(ctx.sessionProjections.summaryKeys().has('provider')).toBe(false)
  })

  it('surfaces a conflicting registration as a failed start instead of a swallowed rejection', async () => {
    const ctx = await host()
    // Another registrant already owns the key at a different stateVersion.
    const other = await ctx.sessionProjections.register({
      ...providerProjectionDefinition,
      stateVersion: providerProjectionDefinition.stateVersion + 1,
    } as never)
    expect(other).toBeDefined()
    await expect(plugin.apply(ctx)).rejects.toThrow(/already registered at stateVersion/)
  })
})
