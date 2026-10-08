import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config, MEMEX_CONFIG_PATHS, guardConfigCandidates, parseConfig, readScopeConfig } from '../src/scope/settings.js'
import { createMemexRuntime, type MemexRuntime } from '../src/plugin.js'
import { liveConfig } from './support/live-config.js'

// dsh-memex-scope「配置经 DSH settings 承载」on DSH 0.2.0: the scope table is
// the plugin's own Cordis Config. Volatile fields update the running instance
// without a remount; the loader validates every candidate through
// `internal/config` and keeps the running (last-good) values when it is invalid.

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

describe('memex Config', () => {
  it('declares the scope table volatile and the organization keys ordinary', () => {
    const value = parseConfig({ internalHosts: ['git.corp.example'], scopes: [{ name: 'work' }] })
    expect(value.internalHosts).toEqual(['git.corp.example'])
    for (const key of MEMEX_CONFIG_PATHS) {
      expect(typeof (value as unknown as Record<string, { get?: unknown }>)[key]?.get).toBe('function')
    }
    expect(readScopeConfig(value).scopes.map(scope => scope.name)).toEqual(['work'])
  })

  it('uses schema defaults when the plugin row carries no config', () => {
    expect(readScopeConfig(parseConfig({}))).toEqual({ autoDerive: true, scopes: [], bindings: [], workspaces: [] })
  })

  it('rejects an invalid scope table at parse time', () => {
    expect(() => parseConfig({ scopes: [{ name: 'dup' }, { name: 'dup' }] })).toThrow(/duplicate scope/)
    expect(() => parseConfig({ scopes: [{ name: 'a', remotePatterns: ['('] }] })).toThrow(/invalid remote pattern/)
  })
})

/** A minimal plugin carrying exactly memex's Config and runtime, mounted behind a real Loader. */
function probe(seen: { runtime?: MemexRuntime; mounts: number }) {
  return {
    name: 'dsh-memex',
    Config,
    apply(ctx: Context, config: Config) {
      seen.mounts += 1
      guardConfigCandidates(ctx)
      seen.runtime = createMemexRuntime(ctx, config)
    },
  }
}

describe('memex runtime over live Config', () => {
  it('starts from the validated row config', async () => {
    const ctx = new Context(); contexts.push(ctx)
    const seen: { runtime?: MemexRuntime; mounts: number } = { mounts: 0 }
    await liveConfig(ctx, probe(seen) as never, { scopes: [{ name: 'work', pathPrefixes: ['/w'] }] })
    expect(seen.runtime!.config().scopes.map(scope => scope.name)).toEqual(['work'])
    expect(seen.runtime!.scopes.current.resolve('/w/repo').scope).toBe('work')
  })

  it('applies a scope edit live, without remounting the plugin', async () => {
    const ctx = new Context(); contexts.push(ctx)
    const seen: { runtime?: MemexRuntime; mounts: number } = { mounts: 0 }
    const live = await liveConfig(ctx, probe(seen) as never, { scopes: [{ name: 'work', pathPrefixes: ['/w'] }] })
    const runtime = seen.runtime!
    await live.replace({ scopes: [{ name: 'other', pathPrefixes: ['/w'] }] })
    expect(seen.mounts).toBe(1)
    expect(seen.runtime).toBe(runtime)
    expect(runtime.config().scopes.map(scope => scope.name)).toEqual(['other'])
    expect(runtime.scopes.current.resolve('/w/repo').scope).toBe('other')
  })

  it('refuses an invalid candidate before it is written', async () => {
    const ctx = new Context(); contexts.push(ctx)
    const seen: { runtime?: MemexRuntime; mounts: number } = { mounts: 0 }
    const live = await liveConfig(ctx, probe(seen) as never, { scopes: [{ name: 'work', pathPrefixes: ['/w'] }] })
    await expect(live.replace({ scopes: [{ name: 'dup' }, { name: 'dup' }] })).rejects.toThrow(/duplicate scope/)
    expect(seen.runtime!.config().scopes.map(scope => scope.name)).toEqual(['work'])
  })

  it('keeps last-good routing when an invalid edit reaches the loader anyway', async () => {
    const ctx = new Context(); contexts.push(ctx)
    const seen: { runtime?: MemexRuntime; mounts: number } = { mounts: 0 }
    const live = await liveConfig(ctx, probe(seen) as never, { scopes: [{ name: 'work', pathPrefixes: ['/w'] }] })
    const runtime = seen.runtime!
    // A hand-edited patch skips the settings pre-check; the loader still rejects it.
    await live.force({ scopes: [{ name: 'dup' }, { name: 'dup' }] })
    expect(runtime.config().scopes.map(scope => scope.name)).toEqual(['work'])
    expect(runtime.scopes.current.resolve('/w/repo').scope).toBe('work')
  })
})
