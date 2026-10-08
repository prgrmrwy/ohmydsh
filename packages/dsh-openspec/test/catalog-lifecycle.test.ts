import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'
import { loadGeneration } from '../src/generations.js'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'

const monitors: any[] = []
vi.mock('../src/catalog-invalidation.js', () => ({ watchCatalogInvalidation: (options: any) => {
  const monitor = { check: async () => {}, dispose: vi.fn(), tick: async () => options.invalidate() }
  monitors.push(monitor); return monitor
} }))
const homes: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); monitors.splice(0); await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })
async function start(delivery = 'both', realRegistry = false) {
  const home = await mkdtemp(join(tmpdir(), 'catalog-lifecycle-')); homes.push(home); vi.stubEnv('DSH_HOME', home)
  const configPath = join(home, 'official.json')
  const edit = async (workflows: string[], mode = delivery) => writeFile(configPath, JSON.stringify({ profile: 'custom', workflows, delivery: mode }))
  await edit(['propose', 'explore'])
  const definitions = new Map<string, any>(), effects: any[] = []
  let provider: any, cached: any, startup: Promise<any>
  const invalidate = vi.fn(() => { cached = undefined })
  const signal = new AbortController()
  const registryContext = new Context()
  if (realRegistry) await registryContext.plugin(SkillRegistry)
  const child = {
    skills: { registerProvider: (factory: any) => { if (realRegistry) return registryContext.skills.registerProvider(control => { provider = factory(control); return provider }); provider = factory({ invalidate, signal: signal.signal }); return () => { signal.abort(); cached = undefined } } },
    commands: { register: (definition: any) => { definitions.set(definition.name, definition); return () => { if (definitions.get(definition.name) === definition) definitions.delete(definition.name) } } },
    provide() {}, on() {}, set: vi.fn(), effect: (factory: any) => { effects.push(factory()) },
  }
  apply({ inject: (_names: any, callback: any) => { startup = callback(child) } } as any, { officialConfigPath: configPath, updateCheck: 'disabled' })
  await startup!
  const list = async () => realRegistry ? registryContext.skills.list({ cwd: '/project' }) : cached ??= await provider.list()
  return { home, edit, definitions, provider, invalidate, list, dispose: () => effects.reverse().forEach(dispose => dispose?.()), monitor: monitors.at(-1) }
}

describe('actual adapter catalog lifecycle', () => {
  it('real_SkillRegistry_cached_catalog_is_invalidated_by_profile_refresh', async () => {
    const h = await start('both', true)
    expect((await h.list()).map((s: any) => s.name)).toContain('openspec-explore')
    await h.edit(['propose', 'apply']); await h.monitor.tick()
    expect((await h.list()).map((s: any) => s.name)).toContain('openspec-apply-change')
    expect((await h.list()).map((s: any) => s.name)).not.toContain('openspec-explore')
    h.dispose(); expect(await h.list()).toEqual([])
  })
  it('configuration_change_invalidates_cached_listing_replaces_commands_and_can_return_to_original_selection', async () => {
    const h = await start(); const initial = await loadGeneration(h.home)
    const manifest = join(h.home, 'plugins/dsh-openspec/generations', initial.id, 'generation.json')
    const original = await readFile(manifest)
    expect((await h.list()).map((s: any) => s.name)).toContain('openspec-explore')
    const staleExplore = h.definitions.get('opsx-explore')
    await h.edit(['propose', 'apply']); await h.monitor.tick()
    expect(h.invalidate).toHaveBeenCalled()
    expect((await h.list()).map((s: any) => s.name)).toContain('openspec-apply-change')
    expect((await h.list()).map((s: any) => s.name)).not.toContain('openspec-explore')
    expect(h.definitions.has('opsx-apply')).toBe(true); expect(h.definitions.has('opsx-explore')).toBe(false)
    const send = vi.fn()
    expect(await staleExplore.handler({ agent: { send }, rawInput: '' })).toMatchObject({ kind: 'error' })
    expect(send).not.toHaveBeenCalled()
    await h.edit(['propose', 'explore']); await h.monitor.tick()
    expect((await loadGeneration(h.home)).id).toBe(initial.id)
    expect(h.definitions.has('opsx-explore')).toBe(true); expect(h.definitions.has('opsx-apply')).toBe(false)
    expect(await readFile(manifest)).toEqual(original)
    h.dispose(); expect(h.definitions.size).toBe(0); expect(h.monitor.dispose).toHaveBeenCalled()
  })
  it('failed_refresh_keeps_previous_generation_and_surface_then_retry_is_single_flight_and_disposal_stops_refresh', async () => {
    const h = await start(); const initial = await loadGeneration(h.home)
    await h.edit(['propose'], 'invalid')
    await expect(h.monitor.tick()).rejects.toThrow('invalid official delivery')
    expect((await loadGeneration(h.home)).id).toBe(initial.id)
    expect(h.definitions.has('opsx-explore')).toBe(true)
    await h.edit(['propose', 'apply'])
    await Promise.all([h.monitor.tick(), h.monitor.tick(), h.monitor.tick()])
    expect(h.invalidate).toHaveBeenCalledTimes(1)
    const last = await loadGeneration(h.home)
    h.dispose(); await h.edit(['propose', 'explore']); await h.monitor.tick()
    expect((await loadGeneration(h.home)).id).toBe(last.id)
    expect(h.definitions.size).toBe(0)
  })
  it('delivery_applies_to_native_surface_and_consumption_refreshes_before_using_cached_candidate', async () => {
    const h = await start('skills')
    expect(h.definitions.has('opsx-propose')).toBe(false)
    const candidate = (await h.list()).find((s: any) => s.name === 'openspec-explore')
    await h.edit(['propose', 'apply'], 'commands')
    expect(await h.provider.get(candidate, {})).toBeUndefined()
    expect((await h.list()).map((s: any) => s.name)).toEqual(['openspec-upgrade'])
    expect(h.definitions.has('opsx-apply')).toBe(true)
    h.dispose()
  })
})
