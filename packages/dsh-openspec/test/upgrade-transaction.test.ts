import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUpgradeTransaction, validStableTarget } from '../src/upgrade-transaction.js'
import { activateGeneration, loadGeneration } from '../src/generations.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-openspec-txn-')); roots.push(root)
  await import('node:fs/promises').then(fs => fs.mkdir(join(root, 'packages/dsh-openspec'), { recursive: true }))
  await writeFile(join(root, 'packages/dsh-openspec/package.json'), JSON.stringify({ name: 'dsh-openspec', dependencies: { '@fission-ai/openspec': '1.13.2' }, peerDependencies: { stable: 'yes' } }))
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { workspaces: ['packages/dsh-openspec'] }, 'packages/dsh-openspec': { dependencies: { '@fission-ai/openspec': '1.13.2' } }, 'node_modules/@fission-ai/openspec': { version: '1.13.2', integrity: 'sha512-old' } } }))
  return root
}
function staged(target: string, integrity = 'sha512-new') { return { target, integrity, packageJson: { name: 'dsh-openspec', dependencies: { '@fission-ai/openspec': target }, peerDependencies: { stable: 'yes' } }, lockfile: { lockfileVersion: 3, packages: { '': { workspaces: ['packages/dsh-openspec'] }, 'packages/dsh-openspec': { dependencies: { '@fission-ai/openspec': target } }, 'node_modules/@fission-ai/openspec': { version: target, integrity } } } } }
function create(root: string, home: string, options: Record<string, unknown> = {}) {
  return createUpgradeTransaction({ checkout: root, recordedCheckout: root, stateDir: join(home, 'plugins/dsh-openspec'), isWorktreeBound: false, stage: async target => staged(target, target === '1.13.2' ? 'sha512-old' : 'sha512-new'), verify: async () => true, activate: async target => activateGeneration(home, target, { cli: true }), runSync: async () => true, ...options } as any)
}

describe('source-owned upgrade transactions', () => {
  it('approved_upgrade_commits_pin_and_lock_then_activates_and_can_upgrade_again', async () => {
    const root = await fixture(); const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-home-')); roots.push(home)
    await activateGeneration(home, '1.13.2', { cli: true })
    const txn = create(root, home)
    expect(await txn.upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'ok', activation: 'live' })
    expect(JSON.parse(await readFile(join(root, 'packages/dsh-openspec/package.json'), 'utf8')).dependencies['@fission-ai/openspec']).toBe('1.13.3')
    expect((await loadGeneration(home)).id).toBe('1.13.3')
    expect(await txn.upgrade('1.13.4', { approved: true })).toMatchObject({ status: 'ok' })
  })
  it('upgrade_changes_only_dependency_and_preserves_package_startup_fields', async () => {
    const root = await fixture(); const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-home-')); roots.push(home)
    const pkg = join(root, 'packages/dsh-openspec/package.json')
    const before = JSON.parse(await readFile(pkg, 'utf8')); before.scripts = { build: 'keep' }; before.exports = { '.': './lib/index.js' }; before.dsh = { client: './lib/client.js' }; before.peerDependenciesMeta = { cordis: { optional: true } }
    await writeFile(pkg, JSON.stringify(before, null, 2) + '\n')
    const txn = create(root, home)
    expect(await txn.upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'ok' })
    const after = JSON.parse(await readFile(pkg, 'utf8'))
    expect(after.dependencies['@fission-ai/openspec']).toBe('1.13.3')
    for (const field of ['scripts', 'exports', 'dsh', 'peerDependencies', 'peerDependenciesMeta']) expect(after[field]).toEqual(before[field])
    expect(after.name).toBe(before.name)
  })
  it('blocked_wrong_checkout_no_write', async () => {
    const root = await fixture(); const before = await readFile(join(root, 'packages/dsh-openspec/package.json'))
    const txn = createUpgradeTransaction({ checkout: root, recordedCheckout: '/different', stateDir: join(root, '.state'), isWorktreeBound: true, stage: vi.fn(), verify: vi.fn(), activate: vi.fn(), runSync: vi.fn() })
    expect(await txn.upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'blocked' })
    expect(await readFile(join(root, 'packages/dsh-openspec/package.json'))).toEqual(before)
  })
  it('authorized_recovery_restores_recorded_old_bytes_and_marks_journal_rolled_back', async () => {
    const root = await fixture(); const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-home-')); roots.push(home)
    const originalPackage = JSON.parse(await readFile(join(root, 'packages/dsh-openspec/package.json'), 'utf8'))
    const originalLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
    const txn = create(root, home, { crashAfterCas: true })
    expect(await txn.upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'recovery-required' })
    expect(await txn.recoverRollback({ approved: true })).toMatchObject({ status: 'ok', target: '1.13.2' })
    expect(JSON.parse(await readFile(join(root, 'packages/dsh-openspec/package.json'), 'utf8'))).toEqual(originalPackage)
    expect(JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))).toEqual(originalLock)
    expect(await txn.inspectRecovery()).toBe('none')
  })
  it('rollback_to_exact_target_uses_same_transaction_and_keeps_current_generation_on_failure', async () => {
    const root = await fixture(); const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-home-')); roots.push(home)
    await activateGeneration(home, '1.13.2', { cli: true })
    const txn = create(root, home)
    expect(await txn.upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'ok' })
    expect(await txn.rollback('1.13.2', { approved: true })).toMatchObject({ status: 'ok', target: '1.13.2' })
    expect(JSON.parse(await readFile(join(root, 'packages/dsh-openspec/package.json'), 'utf8')).dependencies['@fission-ai/openspec']).toBe('1.13.2')
    expect((await loadGeneration(home)).id).toBe('1.13.2')
  })
  it('crash_after_cas_is_recovery_required_and_new_upgrade_refused', async () => {
    const root = await fixture(); const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-home-')); roots.push(home)
    await activateGeneration(home, '1.13.2', { cli: true })
    const txn = create(root, home, { crashAfterCas: true })
    expect(await txn.upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'recovery-required' })
    expect((await loadGeneration(home)).id).toBe('1.13.2')
    expect(await txn.inspectRecovery()).toBe('recovery-required')
    expect(await txn.upgrade('1.13.4', { approved: true })).toMatchObject({ status: 'blocked', reason: 'recovery-required' })
  })
  it('user_edit_after_cas_blocks_rollback_without_modifying_source_or_journal', async () => {
    const root = await fixture(); const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-home-')); roots.push(home)
    const txn = create(root, home, { crashAfterCas: true })
    await txn.upgrade('1.13.3', { approved: true })
    const pkg = join(root, 'packages/dsh-openspec/package.json'); await writeFile(pkg, '{"user":"edit"}')
    const beforePkg = await readFile(pkg); const journal = join(home, 'plugins/dsh-openspec/upgrade-journal.json'); const beforeJournal = await readFile(journal)
    expect(await txn.recoverRollback({ approved: true })).toMatchObject({ status: 'recovery-required' })
    expect(await readFile(pkg)).toEqual(beforePkg); expect(await readFile(journal)).toEqual(beforeJournal)
  })
  it('stable_version_only', () => { expect(validStableTarget('1.13.3')).toBe(true); expect(validStableTarget('latest')).toBe(false); expect(validStableTarget('1.13.3-beta.1')).toBe(false) })
})
