import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { activateGeneration, loadGeneration } from '../src/generations.js'
import { createGenerationBackedProvider } from '../src/generation-provider.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function root() { const dir = await mkdtemp(join(tmpdir(), 'dsh-openspec-gen-')); roots.push(dir); return dir }

describe('immutable generations', () => {
  it('recovery_detection_keeps_previous_active_generation_and_refuses_new_selection', async () => {
    const { createUpgradeTransaction } = await import('../src/upgrade-transaction.js')
    const home = await root()
    const source = await root()
    const fs = await import('node:fs/promises')
    await fs.mkdir(join(source, 'packages/dsh-openspec'), { recursive: true })
    await writeFile(join(source, 'packages/dsh-openspec/package.json'), JSON.stringify({ dependencies: { '@fission-ai/openspec': '1.13.2' }, peerDependencies: { stable: 'yes' } }))
    await writeFile(join(source, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'packages/dsh-openspec': { dependencies: { '@fission-ai/openspec': '1.13.2' } }, 'node_modules/@fission-ai/openspec': { version: '1.13.2', integrity: 'sha512-old' } } }))
    await activateGeneration(home, 'gen-old', { skills: [{ name: 's', body: 'old body' }], invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/old'" })
    const options = { checkout: source, recordedCheckout: source, stateDir: join(home, 'plugins/dsh-openspec'), isWorktreeBound: false, stage: async (target: string) => ({ target, integrity: 'sha512-new', packageJson: { dependencies: { '@fission-ai/openspec': target } }, lockfile: { lockfileVersion: 3, packages: { 'packages/dsh-openspec': { dependencies: { '@fission-ai/openspec': target } }, 'node_modules/@fission-ai/openspec': { version: target, integrity: 'sha512-new' } } } }), verify: async () => true, activate: async (target: string) => activateGeneration(home, target, { skills: [], invocation: 'new' }), runSync: async () => true, crashAfterCas: true }
    const txn = createUpgradeTransaction(options)
    expect(await txn.upgrade('1.13.3', { approved: true, registryIntegrity: 'sha512-new' })).toMatchObject({ status: 'recovery-required' })
    expect((await loadGeneration(home)).id).toBe('gen-old')
    expect(await txn.inspectRecovery()).toBe('recovery-required')
    expect(await txn.upgrade('1.13.4', { approved: true, registryIntegrity: 'sha512-new' })).toMatchObject({ status: 'blocked', reason: 'recovery-required' })
  })
  it('loaded_generation_stays_executable_after_new_selection', async () => {
    const home = await root()
    const a = await activateGeneration(home, 'gen-a', { cli: 'old' })
    const b = await activateGeneration(home, 'gen-b', { cli: 'new' })
    expect((await loadGeneration(home, a.id)).cli).toBe('old')
    expect((await loadGeneration(home, b.id)).cli).toBe('new')
    expect(await readFile(join(home, 'plugins/dsh-openspec/active.json'), 'utf8')).toContain('gen-b')
  })

  it('activation_racing_a_load_never_mixes_body_and_block_generations', async () => {
    const home = await root()
    await activateGeneration(home, 'gen-a', { cli: 'a', skills: [{ name: 's', body: 'body-a' }], invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/a'" })
    const provider = createGenerationBackedProvider({ home, telemetry: 'adapter-off', updateCheck: 'disabled' })
    const loading = provider.get({ name: 's' })
    await activateGeneration(home, 'gen-b', { cli: 'b', skills: [{ name: 's', body: 'body-b' }], invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/b'" })
    const captured = await loading
    expect(captured?.content).toContain('body-a')
    expect(captured?.content).toContain('generation=gen-a')
  })

  it('materialization_copies_verified_cli_closure_into_generation', async () => {
    const { materializeGeneration } = await import('../src/generation-materializer.js')
    const home = await root(); const source = await root()
    const fs = await import('node:fs/promises')
    await fs.mkdir(join(source, 'bin'), { recursive: true })
    await fs.mkdir(join(source, 'dist/core'), { recursive: true })
    await writeFile(join(source, 'bin/openspec.js'), 'console.log("openspec 1.13.2")')
    await writeFile(join(source, 'dist/core/runtime.js'), 'export const ok=true')
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2', bin: { openspec: 'bin/openspec.js' } }))
    const identity = await materializeGeneration({ home, id: 'gen-cli', sourceRoot: source, version: '1.13.2', skills: [{ name: 's', body: 'b' }], invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/managed/openspec.js'" })
    expect(identity.files).toContain('bin/openspec.js')
    expect(await readFile(join(home, 'plugins/dsh-openspec/generations/gen-cli/bin/openspec.js'), 'utf8')).toContain('openspec 1.13.2')
    expect(await readFile(join(home, 'plugins/dsh-openspec/generations/gen-cli/package.json'), 'utf8')).toContain('1.13.2')
  })
  it('materialized_cli_dependency_closure_is_executable_without_profile_node_modules', async () => {
    const { materializeGeneration } = await import('../src/generation-materializer.js')
    const { spawnSync } = await import('node:child_process')
    const home = await root(); const source = await root(); const fs = await import('node:fs/promises')
    await fs.mkdir(join(source, 'bin'), { recursive: true }); await fs.mkdir(join(source, 'dist'), { recursive: true })
    await fs.mkdir(join(source, 'node_modules/tiny-dep'), { recursive: true })
    await writeFile(join(source, 'node_modules/tiny-dep/package.json'), JSON.stringify({ name: 'tiny-dep', version: '1.0.0', type: 'module', exports: './index.js' }))
    await writeFile(join(source, 'node_modules/tiny-dep/index.js'), 'export const value="dependency-ok"')
    await writeFile(join(source, 'bin/openspec.js'), 'const v="1.13.2"; import {value} from "tiny-dep"; console.log(value, v)')
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2', type: 'module', bin: { openspec: 'bin/openspec.js' }, dependencies: { 'tiny-dep': '1.0.0' } }))
    await materializeGeneration({ home, id: 'gen-deps', sourceRoot: source, version: '1.13.2', skills: [], invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/managed/bin/openspec.js'" })
    const executable = spawnSync(process.execPath, [join(home, 'plugins/dsh-openspec/generations/gen-deps/bin/openspec.js')], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } })
    expect(executable.status).toBe(0); expect(executable.stdout.trim()).toBe('dependency-ok 1.13.2')
  })
  it('lookup_without_cwd_returns_same_body_and_block', async () => {
    const home = await root()
    await activateGeneration(home, 'gen-a', { skills: [{ name: 's', body: 'same' }], invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'" })
    const provider = createGenerationBackedProvider({ home, telemetry: 'adapter-off', updateCheck: 'disabled' })
    expect((await provider.get({ name: 's' }))?.content).toEqual((await provider.get({ name: 's' }, { cwd: '/another' }))?.content)
  })

  it('missing_or_partial_generation_fails_with_typed_error_and_no_body', async () => {
    const home = await root()
    await activateGeneration(home, 'gen-a', { body: 'valid' })
    await writeFile(join(home, 'plugins/dsh-openspec/generations/gen-a/generation.json'), '{}')
    await expect(loadGeneration(home)).rejects.toMatchObject({ code: 'generation-invalid' })
  })
})
