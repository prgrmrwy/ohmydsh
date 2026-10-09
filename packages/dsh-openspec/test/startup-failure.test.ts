import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'

// No real timer or registry request: this suite only observes what a failed mount leaves behind.
vi.mock('../src/catalog-invalidation.js', () => ({
  watchCatalogInvalidation: () => ({ check: async () => {}, dispose() {} }),
}))

const homes: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

/**
 * Mount the adapter against a fake Host context and report every surface a failed startup must not leave
 * behind. `initialDeployment: false` with an empty DSH_HOME makes the active generation unloadable, which
 * is the failure this suite observes.
 */
async function mount(config: Record<string, unknown>) {
  const logged: string[] = []
  let commands = 0
  let providers = 0
  let undos = 0
  let startup!: Promise<unknown>
  const child = {
    logger: { error: (message: unknown) => { logged.push(String(message)) } },
    skills: { registerProvider: () => { providers += 1; return () => {} } },
    commands: { register: () => { commands += 1; return () => {} } },
    provide: () => () => { undos += 1 },
    on() {}, set() {}, effect() {},
  }
  apply(
    { inject: (_names: unknown, callback: any) => { startup = callback(child) }, logger: child.logger } as any,
    config as any,
  )
  await startup
  return { logged, commands, providers, undos }
}

describe('adapter startup failure reporting', () => {
  it('startup_failure_logs_stable_code_and_registers_nothing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-startup-')); homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const result = await mount({ officialConfigPath: join(home, 'absent-official-config.json'), updateCheck: 'disabled', initialDeployment: false })
    expect(result.logged).toHaveLength(1)
    expect(result.logged[0]).toContain('dsh-openspec: startup contributions failed (generation-invalid)')
    // The report is an error class, never error text or a host path.
    expect(result.logged[0]).not.toContain(home)
    expect(result.commands).toBe(0)
    expect(result.providers).toBe(0)
    // Both routing services registered before the failure are undone: no partial surface survives.
    expect(result.undos).toBe(2)
  })
})
