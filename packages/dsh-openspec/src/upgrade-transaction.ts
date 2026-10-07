import { createHash, randomUUID } from 'node:crypto'
import { open as openFile, rm } from 'node:fs/promises'
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { validStableTarget } from './upgrade-version.js'
export { validStableTarget } from './upgrade-version.js'

type Staged = { target: string; integrity: string; packageJson: Record<string, any>; lockfile: Record<string, any> }
type Hashes = { packageJson: string; lockfile: string }
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

export function createUpgradeTransaction(options: {
  checkout: string
  recordedCheckout: string
  stateDir: string
  isWorktreeBound: boolean
  stage: (target: string) => Promise<Staged>
  verify: (staged: Staged) => Promise<boolean>
  activate: (target: string) => Promise<unknown>  // may return { activation: 'pending-reload' } when the target cannot be rendered in this process
  runSync: () => Promise<boolean>
  crashAfterCas?: boolean
}) {
  const packagePath = resolve(options.checkout, 'packages/dsh-openspec/package.json')
  const lockPath = resolve(options.checkout, 'package-lock.json')
  const journalPath = resolve(options.stateDir, 'upgrade-journal.json')
  let busy = false
  const lockPathForTransaction = resolve(options.stateDir, 'upgrade.lock')
  const writableSource = async () => {
    for (const path of [packagePath, lockPath, dirname(packagePath), dirname(lockPath)]) {
      const info = await stat(path)
      if ((info.mode & 0o222) === 0) return false
      await access(path, constants.W_OK)
    }
    return true
  }
  const sourceLockPath = async () => resolve(tmpdir(), `dsh-openspec-source-${hash(await realpath(options.checkout))}.lock`)
  const readSource = async () => ({ packageBytes: await readFile(packagePath), lockBytes: await readFile(lockPath) })
  const hashes = (source: { packageBytes: Uint8Array; lockBytes: Uint8Array }): Hashes => ({ packageJson: hash(source.packageBytes), lockfile: hash(source.lockBytes) })
  const writeAtomic = async (path: string, value: string) => {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${randomUUID()}.tmp`
    await writeFile(temp, value, { flag: 'wx' })
    await rename(temp, path)
  }
  async function transact(target: string, consent: { approved: boolean }) {
    if (!consent.approved) return { status: 'blocked', reason: 'explicit-approval-required' }
    if (!validStableTarget(target)) return { status: 'blocked', reason: 'invalid-stable-version' }
    if (options.isWorktreeBound) return { status: 'blocked', reason: 'worktree-bound' }
    let lock: Awaited<ReturnType<typeof openFile>> | undefined
    let ownsBusy = false
    let sourceLock: Awaited<ReturnType<typeof openFile>> | undefined
    let sourceLockFile: string | undefined
    let journalPrepared = false
    try {
      const checkout = await realpath(options.checkout).catch(() => undefined)
      const recorded = await realpath(options.recordedCheckout).catch(() => undefined)
      if (!checkout || !recorded || checkout !== recorded) return { status: 'blocked', reason: 'non-recorded-checkout' }
      if (!await writableSource().catch(() => false)) return { status: 'blocked', reason: 'source-unwritable' }
      let existingJournal: any
      try { existingJournal = JSON.parse(await readFile(journalPath, 'utf8')) }
      catch (error: any) { if (error.code !== 'ENOENT') return { status: 'blocked', reason: 'recovery-required' } }
      if (existingJournal && existingJournal.phase !== 'committed' && existingJournal.phase !== 'rolled-back') return { status: 'blocked', reason: 'recovery-required' }
      if (busy) return { status: 'blocked', reason: 'concurrent-transaction' }
      busy = true
      ownsBusy = true
      await mkdir(options.stateDir, { recursive: true })
      try { lock = await openFile(lockPathForTransaction, 'wx') }
      catch { return { status: 'blocked', reason: 'concurrent-transaction' } }
      sourceLockFile = await sourceLockPath()
      try { sourceLock = await openFile(sourceLockFile, 'wx', 0o600); await sourceLock.writeFile(JSON.stringify({ pid: process.pid, checkout, stateDir: options.stateDir })) }
      catch { return { status: 'blocked', reason: 'concurrent-transaction' } }
      // Another process can publish its journal between our preflight and lock acquisition.
      try {
        const journal = JSON.parse(await readFile(journalPath, 'utf8'))
        if (journal.phase !== 'committed' && journal.phase !== 'rolled-back') return { status: 'blocked', reason: 'recovery-required' }
      } catch (error: any) { if (error.code !== 'ENOENT') return { status: 'blocked', reason: 'recovery-required' } }
      const before = await readSource()
      const initialHashes = hashes(before)
      const oldPackage = JSON.parse(Buffer.from(before.packageBytes).toString('utf8'))
      const oldLock = JSON.parse(Buffer.from(before.lockBytes).toString('utf8'))
      const pin = oldPackage.dependencies?.['@fission-ai/openspec']
      if (!validStableTarget(pin) || oldLock.packages?.['packages/dsh-openspec']?.dependencies?.['@fission-ai/openspec'] !== pin || oldLock.packages?.['node_modules/@fission-ai/openspec']?.version !== pin) return { status: 'blocked', reason: 'source-pin-mismatch' }
      const staged = await options.stage(target)
      if (staged.target !== target || staged.integrity === '' || staged.lockfile.packages?.['node_modules/@fission-ai/openspec']?.integrity !== staged.integrity || staged.lockfile.packages?.['node_modules/@fission-ai/openspec']?.version !== target || !await options.verify(staged)) return { status: 'failed', reason: 'staging-or-integrity-check-failed' }
      const current = await readSource()
      if (hashes(current).packageJson !== initialHashes.packageJson || hashes(current).lockfile !== initialHashes.lockfile) return { status: 'blocked', reason: 'source-drift' }
      const expectedPackage = { ...oldPackage, dependencies: { ...oldPackage.dependencies, '@fission-ai/openspec': target } }
      const expectedLock = structuredClone(oldLock)
      const workspaceLock = expectedLock.packages?.['packages/dsh-openspec']
      const stagedWorkspaceLock = staged.lockfile.packages?.['packages/dsh-openspec']
      const stagedOpenSpecLock = staged.lockfile.packages?.['node_modules/@fission-ai/openspec']
      const currentOpenSpecLock = expectedLock.packages?.['node_modules/@fission-ai/openspec']
      if (!workspaceLock || !stagedWorkspaceLock || !stagedOpenSpecLock || !currentOpenSpecLock) return { status: 'failed', reason: 'lockfile-closure-incomplete' }
      workspaceLock.dependencies = { ...(workspaceLock.dependencies ?? {}), '@fission-ai/openspec': target }
      expectedLock.packages['node_modules/@fission-ai/openspec'] = { ...currentOpenSpecLock, ...stagedOpenSpecLock }
      for (const [key, entry] of Object.entries<any>(staged.lockfile.packages ?? {})) {
        if (!key.startsWith('node_modules/') || key === 'node_modules/@fission-ai/openspec') continue
        const existing = expectedLock.packages[key]
        if (!existing) { expectedLock.packages[key] = entry; continue }
        if (existing.version !== entry.version || existing.integrity !== entry.integrity) return { status: 'failed', reason: 'lockfile-closure-conflict' }
      }
      const prepared = {
        schemaVersion: 1, transactionId: randomUUID(), target, phase: 'prepared',
        before: initialHashes,
        after: { packageJson: hash(JSON.stringify(expectedPackage, null, 2) + '\n'), lockfile: hash(JSON.stringify(expectedLock, null, 2) + '\n') },
        previousVersion: oldPackage.dependencies?.['@fission-ai/openspec'],
        addedClosure: Object.keys(expectedLock.packages).filter(key => !(key in oldLock.packages)).map(key => ({ key, hash: hash(JSON.stringify(expectedLock.packages[key])) })),
      }
      await writeAtomic(journalPath, JSON.stringify(prepared))
      journalPrepared = true
      const stillCurrent = await readSource()
      if (hashes(stillCurrent).packageJson !== initialHashes.packageJson || hashes(stillCurrent).lockfile !== initialHashes.lockfile) return { status: 'blocked', reason: 'source-drift' }
      await writeAtomic(packagePath, JSON.stringify(expectedPackage, null, 2) + '\n')
      await writeAtomic(lockPath, JSON.stringify(expectedLock, null, 2) + '\n')
      if (options.crashAfterCas) return { status: 'recovery-required', reason: 'crash-after-cas' }
      if (!await options.runSync()) throw new Error('sync-failed')
      const activated = await options.activate(target)
      await writeAtomic(journalPath, JSON.stringify({ ...prepared, phase: 'committed' }))
      return { status: 'ok', target, activation: (activated as { activation?: string } | undefined)?.activation === 'pending-reload' ? 'pending-reload' as const : 'live' as const }
    } catch (error) {
      return journalPrepared ? { status: 'recovery-required', reason: 'transaction-interrupted' } : { status: 'failed', reason: error instanceof Error ? error.message : 'transaction-failed' }
    } finally {
      if (sourceLock) { await sourceLock.close().catch(() => {}); await rm(sourceLockFile!, { force: true }).catch(() => {}) }
      if (ownsBusy) busy = false
      if (lock) {
        await lock.close().catch(() => {})
        await rm(lockPathForTransaction, { force: true }).catch(() => {})
      }
    }
  }
  return {
    upgrade: transact,
    rollback: transact,
    async inspectRecovery() {
      try { const journal = JSON.parse(await readFile(journalPath, 'utf8')); return journal.phase === 'committed' || journal.phase === 'rolled-back' ? 'none' : 'recovery-required' }
      catch (error: any) { return error.code === 'ENOENT' ? 'none' : 'recovery-required' }
    },
    async recoverRollback(consent: { approved: boolean }) {
      if (!consent.approved) return { status: 'blocked', reason: 'explicit-approval-required' }
      if (options.isWorktreeBound) return { status: 'blocked', reason: 'worktree-bound' }
      let lock: Awaited<ReturnType<typeof openFile>> | undefined
      let ownsBusy = false
      let sourceLock: Awaited<ReturnType<typeof openFile>> | undefined
      let sourceLockFile: string | undefined
      const drift = () => ({ status: 'recovery-required', reason: 'source-edited-after-cas', manualSteps: 'Reconcile package.json and package-lock.json manually; journal preserved.' })
      try {
        const checkout = await realpath(options.checkout).catch(() => undefined)
        const recorded = await realpath(options.recordedCheckout).catch(() => undefined)
        if (!checkout || checkout !== recorded) return { status: 'blocked', reason: 'non-recorded-checkout' }
        if (!await writableSource().catch(() => false)) return { status: 'blocked', reason: 'source-unwritable' }
        if (busy) return { status: 'blocked', reason: 'concurrent-transaction' }
        busy = true; ownsBusy = true
        await mkdir(options.stateDir, { recursive: true })
        try { lock = await openFile(lockPathForTransaction, 'wx') }
        catch { return { status: 'blocked', reason: 'concurrent-transaction' } }
        sourceLockFile = await sourceLockPath()
        try { sourceLock = await openFile(sourceLockFile, 'wx', 0o600); await sourceLock.writeFile(JSON.stringify({ pid: process.pid, checkout, stateDir: options.stateDir })) }
        catch { return { status: 'blocked', reason: 'concurrent-transaction' } }
        const journalBytes = await readFile(journalPath, 'utf8')
        const journal = JSON.parse(journalBytes)
        if (journal.phase === 'committed' || journal.phase === 'rolled-back') return { status: 'blocked', reason: 'no-recovery-needed' }
        if (!validStableTarget(journal.previousVersion) || !journal.after || !journal.before) return { status: 'recovery-required', reason: 'journal-invalid' }
        const current = await readSource(); const now = hashes(current)
        const packageChanged = now.packageJson !== journal.before.packageJson
        const lockChanged = now.lockfile !== journal.before.lockfile
        if ((packageChanged && now.packageJson !== journal.after.packageJson) || (lockChanged && now.lockfile !== journal.after.lockfile)) return drift()
        if (!packageChanged && !lockChanged) {
          // Prepared but no source CAS occurred: resolve only the guarded journal.
          const fresh = hashes(await readSource())
          if (fresh.packageJson !== now.packageJson || fresh.lockfile !== now.lockfile || await readFile(journalPath, 'utf8') !== journalBytes) return drift()
          await writeAtomic(journalPath, JSON.stringify({ ...journal, phase: 'rolled-back' }))
          return { status: 'ok', target: journal.previousVersion }
        }
        // No saved source text: reconstruct the exact old dependency target using validated staging.
        const staged = await options.stage(journal.previousVersion)
        const rootEntry = staged.lockfile.packages?.['node_modules/@fission-ai/openspec']
        if (staged.target !== journal.previousVersion || rootEntry?.version !== journal.previousVersion || !staged.integrity || staged.integrity !== rootEntry.integrity || !await options.verify(staged)) return { status: 'recovery-required', reason: 'previous-target-integrity-mismatch' }
        const packageNow = JSON.parse(Buffer.from(current.packageBytes).toString('utf8'))
        const lockRestored = JSON.parse(Buffer.from(current.lockBytes).toString('utf8'))
        const packageRestored = { ...packageNow, dependencies: { ...packageNow.dependencies, '@fission-ai/openspec': journal.previousVersion } }
        const workspace = lockRestored.packages?.['packages/dsh-openspec']
        if (!workspace || !staged.lockfile.packages?.['packages/dsh-openspec']) return { status: 'recovery-required', reason: 'rollback-lockfile-incomplete' }
        workspace.dependencies = { ...workspace.dependencies, '@fission-ai/openspec': journal.previousVersion }
        lockRestored.packages['node_modules/@fission-ai/openspec'] = rootEntry
        for (const [key, entry] of Object.entries<any>(staged.lockfile.packages)) {
          if (!key.startsWith('node_modules/') || key === 'node_modules/@fission-ai/openspec') continue
          const existing = lockRestored.packages[key]
          if (existing && (existing.version !== entry.version || existing.integrity !== entry.integrity)) return { status: 'recovery-required', reason: 'lockfile-closure-conflict' }
          if (!existing) lockRestored.packages[key] = entry
        }
        for (const added of lockChanged ? journal.addedClosure ?? [] : []) {
          if (typeof added.key !== 'string' || !added.key.startsWith('node_modules/') || added.key === 'node_modules/@fission-ai/openspec' || hash(JSON.stringify(lockRestored.packages[added.key])) !== added.hash) return { status: 'recovery-required', reason: 'journal-invalid' }
          delete lockRestored.packages[added.key]
        }
        // Staging and verification await external work: recheck both source and the exact journal before CAS.
        const fresh = hashes(await readSource())
        if (fresh.packageJson !== now.packageJson || fresh.lockfile !== now.lockfile || await readFile(journalPath, 'utf8') !== journalBytes) return drift()
        if (packageChanged) await writeAtomic(packagePath, JSON.stringify(packageRestored, null, 2) + '\n')
        if (lockChanged) await writeAtomic(lockPath, JSON.stringify(lockRestored, null, 2) + '\n')
        await writeAtomic(journalPath, JSON.stringify({ ...journal, phase: 'rolled-back' }))
        return { status: 'ok', target: journal.previousVersion }
      } catch { return { status: 'recovery-required', reason: 'recovery-failed' } }
      finally {
        if (sourceLock) { await sourceLock.close().catch(() => {}); await rm(sourceLockFile!, { force: true }).catch(() => {}) }
        if (ownsBusy) busy = false
        if (lock) { await lock.close().catch(() => {}); await rm(lockPathForTransaction, { force: true }).catch(() => {}) }
      }
    },
  }
}
