import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSource, startOperation } from '../src/host/operation.js'
import { recoverBindingSync } from '../src/host/recovery.js'
import { checkTool } from '../src/host/guard.js'

const exec = promisify(execFile)
const roots: string[] = []
async function git(cwd: string, ...args: string[]): Promise<string> { return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout }
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-recovery-')); roots.push(root)
  await git(root, 'init', '-b', 'main'); await git(root, 'config', 'user.email', 'ws@example.invalid'); await git(root, 'config', 'user.name', 'WS Test')
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n')
  await writeFile(join(root, '.gitignore'), '.env.local\nnode_modules/\n')
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'initial')
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('durable binding recovery', () => {
  it('synchronously restores and validates a source binding for session-start', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-recovery', repoPath: root, baseRef: 'main', taskText: 'recover binding', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-recovery' })
    const recovered = recoverBindingSync(root, 'session-recovery')
    expect(recovered).toMatchObject({ valid: true, operation: { operationId: prepared.operationId, taskBranch: prepared.taskBranch, worktreePath: prepared.worktreePath } })
    expect(recoverBindingSync(root, 'different-session')).toBeUndefined()
  }, 120_000)

  it('fails local tools closed when persisted worktree identity no longer validates', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-recovery-invalid', repoPath: root, baseRef: 'main', taskText: 'invalid recovery', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-invalid' })
    await git(prepared.worktreePath, 'checkout', '--detach')
    const recovered = recoverBindingSync(root, 'session-invalid')
    expect(recovered?.valid).toBe(false)
    expect(recovered?.diagnostic).toMatch(/does not equal|detached/)
    expect(checkTool({ name: 'bash', args: { workdir: prepared.worktreePath, command: 'git status' } }, recovered!.operation, recovered!.diagnostic)).toMatch(/绑定校验失败/)
  }, 120_000)
})
