import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'session-updater-')); roots.push(root)
  const home = join(root, 'home'), checkout = join(root, "authoritative ' checkout"), project = join(root, 'project')
  await mkdir(join(home, 'plugins/dsh-openspec'), { recursive: true }); await mkdir(join(checkout, '.git'), { recursive: true }); await mkdir(project)
  await writeFile(join(home, 'plugins/dsh-openspec/source-checkout.json'), JSON.stringify({ schemaVersion: 1, checkout }))
  return { root, home, checkout, project }
}

// Injected staging/runner boundaries avoid registry or deployment effects; the real transaction helper writes only fixtures.
describe('session-owned management updater', () => {
  it('command_builder_is_quoted_read_only_and_refuses_unapproved_or_nonrecorded_caller', async () => {
    const { prepareSessionManagement } = await import('../src/session-management.js')
    const f = await fixture()
    const common = { home: f.home, node: process.execPath, updater: '/adapter/lib/session-updater.js' }
    const intent = { kind: 'upgrade', target: '1.13.3', approved: true } as const
    const ready = await prepareSessionManagement({ ...common, cwd: f.checkout, intent })
    expect(ready).toMatchObject({ status: 'ready', workdir: f.checkout })
    expect(ready.command).toContain("'/adapter/lib/session-updater.js'")
    expect(ready.command).toContain('--approve')
    expect(ready.command).toContain(`'${f.home}'`)
    expect(await prepareSessionManagement({ ...common, cwd: f.project, intent })).toMatchObject({ status: 'blocked', reason: 'non-recorded-checkout' })
    expect(await prepareSessionManagement({ ...common, cwd: f.checkout, intent: { ...intent, approved: false } })).toMatchObject({ status: 'blocked', reason: 'explicit-approval-required' })
    await writeFile(join(f.checkout, '.git-marker'), 'no mutation')
    await rm(join(f.checkout, '.git'), { recursive: true }); await writeFile(join(f.checkout, '.git'), 'gitdir: /main/.git/worktrees/task')
    expect(await prepareSessionManagement({ ...common, cwd: f.checkout, intent })).toMatchObject({ status: 'blocked', reason: 'worktree-bound' })
  })

  it('helper_blocks_before_network_or_source_writes_without_approval_and_on_wrong_cwd_or_worktree', async () => {
    const { runSessionManagement } = await import('../src/session-updater.js')
    const f = await fixture(); const stage = vi.fn(); const sync = vi.fn(); const refresh = vi.fn()
    const deps = { stage, sync, refresh }
    for (const input of [
      { kind: 'upgrade', target: '1.13.3', approved: false, cwd: f.checkout },
      { kind: 'upgrade', target: '1.13.3', approved: true, cwd: f.project },
      { kind: 'refresh-project', approved: false, cwd: f.project },
    ] as const) expect(await runSessionManagement({ home: f.home, ...input }, deps)).toMatchObject({ status: 'blocked' })
    await rm(join(f.checkout, '.git'), { recursive: true }); await writeFile(join(f.checkout, '.git'), 'gitdir: /main/.git/worktrees/task')
    expect(await runSessionManagement({ home: f.home, kind: 'upgrade', target: '1.13.3', approved: true, cwd: f.checkout }, deps)).toMatchObject({ status: 'blocked', reason: 'worktree-bound' })
    expect(stage).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
  })

  it('selected_generation_must_match_source_pin_before_staging_and_pending_reload_blocks_second_upgrade', async () => {
    const { runSessionManagement } = await import('../src/session-updater.js')
    const { activateGeneration } = await import('../src/generations.js')
    const f = await fixture(); await mkdir(join(f.checkout, 'packages/dsh-openspec'), { recursive: true })
    await writeFile(join(f.checkout, 'packages/dsh-openspec/package.json'), JSON.stringify({ dependencies: { '@fission-ai/openspec': '1.13.2' } }))
    await writeFile(join(f.checkout, 'package-lock.json'), JSON.stringify({ packages: { 'packages/dsh-openspec': { dependencies: { '@fission-ai/openspec': '1.13.2' } }, 'node_modules/@fission-ai/openspec': { version: '1.13.2' } } }))
    await activateGeneration(f.home, 'g1', { version: '1.13.1' })
    const stage = vi.fn(), sync = vi.fn(), refresh = vi.fn()
    expect(await runSessionManagement({ home: f.home, kind: 'upgrade', target: '1.13.3', approved: true, cwd: f.checkout }, { stage, sync, refresh })).toMatchObject({ status: 'blocked', reason: 'selected-source-mismatch' })
    expect(stage).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled()
  })
  it('approved_rollback_to_journal_previous_version_recovers_via_session_helper_without_new_grammar', async () => {
    const { runSessionManagement } = await import('../src/session-updater.js')
    const { createUpgradeTransaction } = await import('../src/upgrade-transaction.js')
    const { activateGeneration } = await import('../src/generations.js')
    const f = await fixture(); await mkdir(join(f.checkout, 'packages/dsh-openspec'), { recursive: true })
    const pkg = { dependencies: { '@fission-ai/openspec': '1.13.2' } }
    const lock = { packages: { 'packages/dsh-openspec': { dependencies: pkg.dependencies }, 'node_modules/@fission-ai/openspec': { version: '1.13.2', integrity: 'sha512-old' } } }
    await writeFile(join(f.checkout, 'packages/dsh-openspec/package.json'), JSON.stringify(pkg)); await writeFile(join(f.checkout, 'package-lock.json'), JSON.stringify(lock))
    await activateGeneration(f.home, 'g1', { version: '1.13.2' })
    const stage = vi.fn(async (_checkout: string, target: string) => ({ target, integrity: target === '1.13.2' ? 'sha512-old' : 'sha512-new', packageJson: pkg, lockfile: { packages: { ...lock.packages, 'node_modules/@fission-ai/openspec': { version: target, integrity: target === '1.13.2' ? 'sha512-old' : 'sha512-new' } } } }))
    const sync = vi.fn(async () => true), refresh = vi.fn()
    const transaction = createUpgradeTransaction({ checkout: f.checkout, recordedCheckout: f.checkout, stateDir: join(f.home, 'plugins/dsh-openspec'), isWorktreeBound: false, stage: target => stage(f.checkout, target), verify: async () => true, activate: async () => {}, runSync: sync, crashAfterCas: true })
    await transaction.upgrade('1.13.3', { approved: true }); stage.mockClear()
    const input = { home: f.home, kind: 'rollback', target: '1.13.2', approved: true, cwd: f.checkout } as const
    expect(await runSessionManagement(input, { stage, sync, refresh })).toMatchObject({ status: 'ok', target: '1.13.2' })
    expect(JSON.parse(await readFile(join(f.checkout, 'packages/dsh-openspec/package.json'), 'utf8'))).toEqual(pkg)
    expect(sync).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
  })
  it('approved_project_refresh_uses_only_the_callers_cwd_and_active_generation_cli', async () => {
    const { runSessionManagement } = await import('../src/session-updater.js')
    const { activateGeneration } = await import('../src/generations.js')
    const f = await fixture(); const cli = join(f.home, 'plugins/dsh-openspec/generations/g1/bin/openspec.js')
    await activateGeneration(f.home, 'g1', { cli, version: '1.13.2' })
    await mkdir(join(cli, '..'), { recursive: true }); await writeFile(cli, 'fixture')
    const stage = vi.fn(), sync = vi.fn(), refresh = vi.fn(async () => true)
    expect(await runSessionManagement({ home: f.home, kind: 'refresh-project', approved: true, cwd: f.project }, { stage, sync, refresh })).toMatchObject({ status: 'ok' })
    expect(refresh).toHaveBeenCalledWith(cli, f.project, 'adapter-off')
    expect(stage).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled()
    expect(await runSessionManagement({ home: f.home, kind: 'refresh-project', approved: true, cwd: f.project, telemetry: 'official' }, { stage, sync, refresh })).toMatchObject({ status: 'ok' })
    expect(refresh).toHaveBeenLastCalledWith(cli, f.project, 'official')
  })

  it('built_helper_runs_as_shell_child_and_refreshes_only_the_selected_workspace', async () => {
    const { prepareSessionManagement } = await import('../src/session-management.js')
    const { activateGeneration } = await import('../src/generations.js')
    const f = await fixture(); const other = join(f.root, 'other-project'); await mkdir(other)
    const cli = join(f.home, 'plugins/dsh-openspec/generations/g1/bin/openspec.js')
    await activateGeneration(f.home, 'g1', { cli, version: '1.13.2' })
    await mkdir(join(cli, '..'), { recursive: true })
    await writeFile(cli, "const fs=require('fs'); if(process.argv[2]!=='update')process.exit(2); fs.writeFileSync('refresh-cwd.txt',process.cwd())")
    const updater = fileURLToPath(new URL('../lib/session-updater.js', import.meta.url))
    const intent = { kind: 'refresh-project', approved: true } as const
    const plan = await prepareSessionManagement({ home: f.home, cwd: f.project, node: process.execPath, updater, intent })
    const result = spawnSync('sh', ['-c', plan.command!], { cwd: f.project, encoding: 'utf8', env: { PATH: process.env.PATH } })
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
    expect(result.stdout).toContain('"status":"ok"')
    expect(await readFile(join(f.project, 'refresh-cwd.txt'), 'utf8')).toBe(f.project)
    await expect(readFile(join(other, 'refresh-cwd.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const denied = spawnSync(process.execPath, [updater, '--home', f.home, 'refresh-project'], { cwd: other, encoding: 'utf8' })
    expect(denied.status).toBe(1); expect(denied.stdout).toContain('approval-required')
    await expect(readFile(join(other, 'refresh-cwd.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('approved_upgrade_reuses_real_transaction_and_preserves_active_generation_until_reload', async () => {
    const { runSessionManagement } = await import('../src/session-updater.js')
    const { activateGeneration } = await import('../src/generations.js')
    const f = await fixture()
    await mkdir(join(f.checkout, 'packages/dsh-openspec'), { recursive: true })
    const pkg = { name: 'dsh-openspec', dependencies: { '@fission-ai/openspec': '1.13.2', unchanged: '1.0.0' } }
    const lock = { lockfileVersion: 3, packages: { 'packages/dsh-openspec': { dependencies: pkg.dependencies }, 'node_modules/@fission-ai/openspec': { version: '1.13.2', integrity: 'sha512-old' } } }
    await writeFile(join(f.checkout, 'packages/dsh-openspec/package.json'), JSON.stringify(pkg)); await writeFile(join(f.checkout, 'package-lock.json'), JSON.stringify(lock))
    await activateGeneration(f.home, 'g1', { version: '1.13.2', skills: [{ name: 's', body: 'old' }] })
    const activePath = join(f.home, 'plugins/dsh-openspec/active.json'); const before = await readFile(activePath)
    const stage = vi.fn(async (_checkout: string, target: string) => ({ target, integrity: 'sha512-new', packageJson: pkg, lockfile: { ...lock, packages: { ...lock.packages, 'node_modules/@fission-ai/openspec': { version: target, integrity: 'sha512-new' } } } }))
    const sync = vi.fn(async () => true), refresh = vi.fn()
    expect(await runSessionManagement({ home: f.home, kind: 'upgrade', target: '1.13.3', approved: true, cwd: f.checkout }, { stage, sync, refresh })).toMatchObject({ status: 'ok', activation: 'pending-reload' })
    expect(stage).toHaveBeenCalledWith(f.checkout, '1.13.3'); expect(sync).toHaveBeenCalledWith(f.checkout, f.home)
    expect(JSON.parse(await readFile(join(f.checkout, 'packages/dsh-openspec/package.json'), 'utf8')).dependencies).toEqual({ ...pkg.dependencies, '@fission-ai/openspec': '1.13.3' })
    expect(createHash('sha256').update(await readFile(activePath)).digest('hex')).toBe(createHash('sha256').update(before).digest('hex'))
    expect(refresh).not.toHaveBeenCalled()
    const failed = await runSessionManagement({ home: f.home, kind: 'upgrade', target: '1.13.4', approved: true, cwd: f.checkout }, { stage: async () => { throw new Error('private-source-path-and-credential') }, sync, refresh })
    expect(failed).toMatchObject({ status: 'blocked', reason: 'selected-source-mismatch' })
    await activateGeneration(f.home, 'g2', { version: '1.13.3' })
    const normalized = await runSessionManagement({ home: f.home, kind: 'upgrade', target: '1.13.4', approved: true, cwd: f.checkout }, { stage: async () => { throw new Error('private-source-path-and-credential') }, sync, refresh })
    expect(normalized).toMatchObject({ status: 'failed', reason: 'session-updater-failed' })
    expect(JSON.stringify(failed)).not.toContain('credential')
  })
})
