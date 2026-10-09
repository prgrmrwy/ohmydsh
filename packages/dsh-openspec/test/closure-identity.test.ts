import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'
import { loadGeneration } from '../src/generations.js'

// Only the closure fingerprint is controlled; every other closure function stays real, so the generation
// bytes are still produced by the production materializer.
vi.mock('../src/catalog-invalidation.js', () => ({
  watchCatalogInvalidation: () => ({ check: async () => {}, dispose() {} }),
}))
const state = vi.hoisted(() => ({ closure: 'closure-a' }))
vi.mock('../src/generation-closure.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  closureIdentity: async () => state.closure,
}))

const homes: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

async function startAdapter(home: string) {
  vi.stubEnv('DSH_HOME', home)
  let startup!: Promise<unknown>
  const child = {
    skills: { registerProvider: (factory: any) => { factory({ invalidate() {}, signal: new AbortController().signal }); return () => {} } },
    commands: { register: () => () => {} },
    provide: () => () => {},
    on() {}, set() {}, effect() {},
  }
  apply({ inject: (_names: unknown, callback: any) => { startup = callback(child) } } as any,
    { officialConfigPath: join(home, 'absent-official-config.json'), updateCheck: 'disabled' })
  await startup
}

describe('generation identity covers the dependency closure', () => {
  it('changed_closure_derives_a_new_generation_instead_of_colliding', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-closure-')); homes.push(home)
    state.closure = 'closure-a'
    await startAdapter(home)
    const firstId = (await loadGeneration(home)).id
    const manifest = join(home, 'plugins/dsh-openspec/generations', firstId, 'generation.json')
    const before = await readFile(manifest)
    state.closure = 'closure-b'
    await startAdapter(home)
    const secondId = (await loadGeneration(home)).id
    expect(secondId).not.toBe(firstId)
    expect(await readFile(manifest)).toEqual(before)
  })
})
