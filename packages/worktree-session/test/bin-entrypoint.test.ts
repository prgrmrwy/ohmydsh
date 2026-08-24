import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSource, startOperation } from '../src/host/operation.js'

const exec = promisify(execFile)
const roots: string[] = []
const links: string[] = []
async function git(cwd: string, ...args: string[]): Promise<string> { return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout }
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-bin-')); roots.push(root)
  await git(root, 'init', '-b', 'main'); await git(root, 'config', 'user.email', 'ws@example.invalid'); await git(root, 'config', 'user.name', 'WS Test')
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n')
  await writeFile(join(root, '.gitignore'), '.env.local\nnode_modules/\n')
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'initial')
  return root
}
afterEach(async () => {
  await Promise.all([...roots, ...links].map(path => rm(path, { recursive: true, force: true })))
})

// The built artifact, mirroring what npm materializes in node_modules/.bin:
// a symlink whose realpath is the compiled cli.js, invoked as `node <symlink>`.
const here = dirname(fileURLToPath(import.meta.url))
const builtCli = join(here, '..', 'lib', 'cli.js')
const builtCliExists = existsSync(builtCli)

async function binLink(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ws-bin-link-')); links.push(dir)
  const link = join(dir, 'dsh-ws')
  await symlink(builtCli, link)
  return link
}

async function runViaBin(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [await binLink(), ...args], { encoding: 'utf8' })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const e = error as { code?: number | null; stdout?: string; stderr?: string }
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

describe('dsh-ws bin entrypoint', () => {
  describe.skipIf(!builtCliExists)('via npm bin symlink (skipped when lib/cli.js is missing)', () => {
    it('1.1 runs status and emits the operation report', async () => {
      const root = await fixture()
      const prepared = await startOperation({ operationId: 'operation-bin-1', repoPath: root, baseRef: 'main', taskText: 'bin status', dependencyMode: 'lean' })
      const { code, stdout, stderr } = await runViaBin(['status', prepared.worktreePath])
      expect(stderr).toBe('')
      expect(code).toBe(0)
      expect(JSON.parse(stdout).operationId).toBe('operation-bin-1')
    }, 120_000)

    it('1.2 runs clean --dry-run and actually evaluates the safety gates', async () => {
      const root = await fixture()
      const prepared = await startOperation({ operationId: 'operation-bin-2', repoPath: root, baseRef: 'main', taskText: 'bin clean', dependencyMode: 'lean' })
      await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-bin-2' })
      await git(root, 'merge', '--no-ff', prepared.taskBranch, '-m', 'merge')
      const { code, stdout, stderr } = await runViaBin(['clean', '--dry-run', prepared.worktreePath])
      expect(stderr).toBe('')
      expect(code).toBe(0)
      const plan = JSON.parse(stdout)
      expect(plan.dryRun).toBe(true)
      expect(plan.actions.length).toBeGreaterThan(0)
    }, 120_000)
  })

  it('1.3 importing the CLI module runs no command and prints nothing', async () => {
    if (!builtCliExists) return // same skip condition as above; nothing to import without the artifact
    const { stdout, stderr } = await exec(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(builtCli).href)})`], { encoding: 'utf8' })
    expect(stderr).toBe('')
    expect(stdout).toBe('')
  }, 30_000)
})