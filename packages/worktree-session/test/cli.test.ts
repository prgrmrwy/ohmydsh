import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/cli.js'
import { bindSource, startOperation } from '../src/host/operation.js'

const exec = promisify(execFile)
const roots: string[] = []
async function git(cwd: string, ...args: string[]): Promise<string> { return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout }
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-cli-')); roots.push(root)
  await git(root, 'init', '-b', 'main'); await git(root, 'config', 'user.email', 'ws@example.invalid'); await git(root, 'config', 'user.name', 'WS Test')
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n')
  await writeFile(join(root, '.gitignore'), '.env.local\nnode_modules/\n')
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'initial')
  return root
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('dsh-ws CLI', () => {
  it('prints secret-free status JSON from a nested worktree path', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-cli-1', repoPath: root, baseRef: 'main', taskText: 'cli status', dependencyMode: 'lean' })
    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { chunks.push(String(chunk)); return true })
    expect(await main(['status', prepared.worktreePath])).toBe(0)
    const output = chunks.join('')
    expect(JSON.parse(output).operationId).toBe('operation-cli-1')
    expect(JSON.parse(output).packageManager).toBe('npm')
    expect(output).not.toContain('TOKEN=')
  }, 120_000)

  it('prints a dry-run cleanup plan after ordinary merge proof', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-cli-2', repoPath: root, baseRef: 'main', taskText: 'cli clean', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-cli-2' })
    await git(root, 'merge', '--no-ff', prepared.taskBranch, '-m', 'merge')
    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { chunks.push(String(chunk)); return true })
    expect(await main(['clean', '--dry-run', prepared.worktreePath])).toBe(0)
    expect(JSON.parse(chunks.join('')).dryRun).toBe(true)
  }, 120_000)
})
