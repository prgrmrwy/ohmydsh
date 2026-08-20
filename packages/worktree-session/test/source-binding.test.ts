import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverRepo } from '../src/host/git.js'
import { atomicJson, readJson } from '../src/host/fs.js'
import { bindSource, findBySourceSession, loadOperation, operationFile, sessionStatus, startOperation, updateSourceBinding } from '../src/host/operation.js'
import { wsClean } from '../src/host/maintenance.js'
import { bindingOf, type OperationRecord } from '../src/wire.js'

const exec = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-bind-'))
  roots.push(root)
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.email', 'ws@example.invalid')
  await git(root, 'config', 'user.name', 'WS Test')
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n')
  await writeFile(join(root, '.gitignore'), '.env.local\nnode_modules/\n')
  await writeFile(join(root, '.env.local'), 'TOKEN=secret\n')
  await git(root, 'add', 'package.json', 'package-lock.json', '.gitignore')
  await git(root, 'commit', '-m', 'initial')
  return root
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function prepared(root: string, taskText = 'source bind task'): Promise<string> {
  const operationId = `operation-${Math.random().toString(16).slice(2, 14)}`
  await startOperation({ operationId, repoPath: root, baseRef: 'main', taskText, dependencyMode: 'lean' })
  return operationId
}

describe('source-session binding (schema-v2)', () => {
  it('writes schema-v2 and resolves tasks for a bound source Session', async () => {
    const root = await fixture()
    const operationId = await prepared(root)
    const bound = await bindSource({ operationId, repoPath: root, sourceSessionId: 'session-main-1' })
    expect(bound.state).toBe('bound')
    expect(bound.submitAllowed).toBe(false)
    const repo = await discoverRepo(root)
    const record = await loadOperation(repo.gitCommonDir, operationId)
    expect(record?.schemaVersion).toBe(2)
    const binding = bindingOf(record!)
    expect(binding?.mode).toBe('source-session')
    const bySession = await findBySourceSession(repo.gitCommonDir, 'session-main-1')
    expect(bySession?.operationId).toBe(operationId)
    const status = await sessionStatus(root, 'session-main-1')
    expect(status.bound).toBe(true)
    expect(status.operationId).toBe(operationId)
    expect(status.cleaned).toBe(false)
    expect(status.dependencyMode).toBe('lean')
  }, 120_000)

  it('persists exactly-once submit claim and refuses automatic resubmission', async () => {
    const root = await fixture()
    const operationId = await prepared(root)
    await bindSource({ operationId, repoPath: root, sourceSessionId: 'session-main-2' })
    const first = await updateSourceBinding({ operationId, repoPath: root, sourceSessionId: 'session-main-2', action: 'claim-submit' })
    expect(first.state).toBe('submit-claimed')
    expect(first.submitAllowed).toBe(true)
    const second = await updateSourceBinding({ operationId, repoPath: root, sourceSessionId: 'session-main-2', action: 'claim-submit' })
    expect(second.state).toBe('submit-claimed')
    expect(second.submitAllowed).toBe(false)
    const repo = await discoverRepo(root)
    expect((await readJson<OperationRecord>(operationFile(repo.gitCommonDir, operationId)))?.binding).toMatchObject({ mode: 'source-session', state: 'submit-claimed', sourceSessionId: 'session-main-2' })
  }, 120_000)

  it('moves to admitted and then cleaned without changing the source Session relation', async () => {
    const root = await fixture()
    const operationId = await prepared(root)
    await bindSource({ operationId, repoPath: root, sourceSessionId: 'session-main-3' })
    const admitted = await updateSourceBinding({ operationId, repoPath: root, sourceSessionId: 'session-main-3', action: 'admitted' })
    expect(admitted.state).toBe('admitted')
    const status = await sessionStatus(root, 'session-main-3')
    expect(status.lifecycle).toBe('admitted')
    const repo = await discoverRepo(root)
    await updateSourceBinding({ operationId, repoPath: root, sourceSessionId: 'session-main-3', action: 'cleaned' })
    const afterClean = await readJson<OperationRecord>(operationFile(repo.gitCommonDir, operationId))
    expect(bindingOf(afterClean!)?.mode).toBe('source-session')
    expect(bindingOf(afterClean!)?.state).toBe('cleaned')
    expect((await sessionStatus(root, 'session-main-3')).cleaned).toBe(true)
  }, 120_000)

  it('rejects conflicting bindings without overwriting an existing owned Session', async () => {
    const root = await fixture()
    const operationId = await prepared(root)
    const other = await prepared(root, 'other task')
    await bindSource({ operationId, repoPath: root, sourceSessionId: 'session-a' })
    await expect(bindSource({ operationId: other, repoPath: root, sourceSessionId: 'session-a' })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' })
    const repo = await discoverRepo(root)
    const first = await findBySourceSession(repo.gitCommonDir, 'session-a')
    expect(first?.operationId).toBe(operationId)
    const byOther = await findBySourceSession(repo.gitCommonDir, 'session-a')
    expect(byOther?.operationId).toBe(operationId)
  }, 120_000)

  it('refuses to rebind an operation to another source Session after binding', async () => {
    const root = await fixture()
    const operationId = await prepared(root)
    await bindSource({ operationId, repoPath: root, sourceSessionId: 'session-a' })
    await expect(bindSource({ operationId, repoPath: root, sourceSessionId: 'session-b' })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' })
    const repo = await discoverRepo(root)
    const binding = bindingOf(await loadOperation(repo.gitCommonDir, operationId) as OperationRecord)
    expect(binding?.mode === 'source-session' ? binding.sourceSessionId : '').toBe('session-a')
  }, 120_000)

  it('fails closed on schema-v1 metadata on read and never fabricates a binding', async () => {
    const root = await fixture()
    const operationId = await prepared(root)
    const repo = await discoverRepo(root)
    const file = operationFile(repo.gitCommonDir, operationId)
    const record = await readJson<OperationRecord>(file)
    // Simulate a v1 record: keep the file but strip schemaVersion to a v1 view.
    await atomicJson(file, { ...record, schemaVersion: 1, binding: undefined, handoff: { state: 'target-bound', targetSessionId: 'target-session-legacy', updatedAt: new Date().toISOString() } })
    // Reading a v1 operation reports a clear unsupported-version diagnostic.
    await expect(loadOperation(repo.gitCommonDir, operationId)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION' })
    // Reading must not rewrite the file or fabricate a source binding.
    const persisted = await readJson<unknown>(file) as OperationRecord
    expect(persisted?.schemaVersion).toBe(1)
    expect(persisted?.binding).toBeUndefined()
    expect(persisted?.handoff).toBeTruthy()
    // Session resolution never returns a v1 operation as a source-session binding.
    await expect(sessionStatus(root, 'session-main-1')).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION' })
  }, 120_000)

  it('refuses clean when the target worktree is itself active for an open Session', async () => {
    const root = await fixture()
    const operationId = await prepared(root)
    await bindSource({ operationId, repoPath: root, sourceSessionId: 'session-main-active' })
    const repo = await discoverRepo(root)
    const record = await loadOperation(repo.gitCommonDir, operationId) as OperationRecord
    // A Host-observed active path equal to or inside the target worktree must block clean.
    await expect(wsClean(record.worktreePath, { dryRun: true, requireActivePaths: true, activePaths: [record.worktreePath] })).rejects.toMatchObject({ code: 'CLEAN_REFUSED' })
  }, 120_000)
})
