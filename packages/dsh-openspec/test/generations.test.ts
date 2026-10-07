import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { activateGeneration, loadGeneration } from '../src/generations.js'
import { createGenerationBackedProvider } from '../src/generation-provider.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function root() { const dir = await mkdtemp(join(tmpdir(), 'dsh-openspec-gen-')); roots.push(dir); return dir }

async function invocationFor(home: string, id: string) {
  const { managedInvocation } = await import('../src/managed-invocation.js')
  return managedInvocation({ node: process.execPath, cli: join(home, 'plugins/dsh-openspec/generations', id, 'bin/openspec.js'), telemetry: 'adapter-off' })
}

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
    const identity = await materializeGeneration({ home, id: 'gen-cli', sourceRoot: source, version: '1.13.2', skills: [{ name: 's', body: 'b' }], invocation: await invocationFor(home, 'gen-cli') })
    expect(identity.files).toContain('bin/openspec.js')
    expect(await readFile(join(home, 'plugins/dsh-openspec/generations/gen-cli/bin/openspec.js'), 'utf8')).toContain('openspec 1.13.2')
    expect(await readFile(join(home, 'plugins/dsh-openspec/generations/gen-cli/package.json'), 'utf8')).toContain('1.13.2')
  })
  it('materialization_accepts_real_shaped_cli_whose_entry_file_does_not_embed_the_version', async () => {
    const { materializeGeneration } = await import('../src/generation-materializer.js')
    const home = await root(); const source = await root(); const fs = await import('node:fs/promises')
    await fs.mkdir(join(source, 'bin'), { recursive: true }); await fs.mkdir(join(source, 'dist/cli'), { recursive: true })
    // Real official layout: a 4-line bin entry; the version lives in package.json and is read by dist/cli/index.js.
    await writeFile(join(source, 'bin/openspec.js'), "#!/usr/bin/env node\nimport { runCli } from '../dist/cli/index.js';\nrunCli();\n")
    await writeFile(join(source, 'dist/cli/index.js'), "import { createRequire } from 'node:module'\nconst require = createRequire(import.meta.url)\nexport function runCli() { console.log(require('../../package.json').version) }\n")
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2', type: 'module', bin: { openspec: './bin/openspec.js' } }))
    const invocation = await invocationFor(home, 'gen-real')
    const generation = await materializeGeneration({ home, id: 'gen-real', sourceRoot: source, version: '1.13.2', skills: [{ name: 's', body: 'b' }], invocation })
    expect(generation.id).toBe('gen-real')
    expect((await loadGeneration(home)).id).toBe('gen-real')
  })
  it('materialization_rejects_a_cli_that_reports_a_different_version_and_exposes_no_generation', async () => {
    const { materializeGeneration } = await import('../src/generation-materializer.js')
    const home = await root(); const source = await root(); const fs = await import('node:fs/promises')
    await fs.mkdir(join(source, 'bin'), { recursive: true })
    await writeFile(join(source, 'bin/openspec.js'), "console.log('9.9.9')\n")
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2', type: 'module', bin: { openspec: './bin/openspec.js' } }))
    const invocation = await invocationFor(home, 'gen-bad')
    await expect(materializeGeneration({ home, id: 'gen-bad', sourceRoot: source, version: '1.13.2', skills: [], invocation })).rejects.toThrow(/^cli-smoke-failed$/)
    await expect(loadGeneration(home)).rejects.toMatchObject({ code: 'generation-invalid' })
  })
  it('recorded_invocation_is_executable_exactly_as_the_model_would_run_it_and_a_foreign_path_is_rejected', async () => {
    const { materializeGeneration } = await import('../src/generation-materializer.js')
    const { managedInvocation } = await import('../src/managed-invocation.js')
    const { spawnSync } = await import('node:child_process')
    const home = await root(); const source = await root(); const fs = await import('node:fs/promises')
    await fs.mkdir(join(source, 'bin'), { recursive: true })
    await writeFile(join(source, 'bin/openspec.js'), "console.log('1.13.2')\n")
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2', type: 'module', bin: { openspec: './bin/openspec.js' } }))
    const cli = join(home, 'plugins/dsh-openspec/generations/gen-run/bin/openspec.js')
    const invocation = managedInvocation({ node: process.execPath, cli, telemetry: 'adapter-off' })
    await materializeGeneration({ home, id: 'gen-run', sourceRoot: source, version: '1.13.2', skills: [{ name: 's', body: 'b' }], invocation })
    const recorded = (await loadGeneration(home)).invocation as string
    expect(recorded).toBe(invocation)
    const ran = spawnSync('sh', ['-c', `${recorded} --version`], { encoding: 'utf8', env: { PATH: process.env.PATH } })
    expect({ status: ran.status, out: ran.stdout.trim() }).toEqual({ status: 0, out: '1.13.2' })
    const foreign = managedInvocation({ node: process.execPath, cli: join(home, 'elsewhere/bin/openspec.js'), telemetry: 'adapter-off' })
    await expect(materializeGeneration({ home, id: 'gen-other', sourceRoot: source, version: '1.13.2', skills: [], invocation: foreign })).rejects.toThrow('invocation-path-mismatch')
    expect((await loadGeneration(home)).id).toBe('gen-run')
  })
  it('existing_generation_with_a_different_recorded_invocation_is_an_identity_collision_not_silently_reused', async () => {
    const { materializeGeneration } = await import('../src/generation-materializer.js')
    const home = await root(); const source = await root(); const fs = await import('node:fs/promises')
    await fs.mkdir(join(source, 'bin'), { recursive: true })
    await writeFile(join(source, 'bin/openspec.js'), "console.log('1.13.2')\n")
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2', type: 'module', bin: { openspec: './bin/openspec.js' } }))
    const good = await invocationFor(home, 'gen-same')
    const skills = [{ name: 's', body: 'b' }]
    await materializeGeneration({ home, id: 'gen-same', sourceRoot: source, version: '1.13.2', skills, invocation: good })
    // Same identity and skills, same invocation: idempotent reuse stays allowed.
    expect((await materializeGeneration({ home, id: 'gen-same', sourceRoot: source, version: '1.13.2', skills, invocation: good })).id).toBe('gen-same')
    // A previously materialized generation that recorded a broken path must be reported, never served as-is.
    const manifestPath = join(home, 'plugins/dsh-openspec/generations/gen-same/generation.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.invocation = good.replace('/bin/openspec.js', '/bin/bin/openspec.js')
    await writeFile(manifestPath, JSON.stringify(manifest))
    await expect(materializeGeneration({ home, id: 'gen-same', sourceRoot: source, version: '1.13.2', skills, invocation: good })).rejects.toThrow('generation-identity-collision')
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
    await materializeGeneration({ home, id: 'gen-deps', sourceRoot: source, version: '1.13.2', skills: [], invocation: await invocationFor(home, 'gen-deps') })
    const executable = spawnSync(process.execPath, [join(home, 'plugins/dsh-openspec/generations/gen-deps/bin/openspec.js')], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } })
    expect(executable.status).toBe(0); expect(executable.stdout.trim()).toBe('dependency-ok 1.13.2')
  })
  it('materialization_retains_selection_delivery_and_reuses_without_manifest_rewrite_or_staging_leak', async () => {
    const { materializeGeneration } = await import('../src/generation-materializer.js')
    const fs = await import('node:fs/promises')
    const home = await root(), source = await root()
    await fs.mkdir(join(source, 'bin'), { recursive: true })
    await writeFile(join(source, 'bin/openspec.js'), "console.log('1.13.2')\n")
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2', type: 'module', bin: { openspec: './bin/openspec.js' } }))
    const input = { home, id: 'metadata', sourceRoot: source, version: '1.13.2', skills: [], invocation: await invocationFor(home, 'metadata'), selectionFingerprint: 'fp-1', delivery: 'commands' }
    await materializeGeneration(input)
    expect(await loadGeneration(home)).toMatchObject({ selectionFingerprint: 'fp-1', delivery: 'commands' })
    const path = join(home, 'plugins/dsh-openspec/generations/metadata/generation.json')
    const before = await readFile(path)
    await materializeGeneration(input)
    expect(await readFile(path)).toEqual(before)
    expect(await fs.readdir(join(home, 'plugins/dsh-openspec/generations'))).toEqual(['metadata'])
    await expect(materializeGeneration({ ...input, delivery: 'skills' })).rejects.toThrow('generation-identity-collision')
    expect(await readFile(path)).toEqual(before)
  })

  it('cancelled_materialization_never_activates_and_removes_only_its_staging_directory', async () => {
    const { materializeGeneration } = await import('../src/generation-materializer.js')
    const fs = await import('node:fs/promises')
    const home = await root(), source = await root()
    await activateGeneration(home, 'previous', { skills: [], invocation: 'prior' })
    await fs.mkdir(join(source, 'bin'), { recursive: true })
    await writeFile(join(source, 'bin/openspec.js'), "console.log('1.13.2')")
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2', bin: { openspec: 'bin/openspec.js' } }))
    await expect(materializeGeneration({ home, id: 'cancelled', sourceRoot: source, version: '1.13.2', skills: [], invocation: await invocationFor(home, 'cancelled'), canActivate: () => false })).rejects.toThrow('generation-cancelled')
    expect((await loadGeneration(home)).id).toBe('previous')
    expect(await fs.readdir(join(home, 'plugins/dsh-openspec/generations'))).toEqual(['previous'])
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
