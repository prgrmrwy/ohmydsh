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
  it('rejected_contender_does_not_remove_other_transactions_lock_or_release_owner_busy_state', async () => {
    const root = await fixture(); const home = await fixture()
    let resume!: () => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const wait = new Promise<void>(resolve => { resume = resolve })
    const owner = create(root, home, { stage: async (target: string) => { entered(); await wait; return staged(target) } })
    const pending = owner.upgrade('1.13.3', { approved: true }); await started
    const lock = join(home, 'plugins/dsh-openspec/upgrade.lock')
    try {
      expect(await create(root, home).upgrade('1.13.4', { approved: true })).toMatchObject({ status: 'blocked', reason: 'concurrent-transaction' })
      expect(await readFile(lock)).toBeDefined()
      expect(await owner.upgrade('1.13.4', { approved: true })).toMatchObject({ status: 'blocked', reason: 'concurrent-transaction' })
      expect(await readFile(lock)).toBeDefined()
    } finally { resume(); await pending }
    expect(await pending).toMatchObject({ status: 'ok' })
  })
  it('malformed_recovery_journal_is_reported_and_blocks_before_staging', async () => {
    const root = await fixture(), home = await fixture()
    const fs = await import('node:fs/promises'); await fs.mkdir(join(home, 'plugins/dsh-openspec'), { recursive: true })
    await writeFile(join(home, 'plugins/dsh-openspec/upgrade-journal.json'), '{broken')
    const stage = vi.fn(); const txn = create(root, home, { stage })
    expect(await txn.inspectRecovery()).toBe('recovery-required')
    expect(await txn.upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'blocked', reason: 'recovery-required' })
    expect(stage).not.toHaveBeenCalled()
  })
  it('recovery_drift_during_staging_and_forbidden_context_never_overwrites_user_changes', async () => {
    const root = await fixture(), home = await fixture()
    const txn = create(root, home, { crashAfterCas: true }); await txn.upgrade('1.13.3', { approved: true })
    const packagePath = join(root, 'packages/dsh-openspec/package.json')
    const journalPath = join(home, 'plugins/dsh-openspec/upgrade-journal.json')
    const journal = await readFile(journalPath)
    const stage = vi.fn(async (target: string) => { await writeFile(packagePath, '{"user":"edit during staging"}'); return staged(target) })
    const denied = create(root, home, { isWorktreeBound: true, stage })
    expect(await denied.recoverRollback({ approved: true })).toMatchObject({ status: 'blocked', reason: 'worktree-bound' })
    expect(stage).not.toHaveBeenCalled()
    const recovery = create(root, home, { stage })
    expect(await recovery.recoverRollback({ approved: true })).toMatchObject({ status: 'recovery-required', reason: 'source-edited-after-cas' })
    expect(await readFile(packagePath, 'utf8')).toBe('{"user":"edit during staging"}')
    expect(await readFile(journalPath)).toEqual(journal)
  })
  it('mismatched_source_pin_blocks_before_staging_and_staged_workspace_cannot_change_startup_metadata', async () => {
    const root = await fixture(), home = await fixture()
    const lockPath = join(root, 'package-lock.json'); const lock = JSON.parse(await readFile(lockPath, 'utf8'))
    lock.packages['node_modules/@fission-ai/openspec'].version = '9.9.9'; await writeFile(lockPath, JSON.stringify(lock))
    const stage = vi.fn(async (target: string) => { const result = staged(target); Object.assign(result.lockfile.packages['packages/dsh-openspec'], { peerDependencies: { injected: '*' }, dsh: { client: 'bad' } }); return result })
    expect(await create(root, home, { stage }).upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'blocked', reason: 'source-pin-mismatch' })
    expect(stage).not.toHaveBeenCalled()
    lock.packages['node_modules/@fission-ai/openspec'].version = '1.13.2'; await writeFile(lockPath, JSON.stringify(lock))
    expect(await create(root, home, { stage }).upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'ok' })
    const workspace = JSON.parse(await readFile(lockPath, 'utf8')).packages['packages/dsh-openspec']
    expect(workspace).not.toHaveProperty('peerDependencies'); expect(workspace).not.toHaveProperty('dsh')
  })
  it('same_source_in_two_profiles_is_serialized_before_second_stage', async () => {
    const root = await fixture(), homeA = await fixture(), homeB = await fixture()
    let resume!: () => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const wait = new Promise<void>(resolve => { resume = resolve })
    const owner = create(root, homeA, { stage: async (target: string) => { entered(); await wait; return staged(target) } })
    const pending = owner.upgrade('1.13.3', { approved: true }); await started
    const stage = vi.fn(async (target: string) => staged(target))
    try {
      expect(await create(root, homeB, { stage }).upgrade('1.13.4', { approved: true })).toMatchObject({ status: 'blocked', reason: 'concurrent-transaction' })
      expect(stage).not.toHaveBeenCalled()
    } finally { resume(); await pending }
  })
  it('unwritable_source_is_blocked_before_stage_or_journal_and_source_bytes_stay_identical', async () => {
    const root = await fixture(), home = await fixture()
    const { chmod } = await import('node:fs/promises')
    const path = join(root, 'packages/dsh-openspec/package.json'), before = await readFile(path)
    const stage = vi.fn(async (target: string) => staged(target))
    await chmod(path, 0o444)
    try {
      expect(await create(root, home, { stage }).upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'blocked', reason: 'source-unwritable' })
      expect(stage).not.toHaveBeenCalled(); expect(await readFile(path)).toEqual(before)
      await expect(readFile(join(home, 'plugins/dsh-openspec/upgrade-journal.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await chmod(path, 0o644) }
  })
  it('recovery_removes_only_transaction_added_closure_entries_and_preserves_unrelated_entries', async () => {
    const root = await fixture(), home = await fixture()
    const lockPath = join(root, 'package-lock.json'); const original = JSON.parse(await readFile(lockPath, 'utf8'))
    original.packages['node_modules/unrelated'] = { version: '3', integrity: 'sha512-unrelated' }; await writeFile(lockPath, JSON.stringify(original))
    const stage = async (target: string) => {
      const value: any = staged(target, target === '1.13.2' ? 'sha512-old' : 'sha512-new')
      value.lockfile.packages['node_modules/unrelated'] = original.packages['node_modules/unrelated']
      if (target === '1.13.3') value.lockfile.packages['node_modules/new-only'] = { version: '1', integrity: 'sha512-added' }
      return value
    }
    const txn = create(root, home, { stage, crashAfterCas: true })
    await txn.upgrade('1.13.3', { approved: true })
    expect(await txn.recoverRollback({ approved: true })).toMatchObject({ status: 'ok' })
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toEqual(original)
  })
  it.each(['package-only', 'lock-only', 'neither'])('prepared_journal_%s_source_state_recovers_without_rewriting_unchanged_lock', async state => {
    const root = await fixture(), home = await fixture()
    const packagePath = join(root, 'packages/dsh-openspec/package.json'), lockPath = join(root, 'package-lock.json')
    const beforePackage = await readFile(packagePath), beforeLock = await readFile(lockPath)
    const txn = create(root, home, { crashAfterCas: true })
    await txn.upgrade('1.13.3', { approved: true })
    if (state !== 'lock-only') await writeFile(lockPath, beforeLock)
    if (state !== 'package-only') await writeFile(packagePath, beforePackage)
    expect(await txn.recoverRollback({ approved: true })).toMatchObject({ status: 'ok', target: '1.13.2' })
    expect(JSON.parse(await readFile(packagePath, 'utf8'))).toEqual(JSON.parse(beforePackage.toString()))
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toEqual(JSON.parse(beforeLock.toString()))
    if (state !== 'lock-only') expect(await readFile(lockPath)).toEqual(beforeLock)
    if (state !== 'package-only') expect(await readFile(packagePath)).toEqual(beforePackage)
    expect(await txn.inspectRecovery()).toBe('none')
  })
  it('sync_failure_after_cas_reports_recovery_required_and_never_activates', async () => {
    const root = await fixture(), home = await fixture()
    await activateGeneration(home, '1.13.2', { cli: true })
    const activate = vi.fn(), txn = create(root, home, { activate, runSync: async () => false })
    expect(await txn.upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'recovery-required', reason: 'transaction-interrupted' })
    expect(activate).not.toHaveBeenCalled(); expect((await loadGeneration(home)).id).toBe('1.13.2')
    expect(await txn.inspectRecovery()).toBe('recovery-required')
    expect(await txn.recoverRollback({ approved: true })).toMatchObject({ status: 'ok' })
  })
  it('stable_version_only', () => { expect(validStableTarget('1.13.3')).toBe(true); expect(validStableTarget('latest')).toBe(false); expect(validStableTarget('1.13.3-beta.1')).toBe(false) })
})
