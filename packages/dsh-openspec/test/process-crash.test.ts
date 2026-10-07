import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUpgradeTransaction } from '../src/upgrade-transaction.js'
import { activateGeneration, loadGeneration, recoverGeneration } from '../src/generations.js'

const roots: string[] = [], locks: string[] = []
afterEach(async () => {
  await Promise.all(locks.splice(0).map(path => rm(path, { force: true })))
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
const staged = (target: string) => ({ target, integrity: `sha512-${target}`, packageJson: {}, lockfile: { packages: {
  'packages/dsh-openspec': { dependencies: { '@fission-ai/openspec': target } },
  'node_modules/@fission-ai/openspec': { version: target, integrity: `sha512-${target}` },
} } })

describe('real transaction process death', () => {
  it.each([false, true])('killed_after_cas_preserves_active_and_operator_recovery_respects_user_edit=%s', async userEdit => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'openspec-process-crash-'))); roots.push(root)
    const home = join(root, 'home'), checkout = join(root, 'checkout'), stateDir = join(home, 'plugins/dsh-openspec')
    await mkdir(join(checkout, 'packages/dsh-openspec'), { recursive: true })
    const packagePath = join(checkout, 'packages/dsh-openspec/package.json'), lockPath = join(checkout, 'package-lock.json')
    await writeFile(packagePath, JSON.stringify({ name: 'dsh-openspec', dependencies: { '@fission-ai/openspec': '1.13.2' } }))
    await writeFile(lockPath, JSON.stringify(staged('1.13.2').lockfile))
    await activateGeneration(home, 'healthy', { version: '1.13.2', skills: [{ name: 'old', body: 'healthy immutable instructions' }] })
    const activePath = join(stateDir, 'active.json'), activeBefore = await readFile(activePath)
    const moduleUrl = new URL('../lib/upgrade-transaction.js', import.meta.url).href
    // runSync is the actual boundary reached after both atomic source renames,
    // not crashAfterCas (which returns normally and runs finally cleanup).
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { createUpgradeTransaction } from ${JSON.stringify(moduleUrl)};
      const fixture=${JSON.stringify({ checkout, stateDir })};
      const target='1.13.3';
      const transaction=createUpgradeTransaction({ ...fixture, recordedCheckout:fixture.checkout, isWorktreeBound:false,
        stage:async()=>(${JSON.stringify(staged('1.13.3'))}), verify:async()=>true,
        runSync:async()=>{process.send({phase:'after-cas'});setInterval(()=>{},1000);return new Promise(()=>{});},
        activate:async()=>{throw new Error('must not activate');}});
      console.log(JSON.stringify(await transaction.upgrade(target,{approved:true})));
    `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    let stderr = ''; child.stderr!.on('data', bytes => { stderr += bytes })
    const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`child did not reach CAS: ${stderr}`)), 5_000)
        child.once('error', reject)
        child.once('exit', () => reject(new Error(`child exited before CAS: ${stderr}`)))
        child.once('message', message => { expect(message).toEqual({ phase: 'after-cas' }); resolve() })
      })
      child.kill('SIGKILL') // fixture child only: never a DSH process
      expect(await exited).toEqual({ code: null, signal: 'SIGKILL' })
    } finally { if (timer) clearTimeout(timer); child.kill('SIGKILL'); await exited }
    const sourceLock = join(tmpdir(), `dsh-openspec-source-${createHash('sha256').update(checkout).digest('hex')}.lock`); locks.push(sourceLock)
    const profileLock = join(stateDir, 'upgrade.lock'), journalPath = join(stateDir, 'upgrade-journal.json')
    const owner = JSON.parse(await readFile(sourceLock, 'utf8'))
    expect(owner).toMatchObject({ pid: child.pid, checkout, stateDir })
    expect(() => process.kill(owner.pid, 0)).toThrow()
    expect(await readFile(profileLock)).toBeDefined()
    expect(await readFile(activePath)).toEqual(activeBefore)
    expect((await loadGeneration(home)).version).toBe('1.13.2')
    expect(await recoverGeneration(home)).toMatchObject({ state: 'recovery-required' })
    expect(JSON.parse(await readFile(packagePath, 'utf8')).dependencies['@fission-ai/openspec']).toBe('1.13.3')
    const journal = await readFile(journalPath)
    const stage = vi.fn(async (target: string) => staged(target))
    const txn = createUpgradeTransaction({ checkout, recordedCheckout: checkout, stateDir, isWorktreeBound: false, stage, verify: async () => true, runSync: async () => true, activate: async () => {} })
    expect(await txn.upgrade('1.13.4', { approved: true })).toMatchObject({ status: 'blocked', reason: 'recovery-required' })
    expect(await txn.recoverRollback({ approved: true })).toMatchObject({ status: 'blocked', reason: 'concurrent-transaction' })
    expect(stage).not.toHaveBeenCalled()
    // Explicit operator action in this temporary fixture only. PID death and
    // source/profile identity were verified above; no automatic reclamation.
    await rm(profileLock); await rm(sourceLock)
    if (userEdit) await writeFile(packagePath, '{"user":"edit after crash"}')
    const beforeRecovery = await readFile(packagePath)
    // Recovery runs in another actual process with no inherited in-memory txn state.
    const recovering = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { createUpgradeTransaction } from ${JSON.stringify(moduleUrl)};
      const fixture=${JSON.stringify({ checkout, stateDir })};
      const old=${JSON.stringify(staged('1.13.2'))};
      const txn=createUpgradeTransaction({...fixture,recordedCheckout:fixture.checkout,isWorktreeBound:false,
        stage:async()=>old,verify:async()=>true,runSync:async()=>true,activate:async()=>{}});
      console.log(JSON.stringify(await txn.recoverRollback({approved:true})));
    `], { encoding: 'utf8', timeout: 5_000 })
    expect({ status: recovering.status, stderr: recovering.stderr }).toEqual({ status: 0, stderr: '' })
    const outcome = JSON.parse(recovering.stdout)
    if (userEdit) {
      expect(outcome).toMatchObject({ status: 'recovery-required', reason: 'source-edited-after-cas' })
      expect(await readFile(packagePath)).toEqual(beforeRecovery); expect(await readFile(journalPath)).toEqual(journal)
    } else {
      expect(outcome).toMatchObject({ status: 'ok', target: '1.13.2' })
      expect(JSON.parse(await readFile(packagePath, 'utf8')).dependencies['@fission-ai/openspec']).toBe('1.13.2')
      expect(await txn.inspectRecovery()).toBe('none')
    }
    expect(await readFile(activePath)).toEqual(activeBefore)
  })
})
