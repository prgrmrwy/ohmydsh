import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stageTarget, type StageDependencies } from '../src/stage-target.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function checkout() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-openspec-stage-')); roots.push(root)
  await mkdir(join(root, 'packages/dsh-openspec'), { recursive: true })
  await writeFile(join(root, 'packages/dsh-openspec/package.json'), JSON.stringify({ name: 'dsh-openspec', dependencies: { '@fission-ai/openspec': '1.13.2' } }))
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'packages/dsh-openspec': { dependencies: { '@fission-ai/openspec': '1.13.2' } }, 'node_modules/@fission-ai/openspec': { version: '1.13.2', integrity: 'sha512-old', resolved: 'https://registry.npmjs.org/old.tgz' } } }))
  return root
}
function deps(overrides: Partial<StageDependencies> = {}, stageLockEntries: Record<string, unknown> = {}): StageDependencies {
  return {
    fetchMetadata: async () => ({ integrity: 'sha512-new', tarball: 'https://registry.npmjs.org/@fission-ai/openspec/-/openspec-1.13.3.tgz' }),
    install: async (stageDir, target) => {
      await writeFile(join(stageDir, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/@fission-ai/openspec': { version: target, integrity: 'sha512-new' }, ...stageLockEntries } }))
    },
    smoke: async () => true,
    parity: async () => true,
    ...overrides,
  }
}

describe('upgrade staging', () => {
  it('stages_exact_target_with_registry_integrity_and_changes_only_openspec_dependency', async () => {
    const root = await checkout()
    const staged = await stageTarget(root, '1.13.3', deps())
    expect(staged.packageJson.dependencies['@fission-ai/openspec']).toBe('1.13.3')
    expect(staged.lockfile.packages['node_modules/@fission-ai/openspec']).toMatchObject({ version: '1.13.3', integrity: 'sha512-new', resolved: 'https://registry.npmjs.org/@fission-ai/openspec/-/openspec-1.13.3.tgz' })
    expect(staged.lockfile.packages['packages/dsh-openspec'].dependencies['@fission-ai/openspec']).toBe('1.13.3')
  })
  it('rejects_integrity_mismatch_non_official_tarball_failed_smoke_or_parity_before_any_result', async () => {
    const root = await checkout()
    await expect(stageTarget(root, '1.13.3', deps({ fetchMetadata: async () => ({ integrity: 'sha512-registry', tarball: 'https://registry.npmjs.org/x.tgz' }) }))).rejects.toThrow('registry-integrity-mismatch')
    await expect(stageTarget(root, '1.13.3', deps({ fetchMetadata: async () => ({ integrity: 'sha512-new', tarball: 'https://evil.example/x.tgz' }) }))).rejects.toThrow('registry-integrity-invalid')
    await expect(stageTarget(root, '1.13.3', deps({ smoke: async () => false }))).rejects.toThrow('cli-smoke-failed')
    await expect(stageTarget(root, '1.13.3', deps({ parity: async () => false }))).rejects.toThrow('renderer-parity-failed')
  })
  it('adds_new_transitive_entries_but_refuses_conflicting_existing_ones', async () => {
    const root = await checkout()
    const added = await stageTarget(root, '1.13.3', deps({}, { 'node_modules/tiny': { version: '1.0.0', integrity: 'sha512-tiny' } }))
    expect(added.lockfile.packages['node_modules/tiny']).toMatchObject({ version: '1.0.0' })
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages: { 'packages/dsh-openspec': { dependencies: {} }, 'node_modules/@fission-ai/openspec': { version: '1.13.2', integrity: 'sha512-old' }, 'node_modules/tiny': { version: '0.9.0', integrity: 'sha512-other' } } }))
    await expect(stageTarget(root, '1.13.3', deps({}, { 'node_modules/tiny': { version: '1.0.0', integrity: 'sha512-tiny' } }))).rejects.toThrow('lockfile-closure-conflict')
  })
  it('removes_the_staging_directory_even_on_failure', async () => {
    const root = await checkout(); const seen: string[] = []
    const install = vi.fn(async (stageDir: string) => { seen.push(stageDir); throw new Error('stage-install-failed') })
    await expect(stageTarget(root, '1.13.3', deps({ install }))).rejects.toThrow('stage-install-failed')
    const { access } = await import('node:fs/promises')
    await expect(access(seen[0]!)).rejects.toThrow()
  })
})
