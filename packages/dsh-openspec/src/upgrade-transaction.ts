import { createHash, randomUUID } from 'node:crypto'
import { open as openFile, rm } from 'node:fs/promises'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
    try {
      const checkout = await realpath(options.checkout).catch(() => undefined)
      const recorded = await realpath(options.recordedCheckout).catch(() => undefined)
      if (!checkout || !recorded || checkout !== recorded) return { status: 'blocked', reason: 'non-recorded-checkout' }
      const existingJournal = await readFile(journalPath, 'utf8').then(JSON.parse).catch(() => undefined)
      if (existingJournal && existingJournal.phase !== 'committed' && existingJournal.phase !== 'rolled-back') return { status: 'blocked', reason: 'recovery-required' }
      if (busy) return { status: 'blocked', reason: 'concurrent-transaction' }
      busy = true
      await mkdir(options.stateDir, { recursive: true })
      try { lock = await openFile(lockPathForTransaction, 'wx') }
      catch { return { status: 'blocked', reason: 'concurrent-transaction' } }
      const before = await readSource()
      const initialHashes = hashes(before)
      const staged = await options.stage(target)
      if (staged.target !== target || staged.integrity === '' || staged.lockfile.packages?.['node_modules/@fission-ai/openspec']?.integrity !== staged.integrity || staged.lockfile.packages?.['node_modules/@fission-ai/openspec']?.version !== target || !await options.verify(staged)) return { status: 'failed', reason: 'staging-or-integrity-check-failed' }
      const current = await readSource()
      if (hashes(current).packageJson !== initialHashes.packageJson || hashes(current).lockfile !== initialHashes.lockfile) return { status: 'blocked', reason: 'source-drift' }
      const oldPackage = JSON.parse(Buffer.from(before.packageBytes).toString('utf8'))
      const oldLock = JSON.parse(Buffer.from(before.lockBytes).toString('utf8'))
      const expectedPackage = { ...oldPackage, dependencies: { ...oldPackage.dependencies, '@fission-ai/openspec': target } }
      const expectedLock = structuredClone(oldLock)
      const workspaceLock = expectedLock.packages?.['packages/dsh-openspec']
      const stagedWorkspaceLock = staged.lockfile.packages?.['packages/dsh-openspec']
      const stagedOpenSpecLock = staged.lockfile.packages?.['node_modules/@fission-ai/openspec']
      const currentOpenSpecLock = expectedLock.packages?.['node_modules/@fission-ai/openspec']
      if (!workspaceLock || !stagedWorkspaceLock || !stagedOpenSpecLock || !currentOpenSpecLock) return { status: 'failed', reason: 'lockfile-closure-incomplete' }
      workspaceLock.dependencies = { ...(workspaceLock.dependencies ?? {}), '@fission-ai/openspec': target }
      for (const [key, value] of Object.entries(stagedWorkspaceLock)) if (key !== 'dependencies') workspaceLock[key] = value
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
      }
      await writeAtomic(journalPath, JSON.stringify(prepared))
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
      return { status: 'failed', reason: error instanceof Error ? error.message : 'transaction-failed' }
    } finally {
      busy = false
      await lock?.close().catch(() => {})
      await rm(lockPathForTransaction, { force: true }).catch(() => {})
    }
  }
  return {
    upgrade: transact,
    rollback: transact,
    async inspectRecovery() {
      try { const journal = JSON.parse(await readFile(journalPath, 'utf8')); return journal.phase === 'committed' || journal.phase === 'rolled-back' ? 'none' : 'recovery-required' }
      catch { return 'none' }
    },
    async recoverRollback(consent: { approved: boolean }) {
      if (!consent.approved) return { status: 'blocked', reason: 'explicit-approval-required' }
      const journal = await readFile(journalPath, 'utf8').then(JSON.parse).catch(() => undefined)
      if (!journal || journal.phase === 'committed') return { status: 'blocked', reason: 'no-recovery-needed' }
      const current = await readSource(); const now = hashes(current)
      if (now.packageJson !== journal.after.packageJson || now.lockfile !== journal.after.lockfile) return { status: 'recovery-required', reason: 'source-edited-after-cas', manualSteps: 'Reconcile package.json and package-lock.json manually; journal preserved.' }
      // Transaction snapshots intentionally store no source text; helper-only authorized rollback must stage exact previous target.
      const staged = await options.stage(journal.previousVersion)
      if (staged.integrity !== staged.lockfile.packages?.['node_modules/@fission-ai/openspec']?.integrity) return { status: 'recovery-required', reason: 'previous-target-integrity-mismatch' }
      const before = JSON.parse(await readFile(journalPath, 'utf8'))
      const beforeVersion = before.previousVersion
      const packageNow = JSON.parse(Buffer.from(current.packageBytes).toString('utf8'))
      const lockNow = JSON.parse(Buffer.from(current.lockBytes).toString('utf8'))
      const packageRestored = { ...packageNow, dependencies: { ...packageNow.dependencies, '@fission-ai/openspec': beforeVersion } }
      const lockRestored = structuredClone(lockNow)
      const currentWorkspace = staged.lockfile.packages?.['packages/dsh-openspec']
      const currentRootEntry = staged.lockfile.packages?.['node_modules/@fission-ai/openspec']
      const originalWorkspace = lockRestored.packages?.['packages/dsh-openspec']
      const originalEntry = lockRestored.packages?.['node_modules/@fission-ai/openspec']
      if (!currentWorkspace || !currentRootEntry || !originalWorkspace || !originalEntry) return { status: 'recovery-required', reason: 'rollback-lockfile-incomplete' }
      originalWorkspace.dependencies = { ...(originalWorkspace.dependencies ?? {}), '@fission-ai/openspec': beforeVersion }
      for (const [key, value] of Object.entries(currentWorkspace)) if (key !== 'dependencies') originalWorkspace[key] = value
      lockRestored.packages['node_modules/@fission-ai/openspec'] = { ...originalEntry, ...currentRootEntry, version: beforeVersion }
      await writeAtomic(packagePath, JSON.stringify(packageRestored, null, 2) + '\n')
      await writeAtomic(lockPath, JSON.stringify(lockRestored, null, 2) + '\n')
      await writeAtomic(journalPath, JSON.stringify({ ...journal, phase: 'rolled-back' }))
      return { status: 'ok', target: journal.previousVersion }
    },
  }
}
